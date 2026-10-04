/**
 * httpClient Tests
 *
 * Tests the lightweight fetch wrapper — URL building, error handling, type guards.
 * This is the HTTP layer used by ALL providers and API services.
 */

import { HttpError, isHttpError, buildUrl } from '../../src/main/services/utils/httpClient'

describe('httpClient', () => {
  describe('HttpError', () => {
    it('creates error with status and data', () => {
      const err = new HttpError(404, { message: 'Not Found' }, 'Resource not found')

      expect(err.status).toBe(404)
      expect(err.data).toEqual({ message: 'Not Found' })
      expect(err.message).toBe('Resource not found')
      expect(err.name).toBe('HttpError')
    })

    it('is an instance of Error', () => {
      const err = new HttpError(500, null, 'Server error')

      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(HttpError)
    })
  })

  describe('isHttpError', () => {
    it('returns true for HttpError instances', () => {
      const err = new HttpError(400, null, 'Bad')
      expect(isHttpError(err)).toBe(true)
    })

    it('returns false for regular Error', () => {
      const err = new Error('regular')
      expect(isHttpError(err)).toBe(false)
    })

    it('returns false for non-error values', () => {
      expect(isHttpError(null)).toBe(false)
      expect(isHttpError(undefined)).toBe(false)
      expect(isHttpError('string')).toBe(false)
      expect(isHttpError(42)).toBe(false)
      expect(isHttpError({ status: 404 })).toBe(false)
    })
  })

  describe('buildUrl', () => {
    it('returns base URL when no params', () => {
      expect(buildUrl('https://api.example.com/data')).toBe('https://api.example.com/data')
    })

    it('returns base URL when params is undefined', () => {
      expect(buildUrl('https://api.example.com/data', undefined)).toBe('https://api.example.com/data')
    })

    it('appends query params to URL', () => {
      const url = buildUrl('https://api.example.com/data', { key: 'value', page: 1 })

      expect(url).toContain('key=value')
      expect(url).toContain('page=1')
      expect(url).toMatch(/\?.*&/)
    })

    it('skips null and undefined values', () => {
      const url = buildUrl('https://api.example.com/data', {
        present: 'yes',
        missing: null,
        also_missing: undefined,
      })

      expect(url).toContain('present=yes')
      expect(url).not.toContain('missing')
      expect(url).not.toContain('also_missing')
    })

    it('handles boolean values', () => {
      const url = buildUrl('https://example.com', { active: true, deleted: false })

      expect(url).toContain('active=true')
      expect(url).toContain('deleted=false')
    })

    it('returns base URL when all params are null/undefined', () => {
      const url = buildUrl('https://example.com', { a: null, b: undefined })

      expect(url).toBe('https://example.com')
    })

    it('handles URL with existing query string', () => {
      const url = buildUrl('https://example.com?existing=1', { new: '2' })

      // buildUrl uses URLSearchParams which creates a separate query string
      expect(url).toContain('new=2')
    })

    it('encodes special characters', () => {
      const url = buildUrl('https://example.com', { query: 'hello world' })

      expect(url).toContain('query=hello+world')
    })
  })
})
