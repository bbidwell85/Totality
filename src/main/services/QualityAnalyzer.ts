import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from './LoggingService'
import type { MediaItem, MediaItemVersion, QualityScore, MusicAlbum, MusicTrack, MusicQualityScore, MusicQualityTier, AudioTrack } from '../types/database'

/**
 * Shared input shape for quality scoring.
 * Both MediaItem and MediaItemVersion have these fields.
 */
interface QualityScoringInput {
  resolution: string
  video_codec: string
  video_bitrate: number
  audio_codec: string
  audio_channels: number
  audio_bitrate: number
  has_object_audio?: boolean
  audio_tracks?: string
  hdr_format?: string
  color_bit_depth?: number
  height?: number
}

/**
 * Lightweight quality result for version scoring.
 */
export interface VersionQualityResult {
  quality_tier: string
  tier_quality: string
  tier_score: number
  bitrate_tier_score: number
  audio_tier_score: number
}

/**
 * Legacy quality thresholds (kept for backward compatibility)
 */
interface QualityThresholds {
  resolutionExcellent: number
  resolutionGood: number
  resolutionPoor: number
  bitrate4K: number
  bitrate1080p: number
  bitrate720p: number
  bitrateSD: number
  audioChannelsExcellent: number
  audioChannelsGood: number
  audioBitrateExcellent: number
  audioBitrateGood: number
  audioBitratePoor: number
}

const DEFAULT_THRESHOLDS: QualityThresholds = {
  resolutionExcellent: 1080,
  resolutionGood: 720,
  resolutionPoor: 480,
  bitrate4K: 20000,
  bitrate1080p: 10000,
  bitrate720p: 5000,
  bitrateSD: 2000,
  audioChannelsExcellent: 6,
  audioChannelsGood: 2,
  audioBitrateExcellent: 320,
  audioBitrateGood: 192,
  audioBitratePoor: 128,
}

// Default video bitrate thresholds (MEDIUM and HIGH per tier)
// Below MEDIUM = LOW, MEDIUM to HIGH = MEDIUM, above HIGH = HIGH
const DEFAULT_VIDEO_THRESHOLDS = {
  'SD': { medium: 1500, high: 3500 },
  '720p': { medium: 3000, high: 8000 },
  '1080p': { medium: 6000, high: 15000 },
  '4K': { medium: 15000, high: 40000 }
}

// Default audio bitrate thresholds (MEDIUM and HIGH per tier)
const DEFAULT_AUDIO_THRESHOLDS = {
  'SD': { medium: 128, high: 192 },
  '720p': { medium: 192, high: 320 },
  '1080p': { medium: 256, high: 640 },
  '4K': { medium: 320, high: 1000 }
}

type QualityTier = 'SD' | '720p' | '1080p' | '4K'
type TierQuality = 'LOW' | 'MEDIUM' | 'HIGH'

// Default codec efficiency multipliers (relative to H.264)
const DEFAULT_CODEC_EFFICIENCY = {
  'h264': 1.0, 'avc': 1.0, 'x264': 1.0,
  'h265': 2.0, 'hevc': 2.0, 'x265': 2.0,
  'av1': 2.5,
  'vp9': 1.8
}

// Default music quality thresholds
const DEFAULT_MUSIC_THRESHOLDS = {
  lowBitrate: 192,
  highBitrate: 256,
  hiResSampleRate: 44100,
  hiResBitDepth: 16,
}

export class QualityAnalyzer {
  private thresholds: QualityThresholds
  private thresholdsLoaded = false

  // Configurable settings loaded from database
  private videoThresholds = { ...DEFAULT_VIDEO_THRESHOLDS }
  private audioThresholds = { ...DEFAULT_AUDIO_THRESHOLDS }
  private codecEfficiency = { ...DEFAULT_CODEC_EFFICIENCY }
  private musicThresholds = { ...DEFAULT_MUSIC_THRESHOLDS }
  private videoWeight = 0.7 // 0-1, audio weight = 1 - videoWeight

  constructor(customThresholds?: Partial<QualityThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...customThresholds }
  }

  /**
   * Load all configurable settings from database (cached after first load)
   * Optimized: Uses single batch query instead of multiple individual calls
   */
  async loadThresholdsFromDatabase(): Promise<void> {
    if (this.thresholdsLoaded) {
      return
    }

    try {
      const db = getDatabase()

      // Batch load all quality settings in a single query
      const qualitySettings = db.getSettingsByPrefix('quality_')

      const getNum = (key: string, defaultVal: number): number => {
        const val = qualitySettings[key]
        if (val) {
          const parsed = parseFloat(val)
          if (!isNaN(parsed)) return parsed
        }
        return defaultVal
      }

      // Load video bitrate thresholds (try new keys first, fall back to old)
      this.videoThresholds = {
        'SD': {
          medium: getNum('quality_video_sd_medium', getNum('quality_video_sd_low', DEFAULT_VIDEO_THRESHOLDS.SD.medium)),
          high: getNum('quality_video_sd_high', DEFAULT_VIDEO_THRESHOLDS.SD.high),
        },
        '720p': {
          medium: getNum('quality_video_720p_medium', getNum('quality_video_720p_low', DEFAULT_VIDEO_THRESHOLDS['720p'].medium)),
          high: getNum('quality_video_720p_high', DEFAULT_VIDEO_THRESHOLDS['720p'].high),
        },
        '1080p': {
          medium: getNum('quality_video_1080p_medium', getNum('quality_video_1080p_low', DEFAULT_VIDEO_THRESHOLDS['1080p'].medium)),
          high: getNum('quality_video_1080p_high', DEFAULT_VIDEO_THRESHOLDS['1080p'].high),
        },
        '4K': {
          medium: getNum('quality_video_4k_medium', getNum('quality_video_4k_low', DEFAULT_VIDEO_THRESHOLDS['4K'].medium)),
          high: getNum('quality_video_4k_high', DEFAULT_VIDEO_THRESHOLDS['4K'].high),
        },
      }

      // Load audio bitrate thresholds (try new keys first, fall back to old)
      this.audioThresholds = {
        'SD': {
          medium: getNum('quality_audio_sd_medium', getNum('quality_audio_sd_good', DEFAULT_AUDIO_THRESHOLDS.SD.medium)),
          high: getNum('quality_audio_sd_high', getNum('quality_audio_sd_excellent', DEFAULT_AUDIO_THRESHOLDS.SD.high)),
        },
        '720p': {
          medium: getNum('quality_audio_720p_medium', getNum('quality_audio_720p_good', DEFAULT_AUDIO_THRESHOLDS['720p'].medium)),
          high: getNum('quality_audio_720p_high', getNum('quality_audio_720p_excellent', DEFAULT_AUDIO_THRESHOLDS['720p'].high)),
        },
        '1080p': {
          medium: getNum('quality_audio_1080p_medium', getNum('quality_audio_1080p_good', DEFAULT_AUDIO_THRESHOLDS['1080p'].medium)),
          high: getNum('quality_audio_1080p_high', getNum('quality_audio_1080p_excellent', DEFAULT_AUDIO_THRESHOLDS['1080p'].high)),
        },
        '4K': {
          medium: getNum('quality_audio_4k_medium', getNum('quality_audio_4k_good', DEFAULT_AUDIO_THRESHOLDS['4K'].medium)),
          high: getNum('quality_audio_4k_high', getNum('quality_audio_4k_excellent', DEFAULT_AUDIO_THRESHOLDS['4K'].high)),
        },
      }

      // Load codec efficiency multipliers
      const h264Eff = getNum('quality_codec_h264', DEFAULT_CODEC_EFFICIENCY.h264)
      const h265Eff = getNum('quality_codec_h265', DEFAULT_CODEC_EFFICIENCY.h265)
      const av1Eff = getNum('quality_codec_av1', DEFAULT_CODEC_EFFICIENCY.av1)
      const vp9Eff = getNum('quality_codec_vp9', DEFAULT_CODEC_EFFICIENCY.vp9)
      this.codecEfficiency = {
        'h264': h264Eff, 'avc': h264Eff, 'x264': h264Eff,
        'h265': h265Eff, 'hevc': h265Eff, 'x265': h265Eff,
        'av1': av1Eff,
        'vp9': vp9Eff,
      }

      // Load video/audio weight
      const rawWeight = getNum('quality_video_weight', 70)
      this.videoWeight = Math.max(0, Math.min(100, rawWeight)) / 100

      // Load music quality thresholds
      this.musicThresholds = {
        lowBitrate: getNum('quality_music_low_bitrate', DEFAULT_MUSIC_THRESHOLDS.lowBitrate),
        highBitrate: getNum('quality_music_high_bitrate', DEFAULT_MUSIC_THRESHOLDS.highBitrate),
        hiResSampleRate: getNum('quality_music_hires_samplerate', DEFAULT_MUSIC_THRESHOLDS.hiResSampleRate),
        hiResBitDepth: getNum('quality_music_hires_bitdepth', DEFAULT_MUSIC_THRESHOLDS.hiResBitDepth),
      }

      this.thresholdsLoaded = true
    } catch (error) {
      console.error('Failed to load quality thresholds:', error)
    }
  }

  /**
   * Force reload of thresholds from database (call when settings change)
   */
  invalidateThresholdsCache(): void {
    this.thresholdsLoaded = false
  }

  /**
   * Get codec efficiency multiplier
   */
  private getCodecEfficiency(codec: string): number {
    const codecLower = codec.toLowerCase()
    for (const [key, efficiency] of Object.entries(this.codecEfficiency)) {
      if (codecLower.includes(key)) return efficiency
    }
    return 1.0
  }

  /**
   * Detect lossless audio codec
   */
  private isLosslessAudio(codec: string): boolean {
    const lossless = ['truehd', 'dts-hd ma', 'dtshd_ma', 'flac', 'alac', 'pcm']
    const codecLower = codec.toLowerCase()
    return lossless.some(lc => codecLower.includes(lc))
  }

  /**
   * Calculate audio quality score for ranking tracks
   * Higher score = better quality
   */
  private calculateAudioTrackQualityScore(track: AudioTrack): number {
    let score = 0
    const channels = track.channels || 2
    const bitrate = track.bitrate || 0
    const isLossless = this.isLosslessAudio(track.codec)

    // Sanity check: lossy tracks with suspiciously low bitrate per channel are likely
    // corrupt or placeholder tracks — skip codec/channel bonuses entirely
    const minBitratePerChannel = 32 // kbps — real AC3 5.1 is 64+ per channel
    const isSuspiciouslyLow = !isLossless && !track.hasObjectAudio &&
      bitrate > 0 && bitrate < channels * minBitratePerChannel

    if (isSuspiciouslyLow) {
      // Only score on raw bitrate — no codec/channel bonuses
      return bitrate
    }

    // Object audio (Atmos, DTS:X) gets highest priority
    if (track.hasObjectAudio) {
      score += 10000
    }

    // Lossless codecs get high priority
    if (isLossless) {
      score += 5000
    }

    // Premium lossy codecs
    const codecLower = track.codec.toLowerCase()
    if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('dd+')) {
      score += 3000
    } else if (codecLower.includes('ac3') || codecLower.includes('ac-3') || codecLower.includes('dts')) {
      score += 2000
    } else if (codecLower.includes('aac')) {
      score += 1000
    }

    // More channels = better (7.1 > 5.1 > stereo)
    score += channels * 100

    // Higher bitrate = better
    score += bitrate

    return score
  }

  /**
   * Find the best audio track from media data.
   * Returns the track with highest quality score, or fallback to primary audio fields.
   */
  private getBestAudioTrack(input: QualityScoringInput): {
    codec: string
    channels: number
    bitrate: number
    hasObjectAudio: boolean
  } {
    // Default to the primary audio fields
    const fallback = {
      codec: input.audio_codec || '',
      channels: input.audio_channels || 2,
      bitrate: input.audio_bitrate || 0,
      hasObjectAudio: input.has_object_audio || false,
    }

    // Try to parse audio_tracks
    if (!input.audio_tracks) {
      return fallback
    }

    try {
      const tracks: AudioTrack[] = JSON.parse(input.audio_tracks)
      if (!Array.isArray(tracks) || tracks.length === 0) {
        return fallback
      }

      // Filter out commentary tracks for best-track selection
      const nonCommentary = tracks.filter(t => !t.title?.toLowerCase().includes('commentary'))
      const candidates = nonCommentary.length > 0 ? nonCommentary : tracks

      // Find the track with the highest quality score
      let bestTrack = candidates[0]
      let bestScore = this.calculateAudioTrackQualityScore(bestTrack)

      for (let i = 1; i < candidates.length; i++) {
        const score = this.calculateAudioTrackQualityScore(candidates[i])
        if (score > bestScore) {
          bestScore = score
          bestTrack = candidates[i]
        }
      }

      return {
        codec: bestTrack.codec || fallback.codec,
        channels: bestTrack.channels || fallback.channels,
        bitrate: bestTrack.bitrate || fallback.bitrate,
        hasObjectAudio: bestTrack.hasObjectAudio || false,
      }
    } catch (e) {
      // JSON parse failed, return fallback
      return fallback
    }
  }

  /**
   * Determine video quality tier directly from effective bitrate
   */
  /**
   * Calculate continuous video tier score (0-100) based on effective bitrate
   * relative to the tier's medium/high thresholds
   */
  private calculateVideoTierScore(effectiveBitrate: number, tier: QualityTier): number {
    if (effectiveBitrate <= 0) return 0
    const { medium, high } = this.videoThresholds[tier]
    if (effectiveBitrate >= high) return 100
    if (effectiveBitrate < medium) {
      return Math.round((effectiveBitrate / medium) * 50)
    }
    return 50 + Math.round(((effectiveBitrate - medium) / (high - medium)) * 49)
  }

  /**
   * Calculate continuous audio tier score (0-100) from audio characteristics.
   * Pure bitrate-based scoring against tier thresholds — no codec bonuses.
   */
  private calculateAudioTierScore(
    bestAudio: { codec: string; channels: number; bitrate: number; hasObjectAudio: boolean },
    tier: QualityTier
  ): number {
    // Object audio = perfect
    if (bestAudio.hasObjectAudio) return 100
    // Lossless = perfect
    if (this.isLosslessAudio(bestAudio.codec)) return 100

    if (bestAudio.bitrate <= 0) return 0

    const { medium, high } = this.audioThresholds[tier]
    if (bestAudio.bitrate >= high) return 100
    if (bestAudio.bitrate < medium) {
      return Math.round((bestAudio.bitrate / medium) * 50)
    }
    return 50 + Math.round(((bestAudio.bitrate - medium) / (high - medium)) * 49)
  }

  /**
   * Format bitrate for display - uses kbps for low values, Mbps for high values
   */
  private formatBitrate(kbps: number): string {
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(1)} Mbps`
    }
    return `${kbps} kbps`
  }

  /**
   * Core quality scoring logic shared by analyzeMediaItem and analyzeVersion.
   */
  private scoreQuality(input: QualityScoringInput): {
    qualityTier: QualityTier
    tierQuality: TierQuality
    tierScore: number
    bitrateTierScore: number
    audioTierScore: number
    effectiveBitrate: number
    bestAudio: { codec: string; channels: number; bitrate: number; hasObjectAudio: boolean }
  } {
    const qualityTier = this.classifyTier(input.resolution, input.height)
    const codecEfficiency = this.getCodecEfficiency(input.video_codec)
    const effectiveBitrate = input.video_bitrate * codecEfficiency
    const bestAudio = this.getBestAudioTrack(input)
    const bitrateTierScore = this.calculateVideoTierScore(effectiveBitrate, qualityTier)
    const audioTierScore = this.calculateAudioTierScore(bestAudio, qualityTier)
    const tierScore = Math.round(bitrateTierScore * this.videoWeight + audioTierScore * (1 - this.videoWeight))
    // Derive tier quality from weighted score, not from worst-of video/audio
    const tierQuality: TierQuality = tierScore >= 75 ? 'HIGH' : tierScore >= 50 ? 'MEDIUM' : 'LOW'
    return { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore, effectiveBitrate, bestAudio }
  }

  /**
   * Analyze a media item version and return lightweight quality scores.
   * Used during scan and retroactive analysis to populate per-version quality data.
   */
  analyzeVersion(version: MediaItemVersion): VersionQualityResult {
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore } = this.scoreQuality(version)
    return {
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
    }
  }

  /**
   * Analyze a single media item and calculate quality scores
   */
  async analyzeMediaItem(mediaItem: MediaItem): Promise<QualityScore> {
    const { qualityTier, tierQuality, tierScore, bitrateTierScore, audioTierScore, effectiveBitrate, bestAudio } =
      this.scoreQuality(mediaItem)

    // Legacy scoring (for backward compatibility) - also use best audio
    const resolutionScore = this.calculateResolutionScore(mediaItem.height)
    const bitrateScore = this.calculateBitrateScore(mediaItem.video_bitrate, mediaItem.height)
    const audioScore = this.calculateAudioScore(bestAudio.channels, bestAudio.bitrate)
    const overallScore = tierScore

    // Identify issues
    const issues: string[] = []
    const { medium: mediumThreshold } = this.videoThresholds[qualityTier]

    const codecEfficiency = this.getCodecEfficiency(mediaItem.video_codec)
    if (effectiveBitrate < mediumThreshold && mediaItem.video_bitrate > 0) {
      const codecName = codecEfficiency > 1.0 ? ` (${mediaItem.video_codec})` : ''
      issues.push(
        `Low bitrate for ${qualityTier}: ${this.formatBitrate(mediaItem.video_bitrate)}${codecName}`
      )
    } else if (mediaItem.video_bitrate === 0) {
      issues.push(`Bitrate unknown for ${qualityTier}`)
    }

    // HDR missing for 4K
    if (qualityTier === '4K' && (!mediaItem.hdr_format || mediaItem.hdr_format === 'None')) {
      issues.push('4K content without HDR')
    }

    // 8-bit for 4K content
    if (qualityTier === '4K' &&
        (!mediaItem.color_bit_depth || mediaItem.color_bit_depth < 10)) {
      issues.push('8-bit color (10-bit recommended)')
    }

    // Audio issues (check best audio track)
    const { medium: audioMedium } = this.audioThresholds[qualityTier]
    if (bestAudio.channels < 2) {
      issues.push(`Mono audio`)
    } else if (bestAudio.channels === 2 && bestAudio.bitrate < audioMedium) {
      issues.push(`Low audio quality: ${bestAudio.bitrate} kbps`)
    }

    // Determine if needs upgrade (LOW quality only)
    const isLowQuality = tierQuality === 'LOW'
    const needsUpgrade = tierQuality === 'LOW'

    return {
      media_item_id: mediaItem.id || 0,
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      bitrate_tier_score: bitrateTierScore,
      audio_tier_score: audioTierScore,
      overall_score: overallScore,
      resolution_score: resolutionScore,
      bitrate_score: bitrateScore,
      audio_score: audioScore,
      is_low_quality: isLowQuality,
      needs_upgrade: needsUpgrade,
      issues: JSON.stringify(issues),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Classify media into quality tier using resolution string
   */
  private classifyTier(resolution: string, height?: number): QualityTier {
    const resLower = resolution.toLowerCase()

    if (resLower.includes('4k') || resLower.includes('2160p')) {
      return '4K'
    }
    if (resLower.includes('1080p') || resLower.includes('1080i')) {
      return '1080p'
    }
    if (resLower.includes('720p') || resLower.includes('720i')) {
      return '720p'
    }

    // Parse WxH format (e.g., "1920x1080")
    const wxhMatch = resolution.match(/(\d+)\s*x\s*(\d+)/i)
    if (wxhMatch) {
      const h = parseInt(wxhMatch[2], 10)
      if (h >= 2160) return '4K'
      if (h >= 1080) return '1080p'
      if (h >= 720) return '720p'
      return 'SD'
    }

    // Fallback to height field if available
    if (height) {
      if (height >= 2160) return '4K'
      if (height >= 1080) return '1080p'
      if (height >= 720) return '720p'
    }

    return 'SD'
  }

  /**
   * Calculate resolution score (0-100) - legacy
   */
  private calculateResolutionScore(height: number): number {
    if (height >= 2160) return 100
    if (height >= this.thresholds.resolutionExcellent) return 90
    if (height >= this.thresholds.resolutionGood) return 70
    if (height >= this.thresholds.resolutionPoor) return 50
    return Math.round((height / this.thresholds.resolutionPoor) * 50)
  }

  /**
   * Calculate bitrate score (0-100) based on resolution - legacy
   */
  private calculateBitrateScore(bitrate: number, height: number): number {
    const bitrateKbps = bitrate
    let expectedBitrate: number
    let excellentBitrate: number

    if (height >= 2160) {
      expectedBitrate = this.thresholds.bitrate4K
      excellentBitrate = 30000
    } else if (height >= this.thresholds.resolutionExcellent) {
      expectedBitrate = this.thresholds.bitrate1080p
      excellentBitrate = 15000
    } else if (height >= this.thresholds.resolutionGood) {
      expectedBitrate = this.thresholds.bitrate720p
      excellentBitrate = 8000
    } else {
      expectedBitrate = this.thresholds.bitrateSD
      excellentBitrate = 4000
    }

    if (bitrateKbps >= excellentBitrate) return 100
    if (bitrateKbps >= expectedBitrate) {
      const ratio = (bitrateKbps - expectedBitrate) / (excellentBitrate - expectedBitrate)
      return Math.round(80 + ratio * 20)
    }
    const ratio = bitrateKbps / expectedBitrate
    return Math.round(ratio * 80)
  }

  /**
   * Calculate audio score (0-100) - legacy
   */
  private calculateAudioScore(channels: number, bitrate: number): number {
    let score = 0

    if (channels >= this.thresholds.audioChannelsExcellent) {
      score += 50
    } else if (channels >= this.thresholds.audioChannelsGood) {
      score += 35
    } else {
      score += 15
    }

    if (bitrate >= this.thresholds.audioBitrateExcellent) {
      score += 50
    } else if (bitrate >= this.thresholds.audioBitrateGood) {
      score += 35
    } else if (bitrate >= this.thresholds.audioBitratePoor) {
      score += 20
    } else {
      score += 10
    }

    return Math.min(score, 100)
  }

  /**
   * Analyze all media items in the database
   */
  async analyzeAllMediaItems(
    onProgress?: (current: number, total: number) => void
  ): Promise<number> {
    const db = getDatabase()
    const mediaItems = db.getMediaItems()

    let analyzed = 0
    const tierCounts: Record<string, number> = {}
    const qualityCounts: Record<string, number> = {}

    getLoggingService().verbose('[QualityAnalyzer]', `Starting analysis of ${mediaItems.length} items`)

    for (const item of mediaItems) {
      try {
        const qualityScore = await this.analyzeMediaItem(item)
        await db.upsertQualityScore(qualityScore)

        // Track distribution for verbose summary
        const tier = qualityScore.quality_tier || 'SD'
        const quality = qualityScore.tier_quality || 'MEDIUM'
        tierCounts[tier] = (tierCounts[tier] || 0) + 1
        qualityCounts[quality] = (qualityCounts[quality] || 0) + 1

        // Score individual versions and update best version selection
        if (item.id && item.version_count && item.version_count > 1) {
          const versions = db.getMediaItemVersions(item.id)
          for (const version of versions) {
            if (version.id) {
              const vScore = this.analyzeVersion(version)
              db.updateMediaItemVersionQuality(version.id, vScore)
            }
          }
          db.updateBestVersion(item.id)
        }

        analyzed++

        if (onProgress) {
          onProgress(analyzed, mediaItems.length)
        }
      } catch (error) {
        console.error(`Failed to analyze item ${item.id}:`, error)
      }
    }

    const tierSummary = Object.entries(tierCounts).map(([t, c]) => `${t}:${c}`).join(', ')
    const qualSummary = Object.entries(qualityCounts).map(([q, c]) => `${q}:${c}`).join(', ')
    getLoggingService().verbose('[QualityAnalyzer]',
      `Analysis complete: ${analyzed}/${mediaItems.length} items — Tiers: ${tierSummary} — Quality: ${qualSummary}`)

    return analyzed
  }

  /**
   * Get quality summary statistics
   */
  getQualityDistribution(): {
    byTier: {
      [tier: string]: { low: number; medium: number; high: number }
    }
    byQuality: {
      low: number
      medium: number
      high: number
    }
  } {
    const db = getDatabase()
    const scores = db.getQualityScores()

    const distribution = {
      byTier: {
        'SD': { low: 0, medium: 0, high: 0 },
        '720p': { low: 0, medium: 0, high: 0 },
        '1080p': { low: 0, medium: 0, high: 0 },
        '4K': { low: 0, medium: 0, high: 0 }
      },
      byQuality: {
        low: 0,
        medium: 0,
        high: 0
      }
    }

    scores.forEach((score: QualityScore) => {
      const tier = (score.quality_tier || 'SD') as QualityTier
      const quality = (score.tier_quality || 'MEDIUM').toLowerCase() as 'low' | 'medium' | 'high'

      if (distribution.byTier[tier]) {
        distribution.byTier[tier][quality]++
      }
      distribution.byQuality[quality]++
    })

    return distribution
  }

  /**
   * Get recommended format for upgrade based on current quality
   */
  getRecommendedFormat(mediaItem: MediaItem, currentScore: number): string {
    if (mediaItem.height >= 2160 && currentScore >= 90) {
      return 'No upgrade needed'
    }
    if (mediaItem.height >= 1080 && currentScore < 80) {
      return '4K UHD Blu-ray'
    }
    if (mediaItem.height < 1080) {
      return 'Blu-ray'
    }
    return 'Blu-ray'
  }

  // ============================================================================
  // MUSIC QUALITY ANALYSIS
  // ============================================================================

  /**
   * Analyze a music album's quality
   */
  analyzeMusicAlbum(album: MusicAlbum, tracks: MusicTrack[]): MusicQualityScore {
    const issues: string[] = []

    const qualityTier = this.determineMusicQualityTier(album, tracks)
    const codecScore = this.calculateMusicCodecScore(album, tracks)
    const bitrateScore = this.calculateMusicBitrateScore(album, qualityTier)
    const tierScore = Math.round((codecScore + bitrateScore) / 2)

    // Determine tier quality based on tier score
    let tierQuality: 'LOW' | 'MEDIUM' | 'HIGH'
    if (tierScore >= 75) {
      tierQuality = 'HIGH'
    } else if (tierScore >= 40) {
      tierQuality = 'MEDIUM'
    } else {
      tierQuality = 'LOW'
    }

    if (qualityTier === 'LOSSY_LOW') {
      issues.push(`Low quality lossy encoding (below ${this.musicThresholds.lowBitrate} kbps)`)
    } else if (qualityTier === 'LOSSY_MID' && tierQuality === 'LOW') {
      issues.push('Moderate quality lossy encoding')
    }

    if (tracks.length > 0) {
      const losslessCount = tracks.filter(t => t.is_lossless).length
      const lossyCount = tracks.length - losslessCount
      if (losslessCount > 0 && lossyCount > 0) {
        issues.push('Mixed quality: some tracks are lossy')
      }
    }

    const needsUpgrade = qualityTier === 'LOSSY_LOW' ||
      qualityTier === 'LOSSY_MID'

    return {
      album_id: album.id!,
      quality_tier: qualityTier,
      tier_quality: tierQuality,
      tier_score: tierScore,
      codec_score: codecScore,
      bitrate_score: bitrateScore,
      needs_upgrade: needsUpgrade,
      issues: JSON.stringify(issues),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Determine music quality tier based on codec and specs
   */
  private determineMusicQualityTier(album: MusicAlbum, tracks: MusicTrack[]): MusicQualityTier {
    const hasHiRes = tracks.some(t => t.is_hi_res)
    if (hasHiRes) {
      return 'HI_RES'
    }

    const allLossless = tracks.length > 0 && tracks.every(t => t.is_lossless)
    if (allLossless) {
      return 'LOSSLESS'
    }

    const losslessRatio = tracks.length > 0
      ? tracks.filter(t => t.is_lossless).length / tracks.length
      : 0
    if (losslessRatio > 0.5) {
      return 'LOSSLESS'
    }

    const avgBitrate = album.avg_audio_bitrate || 0

    if (avgBitrate >= this.musicThresholds.highBitrate) {
      return 'LOSSY_HIGH'
    } else if (avgBitrate >= this.musicThresholds.lowBitrate) {
      return 'LOSSY_MID'
    } else {
      return 'LOSSY_LOW'
    }
  }

  /**
   * Calculate codec score for music (0-100)
   */
  private calculateMusicCodecScore(_album: MusicAlbum, tracks: MusicTrack[]): number {
    if (tracks.length === 0) return 50

    const codecRankings: Record<string, number> = {
      'dsd': 100,
      'flac': 95,
      'alac': 95,
      'wav': 95,
      'aiff': 95,
      'ape': 85,
      'wavpack': 85,
      'opus': 80,
      'aac': 70,
      'vorbis': 65,
      'mp3': 60,
      'wma': 50,
    }

    let totalScore = 0
    for (const track of tracks) {
      const codec = (track.audio_codec || '').toLowerCase()
      let codecScore = 50

      for (const [codecName, score] of Object.entries(codecRankings)) {
        if (codec.includes(codecName)) {
          codecScore = score
          break
        }
      }

      if (track.is_hi_res) {
        codecScore = Math.min(100, codecScore + 5)
      }

      totalScore += codecScore
    }

    return Math.round(totalScore / tracks.length)
  }

  /**
   * Calculate bitrate score for music (0-100)
   */
  private calculateMusicBitrateScore(album: MusicAlbum, tier: MusicQualityTier): number {
    const avgBitrate = album.avg_audio_bitrate || 0

    if (tier === 'HI_RES') {
      return 100
    }
    if (tier === 'LOSSLESS') {
      if (avgBitrate >= 1000) return 100
      if (avgBitrate >= 800) return 90
      if (avgBitrate >= 600) return 80
      return 70
    }

    if (avgBitrate >= 320) return 95
    if (avgBitrate >= 256) return 85
    if (avgBitrate >= 192) return 70
    if (avgBitrate >= 160) return 55
    if (avgBitrate >= 128) return 40
    return 25
  }

  /**
   * Get music quality tier display name
   */
  getMusicQualityTierDisplay(tier: MusicQualityTier): string {
    const displays: Record<MusicQualityTier, string> = {
      'LOSSY_LOW': 'Low Quality',
      'LOSSY_MID': 'Standard',
      'LOSSY_HIGH': 'High Quality',
      'LOSSLESS': 'Lossless',
      'HI_RES': 'Hi-Res',
    }
    return displays[tier] || tier
  }

  /**
   * Get recommended music format for upgrade
   */
  getRecommendedMusicFormat(_album: MusicAlbum, score: MusicQualityScore): string {
    if (score.quality_tier === 'HI_RES' && score.tier_quality === 'HIGH') {
      return 'No upgrade needed'
    }

    if (score.quality_tier === 'LOSSLESS' && score.tier_quality !== 'LOW') {
      return 'Hi-Res (24-bit/96kHz+)'
    }

    if (score.quality_tier.startsWith('LOSSY')) {
      return 'Lossless (FLAC/ALAC)'
    }

    return 'Lossless (FLAC/ALAC)'
  }
}

// Export singleton instance
let analyzerInstance: QualityAnalyzer | null = null

export function getQualityAnalyzer(): QualityAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new QualityAnalyzer()
  }
  return analyzerInstance
}
