/**
 * WebSocket Transport for Web Mode
 *
 * When running in a browser (not Electron), this module creates a WebSocket
 * connection to the host app and installs a proxy on window.electronAPI that
 * routes all IPC calls over the WebSocket.
 */

import { RPC_CHANNEL_MAP, EVENT_CHANNEL_MAP } from '../../../shared/ipcChannelMap'

// Image URL fields that may contain local server URLs needing proxy
const IMAGE_URL_FIELDS = new Set([
  'poster_url', 'thumb_url', 'episode_thumb_url', 'artwork_url',
  'season_poster_url', 'art_url',
])

// Check if a URL needs proxying (anything that isn't a public CDN)
function needsProxy(url: string): boolean {
  try {
    const u = new URL(url)
    const h = u.hostname
    // In Electron (non-web mode), CDNs load directly — no proxy needed
    // In web mode, proxy everything so images go through the 7-day disk cache
    if (!isWebMode()) {
      if (h === 'image.tmdb.org' || h.endsWith('.tmdb.org')) return false
      if (h === 'coverartarchive.org') return false
    }
    // Proxy everything else: Plex (*.plex.direct, local IPs), Jellyfin, Emby, Kodi, etc.
    return true
  } catch {
    return false
  }
}

// Rewrite local artwork URLs to go through the proxy
function rewriteImageUrls(data: unknown): unknown {
  if (data === null || data === undefined || typeof data !== 'object') return data

  if (Array.isArray(data)) {
    return data.map(rewriteImageUrls)
  }

  const obj = data as Record<string, unknown>
  let changed = false
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (IMAGE_URL_FIELDS.has(key) && typeof val === 'string' && val && needsProxy(val)) {
      result[key] = `/api/proxy-image?url=${encodeURIComponent(val)}`
      changed = true
    } else if (typeof val === 'object' && val !== null) {
      result[key] = rewriteImageUrls(val)
      changed = true
    } else {
      result[key] = val
    }
  }

  return changed ? result : data
}

// Reverse maps: channel → method name (for incoming events)
const channelToEvent = new Map<string, string>()
for (const [method, channel] of Object.entries(EVENT_CHANNEL_MAP)) {
  channelToEvent.set(channel, method)
}

let ws: WebSocket | null = null
let connectPromise: Promise<void> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let requestId = 0
let reconnectAttempts = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const eventListeners = new Map<string, Set<(...args: unknown[]) => void>>()
let sessionToken: string | null = null
let authPromise: { resolve: (token: string) => void; reject: (e: Error) => void } | null = null
// Auth callback for future use (e.g., auto-showing login screen)
// let onAuthRequired: ((authenticate: (pin: string) => Promise<string>) => void) | null = null

function getWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}`
}

let isConnecting = false

function connect(): Promise<void> {
  // Guard: already connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    return Promise.resolve()
  }
  // Guard: connection in progress — return the existing promise
  if (isConnecting && connectPromise) {
    return connectPromise
  }

  // Cancel any pending reconnect
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  // Close any stale socket before creating a new one
  if (ws) {
    try { ws.onclose = null; ws.close() } catch { /* ignore */ }
    ws = null
  }

  isConnecting = true

  const promise = new Promise<void>((resolve, reject) => {
    ws = new WebSocket(getWsUrl())

    ws.onopen = () => {
      isConnecting = false
      reconnectAttempts = 0
      const stored = sessionStorage.getItem('web_session_token')
      if (stored) {
        sessionToken = stored
      }
      window.dispatchEvent(new CustomEvent('ws-status', { detail: { connected: true } }))
      resolve()
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleMessage(data)
      } catch {
        console.error('[WebTransport] Failed to parse message')
      }
    }

    ws.onclose = () => {
      ws = null
      isConnecting = false
      connectPromise = null
      // Reject all pending RPC promises so callers don't hang forever
      for (const [pendingId, { reject }] of pending.entries()) {
        reject(new Error('WebSocket disconnected'))
        pending.delete(pendingId)
      }
      requestId = 0 // Reset to avoid stale ID collisions on reconnect
      // Notify listeners of offline status
      window.dispatchEvent(new CustomEvent('ws-status', { detail: { connected: false } }))
      // Reconnect with exponential backoff (1s, 1.5s, 2.25s, ... capped at 30s)
      const delayMs = Math.min(30000, 1000 * Math.pow(1.5, reconnectAttempts))
      reconnectAttempts++
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect().catch((err) => console.warn('[WebSocket] Reconnect failed:', err))
      }, delayMs)
    }

    ws.onerror = () => {
      isConnecting = false
      connectPromise = null
      reject(new Error('WebSocket connection failed'))
    }
  })

  connectPromise = promise
  return promise
}

function handleMessage(data: { type: string; [key: string]: unknown }): void {
  switch (data.type) {
    case 'response': {
      const p = pending.get(data.id as number)
      if (p) {
        pending.delete(data.id as number)
        if (data.error) {
          p.reject(new Error(data.error as string))
        } else {
          p.resolve(rewriteImageUrls(data.result))
        }
      }
      break
    }

    case 'event': {
      const channel = data.channel as string
      const args = data.args as unknown[]
      const listeners = eventListeners.get(channel)
      if (listeners) {
        for (const cb of listeners) {
          try {
            cb(...args)
          } catch (err) {
            console.error('[WebTransport] Event listener error:', err)
          }
        }
      }
      break
    }

    case 'auth': {
      if (data.success && data.token) {
        sessionToken = data.token as string
        sessionStorage.setItem('web_session_token', sessionToken)
        authPromise?.resolve(sessionToken)
        authPromise = null
      } else {
        authPromise?.reject(new Error(data.error as string || 'Authentication failed'))
        authPromise = null
      }
      break
    }
  }
}

// Deduplication: identical RPC calls within 500ms share the same promise
const rpcDedup = new Map<string, { promise: Promise<unknown>; timestamp: number }>()
const RPC_DEDUP_WINDOW_MS = 500
const RPC_TIMEOUT_MS = 30_000

// Write channels are excluded from deduplication to avoid suppressing legitimate rapid operations
const WRITE_CHANNEL_PREFIXES = ['wishlist:add', 'wishlist:update', 'wishlist:remove', 'wishlist:addBulk', 'db:setSetting', 'db:reset', 'db:upsert', 'sources:', 'mood:', 'music:fix', 'movie:fix', 'series:fix']

function isWriteChannel(channel: string): boolean {
  return WRITE_CHANNEL_PREFIXES.some(p => channel.startsWith(p))
}

function sendRpc(channel: string, args: unknown[]): Promise<unknown> {
  // Skip deduplication for write operations
  if (!isWriteChannel(channel)) {
    const dedupKey = channel + ':' + JSON.stringify(args)
    const existing = rpcDedup.get(dedupKey)
    if (existing && Date.now() - existing.timestamp < RPC_DEDUP_WINDOW_MS) {
      return existing.promise
    }
  }

  const promise = new Promise<unknown>((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'))
      return
    }
    const id = ++requestId
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`RPC timeout: ${channel}`))
      }
    }, RPC_TIMEOUT_MS)
    pending.set(id, {
      resolve: (v: unknown) => { clearTimeout(timer); resolve(v) },
      reject: (e: Error) => { clearTimeout(timer); reject(e) },
    })
    ws.send(JSON.stringify({
      type: 'rpc',
      id,
      channel,
      args,
      token: sessionToken,
    }))
  })

  // Cache for deduplication (read-only channels only)
  if (!isWriteChannel(channel)) {
    const dedupKey = channel + ':' + JSON.stringify(args)
    rpcDedup.set(dedupKey, { promise, timestamp: Date.now() })
    setTimeout(() => rpcDedup.delete(dedupKey), RPC_DEDUP_WINDOW_MS + 10)
  }

  return promise
}

export function authenticate(pin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'))
      return
    }
    authPromise = { resolve, reject }
    ws.send(JSON.stringify({ type: 'auth', pin }))
  })
}

// export function setAuthRequiredCallback(cb: (authenticate: (pin: string) => Promise<string>) => void): void {
//   onAuthRequired = cb
// }

export function isAuthenticated(): boolean {
  return sessionToken !== null
}

export function isWebMode(): boolean {
  return typeof (window as { electronAPI?: unknown }).electronAPI === 'undefined'
    || (window as { __webMode?: boolean }).__webMode === true
}

/**
 * Initialize web transport: connect WebSocket, install proxy on window.electronAPI
 */
export async function initWebTransport(): Promise<void> {
  await connect()

  // Try authenticating with stored token by making a test RPC
  if (sessionToken) {
    try {
      await sendRpc('app:getVersion', [])
      // Token is valid
    } catch {
      // Token expired, clear it
      sessionToken = null
      sessionStorage.removeItem('web_session_token')
    }
  }

  // Install the proxy
  const proxy = createApiProxy()
  ;(window as { electronAPI?: unknown }).electronAPI = proxy
  ;(window as { __webMode?: boolean }).__webMode = true
}

function createApiProxy(): unknown {
  return new Proxy({}, {
    get(_target, prop: string) {
      // appReady is a no-op in web mode
      if (prop === 'appReady') {
        return () => {}
      }

      // Event listener methods (on*)
      if (prop in EVENT_CHANNEL_MAP) {
        const channel = EVENT_CHANNEL_MAP[prop]
        return (callback: (...args: unknown[]) => void) => {
          if (!eventListeners.has(channel)) {
            eventListeners.set(channel, new Set())
          }
          eventListeners.get(channel)!.add(callback)
          // Return cleanup function
          return () => {
            eventListeners.get(channel)?.delete(callback)
          }
        }
      }

      // RPC methods
      if (prop in RPC_CHANNEL_MAP) {
        const channel = RPC_CHANNEL_MAP[prop]
        return (...args: unknown[]) => sendRpc(channel, args)
      }

      // Unknown method — return a function that rejects
      return (..._args: unknown[]) => {
        console.warn(`[WebTransport] Unknown API method: ${prop}`)
        return Promise.reject(new Error(`${prop} is not available in web mode`))
      }
    },
  })
}
