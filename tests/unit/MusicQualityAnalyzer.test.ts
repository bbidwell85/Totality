/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAnalyzeMusicAlbum = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    analyzeMusicAlbum: mockAnalyzeMusicAlbum,
  })),
}))

import { analyzeAlbumQuality } from '@main/services/MusicQualityAnalyzer'

function createMockDb(albums: any[] = [], tracks: any[] = []) {
  return {
    getMusicAlbums: vi.fn(() => albums),
    getMusicTracks: vi.fn(() => tracks),
    upsertMusicQualityScore: vi.fn(),
    startBatch: vi.fn(),
    endBatch: vi.fn(),
  }
}

describe('MusicQualityAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnalyzeMusicAlbum.mockReturnValue({ quality_tier: 'high' })
  })

  describe('analyzeAlbumQuality', () => {
    it('returns early for empty album list', async () => {
      const db = createMockDb()
      await analyzeAlbumQuality(db)
      expect(db.startBatch).not.toHaveBeenCalled()
    })

    it('analyzes each album', async () => {
      const albums = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
      const db = createMockDb(albums, [])
      await analyzeAlbumQuality(db)
      expect(mockAnalyzeMusicAlbum).toHaveBeenCalledTimes(2)
      expect(db.upsertMusicQualityScore).toHaveBeenCalledTimes(2)
    })

    it('wraps in batch mode', async () => {
      const db = createMockDb([{ id: 1 }], [])
      await analyzeAlbumQuality(db)
      expect(db.startBatch).toHaveBeenCalledOnce()
      expect(db.endBatch).toHaveBeenCalledOnce()
    })

    it('calls endBatch even on error', async () => {
      const db = createMockDb([{ id: 1 }], [])
      mockAnalyzeMusicAlbum.mockImplementation(() => { throw new Error('fail') })
      await expect(analyzeAlbumQuality(db)).rejects.toThrow('fail')
      expect(db.endBatch).toHaveBeenCalledOnce()
    })

    it('calls progress callback', async () => {
      const albums = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const db = createMockDb(albums, [])
      const onProgress = vi.fn()
      await analyzeAlbumQuality(db, undefined, onProgress)
      expect(onProgress).toHaveBeenCalledTimes(3)
      expect(onProgress).toHaveBeenCalledWith(1, 3)
      expect(onProgress).toHaveBeenCalledWith(3, 3)
    })

    it('uses bulk track fetching when available', async () => {
      const albums = [{ id: 1 }, { id: 2 }]
      const trackMap = new Map([[1, [{ id: 10 }]], [2, [{ id: 20 }]]])
      const db = {
        ...createMockDb(albums),
        getMusicTracksByAlbumIds: vi.fn(() => trackMap),
      }
      await analyzeAlbumQuality(db)
      expect(db.getMusicTracksByAlbumIds).toHaveBeenCalledWith([1, 2])
      expect(db.getMusicTracks).not.toHaveBeenCalled()
    })

    it('falls back to per-album tracks when bulk not available', async () => {
      const db = createMockDb([{ id: 1 }], [{ id: 10 }])
      await analyzeAlbumQuality(db)
      expect(db.getMusicTracks).toHaveBeenCalled()
    })

    it('filters sourceId', async () => {
      const db = createMockDb([{ id: 1 }], [])
      await analyzeAlbumQuality(db, 'source-1')
      expect(db.getMusicAlbums).toHaveBeenCalledWith({ sourceId: 'source-1' })
    })
  })
})
