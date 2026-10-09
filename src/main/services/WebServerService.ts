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
}

type WebMessage = RpcMessage | AuthMessage

interface AuthenticatedWebSocket extends WebSocket {
  sessionToken?: string
  clientIp?: string
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

  constructor(handlerMap: Map<string, Function>, devServerUrl?: string) {
    this.handlerMap = handlerMap
    this.devServerUrl = devServerUrl || null
    this.staticRoot = path.join(__dirname, '../../dist')
    this.artworkBasePath = path.join(app.getPath('userData'), 'artwork')
    this.tlsDir = path.join(app.getPath('userData'), 'tls')
  }

  async start(port?: number): Promise<void> {
    if (this.httpServer) return

    // Security: require PIN to be set before allowing web access
    if (!this.isPinRequired()) {
      console.warn('[WebServer] Cannot start: no PIN configured. Set a PIN in Settings → General → Web Access.')
      throw new Error('Web access requires a PIN. Set one in Settings → General → Web Access.')
    }

    this.port = port || this.getConfiguredPort()

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
      getLoggingService().verbose('WebServer', `WebSocket connected from ${ws.clientIp}`)

      ws.on('message', (data) => this.handleWebSocket(ws, data))
      ws.on('close', () => {
        getLoggingService().verbose('WebServer', `WebSocket disconnected from ${ws.clientIp}`)
      })
      ws.on('error', (err) => {
        console.error('[WebServer] WebSocket error:', err.message)
      })
    })

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

        // Periodic cleanup of expired sessions
        this.sessionCleanupTimer = setInterval(() => {
          const now = Date.now()
          for (const [token, session] of this.sessions.entries()) {
            if (session.expiresAt < now) this.sessions.delete(token)
          }
        }, SESSION_CLEANUP_INTERVAL_MS)

        resolve()
      })
    })
  }

  stop(): void {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer)
      this.sessionCleanupTimer = null
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
    for (const client of this.wss.clients) {
      const ws = client as AuthenticatedWebSocket
      if (ws.readyState === WebSocket.OPEN && ws.sessionToken && this.sessions.has(ws.sessionToken)) {
        ws.send(message)
      }
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
    this.serveStatic(url.pathname, res)
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

    // Allow: private IPs, Plex domains, TMDB, Jellyfin/Emby local servers
    const hostname = parsedUrl.hostname
    const isAllowed = hostname === 'localhost' || hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
      hostname.endsWith('.plex.direct') ||
      hostname === 'image.tmdb.org' ||
      parsedUrl.searchParams.has('X-Plex-Token')

    if (!isAllowed) {
      res.writeHead(403)
      res.end('URL not allowed')
      return
    }

    const fetchOptions = parsedUrl.protocol === 'https:'
      ? { rejectUnauthorized: false } as https.RequestOptions // Accept self-signed Plex certs
      : {}
    const fetcher = parsedUrl.protocol === 'https:' ? https : http
    const proxyReq = fetcher.get(imageUrl, fetchOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, {
        'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      })
      proxyRes.pipe(res)
    })
    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502)
        res.end('Failed to fetch image')
      } else {
        res.end()
      }
    })
    proxyReq.setTimeout(10000, () => {
      proxyReq.destroy()
      if (!res.headersSent) {
        res.writeHead(504)
        res.end('Timeout')
      } else {
        res.end()
      }
    })
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

  private serveStatic(pathname: string, res: http.ServerResponse): void {
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
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(data)
        })
        return
      }

      const ext = path.extname(filePath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      const isHashed = /\.[a-f0-9]{8,}\./i.test(path.basename(filePath))
      const cacheControl = isHashed
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate'

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
      const entry = this.rateLimits.get(ip) || { failures: 0, lockedUntil: 0 }
      entry.failures++
      if (entry.failures >= MAX_AUTH_FAILURES) {
        entry.lockedUntil = Date.now() + AUTH_LOCKOUT_MS
        entry.failures = 0
        console.warn(`[WebServer] Auth lockout for IP ${ip} — ${MAX_AUTH_FAILURES} failed attempts`)
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

    // Issue IP-bound token
    const token = crypto.randomUUID()
    this.sessions.set(token, { expiresAt: Date.now() + this.getSessionTimeout(), ip })
    ws.sessionToken = token
    ws.send(JSON.stringify({ type: 'auth', success: true, token }))
    getLoggingService().verbose('WebServer', `Authenticated client from ${ip}`)
  }

  private async handleRpc(ws: AuthenticatedWebSocket, msg: RpcMessage): Promise<void> {
    const { id, channel, args } = msg

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

      ws.send(JSON.stringify({ type: 'response', id, result }))
    } catch (err) {
      // Sanitize error — never expose stack traces or internal details to web clients
      console.error(`[WebServer] RPC error on ${channel}:`, err)
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

  private isValidSession(token: string, clientIp?: string): boolean {
    const session = this.sessions.get(token)
    if (!session) return false
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token)
      return false
    }
    // Verify token is being used from the same IP it was issued to
    if (clientIp && session.ip !== clientIp) {
      console.warn(`[WebServer] Session token used from different IP: issued to ${session.ip}, used from ${clientIp}`)
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

  private async ensureTlsCertificate(): Promise<{ key: string; cert: string }> {
    const keyPath = path.join(this.tlsDir, 'key.pem')
    const certPath = path.join(this.tlsDir, 'cert.pem')

    // Reuse existing certificate if it exists
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return {
        key: fs.readFileSync(keyPath, 'utf-8'),
        cert: fs.readFileSync(certPath, 'utf-8'),
      }
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
