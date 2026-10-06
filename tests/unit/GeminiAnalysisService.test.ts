import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStreamMessage = vi.hoisted(() => vi.fn())
const mockIsConfigured = vi.hoisted(() => vi.fn())
const mockGetMediaItems = vi.hoisted(() => vi.fn())
const mockGetLibraryStats = vi.hoisted(() => vi.fn())
const mockGetSeriesCompleteness = vi.hoisted(() => vi.fn())
const mockGetMovieCollections = vi.hoisted(() => vi.fn())
const mockGetWishlistItems = vi.hoisted(() => vi.fn())
const mockGetMusicAlbums = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getLibraryStats: mockGetLibraryStats,
    getMediaItems: mockGetMediaItems,
    getSeriesCompleteness: mockGetSeriesCompleteness,
    getMovieCollections: mockGetMovieCollections,
    getWishlistItems: mockGetWishlistItems,
    getMusicAlbums: mockGetMusicAlbums,
    getMusicQualityScores: vi.fn(() => []),
    getStorageAnalytics: vi.fn(() => ({
      totalSize: 0, totalItems: 0, byCodec: [], byResolution: [], bySource: [],
      byTier: [], codecMigration: { h264Count: 0, modernCount: 0, totalCount: 0 },
    })),
    getMusicStats: vi.fn(() => ({ totalArtists: 0, totalAlbums: 0, totalTracks: 0 })),
    getIncompleteSeries: vi.fn(() => []),
    getIncompleteMovieCollections: vi.fn(() => []),
    getMusicQualityScore: vi.fn(() => null),
    getAlbumsNeedingUpgrade: vi.fn(() => []),
    getAllArtistCompleteness: vi.fn(() => []),
    getSetting: vi.fn(() => null),
  })),
}))

vi.mock('../../src/main/services/GeminiService', () => ({
  getGeminiService: vi.fn(() => ({
    streamMessage: mockStreamMessage,
    isConfigured: mockIsConfigured,
  })),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    getQualityDistribution: vi.fn(() => ({})),
  })),
}))

vi.mock('../../src/main/services/utils/formatUtils', () => ({
  formatSize: vi.fn((b: number) => `${(b / 1e9).toFixed(1)} GB`),
}))

vi.mock('../../src/main/services/ai-system-prompts', () => ({
  QUALITY_REPORT_SYSTEM_PROMPT: 'quality prompt',
  UPGRADE_PRIORITIES_SYSTEM_PROMPT: 'upgrade prompt',
  COMPLETENESS_INSIGHTS_SYSTEM_PROMPT: 'completeness prompt',
  WISHLIST_ADVICE_SYSTEM_PROMPT: 'wishlist prompt',
  STORAGE_OPTIMIZATION_SYSTEM_PROMPT: 'storage prompt',
  MUSIC_QUALITY_SYSTEM_PROMPT: 'music prompt',
}))

import { GeminiAnalysisService } from '@main/services/GeminiAnalysisService'

describe('GeminiAnalysisService', () => {
  let service: GeminiAnalysisService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new GeminiAnalysisService()
    mockGetLibraryStats.mockReturnValue({ totalItems: 100 })
    mockGetMediaItems.mockReturnValue([])
    mockGetSeriesCompleteness.mockReturnValue([])
    mockGetMovieCollections.mockReturnValue([])
    mockGetWishlistItems.mockReturnValue([])
    mockGetMusicAlbums.mockReturnValue([])
  })

  describe('generateQualityReport', () => {
    it('streams report text via callback', async () => {
      mockStreamMessage.mockResolvedValue({ text: 'Report content here' })
      const onDelta = vi.fn()
      const result = await service.generateQualityReport(onDelta)
      expect(result.text).toBe('Report content here')
      expect(mockStreamMessage).toHaveBeenCalledOnce()
    })

    it('gathers library stats and low-quality items', async () => {
      mockStreamMessage.mockResolvedValue({ text: 'ok' })
      await service.generateQualityReport(vi.fn())
      expect(mockGetLibraryStats).toHaveBeenCalled()
      expect(mockGetMediaItems).toHaveBeenCalledWith(expect.objectContaining({ tierQuality: 'LOW' }))
    })
  })

  describe('generateUpgradePriorities', () => {
    it('returns streamed text', async () => {
      mockStreamMessage.mockResolvedValue({ text: 'Upgrades' })
      const result = await service.generateUpgradePriorities(vi.fn())
      expect(result.text).toBe('Upgrades')
    })
  })

  describe('generateCompletenessInsights', () => {
    it('queries series and collection data', async () => {
      mockStreamMessage.mockResolvedValue({ text: 'Completeness' })
      await service.generateCompletenessInsights(vi.fn())
      expect(mockGetLibraryStats).toHaveBeenCalled()
    })
  })

  describe('generateWishlistAdvice', () => {
    it('queries wishlist items', async () => {
      mockStreamMessage.mockResolvedValue({ text: 'Wishlist' })
      await service.generateWishlistAdvice(vi.fn())
      expect(mockGetWishlistItems).toHaveBeenCalled()
    })
  })

  describe('generateStorageOptimization', () => {
    it('returns storage analysis', async () => {
      mockStreamMessage.mockResolvedValue({ text: 'Storage' })
      const result = await service.generateStorageOptimization(vi.fn())
      expect(result.text).toBe('Storage')
    })
  })

  describe('generateMusicQualityReport', () => {
    it('returns music quality analysis', async () => {
      mockStreamMessage.mockResolvedValue({ text: 'Music' })
      const result = await service.generateMusicQualityReport(vi.fn())
      expect(result.text).toBe('Music')
    })
  })
})
