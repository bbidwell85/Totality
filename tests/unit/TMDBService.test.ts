/**
 * TMDBService Unit Tests
 *
 * Tests for TMDB API integration including caching,
 * rate limiting, and API methods.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock DatabaseService - return API key by default
const mockGetSetting = vi.fn((key: string) => {
  if (key === 'tmdb_api_key') return 'test-api-key-12345'
  return null
})

vi.mock('../../src/main/services/DatabaseService', () => ({
  getDatabaseService: vi.fn(() => ({
    getSetting: mockGetSetting,
  })),
}))

// Mock RateLimiter
vi.mock('../../src/main/services/utils/RateLimiter', () => ({
  RateLimiters: {
    createTMDBLimiter: vi.fn(() => ({
      waitForSlot: vi.fn(() => Promise.resolve()),
    })),
  },
  SlidingWindowRateLimiter: vi.fn(),
}))

import { TMDBService } from '../../src/main/services/TMDBService'

describe('TMDBService', () => {
  let service: TMDBService

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    // Reset the mock to return API key
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'tmdb_api_key') return 'test-api-key-12345'
      return null
    })
    service = new TMDBService()
    await service.initialize()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  describe('initialization', () => {
    it('should initialize with API key from settings', async () => {
      // Already initialized in beforeEach
      // Should not throw when getting API key
      expect(() => service['getApiKey']()).not.toThrow()
    })

    it('should throw error when API key is not configured', async () => {
      // Create a new service with no API key
      mockGetSetting.mockReturnValue(null)
      const serviceWithoutKey = new TMDBService()
      await serviceWithoutKey.initialize()

      expect(() => serviceWithoutKey['getApiKey']()).toThrow('TMDB API key not configured')
    })
  })

  // ============================================================================
  // MOVIE API
  // ============================================================================

  describe('movie API', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should fetch movie details', async () => {
      const mockMovie = {
        id: 550,
        title: 'Fight Club',
        release_date: '1999-10-15',
        belongs_to_collection: null,
        poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMovie),
      })

      const result = await service.getMovieDetails('550')

      expect(result).toEqual(mockMovie)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/movie/550'),
        expect.any(Object)
      )
    })

    it('should search movies by title and year', async () => {
      const mockResults = {
        results: [
          { id: 550, title: 'Fight Club', release_date: '1999-10-15' },
        ],
        total_results: 1,
        page: 1,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResults),
      })

      const result = await service.searchMovie('Fight Club', 1999)

      expect(result.results).toHaveLength(1)
      expect(result.results[0].title).toBe('Fight Club')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=Fight+Club'), // URLSearchParams uses + for spaces
        expect.any(Object)
      )
    })
  })

  // ============================================================================
  // TV SHOW API
  // ============================================================================

  describe('TV show API', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should fetch TV show details', async () => {
      const mockShow = {
        id: 1399,
        name: 'Game of Thrones',
        first_air_date: '2011-04-17',
        number_of_seasons: 8,
        seasons: [],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockShow),
      })

      const result = await service.getTVShowDetails('1399')

      expect(result.name).toBe('Game of Thrones')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tv/1399'),
        expect.any(Object)
      )
    })

    it('should fetch season details', async () => {
      const mockSeason = {
        id: 3627,
        season_number: 1,
        episode_count: 10,
        episodes: [
          { episode_number: 1, name: 'Winter Is Coming' },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSeason),
      })

      const result = await service.getSeasonDetails('1399', 1)

      expect(result.season_number).toBe(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tv/1399/season/1'),
        expect.any(Object)
      )
    })

    it('should fetch episode details', async () => {
      const mockEpisode = {
        id: 63056,
        episode_number: 1,
        name: 'Winter Is Coming',
        air_date: '2011-04-17',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEpisode),
      })

      const result = await service.getEpisodeDetails(1399, 1, 1)

      expect(result.name).toBe('Winter Is Coming')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tv/1399/season/1/episode/1'),
        expect.any(Object)
      )
    })

    it('should search TV shows by title', async () => {
      const mockResults = {
        results: [
          { id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17' },
        ],
        total_results: 1,
        page: 1,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResults),
      })

      const result = await service.searchTVShow('Game of Thrones')

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Game of Thrones')
    })
  })

  // ============================================================================
  // COLLECTION API
  // ============================================================================

  describe('collection API', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should fetch collection details', async () => {
      const mockCollection = {
        id: 10,
        name: 'Star Wars Collection',
        parts: [
          { id: 11, title: 'Star Wars' },
          { id: 1891, title: 'The Empire Strikes Back' },
        ],
        poster_path: '/something.jpg',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCollection),
      })

      const result = await service.getCollectionDetails('10')

      expect(result.name).toBe('Star Wars Collection')
      expect(result.parts).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/collection/10'),
        expect.any(Object)
      )
    })
  })

  // ============================================================================
  // CACHING
  // ============================================================================

  describe('caching', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should cache responses and return cached data on second call', async () => {
      const mockMovie = { id: 550, title: 'Fight Club' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMovie),
      })

      // First call
      const result1 = await service.getMovieDetails('550')
      // Second call should use cache
      const result2 = await service.getMovieDetails('550')

      expect(result1).toEqual(mockMovie)
      expect(result2).toEqual(mockMovie)
      // fetch should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should clear cache', async () => {
      const mockMovie = { id: 550, title: 'Fight Club' }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMovie),
      })

      // First call
      await service.getMovieDetails('550')

      // Clear cache
      service.clearCache()

      // Second call should fetch again
      await service.getMovieDetails('550')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should get cache stats', async () => {
      const stats = service.getCacheStats()

      expect(stats).toHaveProperty('size')
      expect(stats).toHaveProperty('oldestEntry')
      expect(typeof stats.size).toBe('number')
    })
  })

  // ============================================================================
  // IMAGE URL BUILDING
  // ============================================================================

  describe('image URL building', () => {
    it('should build image URL with default size', () => {
      const url = service.buildImageUrl('/abc123.jpg')
      expect(url).toBe('https://image.tmdb.org/t/p/w500/abc123.jpg')
    })

    it('should build image URL with custom size', () => {
      const url = service.buildImageUrl('/abc123.jpg', 'original')
      expect(url).toBe('https://image.tmdb.org/t/p/original/abc123.jpg')
    })

    it('should return null for null path', () => {
      const url = service.buildImageUrl(null)
      expect(url).toBeNull()
    })

    it('should return null for empty path', () => {
      const url = service.buildImageUrl('')
      expect(url).toBeNull()
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(service.getMovieDetails('999999999')).rejects.toThrow()
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(service.getMovieDetails('550')).rejects.toThrow('Network error')
    })
  })

  // ============================================================================
  // FIND BY EXTERNAL ID
  // ============================================================================

  describe('find by external ID', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should find by IMDB ID', async () => {
      const mockResult = {
        movie_results: [{ id: 550, title: 'Fight Club' }],
        tv_results: [],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      })

      const result = await service.findByExternalId('tt0137523', 'imdb_id')

      expect(result.movie_results).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/find/tt0137523'),
        expect.any(Object)
      )
    })
  })
})
