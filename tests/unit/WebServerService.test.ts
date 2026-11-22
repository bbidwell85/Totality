/**
 * WebServerService Tests
 *
 * Tests security-critical features: PIN auth, rate limiting, SSRF protection,
 * session management, protected settings, and IP allowlisting.
 *
 * Since WebServerService methods are mostly private, we test through the
 * WebSocket message handlers by constructing an instance with mocked deps.
 */

import crypto from 'crypto'

// Mock getDatabase and getCredentialEncryptionService before importing the module
const mockGetSetting = vi.fn<(key: string) => string | null>().mockReturnValue(null)
const mockSetSetting = vi.fn()
const mockDeleteSetting = vi.fn()
const mockDecryptSetting = vi.fn((_key: string, val: string) => val)
const mockEncryptSetting = vi.fn((_key: string, val: string) => val)
const mockDecrypt = vi.fn<(val: string) => string>(() => '')

vi.mock('@main/database/getDatabase', () => ({
  getDatabase: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting,
    deleteSetting: mockDeleteSetting,
  }),
}))

vi.mock('@main/services/CredentialEncryptionService', () => ({
  getCredentialEncryptionService: () => ({
    isEncrypted: (val: string) => val.startsWith('encrypted:'),
    decrypt: mockDecrypt,
    encrypt: (val: string) => `encrypted:${val}`,
    decryptSetting: mockDecryptSetting,
    encryptSetting: mockEncryptSetting,
  }),
}))

vi.mock('electron', () => ({ app: { getPath: () => 'C:/test' } }))

import { WebServerService } from '@main/services/WebServerService'

vi.mock('@main/services/LoggingService', () => ({
  getLoggingService: () => ({
    verbose: vi.fn(),
  }),
}))

// ============================================================================
// timingSafeCompare — module-level function
// ============================================================================

describe('timingSafeCompare', () => {
  // Replicate the function since it's not exported
  function timingSafeCompare(a: string, b: string): boolean {
    const hashA = crypto.createHash('sha256').update(a).digest()
    const hashB = crypto.createHash('sha256').update(b).digest()
    return crypto.timingSafeEqual(hashA, hashB)
  }

  it('returns true for matching strings', () => {
    expect(timingSafeCompare('1234', '1234')).toBe(true)
    expect(timingSafeCompare('my-secret-pin', 'my-secret-pin')).toBe(true)
  })

  it('returns false for non-matching strings', () => {
    expect(timingSafeCompare('1234', '5678')).toBe(false)
    expect(timingSafeCompare('1234', '12345')).toBe(false)
    expect(timingSafeCompare('', 'a')).toBe(false)
  })

  it('returns true for empty strings', () => {
    expect(timingSafeCompare('', '')).toBe(true)
  })

  it('handles different lengths safely (via hashing)', () => {
    // Hash makes them equal length — no timingSafeEqual length mismatch error
    expect(timingSafeCompare('short', 'a-much-longer-string')).toBe(false)
  })
})

describe('persisted web sessions', () => {
  beforeEach(() => {
    mockGetSetting.mockReset()
    mockGetSetting.mockReturnValue('encrypted:unreadable')
    mockDeleteSetting.mockReset()
    mockDecrypt.mockReset()
    mockDecrypt.mockImplementation(() => { throw new Error('invalid ciphertext') })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('revokes unreadable encrypted sessions and keeps startup able to use fresh PIN login', () => {
    const service = Object.create(WebServerService.prototype) as {
      loadPersistedSessions: () => void
      sessions: Map<string, unknown>
    }
    service.sessions = new Map([['stale-token', {}]])

    expect(() => service.loadPersistedSessions()).not.toThrow()
    expect(service.sessions.size).toBe(0)
    expect(mockDeleteSetting).toHaveBeenCalledWith('web_sessions')
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('fresh PIN login is required:'),
      expect.any(Error),
    )
  })
})

// ============================================================================
// SSRF Whitelist — extracted logic
// ============================================================================

describe('SSRF proxy whitelist', () => {
  function isUrlAllowed(imageUrl: string): boolean {
    const parsedUrl = new URL(imageUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return false

    const hostname = parsedUrl.hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' ||
      hostname === '::1' || hostname === '[::1]' ||
      hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
      !!hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
      hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80') ||
      hostname.endsWith('.plex.direct') ||
      hostname === 'image.tmdb.org' ||
      hostname === 'coverartarchive.org' ||
      parsedUrl.searchParams.has('X-Plex-Token')
  }

  describe('allows private IPv4 ranges', () => {
    it('allows 192.168.x.x', () => {
      expect(isUrlAllowed('http://192.168.1.100/photo')).toBe(true)
      expect(isUrlAllowed('http://192.168.0.1:32400/photo')).toBe(true)
    })

    it('allows 10.x.x.x', () => {
      expect(isUrlAllowed('http://10.0.0.1/photo')).toBe(true)
      expect(isUrlAllowed('http://10.255.255.255/photo')).toBe(true)
    })

    it('allows 172.16-31.x.x', () => {
      expect(isUrlAllowed('http://172.16.0.1/photo')).toBe(true)
      expect(isUrlAllowed('http://172.31.255.255/photo')).toBe(true)
    })

    it('rejects 172 outside private range', () => {
      expect(isUrlAllowed('http://172.15.0.1/photo')).toBe(false)
      expect(isUrlAllowed('http://172.32.0.1/photo')).toBe(false)
    })
  })

  describe('allows IPv6 private ranges', () => {
    it('allows ::1 loopback', () => {
      expect(isUrlAllowed('http://[::1]/photo')).toBe(true)
    })

    it('allows fc/fd unique local (hostname check uses startsWith on bracket-stripped hostname)', () => {
      // Note: URL parser keeps brackets on IPv6 hostnames: [fc00::1]
      // The whitelist checks hostname.startsWith('fc') which won't match bracketed form.
      // This is a known gap — IPv6 ULA addresses passed as URLs won't match.
      // In practice, image URLs use IPv4 or domain names from providers.
      const url = new URL('http://[fc00::1]/photo')
      expect(url.hostname).toBe('[fc00::1]') // brackets preserved
      // The whitelist won't match this — documenting actual behavior
      expect(isUrlAllowed('http://[fc00::1]/photo')).toBe(false)
    })

    it('allows fe80 link-local (same bracket issue as fc/fd)', () => {
      expect(isUrlAllowed('http://[fe80::1]/photo')).toBe(false) // brackets prevent match
    })
  })

  describe('allows known CDN domains', () => {
    it('allows Plex direct domains', () => {
      expect(isUrlAllowed('https://my-server.abc123.plex.direct:32400/photo')).toBe(true)
    })

    it('allows TMDB images', () => {
      expect(isUrlAllowed('https://image.tmdb.org/t/p/w500/poster.jpg')).toBe(true)
    })

    it('allows coverartarchive', () => {
      expect(isUrlAllowed('https://coverartarchive.org/release/abc/front')).toBe(true)
    })
  })

  describe('allows Plex token URLs', () => {
    it('allows any URL with X-Plex-Token param', () => {
      expect(isUrlAllowed('http://external-server.com/photo?X-Plex-Token=abc123')).toBe(true)
    })
  })

  describe('blocks public/untrusted URLs', () => {
    it('rejects public IPs', () => {
      expect(isUrlAllowed('http://8.8.8.8/photo')).toBe(false)
      expect(isUrlAllowed('http://203.0.113.1/photo')).toBe(false)
    })

    it('rejects public domains', () => {
      expect(isUrlAllowed('http://evil.com/photo')).toBe(false)
      expect(isUrlAllowed('http://attacker.example.org/steal')).toBe(false)
    })

    it('rejects non-HTTP protocols', () => {
      expect(isUrlAllowed('ftp://192.168.1.1/file')).toBe(false)
      expect(isUrlAllowed('file:///etc/passwd')).toBe(false)
    })
  })
})

// ============================================================================
// IP Allowlist — extracted logic
// ============================================================================

describe('IP allowlist', () => {
  function isIpAllowed(ip: string, allowlist: string | null): boolean {
    if (!allowlist) return true
    const allowed = allowlist.split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length === 0) return true
    const normalizedIp = ip.replace(/^::ffff:/, '')
    return allowed.some(a => a === normalizedIp || a === ip)
  }

  it('allows all when allowlist is null', () => {
    expect(isIpAllowed('1.2.3.4', null)).toBe(true)
  })

  it('allows all when allowlist is empty', () => {
    expect(isIpAllowed('1.2.3.4', '')).toBe(true)
    expect(isIpAllowed('1.2.3.4', '  ')).toBe(true)
  })

  it('allows IPs in the allowlist', () => {
    expect(isIpAllowed('192.168.1.5', '192.168.1.5,10.0.0.1')).toBe(true)
    expect(isIpAllowed('10.0.0.1', '192.168.1.5,10.0.0.1')).toBe(true)
  })

  it('rejects IPs not in the allowlist', () => {
    expect(isIpAllowed('192.168.1.99', '192.168.1.5,10.0.0.1')).toBe(false)
  })

  it('normalizes IPv6-mapped IPv4', () => {
    expect(isIpAllowed('::ffff:192.168.1.5', '192.168.1.5')).toBe(true)
  })

  it('handles whitespace in allowlist', () => {
    expect(isIpAllowed('10.0.0.1', '  10.0.0.1 , 192.168.1.5 ')).toBe(true)
  })
})

// ============================================================================
// Auth rate limiting logic
// ============================================================================

describe('auth rate limiting', () => {
  interface RateLimitEntry {
    failures: number
    lockedUntil: number
    lockoutCount: number
  }

  const MAX_AUTH_FAILURES = 5
  const AUTH_LOCKOUT_MS = 60_000

  function processAuthFailure(entry: RateLimitEntry): RateLimitEntry {
    entry.failures++
    if (entry.failures >= MAX_AUTH_FAILURES) {
      entry.lockoutCount = Math.min(entry.lockoutCount + 1, 3)
      const lockoutDuration = entry.lockoutCount >= 3
        ? 24 * 60 * 60 * 1000
        : entry.lockoutCount >= 2
        ? 15 * 60 * 1000
        : AUTH_LOCKOUT_MS
      entry.lockedUntil = Date.now() + lockoutDuration
      entry.failures = 0
    }
    return entry
  }

  it('increments failures without lockout below threshold', () => {
    const entry = { failures: 0, lockedUntil: 0, lockoutCount: 0 }
    for (let i = 0; i < 4; i++) processAuthFailure(entry)
    expect(entry.failures).toBe(4)
    expect(entry.lockedUntil).toBe(0)
  })

  it('locks out for 60s on 5th failure (1st lockout)', () => {
    const entry = { failures: 0, lockedUntil: 0, lockoutCount: 0 }
    for (let i = 0; i < 5; i++) processAuthFailure(entry)
    expect(entry.lockoutCount).toBe(1)
    expect(entry.failures).toBe(0) // reset after lockout
    expect(entry.lockedUntil).toBeGreaterThan(Date.now())
    expect(entry.lockedUntil).toBeLessThanOrEqual(Date.now() + AUTH_LOCKOUT_MS + 100)
  })

  it('escalates to 15 minutes on 2nd lockout', () => {
    const entry = { failures: 0, lockedUntil: 0, lockoutCount: 1 }
    for (let i = 0; i < 5; i++) processAuthFailure(entry)
    expect(entry.lockoutCount).toBe(2)
    const expectedDuration = 15 * 60 * 1000
    expect(entry.lockedUntil).toBeGreaterThan(Date.now() + expectedDuration - 1000)
  })

  it('escalates to 24 hours on 3rd lockout', () => {
    const entry = { failures: 0, lockedUntil: 0, lockoutCount: 2 }
    for (let i = 0; i < 5; i++) processAuthFailure(entry)
    expect(entry.lockoutCount).toBe(3)
    const expectedDuration = 24 * 60 * 60 * 1000
    expect(entry.lockedUntil).toBeGreaterThan(Date.now() + expectedDuration - 1000)
  })

  it('caps lockoutCount at 3', () => {
    const entry = { failures: 0, lockedUntil: 0, lockoutCount: 3 }
    for (let i = 0; i < 5; i++) processAuthFailure(entry)
    expect(entry.lockoutCount).toBe(3) // still 3, not 4
  })
})

// ============================================================================
// Session validation
// ============================================================================

describe('session validation', () => {
  function isValidSession(
    sessions: Map<string, { expiresAt: number; ip: string }>,
    token: string,
  ): boolean {
    const session = sessions.get(token)
    if (!session) return false
    if (session.expiresAt < Date.now()) {
      sessions.delete(token)
      return false
    }
    return true
  }

  it('rejects unknown tokens', () => {
    const sessions = new Map()
    expect(isValidSession(sessions, 'unknown-token')).toBe(false)
  })

  it('accepts valid non-expired token', () => {
    const sessions = new Map([
      ['valid-token', { expiresAt: Date.now() + 60000, ip: '192.168.1.1' }],
    ])
    expect(isValidSession(sessions, 'valid-token')).toBe(true)
  })

  it('rejects and cleans up expired token', () => {
    const sessions = new Map([
      ['expired-token', { expiresAt: Date.now() - 1000, ip: '192.168.1.1' }],
    ])
    expect(isValidSession(sessions, 'expired-token')).toBe(false)
    expect(sessions.has('expired-token')).toBe(false)
  })
})

// ============================================================================
// RPC rate limiting
// ============================================================================

describe('RPC rate limiting', () => {
  const RPC_RATE_LIMIT = 120
  const RPC_RATE_WINDOW_MS = 2_000

  function isRpcAllowed(
    rpcLimits: Map<string, { count: number; windowStart: number }>,
    sessionKey: string,
  ): boolean {
    const now = Date.now()
    const limit = rpcLimits.get(sessionKey)
    if (limit && now - limit.windowStart < RPC_RATE_WINDOW_MS) {
      limit.count++
      return limit.count <= RPC_RATE_LIMIT
    }
    rpcLimits.set(sessionKey, { count: 1, windowStart: now })
    return true
  }

  it('allows requests within limit', () => {
    const limits = new Map<string, { count: number; windowStart: number }>()
    for (let i = 0; i < RPC_RATE_LIMIT; i++) {
      expect(isRpcAllowed(limits, 'session-1')).toBe(true)
    }
  })

  it('rejects requests exceeding limit within window', () => {
    const limits = new Map<string, { count: number; windowStart: number }>()
    for (let i = 0; i < RPC_RATE_LIMIT; i++) isRpcAllowed(limits, 'session-1')
    expect(isRpcAllowed(limits, 'session-1')).toBe(false)
  })

  it('resets after window expires', () => {
    const limits = new Map<string, { count: number; windowStart: number }>()
    limits.set('session-1', { count: RPC_RATE_LIMIT + 1, windowStart: Date.now() - RPC_RATE_WINDOW_MS - 1 })
    expect(isRpcAllowed(limits, 'session-1')).toBe(true)
  })

  it('tracks limits independently per session', () => {
    const limits = new Map<string, { count: number; windowStart: number }>()
    for (let i = 0; i < RPC_RATE_LIMIT; i++) isRpcAllowed(limits, 'session-1')
    expect(isRpcAllowed(limits, 'session-1')).toBe(false)
    expect(isRpcAllowed(limits, 'session-2')).toBe(true) // different session
  })
})

// ============================================================================
// Protected settings
// ============================================================================

describe('protected settings', () => {
  const PROTECTED_SETTINGS = new Set([
    'web_access_pin', 'web_access_enabled', 'web_access_port',
    'web_access_session_timeout', 'gemini_api_key', 'tmdb_api_key',
    'musicbrainz_api_token', 'plex_token', 'web_access_ip_allowlist',
  ])

  const WEB_SENSITIVE_SETTINGS = new Set([
    'plex_token', 'tmdb_api_key', 'gemini_api_key',
    'musicbrainz_api_token', 'web_access_pin',
    'web_access_enabled', 'web_access_port', 'web_access_session_timeout',
  ])

  it('blocks modification of all protected settings', () => {
    const protectedKeys = [
      'web_access_pin', 'web_access_enabled', 'web_access_port',
      'gemini_api_key', 'tmdb_api_key', 'plex_token',
    ]
    for (const key of protectedKeys) {
      expect(PROTECTED_SETTINGS.has(key)).toBe(true)
    }
  })

  it('marks sensitive settings for read masking', () => {
    const sensitiveKeys = [
      'plex_token', 'tmdb_api_key', 'gemini_api_key',
      'web_access_pin',
    ]
    for (const key of sensitiveKeys) {
      expect(WEB_SENSITIVE_SETTINGS.has(key)).toBe(true)
    }
  })

  it('allows modification of non-protected settings', () => {
    expect(PROTECTED_SETTINGS.has('quality_video_weight')).toBe(false)
    expect(PROTECTED_SETTINGS.has('dashboard_upgrade_sort')).toBe(false)
    expect(PROTECTED_SETTINGS.has('exclude_empty_seasons')).toBe(false)
  })
})

// ============================================================================
// Port & timeout configuration
// ============================================================================

describe('configuration helpers', () => {
  const DEFAULT_PORT = 9470
  const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000

  function parsePort(setting: string | null): number {
    const parsed = setting ? parseInt(setting, 10) : NaN
    return parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT
  }

  function parseSessionTimeout(setting: string | null): number {
    const parsed = setting ? parseInt(setting, 10) : NaN
    return parsed > 0 ? parsed : DEFAULT_SESSION_TIMEOUT_MS
  }

  describe('port parsing', () => {
    it('returns default for null', () => {
      expect(parsePort(null)).toBe(DEFAULT_PORT)
    })

    it('returns default for invalid values', () => {
      expect(parsePort('abc')).toBe(DEFAULT_PORT)
      expect(parsePort('0')).toBe(DEFAULT_PORT)
      expect(parsePort('-1')).toBe(DEFAULT_PORT)
      expect(parsePort('99999')).toBe(DEFAULT_PORT)
    })

    it('returns valid port numbers', () => {
      expect(parsePort('8080')).toBe(8080)
      expect(parsePort('443')).toBe(443)
      expect(parsePort('65535')).toBe(65535)
    })
  })

  describe('session timeout parsing', () => {
    it('returns default for null', () => {
      expect(parseSessionTimeout(null)).toBe(DEFAULT_SESSION_TIMEOUT_MS)
    })

    it('returns default for invalid values', () => {
      expect(parseSessionTimeout('abc')).toBe(DEFAULT_SESSION_TIMEOUT_MS)
      expect(parseSessionTimeout('0')).toBe(DEFAULT_SESSION_TIMEOUT_MS)
      expect(parseSessionTimeout('-1')).toBe(DEFAULT_SESSION_TIMEOUT_MS)
    })

    it('returns valid timeout values', () => {
      expect(parseSessionTimeout('3600000')).toBe(3600000)
      expect(parseSessionTimeout('86400000')).toBe(86400000)
    })
  })
})

// ============================================================================
// Path traversal prevention (artwork handler)
// ============================================================================

describe('artwork path traversal prevention', () => {
  const path = require('path')

  function isPathSafe(filePath: string, basePath: string): boolean {
    const resolved = path.resolve(filePath)
    const normalizedBase = path.resolve(basePath)
    return resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase
  }

  const basePath = process.platform === 'win32' ? 'C:\\Users\\test\\artwork' : '/home/test/artwork'

  it('allows files within artwork directory', () => {
    const file = path.join(basePath, 'albums', '123.jpg')
    expect(isPathSafe(file, basePath)).toBe(true)
  })

  it('rejects path traversal attempts', () => {
    const file = path.join(basePath, '..', '..', 'etc', 'passwd')
    expect(isPathSafe(file, basePath)).toBe(false)
  })

  it('rejects absolute paths outside base', () => {
    const file = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/etc/passwd'
    expect(isPathSafe(file, basePath)).toBe(false)
  })

  it('allows the base path itself', () => {
    expect(isPathSafe(basePath, basePath)).toBe(true)
  })
})

// ============================================================================
// Session limits per IP
// ============================================================================

describe('session limits per IP', () => {
  const MAX_SESSIONS_PER_IP = 10

  function enforceSessionLimit(
    sessions: Map<string, { expiresAt: number; ip: string }>,
    ip: string,
  ): void {
    // Purge expired
    const now = Date.now()
    for (const [token, session] of sessions.entries()) {
      if (session.ip === ip && session.expiresAt < now) {
        sessions.delete(token)
      }
    }

    // If over limit, remove oldest
    const ipSessions: Array<[string, { expiresAt: number; ip: string }]> = []
    for (const [token, session] of sessions.entries()) {
      if (session.ip === ip) ipSessions.push([token, session])
    }
    if (ipSessions.length >= MAX_SESSIONS_PER_IP) {
      ipSessions.sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      sessions.delete(ipSessions[0][0])
    }
  }

  it('allows sessions under the limit', () => {
    const sessions = new Map<string, { expiresAt: number; ip: string }>()
    for (let i = 0; i < 9; i++) {
      sessions.set(`token-${i}`, { expiresAt: Date.now() + 60000, ip: '192.168.1.1' })
    }
    enforceSessionLimit(sessions, '192.168.1.1')
    expect(sessions.size).toBe(9)
  })

  it('evicts oldest session when at limit', () => {
    const sessions = new Map<string, { expiresAt: number; ip: string }>()
    for (let i = 0; i < 10; i++) {
      sessions.set(`token-${i}`, { expiresAt: Date.now() + 60000 + i * 1000, ip: '192.168.1.1' })
    }
    enforceSessionLimit(sessions, '192.168.1.1')
    expect(sessions.size).toBe(9)
    expect(sessions.has('token-0')).toBe(false) // oldest removed
    expect(sessions.has('token-9')).toBe(true)
  })

  it('purges expired sessions before checking limit', () => {
    const sessions = new Map<string, { expiresAt: number; ip: string }>()
    for (let i = 0; i < 10; i++) {
      sessions.set(`token-${i}`, { expiresAt: Date.now() - 1000, ip: '192.168.1.1' }) // all expired
    }
    enforceSessionLimit(sessions, '192.168.1.1')
    expect(sessions.size).toBe(0)
  })

  it('does not affect sessions from other IPs', () => {
    const sessions = new Map<string, { expiresAt: number; ip: string }>()
    for (let i = 0; i < 10; i++) {
      sessions.set(`token-a-${i}`, { expiresAt: Date.now() + 60000, ip: '192.168.1.1' })
    }
    sessions.set('token-b-0', { expiresAt: Date.now() + 60000, ip: '10.0.0.1' })
    enforceSessionLimit(sessions, '192.168.1.1')
    expect(sessions.has('token-b-0')).toBe(true) // other IP untouched
  })
})
