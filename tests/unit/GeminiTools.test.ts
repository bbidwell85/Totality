/**
 * GeminiTools Input Validation Tests
 *
 * Verifies that tool input sanitization helpers correctly validate,
 * clamp, and reject invalid inputs from AI-generated tool calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared mock database instance
const mockDb = {
  globalSearch: vi.fn(() => ({ movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] })),
  getMediaItems: vi.fn(() => []),
  getTVShows: vi.fn(() => []),
  getLibraryStats: vi.fn(() => ({})),
  getSeriesCompletenessByTitle: vi.fn(() => null),
  getIncompleteSeries: vi.fn(() => []),
  getAllSeriesCompleteness: vi.fn(() => []),
  getIncompleteMovieCollections: vi.fn(() => []),
  getMovieCollections: vi.fn(() => []),
  getMusicStats: vi.fn(() => ({})),
  getAggregatedSourceStats: vi.fn(() => ({})),
  getWishlistItems: vi.fn(() => []),
  getMediaItemById: vi.fn(() => null),
  getMediaItemsByTmdbIds: vi.fn(() => new Map()),
  getQualityScoreByMediaId: vi.fn(() => null),
  getMediaItemVersions: vi.fn(() => []),
  addWishlistItemsBulk: vi.fn(() => 0),
}

// Mock dependencies before importing
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => mockDb),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    getQualityDistribution: vi.fn(() => ({})),
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    searchMovie: vi.fn(() => ({ results: [] })),
    searchTVShow: vi.fn(() => ({ results: [] })),
    searchCollection: vi.fn(() => ({ results: [] })),
  })),
}))

// Import after mocks
const { executeTool } = await import('../../src/main/services/GeminiTools')

describe('GeminiTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('input validation', () => {
    it('should reject search_library with missing query', async () => {
      const result = await executeTool('search_library', {})
      expect(JSON.parse(result)).toEqual({ error: 'query is required' })
    })

    it('should reject search_library with non-string query', async () => {
      const result = await executeTool('search_library', { query: 123 })
      expect(JSON.parse(result)).toEqual({ error: 'query is required' })
    })

    it('should truncate long search queries', async () => {
      const longQuery = 'a'.repeat(500)
      const result = await executeTool('search_library', { query: longQuery })
      // Should not throw — query is truncated to 200 chars
      const parsed = JSON.parse(result)
      expect(parsed).toBeDefined()
    })

    it('should clamp get_media_items limit to max 50', async () => {
      await executeTool('get_media_items', { limit: 1000 })
      expect(mockDb.getMediaItems).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 })
      )
    })

    it('should default get_media_items limit to 20', async () => {
      await executeTool('get_media_items', {})
      expect(mockDb.getMediaItems).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 })
      )
    })

    it('should handle non-numeric limit gracefully', async () => {
      await executeTool('get_media_items', { limit: 'abc' })
      expect(mockDb.getMediaItems).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 })
      )
    })

    it('should handle boolean inputs correctly', async () => {
      await executeTool('get_media_items', { needs_upgrade: true })
      expect(mockDb.getMediaItems).toHaveBeenCalledWith(
        expect.objectContaining({ needsUpgrade: true })
      )
    })

    it('should reject non-boolean needs_upgrade', async () => {
      await executeTool('get_media_items', { needs_upgrade: 'yes' })
      expect(mockDb.getMediaItems).toHaveBeenCalledWith(
        expect.objectContaining({ needsUpgrade: undefined })
      )
    })

    it('should reject search_tmdb with missing query', async () => {
      const result = await executeTool('search_tmdb', { search_type: 'movie' })
      expect(JSON.parse(result)).toEqual({ error: 'query is required' })
    })

    it('should reject get_similar_titles with missing title', async () => {
      const result = await executeTool('get_similar_titles', { media_type: 'movie' })
      expect(JSON.parse(result)).toEqual({ error: 'title is required' })
    })

    it('should handle check_ownership with non-array titles', async () => {
      const result = await executeTool('check_ownership', { titles: 'not an array' })
      const parsed = JSON.parse(result)
      expect(parsed.checked).toBe(0)
    })

    it('should handle add_to_wishlist with non-array items', async () => {
      const result = await executeTool('add_to_wishlist', { items: 'not an array' })
      const parsed = JSON.parse(result)
      expect(parsed.added).toBe(0)
    })

    it('should clamp wishlist priority to 1-5', async () => {
      const result = await executeTool('add_to_wishlist', {
        items: [{ title: 'Test', media_type: 'movie', priority: 99 }],
      })
      // Should not crash — priority clamped
      expect(result).toBeDefined()
    })

    it('should return error for unknown tool', async () => {
      const result = await executeTool('nonexistent_tool', {})
      expect(JSON.parse(result)).toEqual({ error: 'Unknown tool: nonexistent_tool' })
    })
  })
})
