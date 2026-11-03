/**
 * WebServerService
 *
 * Embeds an HTTP + WebSocket server in the main process to serve the
 * Totality UI to web browsers on the LAN.
 *
 * Security:
 * - PIN required by default (enforced — no access without PIN set)
 * - Session tokens bound to originating IP
 * - Rate-limited auth (5 failures → 60s lockout per IP)
 * - Artwork endpoint restricted to known artwork directories only
 * - Sensitive settings (PIN, API keys) blocked from web modification
 * - WebSocket message size limited to 1MB
 * - Security headers on all HTTP responses
 */

import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import zlib from 'zlib'
import os from 'os'
import { app } from 'electron'
import selfsigned from 'selfsigned'
import { WebSocketServer, WebSocket } from 'ws'
import { WEB_DENIED_CHANNELS, WEB_SENSITIVE_SETTINGS } from '../../shared/ipcChannelMap'
import { getDatabase } from '../database/getDatabase'
import { getCredentialEncryptionService } from './CredentialEncryptionService'
import { SETTING_KEYS } from '../../shared/settingKeys'
import { getLoggingService } from './LoggingService'

// Types
interface RpcMessage {
  type: 'rpc'
  id: number
  channel: string
  args: unknown[]
  token?: string
}

interface AuthMessage {
  type: 'auth'
  pin: string
}

interface Session {
  expiresAt: number
  ip: string
}

interface RateLimitEntry {
  failures: number
  lockedUntil: number
  lockoutCount: number
}

type WebMessage = RpcMessage | AuthMessage

interface AuthenticatedWebSocket extends WebSocket {
  sessionToken?: string
  clientIp?: string
  isAlive?: boolean
}

// MIME types for static file serving
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

const DEFAULT_PORT = 9470
const MAX_AUTH_FAILURES = 5
const AUTH_LOCKOUT_MS = 60_000
const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000
const MAX_WS_MESSAGE_SIZE = 1024 * 1024 // 1MB
const ARTWORK_RATE_LIMIT = 100 // max requests per window
const ARTWORK_RATE_WINDOW_MS = 10_000 // 10 seconds
const MAX_SESSIONS_PER_IP = 10
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/** Constant-time string comparison to prevent timing attacks on PIN */
function timingSafeCompare(a: string, b: string): boolean {
  // Hash both to ensure equal length for timingSafeEqual
  const hashA = crypto.createHash('sha256').update(a).digest()
  const hashB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

// Settings that web clients must NOT be allowed to modify
const PROTECTED_SETTINGS: Set<string> = new Set([
  SETTING_KEYS.web_access_pin,
  SETTING_KEYS.web_access_enabled,
  SETTING_KEYS.web_access_port,
  SETTING_KEYS.web_access_session_timeout,
  SETTING_KEYS.gemini_api_key,
  SETTING_KEYS.tmdb_api_key,
  SETTING_KEYS.musicbrainz_api_token,
  SETTING_KEYS.plex_token,
  SETTING_KEYS.web_access_ip_allowlist,
])

export class WebServerService {
  private httpServer: http.Server | https.Server | null = null
  private httpRedirectServer: http.Server | null = null
  private wss: WebSocketServer | null = null
  private handlerMap: Map<string, Function>
  private sessions = new Map<string, Session>()
  private rateLimits = new Map<string, RateLimitEntry>()
  private artworkRateLimits = new Map<string, { count: number; windowStart: number }>()
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null
  private port = DEFAULT_PORT
  private staticRoot: string
  private devServerUrl: string | null = null
  private artworkBasePath: string
  private tlsDir: string
  private eventThrottles = new Map<WebSocket, Map<string, number>>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private cachePruneTimer: ReturnType<typeof setInterval> | null = null

  private readonly THROTTLED_EVENTS = new Set([
    'library:updated', 'quality:analysisProgress', 'music:scanProgress',
    'music:qualityProgress', 'music:completenessProgress', 'sources:scanProgress',
    'series:progress', 'collections:progress',
  ])
  private readonly EVENT_THROTTLE_MS = 1000

  constructor(handlerMap: Map<string, Function>, devServerUrl?: string) {
    this.handlerMap = handlerMap
    this.devServerUrl = devServerUrl || null
    this.staticRoot = path.join(__dirname, '../../dist')
    this.artworkBasePath = path.join(app.getPath('userData'), 'artwork')
    this.tlsDir = path.join(app.getPath('userData'), 'tls')
  }

  /** Load persisted sessions from database (survive app restarts) */
  private loadPersistedSessions(): void {
    try {
      const db = getDatabase()
      const raw = db.getSetting('web_sessions')
      if (!raw) return
      const entries = JSON.parse(raw) as Array<[string, Session]>
      const now = Date.now()
      for (const [token, session] of entries) {
        if (session.expiresAt > now) {
          this.sessions.set(token, session)
        }
      }
      getLoggingService().verbose('WebServer', `Restored ${this.sessions.size} persisted sessions`)
    } catch (err) {
      console.warn('[WebServer] Failed to restore sessions:', (err as Error).message)
    }
  }

  /** Save current sessions to database */
  private persistSessions(): void {
    try {
      const db = getDatabase()
      const entries = Array.from(this.sessions.entries())
      db.setSetting('web_sessions', JSON.stringify(entries))
    } catch (err) {
      console.warn('[WebServer] Failed to persist sessions:', (err as Error).message)
    }
  }

  async start(port?: number): Promise<void> {
    if (this.httpServer) return

    // Security: require PIN to be set before allowing web access
    if (!this.isPinRequired()) {
      console.warn('[WebServer] Cannot start: no PIN configured. Set a PIN in Settings → General → Web Access.')
      throw new Error('Web access requires a PIN. Set one in Settings → General → Web Access.')
    }

    this.port = port || this.getConfiguredPort()
    this.loadPersistedSessions()

    // Create HTTP or HTTPS server
    const useHttps = this.isHttpsEnabled()
    if (useHttps) {
      const tlsCert = await this.ensureTlsCertificate()
      this.httpServer = https.createServer(tlsCert, (req, res) => this.handleHttp(req, res))
      console.log('[WebServer] HTTPS enabled')
    } else {
      this.httpServer = http.createServer((req, res) => this.handleHttp(req, res))
    }
    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: MAX_WS_MESSAGE_SIZE,
      perMessageDeflate: {
        zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
        zlibInflateOptions: { chunkSize: 10 * 1024 },
        threshold: 1024, // Only compress messages > 1KB
      },
    })

    this.wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
      // Origin validation — reject connections from unexpected origins (CSRF protection)
      const origin = req.headers.origin
      if (origin) {
        try {
          const originUrl = new URL(origin)
          const expectedPort = String(this.port)
          // Allow connections from our own server or localhost
          if (originUrl.port !== expectedPort && originUrl.hostname !== 'localhost' && originUrl.hostname !== '127.0.0.1') {
            console.warn(`[WebServer] Rejected WebSocket from unexpected origin: ${origin}`)
            ws.close(4003, 'Origin not allowed')
            return
          }
        } catch {
          ws.close(4003, 'Invalid origin')
          return
        }
      }

      ws.clientIp = req.socket.remoteAddress || 'unknown'

      // IP allowlist check
      if (!this.isIpAllowed(ws.clientIp)) {
        console.warn(`[WebServer] Rejected WebSocket from non-allowlisted IP: ${ws.clientIp}`)
        ws.close(4003, 'IP not allowed')
        return
      }

      getLoggingService().verbose('WebServer', `WebSocket connected from ${ws.clientIp} (clients: ${this.wss!.clients.size})`)
      ws.isAlive = true

      ws.on('pong', () => { ws.isAlive = true })
      ws.on('message', (data) => this.handleWebSocket(ws, data))
      ws.on('close', (code, reason) => {
        this.eventThrottles.delete(ws)
        getLoggingService().verbose('WebServer', `WebSocket disconnected from ${ws.clientIp} (code: ${code}, reason: ${reason || 'none'}, clients: ${this.wss!.clients.size})`)
      })
      ws.on('error', (err) => {
        console.error('[WebServer] WebSocket error:', err.message)
      })
    })

    // Heartbeat: ping every 30s, terminate unresponsive clients
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return
      for (const client of this.wss.clients) {
        const ws = client as AuthenticatedWebSocket
        if (ws.isAlive === false) {
          ws.terminate()
          continue
        }
        ws.isAlive = false
        ws.ping()
      }
    }, 30_000)

    return new Promise((resolve, reject) => {
      let settled = false
      this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
        if (!settled) {
          settled = true
          this.httpServer = null
          this.wss = null
          if (err.code === 'EADDRINUSE') {
            console.error(`[WebServer] Port ${this.port} is already in use`)
            reject(new Error(`Port ${this.port} is already in use`))
          } else {
            reject(err)
          }
        } else {
          console.error('[WebServer] Server error:', err.message)
        }
      })

      this.httpServer!.listen(this.port, '0.0.0.0', () => {
        settled = true
        const proto = useHttps ? 'https' : 'http'
        console.log(`[WebServer] Listening on ${proto}://0.0.0.0:${this.port}`)

        // Prune stale image cache on startup and periodically (every hour)
        this.pruneImageCache()
        this.cachePruneTimer = setInterval(() => this.pruneImageCache(), 60 * 60 * 1000)

        // When HTTPS is enabled, start an HTTP companion on port+1 for cert download + redirect
        if (useHttps) {
          const httpPort = this.port + 1
          this.httpRedirectServer = http.createServer((req, res) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`)
            // Serve cert download over plain HTTP
            if (url.pathname === '/api/cert') {
              this.handleHttp(req, res)
              return
            }
            // Redirect everything else to HTTPS
            const host = (req.headers.host || '').replace(`:${httpPort}`, `:${this.port}`)
            res.writeHead(302, { Location: `https://${host}${req.url}` })
            res.end()
          })
          this.httpRedirectServer.listen(httpPort, '0.0.0.0', () => {
            console.log(`[WebServer] HTTP cert server on http://0.0.0.0:${httpPort}`)
          })
          this.httpRedirectServer.on('error', () => {
            // Non-critical — HTTPS still works without the HTTP companion
            console.warn(`[WebServer] Could not start HTTP companion on port ${httpPort}`)
          })
        }

        // Periodic cleanup of expired sessions and rate limit entries
        this.sessionCleanupTimer = setInterval(() => {
          const now = Date.now()
          let cleaned = false
          for (const [token, session] of this.sessions.entries()) {
            if (session.expiresAt < now) { this.sessions.delete(token); cleaned = true }
          }
          if (cleaned) this.persistSessions()
          // Evict expired rate limit entries
          for (const [ip, entry] of this.rateLimits.entries()) {
            if (entry.lockedUntil < now && entry.failures === 0) this.rateLimits.delete(ip)
          }
          // Evict stale artwork rate limit entries (older than 2x window)
          for (const [ip, entry] of this.artworkRateLimits.entries()) {
            if (now - entry.windowStart > ARTWORK_RATE_WINDOW_MS * 2) this.artworkRateLimits.delete(ip)
          }
        }, SESSION_CLEANUP_INTERVAL_MS)

        resolve()
      })
    })
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer)
      this.sessionCleanupTimer = null
    }
    if (this.cachePruneTimer) {
      clearInterval(this.cachePruneTimer)
      this.cachePruneTimer = null
    }
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close(1001, 'Server shutting down')
      }
      this.wss.close()
      this.wss = null
    }
    if (this.httpRedirectServer) {
      this.httpRedirectServer.close()
      this.httpRedirectServer = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
    this.sessions.clear()
    console.log('[WebServer] Stopped')
  }

  isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening
  }

  getPort(): number {
    return this.port
  }

  getConnectedClients(): number {
    return this.wss ? this.wss.clients.size : 0
  }

  /** Broadcast an event to all authenticated WebSocket clients */
  broadcastEvent(channel: string, ...args: unknown[]): void {
    if (!this.wss) return

    const message = JSON.stringify({ type: 'event', channel, args })
    const now = Date.now()
    const isThrottled = this.THROTTLED_EVENTS.has(channel)
    let sent = 0
    let throttled = 0

    for (const client of this.wss.clients) {
      const ws = client as AuthenticatedWebSocket
      if (ws.readyState === WebSocket.OPEN && ws.sessionToken && this.sessions.has(ws.sessionToken)) {
        if (isThrottled) {
          let clientThrottles = this.eventThrottles.get(ws)
          if (!clientThrottles) {
            clientThrottles = new Map()
            this.eventThrottles.set(ws, clientThrottles)
          }
          const lastSent = clientThrottles.get(channel) || 0
          if (now - lastSent < this.EVENT_THROTTLE_MS) {
            throttled++
            continue
          }
          clientThrottles.set(channel, now)
        }
        ws.send(message)
        sent++
      }
    }

    if (sent > 0 || throttled > 0) {
      getLoggingService().verbose('WebServer', `Broadcast ${channel}: sent=${sent} throttled=${throttled} size=${(message.length / 1024).toFixed(1)}KB`)
    }
  }

  // ---------------------------------------------------------------------------
  // Security Headers
  // ---------------------------------------------------------------------------

  private setSecurityHeaders(res: http.ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '1; mode=block')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self' ws: wss:; font-src 'self' data:")
  }

  // ---------------------------------------------------------------------------
  // HTTP Handler
  // ---------------------------------------------------------------------------

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
    this.setSecurityHeaders(res)

    // IP allowlist check
    const clientIp = req.socket.remoteAddress || 'unknown'
    if (!this.isIpAllowed(clientIp)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden')
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // Image proxy — serves Plex/Jellyfin artwork through Totality to avoid mixed content
    if (url.pathname === '/api/proxy-image') {
      this.handleProxyImage(url, res)
      return
    }

    // Certificate download endpoint — allows users to trust the self-signed cert
    if (url.pathname === '/api/cert') {
      const certPath = path.join(this.tlsDir, 'cert.pem')
      if (fs.existsSync(certPath)) {
        const cert = fs.readFileSync(certPath)
        res.writeHead(200, {
          'Content-Type': 'application/x-pem-file',
          'Content-Disposition': 'attachment; filename="totality-cert.pem"',
        })
        res.end(cert)
      } else {
        res.writeHead(404)
        res.end('No certificate')
      }
      return
    }

    // Artwork endpoint — restricted to app's artwork directory, rate-limited
    if (url.pathname === '/api/artwork') {
      this.handleArtwork(url, res, req.socket.remoteAddress)
      return
    }

    // In dev mode, proxy to Vite dev server for hot-reloading
    if (this.devServerUrl) {
      this.proxyToDevServer(req, res)
      return
    }

    // Serve static files from dist/
    this.serveStatic(url.pathname, req, res)
    } catch (err) {
      console.error('[WebServer] HTTP handler error:', err)
      if (!res.headersSent) {
        res.writeHead(500)
        res.end('Internal Server Error')
      }
    }
  }

  private handleArtwork(url: URL, res: http.ServerResponse, clientIp?: string): void {
    // Rate limit artwork requests per IP
    const ip = clientIp || 'unknown'
    const now = Date.now()
    const rateEntry = this.artworkRateLimits.get(ip) || { count: 0, windowStart: now }
    if (now - rateEntry.windowStart > ARTWORK_RATE_WINDOW_MS) {
      rateEntry.count = 0
      rateEntry.windowStart = now
    }
    rateEntry.count++
    this.artworkRateLimits.set(ip, rateEntry)
    if (rateEntry.count > ARTWORK_RATE_LIMIT) {
      res.writeHead(429)
      res.end('Too many requests')
      return
    }

    const filePath = url.searchParams.get('path')
    if (!filePath) {
      res.writeHead(400)
      res.end('Missing path parameter')
      return
    }

    // Validate file extension
    const ext = path.extname(filePath).toLowerCase()
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
    if (!allowedExts.includes(ext)) {
      res.writeHead(403)
      res.end('Forbidden file type')
      return
    }

    // Security: only serve files from the app's artwork directory
    const resolved = path.resolve(filePath)
    const normalizedArtwork = path.resolve(this.artworkBasePath)
    if (!resolved.startsWith(normalizedArtwork + path.sep) && resolved !== normalizedArtwork) {
      console.warn(`[WebServer] Blocked artwork request outside allowed directory: ${filePath}`)
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      })
      res.end(data)
    })
  }

  private imageCacheDir = path.join(app.getPath('userData'), 'image-cache')
  private imageCacheMaxBytes = 500 * 1024 * 1024 // 500MB
  private imageCacheMaxAge = 7 * 24 * 60 * 60 * 1000 // 7 days

  private handleProxyImage(url: URL, res: http.ServerResponse): void {
    const imageUrl = url.searchParams.get('url')
    if (!imageUrl) {
      res.writeHead(400)
      res.end('Missing url parameter')
      return
    }

    // Only proxy URLs from local/private networks or known media services
    let parsedUrl: URL
    try {
      parsedUrl = new URL(imageUrl)
    } catch {
      res.writeHead(400)
      res.end('Invalid URL')
      return
    }

    // Allow: private IPs (IPv4 + IPv6), Plex domains, TMDB, Jellyfin/Emby local servers
    const hostname = parsedUrl.hostname
    const isAllowed = hostname === 'localhost' || hostname === '127.0.0.1' ||
      hostname === '::1' || hostname === '[::1]' ||
      hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
      hostname.startsWith('fc') || hostname.startsWith('fd') ||
      hostname.endsWith('.plex.direct') ||
      hostname === 'image.tmdb.org' ||
      hostname === 'coverartarchive.org' ||
      parsedUrl.searchParams.has('X-Plex-Token')

    if (!isAllowed) {
      res.writeHead(403)
      res.end('URL not allowed')
      return
    }

    // Add thumbnail sizing to reduce bandwidth for mobile clients
    const isPlexUrl = hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
      hostname.endsWith('.plex.direct') || parsedUrl.searchParams.has('X-Plex-Token')
    if (isPlexUrl) {
      const existingWidth = Number(parsedUrl.searchParams.get('width') || 0)
      // Cap at 300×450 — always override if larger or unset
      if (!existingWidth || existingWidth > 450) {
        parsedUrl.searchParams.set('width', '300')
        parsedUrl.searchParams.set('height', '450')
      }
    }
    // Jellyfin/Emby: add maxWidth if not already specified (API supports it natively)
    const isJellyfinEmby = parsedUrl.pathname.includes('/Items/') && parsedUrl.pathname.includes('/Images/')
    if (isJellyfinEmby && !parsedUrl.searchParams.has('maxWidth')) {
      parsedUrl.searchParams.set('maxWidth', '600')
      parsedUrl.searchParams.set('quality', '80')
    }
    const finalUrl = parsedUrl.toString()

    // Build cache key without auth tokens so cache survives across sessions
    const cacheUrl = new URL(finalUrl)
    cacheUrl.searchParams.delete('X-Plex-Token')
    cacheUrl.searchParams.delete('api_key')
    cacheUrl.searchParams.delete('ApiKey')

    // Check disk cache first
    const proxyStart = Date.now()
    const cacheKey = crypto.createHash('sha256').update(cacheUrl.toString()).digest('hex')
    const cachePath = path.join(this.imageCacheDir, `${cacheKey}.img`)

    try {
      const stat = fs.statSync(cachePath)
      if (Date.now() - stat.mtimeMs < this.imageCacheMaxAge) {
        // Serve from cache
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=604800',
          'Content-Length': String(stat.size),
        })
        fs.createReadStream(cachePath).pipe(res)
        getLoggingService().verbose('WebServer', `Image proxy HIT: ${(stat.size / 1024).toFixed(0)}KB in ${Date.now() - proxyStart}ms`)
        return
      }
    } catch {
      // Cache miss — fetch from source
    }

    const fetchOptions = parsedUrl.protocol === 'https:'
      ? { rejectUnauthorized: false } as https.RequestOptions
      : {}
    const fetcher = parsedUrl.protocol === 'https:' ? https : http
    const proxyReq = fetcher.get(finalUrl, fetchOptions, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        res.writeHead(proxyRes.statusCode || 502)
        res.end()
        return
      }

      const contentType = proxyRes.headers['content-type'] || 'image/jpeg'
      const contentLength = proxyRes.headers['content-length']
      const sizeKb = contentLength ? Number(contentLength) / 1024 : 0
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800',
      })
      getLoggingService().verbose('WebServer', `Image proxy MISS: ${sizeKb ? sizeKb.toFixed(0) + 'KB' : '?KB'} in ${Date.now() - proxyStart}ms (${hostname})`)
      if (sizeKb > 2048) {
        console.warn(`[WebServer] Oversized image (${sizeKb.toFixed(0)}KB): ${parsedUrl.pathname}`)
      }

      // Write to cache and response simultaneously
      try {
        fs.mkdirSync(this.imageCacheDir, { recursive: true })
        const cacheStream = fs.createWriteStream(cachePath)
        proxyRes.pipe(cacheStream)
        proxyRes.pipe(res)
        cacheStream.on('error', () => {
          try { fs.unlinkSync(cachePath) } catch { /* ignore */ }
        })
      } catch {
        // Cache write failed — still serve response
        proxyRes.pipe(res)
      }
    })
    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502)
        res.end('Failed to fetch image')
      } else {
        res.end()
      }
    })
    proxyReq.setTimeout(30000, () => {
      proxyReq.destroy()
      if (!res.headersSent) {
        res.writeHead(504)
        res.end('Timeout')
      } else {
        res.end()
      }
    })
  }

  /** Prune image cache if it exceeds max size */
  pruneImageCache(): void {
    try {
      if (!fs.existsSync(this.imageCacheDir)) return
      const files = fs.readdirSync(this.imageCacheDir)
        .map(f => {
          const fp = path.join(this.imageCacheDir, f)
          try { const s = fs.statSync(fp); return { path: fp, size: s.size, mtime: s.mtimeMs } }
          catch { return null }
        })
        .filter(Boolean) as { path: string; size: number; mtime: number }[]

      const totalSize = files.reduce((sum, f) => sum + f.size, 0)
      if (totalSize <= this.imageCacheMaxBytes) return

      // Remove oldest files until under limit
      files.sort((a, b) => a.mtime - b.mtime)
      let freed = 0
      const target = totalSize - this.imageCacheMaxBytes
      for (const file of files) {
        try { fs.unlinkSync(file.path); freed += file.size }
        catch { /* ignore */ }
        if (freed >= target) break
      }
      console.log(`[WebServer] Pruned image cache: freed ${Math.round(freed / 1024 / 1024)}MB`)
    } catch { /* ignore */ }
  }

  private proxyToDevServer(req: http.IncomingMessage, res: http.ServerResponse): void {
    const target = new URL(this.devServerUrl!)
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
        proxyRes.pipe(res)
      },
    )
    proxyReq.on('error', () => {
      res.writeHead(502)
      res.end('Dev server unavailable')
    })
    req.pipe(proxyReq)
  }

  private static readonly COMPRESSIBLE_EXTS = new Set([
    '.html', '.js', '.css', '.json', '.svg', '.map',
  ])
  private static readonly GZIP_MIN_SIZE = 1024 // Only compress files > 1KB

  private serveStatic(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    let filePath = path.join(this.staticRoot, pathname === '/' ? 'index.html' : pathname)

    // Security: prevent path traversal
    if (!filePath.startsWith(this.staticRoot)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        filePath = path.join(this.staticRoot, 'index.html')
        fs.readFile(filePath, (err2, data) => {
          if (err2) {
            res.writeHead(404)
            res.end('Not found')
            return
          }
          const acceptEncoding = req.headers['accept-encoding'] || ''
          const useGzip = typeof acceptEncoding === 'string'
            && acceptEncoding.includes('gzip')
            && data.length > WebServerService.GZIP_MIN_SIZE
          if (useGzip) {
            res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' })
            const gzipStream = zlib.createGzip()
            gzipStream.pipe(res)
            gzipStream.end(data)
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(data)
          }
        })
        return
      }

      const ext = path.extname(filePath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      const isHashed = /\.[a-f0-9]{8,}\./i.test(path.basename(filePath))
      const cacheControl = isHashed
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate'

      const acceptEncoding = req.headers['accept-encoding'] || ''
      const canGzip = typeof acceptEncoding === 'string'
        && acceptEncoding.includes('gzip')
        && WebServerService.COMPRESSIBLE_EXTS.has(ext)
        && stats.size > WebServerService.GZIP_MIN_SIZE

      if (canGzip) {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          'Content-Encoding': 'gzip',
        })
        const fileStream = fs.createReadStream(filePath)
        const gzipStream = zlib.createGzip()
        fileStream.pipe(gzipStream).pipe(res)
        fileStream.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(500)
          }
          res.end()
        })
      } else {
        fs.readFile(filePath, (err2, data) => {
          if (err2) {
            res.writeHead(500)
            res.end('Internal Server Error')
            return
          }
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
          })
          res.end(data)
        })
      }
    })
  }

  // ---------------------------------------------------------------------------
  // WebSocket Handler
  // ---------------------------------------------------------------------------

  private async handleWebSocket(ws: AuthenticatedWebSocket, rawData: unknown): Promise<void> {
    let msg: WebMessage
    try {
      msg = JSON.parse(String(rawData))
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }))
      return
    }

    if (msg.type === 'auth') {
      await this.handleAuth(ws, msg as AuthMessage)
      return
    }

    if (msg.type === 'rpc') {
      const rpc = msg as RpcMessage

      // Always require authentication
      if (!rpc.token || !this.isValidSession(rpc.token, ws.clientIp)) {
        ws.send(JSON.stringify({ type: 'response', id: rpc.id, error: 'Unauthorized' }))
        return
      }

      await this.handleRpc(ws, rpc)
      return
    }

    ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }))
  }

  /** Check if an IP is allowed by the allowlist (empty = allow all) */
  private isIpAllowed(ip: string): boolean {
    const db = getDatabase()
    const allowlist = db.getSetting(SETTING_KEYS.web_access_ip_allowlist)
    if (!allowlist) return true // empty = allow all
    const allowed = allowlist.split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length === 0) return true
    // Normalize IPv6-mapped IPv4 (::ffff:192.168.1.1 → 192.168.1.1)
    const normalizedIp = ip.replace(/^::ffff:/, '')
    return allowed.some(a => a === normalizedIp || a === ip)
  }

  private async handleAuth(ws: AuthenticatedWebSocket, msg: AuthMessage): Promise<void> {
    const ip = ws.clientIp || 'unknown'

    // Check rate limit
    const limit = this.rateLimits.get(ip)
    if (limit && limit.lockedUntil > Date.now()) {
      const remaining = Math.ceil((limit.lockedUntil - Date.now()) / 1000)
      ws.send(JSON.stringify({ type: 'auth', success: false, error: `Too many attempts. Try again in ${remaining}s` }))
      return
    }

    // Validate PIN (always required) — uses constant-time comparison
    const storedPin = this.getStoredPin()
    if (!storedPin || !timingSafeCompare(msg.pin, storedPin)) {
      const entry = this.rateLimits.get(ip) || { failures: 0, lockedUntil: 0, lockoutCount: 0 }
      entry.failures++
      if (entry.failures >= MAX_AUTH_FAILURES) {
        entry.lockoutCount++
        const lockoutDuration = entry.lockoutCount >= 3
          ? 24 * 60 * 60 * 1000   // 24 hours after 3rd lockout
          : entry.lockoutCount >= 2
          ? 15 * 60 * 1000         // 15 minutes after 2nd lockout
          : AUTH_LOCKOUT_MS        // 60 seconds after 1st lockout
        entry.lockedUntil = Date.now() + lockoutDuration
        entry.failures = 0
        const durationLabel = lockoutDuration >= 86400000 ? '24 hours' : lockoutDuration >= 900000 ? '15 minutes' : '60 seconds'
        console.warn(`[WebServer] Auth lockout #${entry.lockoutCount} for IP ${ip} — locked for ${durationLabel}`)
      }
      this.rateLimits.set(ip, entry)
      ws.send(JSON.stringify({ type: 'auth', success: false, error: 'Invalid PIN' }))
      return
    }

    // Success — clear rate limit
    this.rateLimits.delete(ip)

    // Purge expired sessions for this IP before checking limit
    const now = Date.now()
    for (const [token, session] of this.sessions.entries()) {
      if (session.ip === ip && session.expiresAt < now) {
        this.sessions.delete(token)
      }
    }

    // If still over limit, revoke the oldest session instead of blocking
    const ipSessions: Array<[string, Session]> = []
    for (const [token, session] of this.sessions.entries()) {
      if (session.ip === ip) ipSessions.push([token, session])
    }
    if (ipSessions.length >= MAX_SESSIONS_PER_IP) {
      // Remove the oldest session to make room
      ipSessions.sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      this.sessions.delete(ipSessions[0][0])
    }

    // Issue token
    const token = crypto.randomUUID()
    this.sessions.set(token, { expiresAt: Date.now() + this.getSessionTimeout(), ip })
    this.persistSessions()
    ws.sessionToken = token
    ws.send(JSON.stringify({ type: 'auth', success: true, token }))
    getLoggingService().verbose('WebServer', `Authenticated client from ${ip}`)
  }

  private async handleRpc(ws: AuthenticatedWebSocket, msg: RpcMessage): Promise<void> {
    const { id, channel, args } = msg
    const rpcStart = Date.now()

    // Check denylist
    if (WEB_DENIED_CHANNELS.has(channel)) {
      ws.send(JSON.stringify({ type: 'response', id, error: 'Not available in web mode' }))
      return
    }

    // Block modification of protected settings
    if (channel === 'db:setSetting' && args.length >= 1) {
      const settingKey = args[0] as string
      if (PROTECTED_SETTINGS.has(settingKey)) {
        ws.send(JSON.stringify({ type: 'response', id, error: 'Cannot modify this setting from web' }))
        return
      }
    }

    // For sensitive settings, return whether the key has a value (not the value itself)
    if (channel === 'db:getSetting' && args.length >= 1) {
      const settingKey = args[0] as string
      if (WEB_SENSITIVE_SETTINGS.has(settingKey)) {
        // Return empty string (falsy) or 'true' (truthy) — never the actual value
        try {
          const handler = this.handlerMap.get(channel)
          if (handler) {
            const syntheticEvent = { sender: { send: () => {}, isDestroyed: () => false } }
            const val = await handler(syntheticEvent, ...args)
            ws.send(JSON.stringify({ type: 'response', id, result: val ? '__set__' : null }))
            return
          }
        } catch {
          ws.send(JSON.stringify({ type: 'response', id, result: null }))
          return
        }
      }
    }

    // Look up handler
    const handler = this.handlerMap.get(channel)
    if (!handler) {
      ws.send(JSON.stringify({ type: 'response', id, error: `Unknown channel: ${channel}` }))
      return
    }

    try {
      const syntheticEvent = {
        sender: {
          send: (eventChannel: string, ...eventArgs: unknown[]) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'event', channel: eventChannel, args: eventArgs }))
            }
          },
          isDestroyed: () => ws.readyState !== WebSocket.OPEN,
        },
      }

      let result = await handler(syntheticEvent, ...args)

      // Strip connection_config from source responses (contains passwords/tokens)
      if (channel === 'sources:list' || channel === 'sources:getEnabled') {
        if (Array.isArray(result)) {
          result = result.map((s: Record<string, unknown>) => ({ ...s, connection_config: '{}' }))
        }
      }

      // Strip sensitive settings from getAllSettings response
      if (channel === 'db:getAllSettings' && result && typeof result === 'object') {
        const filtered = { ...(result as Record<string, string>) }
        for (const key of WEB_SENSITIVE_SETTINGS) {
          if (key in filtered) filtered[key] = ''
        }
        result = filtered
      }

      const responseJson = JSON.stringify({ type: 'response', id, result })
      const rpcMs = Date.now() - rpcStart
      const responseKb = (responseJson.length / 1024).toFixed(1)
      ws.send(responseJson)
      getLoggingService().verbose('WebServer', `RPC ${channel} → ${rpcMs}ms, ${responseKb}KB (${ws.clientIp})`)
      if (rpcMs > 1000) {
        console.warn(`[WebServer] Slow RPC: ${channel} took ${rpcMs}ms (${responseKb}KB)`)
      }
    } catch (err) {
      const rpcMs = Date.now() - rpcStart
      // Sanitize error — never expose stack traces or internal details to web clients
      console.error(`[WebServer] RPC error on ${channel} after ${rpcMs}ms:`, err)
      ws.send(JSON.stringify({ type: 'response', id, error: 'Internal error' }))
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isPinRequired(): boolean {
    try {
      const pin = getDatabase().getSetting(SETTING_KEYS.web_access_pin)
      return !!pin && pin.trim().length > 0
    } catch {
      return false
    }
  }

  private getStoredPin(): string | null {
    try {
      const pin = getDatabase().getSetting(SETTING_KEYS.web_access_pin)
      if (!pin) return null
      return getCredentialEncryptionService().decryptSetting(SETTING_KEYS.web_access_pin, pin)
    } catch {
      return null
    }
  }

  private getConfiguredPort(): number {
    try {
      const port = getDatabase().getSetting(SETTING_KEYS.web_access_port)
      const parsed = port ? parseInt(port, 10) : NaN
      return parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT
    } catch {
      return DEFAULT_PORT
    }
  }

  private getSessionTimeout(): number {
    try {
      const timeout = getDatabase().getSetting(SETTING_KEYS.web_access_session_timeout)
      const parsed = timeout ? parseInt(timeout, 10) : NaN
      return parsed > 0 ? parsed : DEFAULT_SESSION_TIMEOUT_MS
    } catch {
      return DEFAULT_SESSION_TIMEOUT_MS
    }
  }

  private isValidSession(token: string, _clientIp?: string): boolean {
    const session = this.sessions.get(token)
    if (!session) return false
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token)
      return false
    }
    return true
  }

  private isHttpsEnabled(): boolean {
    try {
      const setting = getDatabase().getSetting(SETTING_KEYS.web_access_https)
      return setting !== 'false' // Default to true
    } catch {
      return true
    }
  }

  /**
   * Check if the existing cert's SANs cover all current network IPs
   */
  private certSansMatchCurrentIps(certPem: string): boolean {
    try {
      const cert = new crypto.X509Certificate(certPem)
      const sanText = cert.subjectAltName || ''
      // Parse "IP Address:192.168.1.5, IP Address:127.0.0.1, DNS:localhost" format
      const certIps = new Set(
        sanText.split(',')
          .map(s => s.trim())
          .filter(s => s.startsWith('IP Address:'))
          .map(s => s.replace('IP Address:', ''))
      )

      // Get current non-internal IPv4 addresses
      const interfaces = os.networkInterfaces()
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal && !certIps.has(iface.address)) {
            console.log(`[WebServer] Current IP ${iface.address} not in cert SANs`)
            return false
          }
        }
      }
      return true
    } catch {
      // If cert parsing fails, regenerate
      return false
    }
  }

  private async ensureTlsCertificate(): Promise<{ key: string; cert: string }> {
    const keyPath = path.join(this.tlsDir, 'key.pem')
    const certPath = path.join(this.tlsDir, 'cert.pem')

    // Priority 1: User-provided custom certificate (for reverse proxies, real SSL)
    const customCertPath = path.join(this.tlsDir, 'custom-cert.pem')
    const customKeyPath = path.join(this.tlsDir, 'custom-key.pem')
    if (fs.existsSync(customCertPath) && fs.existsSync(customKeyPath)) {
      console.log('[WebServer] Using custom TLS certificate from', this.tlsDir)
      return {
        key: fs.readFileSync(customKeyPath, 'utf-8'),
        cert: fs.readFileSync(customCertPath, 'utf-8'),
      }
    }

    // Priority 2: Reuse existing self-signed certificate if IPs still match
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      const certPem = fs.readFileSync(certPath, 'utf-8')
      if (this.certSansMatchCurrentIps(certPem)) {
        return { key: fs.readFileSync(keyPath, 'utf-8'), cert: certPem }
      }
      console.log('[WebServer] Network IPs changed — regenerating self-signed certificate')
      fs.unlinkSync(keyPath)
      fs.unlinkSync(certPath)
    }

    console.log('[WebServer] Generating self-signed TLS certificate...')
    fs.mkdirSync(this.tlsDir, { recursive: true })

    const notAfter = new Date()
    notAfter.setFullYear(notAfter.getFullYear() + 10)

    // Collect all local IPv4 addresses for SANs
    const altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      { type: 7, ip: '0.0.0.0' },
    ]
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          altNames.push({ type: 7, ip: iface.address })
        }
      }
    }
    console.log(`[WebServer] Certificate SANs: ${altNames.map(a => 'ip' in a ? a.ip : a.value).join(', ')}`)

    const attrs = [{ name: 'commonName', value: 'Totality' }]
    const pems = await selfsigned.generate(attrs, {
      algorithm: 'sha256',
      keySize: 2048,
      notAfterDate: notAfter,
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames },
      ],
    })

    fs.writeFileSync(keyPath, pems.private, { mode: 0o600 })
    fs.writeFileSync(certPath, pems.cert, { mode: 0o644 })
    console.log('[WebServer] Self-signed TLS certificate generated')

    return { key: pems.private, cert: pems.cert }
  }
}

// Singleton
let instance: WebServerService | null = null

export function initWebServerService(handlerMap: Map<string, Function>, devServerUrl?: string): WebServerService {
  instance = new WebServerService(handlerMap, devServerUrl)
  return instance
}

export function getWebServerService(): WebServerService | null {
  return instance
}
