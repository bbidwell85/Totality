import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetMediaSources = vi.hoisted(() => vi.fn())
const mockCountMusicTracks = vi.hoisted(() => vi.fn())
const mockGetMusicTracks = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getMediaSources: mockGetMediaSources,
    countMusicTracks: mockCountMusicTracks,
    getMusicTracks: mockGetMusicTracks,
  })),
}))

import { MoodSyncService } from '@main/services/MoodSyncService'

describe('MoodSyncService', () => {
  let service: MoodSyncService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MoodSyncService()
  })

  // ==========================================================================
  // getSources
  // ==========================================================================
  describe('getSources', () => {
    it('filters non-TAG_SYNC providers', () => {
      mockGetMediaSources.mockReturnValue([
        { source_id: 's1', display_name: 'Plex', source_type: 'plex' },
        { source_id: 's2', display_name: 'Local', source_type: 'local' },
      ])
      mockCountMusicTracks.mockReturnValue(10)

      const result = service.getSources()
      expect(result).toHaveLength(1)
      expect(result[0].sourceName).toBe('Plex')
    })

    it('skips sources with 0 tracks', () => {
      mockGetMediaSources.mockReturnValue([
        { source_id: 's1', display_name: 'Plex', source_type: 'plex' },
      ])
      mockCountMusicTracks.mockReturnValue(0)

      const result = service.getSources()
      expect(result).toHaveLength(0)
    })

    it('returns track counts per source', () => {
      mockGetMediaSources.mockReturnValue([
        { source_id: 's1', display_name: 'Plex', source_type: 'plex' },
      ])
      mockCountMusicTracks
        .mockReturnValueOnce(100) // totalTracks
        .mockReturnValueOnce(50)  // tracksWithMoods

      const result = service.getSources('mood')
      expect(result[0].totalTracks).toBe(100)
      expect(result[0].tracksWithMoods).toBe(50)
    })

    it('includes all TAG_SYNC providers', () => {
      mockGetMediaSources.mockReturnValue([
        { source_id: 's1', display_name: 'Plex', source_type: 'plex' },
        { source_id: 's2', display_name: 'MM', source_type: 'mediamonkey' },
        { source_id: 's3', display_name: 'Kodi', source_type: 'kodi' },
        { source_id: 's4', display_name: 'Kodi Local', source_type: 'kodi-local' },
      ])
      mockCountMusicTracks.mockReturnValue(5)

      const result = service.getSources()
      expect(result).toHaveLength(4)
    })
  })

  // ==========================================================================
  // getComparison
  // ==========================================================================
  describe('getComparison', () => {
    it('returns empty when SOT has no tracks with tags', () => {
      mockGetMusicTracks.mockReturnValue([])
      const result = service.getComparison('sot-source')
      expect(result).toEqual([])
    })

    it('returns empty when no other TAG_SYNC sources exist', () => {
      mockGetMusicTracks.mockReturnValue([
        { id: 1, title: 'Song', artist_name: 'Artist', mood: '["Happy"]' },
      ])
      mockGetMediaSources.mockReturnValue([])

      const result = service.getComparison('sot-source')
      expect(result).toEqual([])
    })

    it('matches tracks by musicbrainz_id', () => {
      const sotTrack = {
        id: 1, title: 'Song', artist_name: 'Artist',
        musicbrainz_id: 'mb-123', mood: '["Happy"]',
      }
      const targetTrack = {
        id: 2, title: 'Song', artist_name: 'Artist',
        musicbrainz_id: 'mb-123', mood: '["Sad"]', provider_id: 'p2',
      }

      mockGetMusicTracks.mockReturnValueOnce([sotTrack]) // SOT tracks
      mockGetMediaSources.mockReturnValue([
        { source_id: 'target', display_name: 'Target', source_type: 'plex' },
      ])
      mockCountMusicTracks.mockReturnValue(1)
      mockGetMusicTracks.mockReturnValueOnce([targetTrack]) // target tracks

      const result = service.getComparison('sot-source')
      expect(result).toHaveLength(1)
      expect(result[0].targets[0].hasMismatch).toBe(true)
    })

    it('matches tracks by title+artist fallback', () => {
      const sotTrack = {
        id: 1, title: 'Song Title', artist_name: 'Artist Name',
        mood: '["Chill"]',
      }
      const targetTrack = {
        id: 2, title: 'Song Title', artist_name: 'Artist Name',
        mood: '["Chill"]', provider_id: 'p2',
      }

      mockGetMusicTracks.mockReturnValueOnce([sotTrack])
      mockGetMediaSources.mockReturnValue([
        { source_id: 'target', display_name: 'Target', source_type: 'mediamonkey' },
      ])
      mockCountMusicTracks.mockReturnValue(1)
      mockGetMusicTracks.mockReturnValueOnce([targetTrack])

      const result = service.getComparison('sot-source')
      expect(result).toHaveLength(1)
      expect(result[0].targets[0].hasMismatch).toBe(false)
    })

    it('detects case-insensitive tag matches', () => {
      const sotTrack = {
        id: 1, title: 'Song', artist_name: 'Artist',
        musicbrainz_id: 'mb-1', mood: '["Happy", "Sad"]',
      }
      const targetTrack = {
        id: 2, title: 'Song', artist_name: 'Artist',
        musicbrainz_id: 'mb-1', mood: '["sad", "happy"]', provider_id: 'p2',
      }

      mockGetMusicTracks.mockReturnValueOnce([sotTrack])
      mockGetMediaSources.mockReturnValue([
        { source_id: 'target', display_name: 'Target', source_type: 'plex' },
      ])
      mockCountMusicTracks.mockReturnValue(1)
      mockGetMusicTracks.mockReturnValueOnce([targetTrack])

      const result = service.getComparison('sot-source')
      expect(result[0].targets[0].hasMismatch).toBe(false)
    })

    it('skips SOT tracks with empty tags', () => {
      const sotTrack = {
        id: 1, title: 'Song', artist_name: 'Artist', mood: null,
      }

      mockGetMusicTracks.mockReturnValueOnce([sotTrack])
      mockGetMediaSources.mockReturnValue([
        { source_id: 'target', display_name: 'Target', source_type: 'plex' },
      ])
      mockCountMusicTracks.mockReturnValue(1)
      mockGetMusicTracks.mockReturnValueOnce([])

      const result = service.getComparison('sot-source')
      expect(result).toHaveLength(0)
    })

    it('uses genre field when specified', () => {
      const sotTrack = {
        id: 1, title: 'Song', artist_name: 'Artist',
        musicbrainz_id: 'mb-1', genres: '["Rock"]',
      }
      const targetTrack = {
        id: 2, title: 'Song', artist_name: 'Artist',
        musicbrainz_id: 'mb-1', genres: '["Pop"]', provider_id: 'p2',
      }

      mockGetMusicTracks.mockReturnValueOnce([sotTrack])
      mockGetMediaSources.mockReturnValue([
        { source_id: 'target', display_name: 'Target', source_type: 'plex' },
      ])
      mockCountMusicTracks.mockReturnValue(1)
      mockGetMusicTracks.mockReturnValueOnce([targetTrack])

      const result = service.getComparison('sot-source', 'genre')
      expect(result).toHaveLength(1)
      expect(result[0].targets[0].hasMismatch).toBe(true)
    })
  })
})
