import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
  })),
}))

import { parseTrackNumber } from '@main/providers/kodi/KodiMusicDatabaseSchema'

describe('KodiMusicDatabaseSchema', () => {
  describe('parseTrackNumber', () => {
    it('returns disc 1 track 0 for zero', () => {
      expect(parseTrackNumber(0)).toEqual({ disc: 1, track: 0 })
    })

    it('returns disc 1 track 0 for negative', () => {
      expect(parseTrackNumber(-1)).toEqual({ disc: 1, track: 0 })
    })

    it('returns simple track number on disc 1', () => {
      expect(parseTrackNumber(5)).toEqual({ disc: 1, track: 5 })
    })

    it('returns disc 1 for max simple track', () => {
      expect(parseTrackNumber(65535)).toEqual({ disc: 1, track: 65535 })
    })

    it('decodes combined disc 1 track 5', () => {
      // 1 * 65536 + 5 = 65541
      expect(parseTrackNumber(65541)).toEqual({ disc: 1, track: 5 })
    })

    it('decodes combined disc 2 track 5', () => {
      // 2 * 65536 + 5 = 131077
      expect(parseTrackNumber(131077)).toEqual({ disc: 2, track: 5 })
    })

    it('decodes disc boundary at 65536', () => {
      // 1 * 65536 + 0 = 65536
      expect(parseTrackNumber(65536)).toEqual({ disc: 1, track: 0 })
    })

    it('decodes disc 3', () => {
      // 3 * 65536 + 1 = 196609
      expect(parseTrackNumber(196609)).toEqual({ disc: 3, track: 1 })
    })
  })
})
