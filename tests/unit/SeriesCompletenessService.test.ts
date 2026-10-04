/**
 * SeriesCompletenessService Tests
 *
 * Tests series completeness analysis — episode counting, missing episode
 * detection, season 0 handling, and completeness calculation.
 */

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

const mockDb = {
  getSetting: vi.fn(() => 'fake-key'),
  getMediaItems: vi.fn(() => []),
  getMediaSources: vi.fn(() => []),
  getEpisodesForSeries: vi.fn(() => []),
  getSeriesCompletenessByTitle: vi.fn(() => null),
  upsertSeriesCompleteness: vi.fn(() => 1),
  deleteSeriesCompleteness: vi.fn(),
  getSeriesCompleteness: vi.fn(() => []),
  getAllSeriesCompleteness: vi.fn(() => []),
  updateMediaItemArtwork: vi.fn(),
  getMediaSourceById: vi.fn(() => null),
  startBatch: vi.fn(),
  endBatch: vi.fn(),
  forceSave: vi.fn(),
}

const mockTmdb = {
  initialize: vi.fn(),
  getTVShowDetails: vi.fn(),
  getTVShowWithSeasons: vi.fn(),
  getSeasonDetails: vi.fn(),
  searchTVShow: vi.fn(),
  buildImageUrl: vi.fn((path: string) => path ? `https://img${path}` : null),
}

import { getSeriesCompletenessService } from '../../src/main/services/SeriesCompletenessService'

describe('SeriesCompletenessService', () => {
  let service: ReturnType<typeof getSeriesCompletenessService>

  beforeEach(() => {
    vi.clearAllMocks()
    service = getSeriesCompletenessService()
    service.resetCancellation()
  })

  describe('analyzeSeries', () => {
    it('returns null when no episodes found', async () => {
      mockDb.getEpisodesForSeries.mockReturnValue([])

      const result = await service.analyzeSeries('Unknown Show')

      expect(result).toBeNull()
    })

    it('creates unmatched result when TMDB ID not found', async () => {
      mockDb.getEpisodesForSeries.mockReturnValue([
        { season_number: 1, episode_number: 1, series_tmdb_id: null, title: 'Ep1' },
      ])
      mockTmdb.searchTVShow.mockResolvedValue({ results: [] })
      mockDb.getSeriesCompletenessByTitle.mockReturnValue({
        series_title: 'No Match Show',
        owned_episodes: 1,
        completeness_percentage: 0,
      })

      const result = await service.analyzeSeries('No Match Show')

      expect(result).toBeDefined()
      expect(mockDb.upsertSeriesCompleteness).toHaveBeenCalled()
    })

    it('analyzes series with cached TMDB ID', async () => {
      mockDb.getEpisodesForSeries.mockReturnValue([
        { season_number: 1, episode_number: 1, series_tmdb_id: '1234' },
        { season_number: 1, episode_number: 2, series_tmdb_id: '1234' },
      ])

      mockTmdb.getTVShowDetails.mockResolvedValue({
        poster_path: '/poster.jpg',
        backdrop_path: '/bg.jpg',
        status: 'Ended',
        seasons: [
          { season_number: 1, air_date: '2020-01-01' },
        ],
      })

      mockTmdb.getTVShowWithSeasons.mockResolvedValue({
        'season/1': {
          poster_path: null,
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2020-01-01' },
            { season_number: 1, episode_number: 2, name: 'Second', air_date: '2020-01-08' },
            { season_number: 1, episode_number: 3, name: 'Third', air_date: '2020-01-15' },
          ],
        },
      })

      mockDb.getSeriesCompletenessByTitle.mockReturnValue({
        series_title: 'Test Show',
        total_episodes: 3,
        owned_episodes: 2,
        completeness_percentage: 67,
      })

      const result = await service.analyzeSeries('Test Show', undefined, undefined, '1234')

      expect(result).toBeDefined()
      expect(mockTmdb.getTVShowDetails).toHaveBeenCalledWith('1234')
      expect(mockDb.upsertSeriesCompleteness).toHaveBeenCalled()

      // Check the upsert was called with correct data
      const upsertCall = mockDb.upsertSeriesCompleteness.mock.calls[0][0]
      expect(upsertCall.total_episodes).toBe(3)
      expect(upsertCall.owned_episodes).toBe(2)
      expect(upsertCall.completeness_percentage).toBe(67)
    })

    it('excludes season 0 specials from owned count', async () => {
      mockDb.getEpisodesForSeries.mockReturnValue([
        { season_number: 0, episode_number: 1, series_tmdb_id: '100' }, // Special
        { season_number: 1, episode_number: 1, series_tmdb_id: '100' },
      ])

      mockTmdb.getTVShowDetails.mockResolvedValue({
        poster_path: null, backdrop_path: null, status: 'Ended',
        seasons: [
          { season_number: 0, air_date: '2019-01-01' },
          { season_number: 1, air_date: '2020-01-01' },
        ],
      })

      mockTmdb.getTVShowWithSeasons.mockResolvedValue({
        'season/1': {
          poster_path: null,
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Ep', air_date: '2020-01-01' },
          ],
        },
      })

      mockDb.getSeriesCompletenessByTitle.mockReturnValue({ completeness_percentage: 100 })

      await service.analyzeSeries('Show', undefined, undefined, '100')

      const upsertCall = mockDb.upsertSeriesCompleteness.mock.calls[0][0]
      // owned_episodes should be 1 (season 0 excluded)
      expect(upsertCall.owned_episodes).toBe(1)
      expect(upsertCall.completeness_percentage).toBe(100)
    })

    it('clamps completeness to 100% max', async () => {
      // User has more episodes than TMDB knows about
      mockDb.getEpisodesForSeries.mockReturnValue([
        { season_number: 1, episode_number: 1, series_tmdb_id: '200' },
        { season_number: 1, episode_number: 2, series_tmdb_id: '200' },
        { season_number: 1, episode_number: 3, series_tmdb_id: '200' }, // Extra
      ])

      mockTmdb.getTVShowDetails.mockResolvedValue({
        poster_path: null, backdrop_path: null, status: 'Ended',
        seasons: [{ season_number: 1, air_date: '2020-01-01' }],
      })

      mockTmdb.getTVShowWithSeasons.mockResolvedValue({
        'season/1': {
          poster_path: null,
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Ep', air_date: '2020-01-01' },
          ],
        },
      })

      mockDb.getSeriesCompletenessByTitle.mockReturnValue({ completeness_percentage: 100 })

      await service.analyzeSeries('Show', undefined, undefined, '200')

      const upsertCall = mockDb.upsertSeriesCompleteness.mock.calls[0][0]
      expect(upsertCall.completeness_percentage).toBeLessThanOrEqual(100)
    })
  })

  describe('analyzeAllSeries', () => {
    it('completes with no series to analyze', async () => {
      mockDb.getMediaItems.mockReturnValue([])

      const result = await service.analyzeAllSeries(undefined, 'src1')

      expect(result.completed).toBe(true)
      expect(result.analyzed).toBe(0)
    })
  })
})
