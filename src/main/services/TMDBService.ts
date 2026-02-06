import {
  TMDBMovieDetails,
  TMDBCollection,
  TMDBTVShowDetails,
  TMDBSeasonDetails,
  TMDBEpisode,
  TMDBSearchResponse,
  TMDBMovieSearchResult,
  TMDBTVSearchResult,
  TMDBConfiguration
} from '../types/tmdb'
import { getDatabaseService } from './DatabaseService'
import { RateLimiters, SlidingWindowRateLimiter } from './utils/RateLimiter'

/**
 * TMDB API v3 Service with rate limiting and caching
 * Rate limit: ~40 requests per second per IP
 * API Documentation: https://developer.themoviedb.org/reference/intro/getting-started
 */
export class TMDBService {
  private static readonly BASE_URL = 'https://api.themoviedb.org/3'
  private static readonly IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/'
  private static readonly CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  private static readonly MAX_CONCURRENT = 10 // Max concurrent requests
  private static readonly REQUEST_TIMEOUT = 30000 // 30 second timeout for API requests

  private apiKey: string | null = null
  private cache: Map<string, { data: any; timestamp: number }> = new Map()
  private rateLimiter: SlidingWindowRateLimiter = RateLimiters.createTMDBLimiter()
  private activeRequests = 0
  private requestQueue: Array<{ execute: () => Promise<void>; resolve: () => void }> = []

  /**
   * Initialize service with API key from settings
   */
  async initialize(): Promise<void> {
    const db = getDatabaseService()
    const setting = db.getSetting('tmdb_api_key')
    this.apiKey = setting || null

    if (!this.apiKey || this.apiKey === '') {
      console.warn('TMDB API key not configured. Collection detection will be unavailable.')
    }
  }

  /**
   * Get TMDB API key from settings
   */
  private getApiKey(): string {
    if (!this.apiKey || this.apiKey === '') {
      throw new Error('TMDB API key not configured. Please add your API key in settings.')
    }
    return this.apiKey
  }

  /**
   * Rate limiting: Wait for a request slot
   * Uses shared SlidingWindowRateLimiter (40 requests per second)
   */
  private async waitForRateLimit(): Promise<void> {
    await this.rateLimiter.waitForSlot()
  }

  /**
   * Process the next item in the request queue
   */
  private processQueue(): void {
    if (this.requestQueue.length === 0) return
    if (this.activeRequests >= TMDBService.MAX_CONCURRENT) return

    const next = this.requestQueue.shift()
    if (next) {
      this.activeRequests++
      next.execute().finally(() => {
        this.activeRequests--
        next.resolve()
        this.processQueue()
      })
    }
  }

  /**
   * Queue a request for execution with concurrency control
   * Allows up to MAX_CONCURRENT requests at a time
   */
  async queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async (): Promise<void> => {
        try {
          const result = await requestFn()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }

      this.requestQueue.push({
        execute,
        resolve: () => {} // Placeholder, actual resolution in execute
      })

      this.processQueue()
    })
  }

  /**
   * Make multiple requests in parallel with rate limiting
   * Useful for batch processing
   */
  async batchRequest<T>(requests: Array<() => Promise<T>>): Promise<Array<PromiseSettledResult<T>>> {
    return Promise.allSettled(
      requests.map(reqFn => this.queueRequest(reqFn))
    )
  }

  /**
   * Cache management: Get from cache or return null
   */
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key)

    if (cached && Date.now() - cached.timestamp < TMDBService.CACHE_DURATION) {
      return cached.data as T
    }

    // Remove expired cache
    if (cached) {
      this.cache.delete(key)
    }

    return null
  }

  /**
   * Cache management: Store in cache
   */
  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })
  }

  /**
   * Make API request with rate limiting and caching
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const apiKey = this.getApiKey()

    // Build cache key
    const cacheKey = `${endpoint}?${new URLSearchParams(params).toString()}`

    // Check cache
    const cached = this.getFromCache<T>(cacheKey)
    if (cached) {
      return cached
    }

    // Apply rate limiting
    await this.waitForRateLimit()

    // Build URL
    const url = new URL(`${TMDBService.BASE_URL}${endpoint}`)
    url.searchParams.append('api_key', apiKey)
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })

    // Make request with timeout using AbortController
    console.log('[TMDB] Requesting:', url.toString().replace(apiKey, 'API_KEY'))
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TMDBService.REQUEST_TIMEOUT)

    let response: Response
    try {
      response = await fetch(url.toString(), { signal: controller.signal })
    } catch (error: unknown) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('TMDB API request timed out')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const error = await response.json()
      console.error('[TMDB] Error response:', error)
      throw new Error(`TMDB API Error: ${error.status_message || response.statusText}`)
    }

    const data = await response.json()
    console.log('[TMDB] Response for', endpoint, '- total_results:', (data as any).total_results)

    // Cache the response
    this.setCache(cacheKey, data)

    return data as T
  }

  /**
   * Get movie details by TMDB ID
   */
  async getMovieDetails(tmdbId: string): Promise<TMDBMovieDetails> {
    return await this.request<TMDBMovieDetails>(`/movie/${tmdbId}`)
  }

  /**
   * Get collection details by collection ID
   */
  async getCollectionDetails(collectionId: string): Promise<TMDBCollection> {
    return await this.request<TMDBCollection>(`/collection/${collectionId}`)
  }

  /**
   * Get TV show details by TMDB ID
   */
  async getTVShowDetails(tmdbId: string): Promise<TMDBTVShowDetails> {
    return await this.request<TMDBTVShowDetails>(`/tv/${tmdbId}`)
  }

  /**
   * Get TV show details with all season episode data in ONE API call
   * Uses append_to_response to fetch up to 20 seasons at once
   * This is MUCH faster than calling getSeasonDetails for each season
   */
  async getTVShowWithSeasons(tmdbId: string, seasonNumbers: number[]): Promise<TMDBTVShowDetails & { [key: string]: TMDBSeasonDetails }> {
    // TMDB limits append_to_response to 20 items
    const MAX_APPEND = 20
    const seasonsToAppend = seasonNumbers.slice(0, MAX_APPEND)

    // Build append_to_response parameter: season/1,season/2,season/3,...
    const appendParam = seasonsToAppend.map(n => `season/${n}`).join(',')

    const result = await this.request<TMDBTVShowDetails & { [key: string]: TMDBSeasonDetails }>(
      `/tv/${tmdbId}`,
      { append_to_response: appendParam }
    )

    return result
  }

  /**
   * Get TV season details
   */
  async getSeasonDetails(tmdbId: string, seasonNumber: number): Promise<TMDBSeasonDetails> {
    return await this.request<TMDBSeasonDetails>(`/tv/${tmdbId}/season/${seasonNumber}`)
  }

  /**
   * Get TV episode details
   */
  async getEpisodeDetails(tmdbId: string | number, seasonNumber: number, episodeNumber: number): Promise<TMDBEpisode> {
    return await this.request<TMDBEpisode>(`/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`)
  }

  /**
   * Search for TV show and get episode details in optimized way
   * First searches for series, then gets episode details
   * Caches series ID for subsequent episode lookups
   */
  async searchAndGetEpisode(
    seriesTitle: string,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<{ seriesTmdbId: number; episode: TMDBEpisode; seriesName: string } | null> {
    try {
      // Search for the series
      const searchResponse = await this.searchTVShow(seriesTitle)
      if (!searchResponse.results || searchResponse.results.length === 0) {
        return null
      }

      const series = searchResponse.results[0]
      const seriesTmdbId = series.id
      const seriesName = series.name

      // Get episode details
      const episode = await this.getEpisodeDetails(seriesTmdbId, seasonNumber, episodeNumber)

      return { seriesTmdbId, episode, seriesName }
    } catch (error) {
      // Episode might not exist in TMDB
      return null
    }
  }

  /**
   * Search for movies by title and optional year
   */
  async searchMovie(query: string, year?: number): Promise<TMDBSearchResponse<TMDBMovieSearchResult>> {
    const params: Record<string, string> = {
      query
    }

    if (year) {
      params.year = year.toString()
    }

    return await this.request<TMDBSearchResponse<TMDBMovieSearchResult>>('/search/movie', params)
  }

  /**
   * Search for TV shows by title
   */
  async searchTVShow(query: string): Promise<TMDBSearchResponse<TMDBTVSearchResult>> {
    return await this.request<TMDBSearchResponse<TMDBTVSearchResult>>('/search/tv', {
      query
    })
  }

  /**
   * Find content by external ID (IMDB)
   * Returns both movie and TV show results if found
   */
  async findByExternalId(
    externalId: string,
    externalSource: 'imdb_id'
  ): Promise<{
    movie_results: Array<{ id: number; title: string; release_date?: string }>
    tv_results: Array<{ id: number; name: string }>
  }> {
    return await this.request<{
      movie_results: Array<{ id: number; title: string; release_date?: string }>
      tv_results: Array<{ id: number; name: string }>
    }>(
      `/find/${externalId}`,
      { external_source: externalSource }
    )
  }

  /**
   * Get TMDB configuration (image base URLs, etc.)
   */
  async getConfiguration(): Promise<TMDBConfiguration> {
    return await this.request<TMDBConfiguration>('/configuration')
  }

  /**
   * Build full image URL from path
   */
  buildImageUrl(path: string | null, size: 'w300' | 'w500' | 'original' = 'w500'): string | null {
    if (!path) return null
    return `${TMDBService.IMAGE_BASE_URL}${size}${path}`
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; oldestEntry: number | null } {
    const now = Date.now()
    let oldestTimestamp: number | null = null

    this.cache.forEach(entry => {
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp
      }
    })

    const oldestAge = oldestTimestamp ? now - oldestTimestamp : null

    return {
      size: this.cache.size,
      oldestEntry: oldestAge
    }
  }
}

// Singleton instance
let tmdbService: TMDBService | null = null

export function getTMDBService(): TMDBService {
  if (!tmdbService) {
    tmdbService = new TMDBService()
    tmdbService.initialize().catch(err => {
      console.error('Failed to initialize TMDB service:', err)
    })
  }
  return tmdbService
}
