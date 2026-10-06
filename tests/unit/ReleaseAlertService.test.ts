import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetSetting = vi.hoisted(() => vi.fn())
const mockGetWishlistItems = vi.hoisted(() => vi.fn())
const mockCreateNotification = vi.hoisted(() => vi.fn())
const mockGetMovieReleaseDates = vi.hoisted(() => vi.fn())
const mockGetTVShowDetails = vi.hoisted(() => vi.fn())
const mockEmitNotificationCreated = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: mockGetSetting,
    getWishlistItems: mockGetWishlistItems,
    createNotification: mockCreateNotification,
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    initialize: vi.fn(),
    getMovieReleaseDates: mockGetMovieReleaseDates,
    getTVShowDetails: mockGetTVShowDetails,
  })),
}))

vi.mock('../../src/main/ipc/utils/notificationEmitter', () => ({
  emitNotificationCreated: mockEmitNotificationCreated,
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))

import { ReleaseAlertService } from '@main/services/ReleaseAlertService'

describe('ReleaseAlertService', () => {
  let service: ReleaseAlertService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    service = new ReleaseAlertService()
  })

  afterEach(() => {
    service.stop()
    vi.useRealTimers()
  })

  // ==========================================================================
  // start / stop
  // ==========================================================================
  describe('start', () => {
    it('does nothing when disabled', async () => {
      mockGetSetting.mockReturnValue('false')
      await service.start()
      // No timer set — advancing time should not call checkForReleases
      expect(mockGetWishlistItems).not.toHaveBeenCalled()
    })

    it('sets up polling when enabled', async () => {
      mockGetSetting.mockReturnValue('true')
      await service.start()
      // Verify timer was created (stop clears it without error)
      service.stop()
    })
  })

  describe('stop', () => {
    it('clears timer without error', () => {
      expect(() => service.stop()).not.toThrow()
    })
  })

  // ==========================================================================
  // checkForReleases
  // ==========================================================================
  describe('checkForReleases', () => {
    beforeEach(() => {
      mockGetSetting
        .mockReturnValueOnce('30')   // release_alert_days_ahead
        .mockReturnValueOnce('US')   // store_region
    })

    it('returns 0 when no wishlist items have tmdb_id', async () => {
      mockGetWishlistItems.mockReturnValue([{ id: 1, title: 'Test', tmdb_id: null }])
      const count = await service.checkForReleases()
      expect(count).toBe(0)
    })

    it('returns 0 when wishlist is empty', async () => {
      mockGetWishlistItems.mockReturnValue([])
      const count = await service.checkForReleases()
      expect(count).toBe(0)
    })

    it('alerts for digital releases within range', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'Movie', tmdb_id: '123', media_type: 'movie' },
      ])
      mockGetMovieReleaseDates.mockResolvedValue({
        results: [{
          iso_3166_1: 'US',
          release_dates: [{ type: 4, release_date: `${tomorrowStr}T00:00:00.000Z` }],
        }],
      })

      const count = await service.checkForReleases()
      expect(count).toBe(1)
      expect(mockCreateNotification).toHaveBeenCalledOnce()
      expect(mockCreateNotification.mock.calls[0][0].title).toContain('Digital')
    })

    it('skips releases outside date range', async () => {
      const farFuture = '2099-01-01'
      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'Movie', tmdb_id: '123', media_type: 'movie' },
      ])
      mockGetMovieReleaseDates.mockResolvedValue({
        results: [{
          iso_3166_1: 'US',
          release_dates: [{ type: 4, release_date: `${farFuture}T00:00:00.000Z` }],
        }],
      })

      const count = await service.checkForReleases()
      expect(count).toBe(0)
    })

    it('deduplicates alerts by tmdb_id:type', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'Movie', tmdb_id: '123', media_type: 'movie' },
      ])
      mockGetMovieReleaseDates.mockResolvedValue({
        results: [{
          iso_3166_1: 'US',
          release_dates: [{ type: 4, release_date: `${tomorrowStr}T00:00:00.000Z` }],
        }],
      })

      await service.checkForReleases()
      // Reset mocks for second call but keep same service (alertedIds persisted)
      mockGetSetting.mockReturnValueOnce('30').mockReturnValueOnce('US')
      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'Movie', tmdb_id: '123', media_type: 'movie' },
      ])
      mockGetMovieReleaseDates.mockResolvedValue({
        results: [{
          iso_3166_1: 'US',
          release_dates: [{ type: 4, release_date: `${tomorrowStr}T00:00:00.000Z` }],
        }],
      })

      const count = await service.checkForReleases()
      expect(count).toBe(0) // Already alerted
    })

    it('falls back to US region', async () => {
      mockGetSetting.mockReset()
      mockGetSetting
        .mockReturnValueOnce('30')
        .mockReturnValueOnce('GB') // Non-US region

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'Movie', tmdb_id: '123', media_type: 'movie' },
      ])
      mockGetMovieReleaseDates.mockResolvedValue({
        results: [{
          iso_3166_1: 'US', // No GB entry, falls back to US
          release_dates: [{ type: 4, release_date: `${tomorrowStr}T00:00:00.000Z` }],
        }],
      })

      const count = await service.checkForReleases()
      expect(count).toBe(1)
    })

    it('handles TV shows with next_episode_to_air', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'TV Show', tmdb_id: '456', media_type: 'tv' },
      ])
      mockGetTVShowDetails.mockResolvedValue({
        next_episode_to_air: { air_date: tomorrowStr },
      })

      const count = await service.checkForReleases()
      expect(count).toBe(1)
      expect(mockCreateNotification.mock.calls[0][0].title).toContain('New episode')
    })

    it('handles TMDB API failures gracefully', async () => {
      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'Movie', tmdb_id: '123', media_type: 'movie' },
      ])
      mockGetMovieReleaseDates.mockRejectedValue(new Error('API error'))

      const count = await service.checkForReleases()
      expect(count).toBe(0)
    })

    it('only checks digital (4) and physical (5) releases', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      mockGetWishlistItems.mockReturnValue([
        { id: 1, title: 'Movie', tmdb_id: '123', media_type: 'movie' },
      ])
      mockGetMovieReleaseDates.mockResolvedValue({
        results: [{
          iso_3166_1: 'US',
          release_dates: [
            { type: 3, release_date: `${tomorrowStr}T00:00:00.000Z` }, // Theatrical — skipped
            { type: 5, release_date: `${tomorrowStr}T00:00:00.000Z` }, // Physical — included
          ],
        }],
      })

      const count = await service.checkForReleases()
      expect(count).toBe(1)
      expect(mockCreateNotification.mock.calls[0][0].title).toContain('Physical')
    })
  })
})
