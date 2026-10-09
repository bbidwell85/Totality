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
    // Don't proxy well-known public CDNs — they work directly from the browser
    if (h === 'image.tmdb.org' || h.endsWith('.tmdb.org')) return false
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
let requestId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const eventListeners = new Map<string, Set<Function>>()
let sessionToken: string | null = null
let authPromise: { resolve: (token: string) => void; reject: (e: Error) => void } | null = null
// Auth callback for future use (e.g., auto-showing login screen)
// let onAuthRequired: ((authenticate: (pin: string) => Promise<string>) => void) | null = null

function getWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}`
}

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(getWsUrl())

    ws.onopen = () => {
      // Try to restore session
      const stored = sessionStorage.getItem('web_session_token')
      if (stored) {
        sessionToken = stored
      }
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
      // Reconnect after delay
      setTimeout(() => {
        connect().catch(() => {})
      }, 3000)
    }

    ws.onerror = () => {
      reject(new Error('WebSocket connection failed'))
    }
  })
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

function sendRpc(channel: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'))
      return
    }
    const id = ++requestId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({
      type: 'rpc',
      id,
      channel,
      args,
      token: sessionToken,
    }))
  })
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
        return (callback: Function) => {
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
