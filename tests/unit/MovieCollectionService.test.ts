/**
 * MovieCollectionService Tests
 *
 * Tests collection completeness analysis logic — the area with the most
 * user-reported bugs (collections not completing, disappearing, duplicating).
 */

// Mock dependencies
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => mockDb),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => mockTmdb),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/utils/httpClient', () => ({
  fetchJSON: vi.fn(),
}))

const mockDb = {
  getSetting: vi.fn(() => 'fake-tmdb-key'),
  setSetting: vi.fn(),
  deleteSetting: vi.fn(),
  getMediaItems: vi.fn(() => []),
  getMediaSources: vi.fn(() => []),
  getMediaSourceById: vi.fn(() => null),
  getMovieCollections: vi.fn(() => []),
  upsertMovieCollection: vi.fn(),
  deleteMovieCollection: vi.fn(),
  clearMovieCollections: vi.fn(),
  forceSave: vi.fn(),
  startBatch: vi.fn(),
  endBatch: vi.fn(),
  updateMediaItemArtwork: vi.fn(),
}

const mockTmdb = {
  initialize: vi.fn(),
  getMovieDetails: vi.fn(),
  getCollectionDetails: vi.fn(),
  buildImageUrl: vi.fn((path: string, size: string) => `https://image.tmdb.org/t/p/${size}${path}`),
}

import { getMovieCollectionService } from '../../src/main/services/MovieCollectionService'

describe('MovieCollectionService', () => {
  let service: ReturnType<typeof getMovieCollectionService>

  beforeEach(() => {
    vi.clearAllMocks()
    service = getMovieCollectionService()
    // Reset cancellation state
    service.resetCancellation()
  })

  describe('lookupCollectionCompleteness', () => {
    it('calculates completeness percentage correctly', async () => {
      mockTmdb.getCollectionDetails.mockResolvedValue({
        name: 'The Dark Knight Collection',
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        parts: [
          { id: 1, title: 'Batman Begins', release_date: '2005-06-15', poster_path: '/bb.jpg' },
          { id: 2, title: 'The Dark Knight', release_date: '2008-07-18', poster_path: '/dk.jpg' },
          { id: 3, title: 'The Dark Knight Rises', release_date: '2012-07-20', poster_path: '/dkr.jpg' },
        ],
      })

      const result = await service.lookupCollectionCompleteness('123', ['1', '2']) // Own 2 of 3

      expect(result).not.toBeNull()
      expect(result!.totalMovies).toBe(3)
      expect(result!.ownedMovies).toBe(2)
      expect(result!.completenessPercentage).toBe(67) // Math.round(2/3 * 100)
      expect(result!.missingMovies).toHaveLength(1)
      expect(result!.missingMovies[0].title).toBe('The Dark Knight Rises')
      expect(result!.collectionName).toBe('The Dark Knight Collection')
    })

    it('returns null for single-movie collections', async () => {
      mockTmdb.getCollectionDetails.mockResolvedValue({
        name: 'Solo Collection',
        parts: [
          { id: 1, title: 'Only Movie', release_date: '2020-01-01' },
        ],
      })

      const result = await service.lookupCollectionCompleteness('456', ['1'])
      expect(result).toBeNull()
    })

    it('filters out unreleased movies', async () => {
      mockTmdb.getCollectionDetails.mockResolvedValue({
        name: 'Future Collection',
        parts: [
          { id: 1, title: 'Released', release_date: '2020-01-01' },
          { id: 2, title: 'Also Released', release_date: '2022-06-01' },
          { id: 3, title: 'Not Yet', release_date: '2099-12-31' },
          { id: 4, title: 'No Date', release_date: null },
        ],
      })

      const result = await service.lookupCollectionCompleteness('789', ['1'])

      expect(result).not.toBeNull()
      expect(result!.totalMovies).toBe(2) // Only released movies count
      expect(result!.ownedMovies).toBe(1)
    })

    it('returns 100% when all released movies are owned', async () => {
      mockTmdb.getCollectionDetails.mockResolvedValue({
        name: 'Complete Collection',
        parts: [
          { id: 1, title: 'Movie A', release_date: '2020-01-01' },
          { id: 2, title: 'Movie B', release_date: '2021-01-01' },
        ],
      })

      const result = await service.lookupCollectionCompleteness('100', ['1', '2'])

      expect(result!.completenessPercentage).toBe(100)
      expect(result!.missingMovies).toHaveLength(0)
    })

    it('handles empty owned list (0% completeness)', async () => {
      mockTmdb.getCollectionDetails.mockResolvedValue({
        name: 'Not Owned',
        parts: [
          { id: 1, title: 'A', release_date: '2020-01-01' },
          { id: 2, title: 'B', release_date: '2021-01-01' },
        ],
      })

      const result = await service.lookupCollectionCompleteness('200', [])

      expect(result!.completenessPercentage).toBe(0)
      expect(result!.missingMovies).toHaveLength(2)
    })
  })

  describe('analyzeAllCollections', () => {
    it('throws if TMDB API key not configured', async () => {
      mockDb.getSetting.mockReturnValue(null)

      await expect(
        service.analyzeAllCollections(undefined, 'src1')
      ).rejects.toThrow('TMDB API key not configured')
    })

    it('skips when no movies have TMDB IDs', async () => {
      mockDb.getSetting.mockReturnValue('key')
      mockDb.getMediaItems.mockReturnValue([
        { id: 1, title: 'No TMDB', type: 'movie', tmdb_id: null },
      ])
      mockDb.getMediaSourceById.mockReturnValue({ source_type: 'plex' })

      const result = await service.analyzeAllCollections(undefined, 'src1')

      expect(result.completed).toBe(true)
      expect(result.analyzed).toBe(0)
    })

    it('respects cancellation during scanning phase', async () => {
      mockDb.getSetting.mockReturnValue('key')
      mockDb.getMediaSourceById.mockReturnValue({ source_type: 'plex' })
      mockDb.getMediaItems.mockReturnValue([
        { id: 1, title: 'Movie 1', type: 'movie', tmdb_id: '550', plex_id: 'p1' },
        { id: 2, title: 'Movie 2', type: 'movie', tmdb_id: '551', plex_id: 'p2' },
      ])

      // Cancel after first TMDB lookup
      let callCount = 0
      mockTmdb.getMovieDetails.mockImplementation(async () => {
        callCount++
        if (callCount >= 1) service.cancel()
        return { belongs_to_collection: { id: 1, name: 'Collection' } }
      })

      const result = await service.analyzeAllCollections(undefined, 'src1')

      expect(result.completed).toBe(false)
    })

    it('sets incomplete flag on cancellation', async () => {
      mockDb.getSetting.mockReturnValue('key')
      mockDb.getMediaSourceById.mockReturnValue({ source_type: 'plex' })
      mockDb.getMediaItems.mockReturnValue([
        { id: 1, title: 'Movie', type: 'movie', tmdb_id: '550', plex_id: 'p1' },
      ])

      // Cancel during processing
      mockTmdb.getMovieDetails.mockImplementation(async () => {
        service.cancel()
        return { belongs_to_collection: { id: 1, name: 'Coll' } }
      })

      await service.analyzeAllCollections(undefined, 'src1')

      expect(mockDb.setSetting).toHaveBeenCalledWith('collection_analysis_incomplete', 'true')
    })

    it('clears incomplete flag on successful completion', async () => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'tmdb_api_key') return 'key'
        if (key === 'collection_analysis_incomplete') return 'true'
        return null
      })
      mockDb.getMediaSourceById.mockReturnValue({ source_type: 'plex' })
      mockDb.getMediaItems.mockReturnValue([])

      await service.analyzeAllCollections(undefined, 'src1')

      expect(mockDb.deleteSetting).toHaveBeenCalledWith('collection_analysis_incomplete')
    })
  })

  describe('deduplication', () => {
    it('keeps higher bitrate version when TMDB IDs match', () => {
      const movies = [
        { id: 1, tmdb_id: '550', title: 'Fight Club', video_bitrate: 3000 },
        { id: 2, tmdb_id: '550', title: 'Fight Club', video_bitrate: 8000 },
        { id: 3, tmdb_id: '551', title: 'Other Movie', video_bitrate: 5000 },
      ] as unknown as MediaItem[]

      // Access the private method via any cast for testing
      const deduplicated = (service as unknown as { deduplicateMoviesByTmdbId: (m: MediaItem[]) => MediaItem[] })
        .deduplicateMoviesByTmdbId(movies)

      expect(deduplicated).toHaveLength(2)
      const fightClub = deduplicated.find(m => m.tmdb_id === '550')
      expect(fightClub?.video_bitrate).toBe(8000) // Higher bitrate kept
    })

    it('skips movies without TMDB IDs', () => {
      const movies = [
        { id: 1, tmdb_id: null, title: 'No ID', video_bitrate: 5000 },
        { id: 2, tmdb_id: '100', title: 'Has ID', video_bitrate: 5000 },
      ] as unknown as MediaItem[]

      const deduplicated = (service as unknown as { deduplicateMoviesByTmdbId: (m: MediaItem[]) => MediaItem[] })
        .deduplicateMoviesByTmdbId(movies)

      expect(deduplicated).toHaveLength(1)
      expect(deduplicated[0].tmdb_id).toBe('100')
    })
  })
})

// Need to import MediaItem type for test data
import type { MediaItem } from '../../src/main/types/database'
