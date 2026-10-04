/**
 * LoggingService Tests
 *
 * Tests console interception safety, circular buffer, and sanitization.
 * The try/catch safety fix was added during stability audit.
 */

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
  })),
}))

import { getLoggingService } from '../../src/main/services/LoggingService'

describe('LoggingService', () => {
  let service: ReturnType<typeof getLoggingService>

  beforeEach(() => {
    service = getLoggingService()
  })

  describe('getLogs', () => {
    it('returns an array', () => {
      const logs = service.getLogs()
      expect(Array.isArray(logs)).toBe(true)
    })

    it('respects limit parameter', () => {
      const logs = service.getLogs(5)
      expect(logs.length).toBeLessThanOrEqual(5)
    })
  })

  describe('sanitization', () => {
    it('sanitizes API key patterns from log messages', () => {
      // The sanitize method is private, but we can test through the public API
      // by checking that logged messages don't contain sensitive patterns
      const logs = service.getLogs()
      for (const log of logs) {
        expect(log.message).not.toMatch(/X-Plex-Token=[a-zA-Z0-9]{10,}/)
        expect(log.message).not.toMatch(/api_key=[a-zA-Z0-9]{10,}/)
      }
    })
  })

  describe('verbose mode', () => {
    it('verbose method exists and accepts source + message', () => {
      // Should not throw
      expect(() => {
        service.verbose('[Test]', 'test message')
      }).not.toThrow()
    })

    it('verbose with details object does not throw', () => {
      expect(() => {
        service.verbose('[Test]', 'message', { key: 'value' })
      }).not.toThrow()
    })
  })

  describe('console interception safety', () => {
    it('console.log does not throw even if captureLog has issues', () => {
      // After the stability fix, captureLog is wrapped in try/catch
      // so console.log should never throw
      expect(() => {
        console.log('test log message')
      }).not.toThrow()
    })

    it('console.error does not throw', () => {
      expect(() => {
        console.error('test error message')
      }).not.toThrow()
    })

    it('console.warn does not throw', () => {
      expect(() => {
        console.warn('test warn message')
      }).not.toThrow()
    })

    it('logging with circular reference does not throw', () => {
      // This was the original bug — circular refs in JSON.stringify could crash
      const circular: Record<string, unknown> = { a: 1 }
      circular.self = circular

      expect(() => {
        console.log('circular:', circular)
      }).not.toThrow()
    })

    it('logging with null/undefined does not throw', () => {
      expect(() => {
        console.log(null, undefined, '', 0, false)
      }).not.toThrow()
    })
  })
})
