/**
 * ProviderUtils Unit Tests
 *
 * Tests for shared provider utility functions: best audio track selection,
 * commentary detection, bitrate estimation, and bitrate calculation.
 */

import { describe, it, expect } from 'vitest'
import {
  selectBestAudioTrack,
  isCommentaryTrack,
  estimateAudioBitrate,
  calculateAudioBitrateFromFile,
  isEstimatedBitrate,
  scoreVersion,
} from '../../src/main/providers/utils/ProviderUtils'
import { normalizeResolution } from '../../src/main/services/MediaNormalizer'
import type { AudioTrackInfo } from '../../src/main/providers/utils/ProviderUtils'

// ============================================================================
// selectBestAudioTrack
// ============================================================================

describe('selectBestAudioTrack', () => {
  it('should return undefined for empty array', () => {
    expect(selectBestAudioTrack([])).toBeUndefined()
  })

  it('should return undefined for null', () => {
    expect(selectBestAudioTrack(null as unknown as AudioTrackInfo[])).toBeUndefined()
  })

  it('should select higher tier codec', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'aac', channels: 2, bitrate: 128 },
      { index: 1, codec: 'truehd', channels: 8, bitrate: 5000 },
    ]
    expect(selectBestAudioTrack(tracks)!.index).toBe(1)
  })

  it('should prefer more channels at same tier', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'ac3', channels: 2, bitrate: 384 },
      { index: 1, codec: 'aac', channels: 6, bitrate: 384 },
    ]
    expect(selectBestAudioTrack(tracks)!.channels).toBe(6)
  })

  it('should prefer higher bitrate at same tier and channels', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'ac3', channels: 6, bitrate: 384 },
      { index: 1, codec: 'ac3', channels: 6, bitrate: 640 },
    ]
    expect(selectBestAudioTrack(tracks)!.bitrate).toBe(640)
  })

  it('should filter out commentary tracks', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'truehd', channels: 8, bitrate: 5000, title: "Director's Commentary" },
      { index: 1, codec: 'ac3', channels: 6, bitrate: 448, title: 'English' },
    ]
    const best = selectBestAudioTrack(tracks)
    expect(best!.index).toBe(1) // Should skip commentary even though it's higher tier
  })

  it('should fall back to commentary tracks if all are commentary', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'ac3', channels: 6, bitrate: 448, title: 'Commentary with Director' },
      { index: 1, codec: 'aac', channels: 2, bitrate: 128, title: 'Commentary with Cast' },
    ]
    const best = selectBestAudioTrack(tracks)
    expect(best!.index).toBe(0) // Should use AC3 commentary (better quality)
  })
})

// ============================================================================
// isCommentaryTrack
// ============================================================================

describe('isCommentaryTrack', () => {
  it('should detect commentary in title', () => {
    expect(isCommentaryTrack({ title: "Director's Commentary" })).toBe(true)
    expect(isCommentaryTrack({ title: 'Commentary with Cast' })).toBe(true)
  })

  it('should be case-insensitive', () => {
    expect(isCommentaryTrack({ title: 'COMMENTARY' })).toBe(true)
  })

  it('should return false for non-commentary tracks', () => {
    expect(isCommentaryTrack({ title: 'English' })).toBe(false)
    expect(isCommentaryTrack({ title: 'English DTS-HD MA 7.1' })).toBe(false)
  })

  it('should return false for tracks without title', () => {
    expect(isCommentaryTrack({})).toBe(false)
    expect(isCommentaryTrack({ title: undefined })).toBe(false)
  })
})

// ============================================================================
// estimateAudioBitrate
// ============================================================================

describe('estimateAudioBitrate', () => {
  describe('lossless codecs', () => {
    it('should estimate TrueHD/Atmos bitrate by channel count', () => {
      expect(estimateAudioBitrate('truehd', 8)).toBe(6000)
      expect(estimateAudioBitrate('truehd', 6)).toBe(4000)
      expect(estimateAudioBitrate('truehd', 2)).toBe(2500)
    })

    it('should estimate TrueHD Atmos bitrate', () => {
      expect(estimateAudioBitrate('TrueHD Atmos', 8)).toBe(6000)
    })

    it('should estimate DTS-HD MA bitrate', () => {
      expect(estimateAudioBitrate('dts-hd ma', 8)).toBe(5000)
      expect(estimateAudioBitrate('dts-hd ma', 6)).toBe(3500)
      expect(estimateAudioBitrate('dtshd_ma', 2)).toBe(2000)
    })

    it('should estimate generic DTS-HD bitrate', () => {
      expect(estimateAudioBitrate('dts-hd hra', 6)).toBe(2500)
      expect(estimateAudioBitrate('dtshd', 2)).toBe(1500)
    })

    it('should estimate FLAC/PCM bitrate', () => {
      expect(estimateAudioBitrate('flac', 6)).toBe(3000)
      expect(estimateAudioBitrate('pcm', 2)).toBe(1500)
      expect(estimateAudioBitrate('lpcm', 2)).toBe(1500)
    })
  })

  describe('lossy codecs', () => {
    it('should estimate DTS bitrate', () => {
      expect(estimateAudioBitrate('dts', 6)).toBe(1509)
      expect(estimateAudioBitrate('dts', 2)).toBe(768)
    })

    it('should estimate EAC3 bitrate', () => {
      expect(estimateAudioBitrate('eac3', 8)).toBe(1024)
      expect(estimateAudioBitrate('eac3', 6)).toBe(640)
      expect(estimateAudioBitrate('e-ac-3', 2)).toBe(384)
    })

    it('should estimate AC3 bitrate', () => {
      expect(estimateAudioBitrate('ac3', 6)).toBe(640)
      expect(estimateAudioBitrate('ac-3', 2)).toBe(384)
    })

    it('should estimate AAC bitrate', () => {
      expect(estimateAudioBitrate('aac', 6)).toBe(384)
      expect(estimateAudioBitrate('aac', 2)).toBe(256)
    })

    it('should estimate MP3 bitrate', () => {
      expect(estimateAudioBitrate('mp3', 6)).toBe(320)
      expect(estimateAudioBitrate('mp3', 2)).toBe(192)
    })

    it('should estimate Opus bitrate', () => {
      expect(estimateAudioBitrate('opus', 6)).toBe(256)
      expect(estimateAudioBitrate('opus', 2)).toBe(128)
    })
  })

  describe('edge cases', () => {
    it('should handle null/undefined codec', () => {
      expect(estimateAudioBitrate(null, 6)).toBe(640)
      expect(estimateAudioBitrate(undefined, 2)).toBe(256)
    })

    it('should handle null/undefined channels', () => {
      expect(estimateAudioBitrate('aac', null)).toBe(256)
      expect(estimateAudioBitrate('aac', undefined)).toBe(256)
    })

    it('should return default for unknown codecs', () => {
      expect(estimateAudioBitrate('unknown', 6)).toBe(640)
      expect(estimateAudioBitrate('unknown', 2)).toBe(256)
    })
  })
})

// ============================================================================
// calculateAudioBitrateFromFile
// ============================================================================

describe('calculateAudioBitrateFromFile', () => {
  it('should calculate audio bitrate from total minus video', () => {
    // 20000 total, 15000 video = 5000 remaining * 0.95 / 1 track = 4750
    const result = calculateAudioBitrateFromFile(20000, 15000, 1)
    expect(result).toBe(4750)
  })

  it('should divide among multiple tracks', () => {
    // 20000 total, 15000 video = 5000 remaining * 0.95 / 2 tracks = 2375
    const result = calculateAudioBitrateFromFile(20000, 15000, 2)
    expect(result).toBe(2375)
  })

  it('should return 0 for zero total bitrate', () => {
    expect(calculateAudioBitrateFromFile(0, 15000, 1)).toBe(0)
  })

  it('should return 0 for zero video bitrate', () => {
    expect(calculateAudioBitrateFromFile(20000, 0, 1)).toBe(0)
  })

  it('should return 0 for zero tracks', () => {
    expect(calculateAudioBitrateFromFile(20000, 15000, 0)).toBe(0)
  })

  it('should return 0 when video exceeds total', () => {
    expect(calculateAudioBitrateFromFile(10000, 15000, 1)).toBe(0)
  })
})

// ============================================================================
// isEstimatedBitrate
// ============================================================================

// ============================================================================
// scoreVersion
// ============================================================================

describe('scoreVersion', () => {
  describe('resolution tier ranking', () => {
    it('ranks 4K > 1080p > 720p > SD', () => {
      const uhd = scoreVersion({ resolution: '4K', video_bitrate: 0, hdr_format: 'None' })
      const fhd = scoreVersion({ resolution: '1080p', video_bitrate: 0, hdr_format: 'None' })
      const hd = scoreVersion({ resolution: '720p', video_bitrate: 0, hdr_format: 'None' })
      const sd = scoreVersion({ resolution: '480p', video_bitrate: 0, hdr_format: 'None' })

      expect(uhd).toBeGreaterThan(fhd)
      expect(fhd).toBeGreaterThan(hd)
      expect(hd).toBeGreaterThan(sd)
    })

    it('handles all normalizeResolution output values correctly', () => {
      // normalizeResolution returns these exact strings — scoreVersion must handle all of them
      const resolutions = [
        { w: 3840, h: 2160, expected: '4K' },
        { w: 1920, h: 1080, expected: '1080p' },
        { w: 1280, h: 720, expected: '720p' },
        { w: 720, h: 480, expected: '480p' },
        { w: 320, h: 240, expected: 'SD' },
      ]

      const scores = resolutions.map(r => ({
        label: r.expected,
        normalized: normalizeResolution(r.w, r.h),
        score: scoreVersion({ resolution: normalizeResolution(r.w, r.h), video_bitrate: 0, hdr_format: 'None' }),
      }))

      // Verify normalizeResolution returns what we expect
      for (const s of scores) {
        expect(s.normalized).toBe(s.label)
      }

      // 4K must score highest tier
      expect(scores[0].score).toBeGreaterThan(scores[1].score)
      // 1080p > 720p
      expect(scores[1].score).toBeGreaterThan(scores[2].score)
      // 720p > 480p and SD (both tier 1)
      expect(scores[2].score).toBeGreaterThan(scores[3].score)
    })
  })

  describe('HDR bonus', () => {
    it('adds 1000 for non-None HDR format', () => {
      const sdr = scoreVersion({ resolution: '1080p', video_bitrate: 10000, hdr_format: 'None' })
      const hdr = scoreVersion({ resolution: '1080p', video_bitrate: 10000, hdr_format: 'HDR10' })
      const dv = scoreVersion({ resolution: '1080p', video_bitrate: 10000, hdr_format: 'Dolby Vision' })

      expect(hdr).toBe(sdr + 1000)
      expect(dv).toBe(sdr + 1000)
    })

    it('treats undefined/missing hdr_format as SDR', () => {
      const noHdr = scoreVersion({ resolution: '1080p', video_bitrate: 5000 })
      const noneHdr = scoreVersion({ resolution: '1080p', video_bitrate: 5000, hdr_format: 'None' })

      expect(noHdr).toBe(noneHdr)
    })
  })

  describe('bitrate tiebreaker', () => {
    it('higher bitrate wins within same tier', () => {
      const low = scoreVersion({ resolution: '1080p', video_bitrate: 5000, hdr_format: 'None' })
      const high = scoreVersion({ resolution: '1080p', video_bitrate: 20000, hdr_format: 'None' })

      expect(high).toBeGreaterThan(low)
      expect(high - low).toBe(15000)
    })
  })

  describe('tier dominance', () => {
    it('higher resolution always beats lower resolution regardless of bitrate', () => {
      const hd720_maxBitrate = scoreVersion({ resolution: '720p', video_bitrate: 99999, hdr_format: 'None' })
      const fhd1080_minBitrate = scoreVersion({ resolution: '1080p', video_bitrate: 0, hdr_format: 'None' })

      expect(fhd1080_minBitrate).toBeGreaterThan(hd720_maxBitrate)
    })

    it('HDR does not override resolution tier', () => {
      const hd720_hdr = scoreVersion({ resolution: '720p', video_bitrate: 50000, hdr_format: 'HDR10' })
      const fhd1080_sdr = scoreVersion({ resolution: '1080p', video_bitrate: 0, hdr_format: 'None' })

      expect(fhd1080_sdr).toBeGreaterThan(hd720_hdr)
    })
  })

  describe('case insensitivity', () => {
    it('handles mixed-case resolution strings', () => {
      const lower = scoreVersion({ resolution: '4k', video_bitrate: 0 })
      const upper = scoreVersion({ resolution: '4K', video_bitrate: 0 })

      expect(lower).toBe(upper)
    })
  })
})

describe('isEstimatedBitrate', () => {
  it('should detect known estimated values', () => {
    expect(isEstimatedBitrate(128)).toBe(true)
    expect(isEstimatedBitrate(256)).toBe(true)
    expect(isEstimatedBitrate(640)).toBe(true)
    expect(isEstimatedBitrate(1509)).toBe(true)
    expect(isEstimatedBitrate(5000)).toBe(true)
  })

  it('should return false for non-estimated values', () => {
    expect(isEstimatedBitrate(129)).toBe(false)
    expect(isEstimatedBitrate(448)).toBe(false)
    expect(isEstimatedBitrate(7500)).toBe(false)
  })
})
