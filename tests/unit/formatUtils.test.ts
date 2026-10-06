import { describe, it, expect } from 'vitest'
import { formatSize } from '@main/services/utils/formatUtils'

describe('formatUtils', () => {
  describe('formatSize', () => {
    it('formats zero bytes', () => {
      expect(formatSize(0)).toBe('0 MB')
    })

    it('formats small values as MB', () => {
      expect(formatSize(500_000_000)).toBe('500 MB')
    })

    it('formats GB values', () => {
      expect(formatSize(1.5e9)).toBe('1.5 GB')
    })

    it('formats TB values', () => {
      expect(formatSize(2.3e12)).toBe('2.3 TB')
    })

    it('formats exactly at GB boundary', () => {
      expect(formatSize(1e9)).toBe('1.0 GB')
    })

    it('formats exactly at TB boundary', () => {
      expect(formatSize(1e12)).toBe('1.0 TB')
    })

    it('formats very small values', () => {
      expect(formatSize(1000)).toBe('0 MB')
    })

    it('formats sub-GB as MB without decimals', () => {
      expect(formatSize(123_456_789)).toBe('123 MB')
    })
  })
})
