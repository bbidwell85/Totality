/**
 * QualityAnalyzer Unit Tests
 *
 * Tests for quality scoring logic including resolution tiers,
 * bitrate analysis, codec efficiency, and audio quality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock DatabaseService before importing QualityAnalyzer
vi.mock('../../src/main/services/DatabaseService', () => ({
  getDatabaseService: vi.fn(() => ({
    getSettingsByPrefix: vi.fn(() => ({})),
    upsertQualityScore: vi.fn(),
  })),
}))

import { QualityAnalyzer } from '../../src/main/services/QualityAnalyzer'
import type { MediaItem } from '../../src/main/types/database'

describe('QualityAnalyzer', () => {
  let analyzer: QualityAnalyzer

  beforeEach(() => {
    vi.clearAllMocks()
    analyzer = new QualityAnalyzer()
  })

  // ============================================================================
  // RESOLUTION TIER DETECTION
  // ============================================================================

  describe('resolution tier detection', () => {
    it('should classify SD resolution (below 720p)', async () => {
      const item = createMediaItem({ resolution: '480p', video_bitrate: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
    })

    it('should classify 720p resolution', async () => {
      const item = createMediaItem({ resolution: '720p', video_bitrate: 5000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })

    it('should classify 1080p resolution', async () => {
      const item = createMediaItem({ resolution: '1080p', video_bitrate: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should classify 4K resolution (2160p)', async () => {
      const item = createMediaItem({ resolution: '2160p', video_bitrate: 25000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should handle numeric resolution strings (falls back to SD for WxH format)', async () => {
      // Note: classifyTier() only recognizes patterns like '1080p', not 'WxH' format
      const item = createMediaItem({ resolution: '1920x1080', video_bitrate: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD') // WxH format not parsed as resolution tier
    })

    it('should default to SD for unknown resolution', async () => {
      const item = createMediaItem({ resolution: 'unknown', video_bitrate: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
    })
  })

  // ============================================================================
  // TIER QUALITY (WITHIN-TIER SCORING)
  // ============================================================================

  describe('tier quality scoring', () => {
    it('should rate HIGH quality for high bitrate 1080p', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 20000,
        audio_channels: 6,
        audio_codec: 'truehd',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should rate MEDIUM quality for medium bitrate 1080p', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        audio_channels: 6,
        audio_codec: 'ac3',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('MEDIUM')
    })

    it('should rate LOW quality for low bitrate 1080p', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 3000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('LOW')
    })

    it('should consider audio quality in overall tier', async () => {
      // High video bitrate but poor audio should not be HIGH
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 20000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      // Audio is LOW, so overall should not be HIGH
      expect(['LOW', 'MEDIUM']).toContain(score.tier_quality)
    })
  })

  // ============================================================================
  // CODEC EFFICIENCY
  // ============================================================================

  describe('codec efficiency', () => {
    it('should apply HEVC/H.265 efficiency multiplier', async () => {
      const h264Item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        video_codec: 'h264',
      })
      const hevcItem = createMediaItem({
        resolution: '1080p',
        video_bitrate: 4000, // Half the bitrate
        video_codec: 'hevc',
      })

      const h264Score = await analyzer.analyzeMediaItem(h264Item)
      const hevcScore = await analyzer.analyzeMediaItem(hevcItem)

      // HEVC at half bitrate should have similar or better effective quality
      // due to 2x efficiency multiplier
      expect(hevcScore.tier_score).toBeGreaterThanOrEqual(h264Score.tier_score - 20)
    })

    it('should apply AV1 efficiency multiplier', async () => {
      const item = createMediaItem({
        resolution: '2160p', // Use standard resolution string
        video_bitrate: 15000,
        video_codec: 'av1',
        audio_codec: 'truehd', // HIGH audio to not drag down overall
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      // AV1 has 3x efficiency, so effective bitrate is 45000 (above 40000 HIGH threshold)
      expect(score.tier_quality).toBe('HIGH')
    })
  })

  // ============================================================================
  // AUDIO QUALITY
  // ============================================================================

  describe('audio quality detection', () => {
    it('should recognize object audio (Atmos) as HIGH quality', async () => {
      const item = createMediaItem({
        resolution: '2160p', // Standard resolution string
        video_bitrate: 45000, // Above 4K HIGH threshold (40000)
        has_object_audio: true,
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should recognize lossless audio (TrueHD) as HIGH quality', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should recognize DTS-HD MA as lossless', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'dts-hd ma',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should recognize FLAC as lossless', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'flac',
        audio_channels: 2,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should rate AC3 5.1 as MEDIUM quality', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_bitrate: 448,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('MEDIUM')
    })

    it('should rate stereo AAC at low bitrate as LOW', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate: 96,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('LOW')
    })
  })

  // ============================================================================
  // NEEDS UPGRADE FLAG
  // ============================================================================

  describe('needs upgrade detection', () => {
    it('should flag LOW quality items as needing upgrade', async () => {
      const item = createMediaItem({
        resolution: '720p',
        video_bitrate: 1500,
        audio_channels: 2,
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.needs_upgrade).toBe(true)
    })

    it('should not flag HIGH quality items as needing upgrade', async () => {
      const item = createMediaItem({
        resolution: '4K',
        video_bitrate: 50000,
        audio_codec: 'truehd',
        audio_channels: 8,
        has_object_audio: true,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.needs_upgrade).toBe(false)
    })
  })

  // ============================================================================
  // AUDIO TRACKS PARSING
  // ============================================================================

  describe('audio tracks parsing', () => {
    it('should select best audio track from multiple tracks', async () => {
      const item = createMediaItem({
        resolution: '2160p', // Standard resolution string
        video_bitrate: 45000, // Above 4K HIGH threshold (40000)
        audio_codec: 'aac', // Default fallback
        audio_channels: 2,
        audio_tracks: JSON.stringify([
          { codec: 'aac', channels: 2, bitrate: 128, hasObjectAudio: false },
          { codec: 'truehd', channels: 8, bitrate: 5000, hasObjectAudio: true },
          { codec: 'ac3', channels: 6, bitrate: 448, hasObjectAudio: false },
        ]),
      })
      const score = await analyzer.analyzeMediaItem(item)
      // Should select TrueHD Atmos track as best (object audio = HIGH)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should fallback to primary audio fields if audio_tracks is empty', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_tracks: '[]',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should handle invalid audio_tracks JSON gracefully', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_tracks: 'not valid json',
      })
      // Should not throw
      const score = await analyzer.analyzeMediaItem(item)
      expect(score).toBeDefined()
    })
  })

  // ============================================================================
  // ISSUES REPORTING
  // ============================================================================

  describe('issues reporting', () => {
    it('should report low bitrate issue', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 2000,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.issues).toContain('Low bitrate')
    })

    it('should report poor audio issue', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.issues).toContain('audio')
    })
  })

  // ============================================================================
  // THRESHOLD CACHING
  // ============================================================================

  describe('threshold caching', () => {
    it('should invalidate thresholds cache', () => {
      analyzer.invalidateThresholdsCache()
      // Should not throw
      expect(() => analyzer.invalidateThresholdsCache()).not.toThrow()
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 1,
    source_id: 'test-source',
    source_type: 'plex',
    library_id: 'lib-1',
    provider_item_id: 'test-123',
    type: 'movie',
    title: 'Test Movie',
    year: 2023,
    resolution: '1080p',
    video_codec: 'h264',
    video_bitrate: 10000,
    audio_codec: 'ac3',
    audio_channels: 6,
    audio_bitrate: 448,
    has_object_audio: false,
    ...overrides,
  }
}
