/**
 * MediaNormalizer Unit Tests
 *
 * Tests for all normalization functions used across providers.
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeVideoCodec,
  normalizeAudioCodec,
  getFullAudioCodecName,
  normalizeResolution,
  normalizeHdrFormat,
  normalizeBitrate,
  normalizeFrameRate,
  normalizeAudioChannels,
  normalizeSampleRate,
  normalizeContainer,
  hasObjectAudio,
  normalizeMediaInfo,
} from '../../src/main/services/MediaNormalizer'

// ============================================================================
// normalizeVideoCodec
// ============================================================================

describe('normalizeVideoCodec', () => {
  it('should return empty string for null/undefined', () => {
    expect(normalizeVideoCodec(null)).toBe('')
    expect(normalizeVideoCodec(undefined)).toBe('')
  })

  it('should normalize HEVC/H.265 variants', () => {
    expect(normalizeVideoCodec('hevc')).toBe('HEVC')
    expect(normalizeVideoCodec('h265')).toBe('HEVC')
    expect(normalizeVideoCodec('h.265')).toBe('HEVC')
    expect(normalizeVideoCodec('x265')).toBe('HEVC')
    expect(normalizeVideoCodec('HEVC Main 10')).toBe('HEVC')
  })

  it('should normalize H.264/AVC variants', () => {
    expect(normalizeVideoCodec('h264')).toBe('H.264')
    expect(normalizeVideoCodec('h.264')).toBe('H.264')
    expect(normalizeVideoCodec('avc')).toBe('H.264')
    expect(normalizeVideoCodec('x264')).toBe('H.264')
    expect(normalizeVideoCodec('avc1')).toBe('H.264')
    expect(normalizeVideoCodec('some h264 variant')).toBe('H.264')
  })

  it('should normalize AV1', () => {
    expect(normalizeVideoCodec('av1')).toBe('AV1')
    expect(normalizeVideoCodec('av01')).toBe('AV1')
  })

  it('should normalize VP9 and VP8', () => {
    expect(normalizeVideoCodec('vp9')).toBe('VP9')
    expect(normalizeVideoCodec('VP9')).toBe('VP9')
    expect(normalizeVideoCodec('vp8')).toBe('VP8')
  })

  it('should normalize MPEG-4 variants', () => {
    expect(normalizeVideoCodec('mpeg4')).toBe('MPEG-4')
    expect(normalizeVideoCodec('mp4v')).toBe('MPEG-4')
    expect(normalizeVideoCodec('divx')).toBe('MPEG-4')
    expect(normalizeVideoCodec('xvid')).toBe('MPEG-4')
  })

  it('should normalize MPEG-2', () => {
    expect(normalizeVideoCodec('mpeg2')).toBe('MPEG-2')
    expect(normalizeVideoCodec('mpeg2video')).toBe('MPEG-2')
    expect(normalizeVideoCodec('mp2v')).toBe('MPEG-2')
  })

  it('should normalize VC-1', () => {
    expect(normalizeVideoCodec('vc1')).toBe('VC-1')
    expect(normalizeVideoCodec('vc-1')).toBe('VC-1')
    expect(normalizeVideoCodec('wmv3')).toBe('VC-1')
    expect(normalizeVideoCodec('wvc1')).toBe('VC-1')
  })

  it('should normalize MPEG-1', () => {
    expect(normalizeVideoCodec('mpeg1')).toBe('MPEG-1')
    expect(normalizeVideoCodec('mpeg1video')).toBe('MPEG-1')
  })

  it('should normalize ProRes', () => {
    expect(normalizeVideoCodec('prores')).toBe('ProRes')
    expect(normalizeVideoCodec('Apple ProRes 422')).toBe('ProRes')
  })

  it('should normalize DNxHD', () => {
    expect(normalizeVideoCodec('dnxhd')).toBe('DNxHD')
    expect(normalizeVideoCodec('dnxhr')).toBe('DNxHD')
  })

  it('should uppercase unknown codecs', () => {
    expect(normalizeVideoCodec('somecodec')).toBe('SOMECODEC')
  })
})

// ============================================================================
// normalizeAudioCodec
// ============================================================================

describe('normalizeAudioCodec', () => {
  it('should return empty string for null/undefined', () => {
    expect(normalizeAudioCodec(null)).toBe('')
    expect(normalizeAudioCodec(undefined)).toBe('')
  })

  it('should normalize DTS variants via profile (Plex dca pattern)', () => {
    expect(normalizeAudioCodec('dca', 'ma')).toBe('DTS-HD MA')
    expect(normalizeAudioCodec('dca', 'hra')).toBe('DTS-HD')
    expect(normalizeAudioCodec('dts', 'dts-hd ma')).toBe('DTS-HD MA')
    expect(normalizeAudioCodec('dts', 'dts-hd hra')).toBe('DTS-HD')
    expect(normalizeAudioCodec('dts', 'dts-hd hr')).toBe('DTS-HD')
    expect(normalizeAudioCodec('dts', 'dts:x')).toBe('DTS:X')
    expect(normalizeAudioCodec('dts', 'dtsx')).toBe('DTS:X')
    expect(normalizeAudioCodec('dts', 'x')).toBe('DTS:X')
    expect(normalizeAudioCodec('dca')).toBe('DTS')
  })

  it('should normalize TrueHD', () => {
    expect(normalizeAudioCodec('truehd')).toBe('TrueHD')
    expect(normalizeAudioCodec('TrueHD Atmos')).toBe('TrueHD')
  })

  it('should normalize DTS-HD MA from codec string', () => {
    expect(normalizeAudioCodec('dts-hd ma')).toBe('DTS-HD MA')
    expect(normalizeAudioCodec('dtshd_ma')).toBe('DTS-HD MA')
    expect(normalizeAudioCodec('dts-hd.ma')).toBe('DTS-HD MA')
  })

  it('should normalize DTS-HD from codec string', () => {
    expect(normalizeAudioCodec('dts-hd hr')).toBe('DTS-HD')
    expect(normalizeAudioCodec('dts-hd')).toBe('DTS-HD')
    expect(normalizeAudioCodec('dtshd')).toBe('DTS-HD')
  })

  it('should normalize DTS:X from codec string', () => {
    expect(normalizeAudioCodec('dts:x')).toBe('DTS:X')
    expect(normalizeAudioCodec('dtsx')).toBe('DTS:X')
  })

  it('should normalize DTS standard', () => {
    expect(normalizeAudioCodec('dts')).toBe('DTS')
  })

  it('should normalize EAC3 variants', () => {
    expect(normalizeAudioCodec('eac3')).toBe('EAC3')
    expect(normalizeAudioCodec('ec3')).toBe('EAC3')
    expect(normalizeAudioCodec('e-ac-3')).toBe('EAC3')
    expect(normalizeAudioCodec('ec-3')).toBe('EAC3')
    expect(normalizeAudioCodec('Dolby Digital Plus')).toBe('EAC3')
  })

  it('should normalize AC3 variants', () => {
    expect(normalizeAudioCodec('ac3')).toBe('AC3')
    expect(normalizeAudioCodec('ac-3')).toBe('AC3')
    expect(normalizeAudioCodec('a52')).toBe('AC3')
    expect(normalizeAudioCodec('Dolby Digital')).toBe('AC3')
  })

  it('should normalize AAC', () => {
    expect(normalizeAudioCodec('aac')).toBe('AAC')
    expect(normalizeAudioCodec('aac_latm')).toBe('AAC')
  })

  it('should normalize FLAC', () => {
    expect(normalizeAudioCodec('flac')).toBe('FLAC')
  })

  it('should normalize ALAC', () => {
    expect(normalizeAudioCodec('alac')).toBe('ALAC')
  })

  it('should normalize PCM', () => {
    expect(normalizeAudioCodec('pcm')).toBe('PCM')
    expect(normalizeAudioCodec('lpcm')).toBe('PCM')
    expect(normalizeAudioCodec('pcm_s24le')).toBe('PCM')
  })

  it('should normalize MP3', () => {
    expect(normalizeAudioCodec('mp3')).toBe('MP3')
    expect(normalizeAudioCodec('mp3float')).toBe('MP3')
    expect(normalizeAudioCodec('mpeg audio layer 3')).toBe('MP3')
  })

  it('should normalize Opus', () => {
    expect(normalizeAudioCodec('opus')).toBe('Opus')
  })

  it('should normalize Vorbis', () => {
    expect(normalizeAudioCodec('vorbis')).toBe('Vorbis')
  })

  it('should normalize WMA', () => {
    expect(normalizeAudioCodec('wma')).toBe('WMA')
    expect(normalizeAudioCodec('wmav2')).toBe('WMA')
  })

  it('should uppercase unknown codecs', () => {
    expect(normalizeAudioCodec('unknowncodec')).toBe('UNKNOWNCODEC')
  })
})

// ============================================================================
// getFullAudioCodecName
// ============================================================================

describe('getFullAudioCodecName', () => {
  it('should return empty for null codec', () => {
    expect(getFullAudioCodecName(null, null, null, null)).toBe('')
  })

  it('should return base codec when no object audio', () => {
    expect(getFullAudioCodecName('truehd', null, null, null)).toBe('TrueHD')
    expect(getFullAudioCodecName('eac3', null, null, null)).toBe('EAC3')
  })

  it('should append Atmos to TrueHD', () => {
    expect(getFullAudioCodecName('truehd', 'atmos', null, null)).toBe('TrueHD Atmos')
    expect(getFullAudioCodecName('truehd', null, 'English TrueHD Atmos', null)).toBe('TrueHD Atmos')
    expect(getFullAudioCodecName('truehd', null, null, 'atmos 7.1')).toBe('TrueHD Atmos')
  })

  it('should append Atmos to EAC3', () => {
    expect(getFullAudioCodecName('eac3', 'Atmos', null, null)).toBe('EAC3 Atmos')
    expect(getFullAudioCodecName('eac3', null, 'EAC3 Atmos 7.1', null)).toBe('EAC3 Atmos')
  })

  it('should detect DTS:X from profile/title', () => {
    expect(getFullAudioCodecName('dts', null, 'DTS:X', null)).toBe('DTS:X')
    expect(getFullAudioCodecName('dts-hd ma', 'DTS:X', null, null)).toBe('DTS:X')
    expect(getFullAudioCodecName('dts', null, 'DTS-X 7.1', null)).toBe('DTS:X')
  })

  it('should return base codec for non-matching object audio', () => {
    expect(getFullAudioCodecName('ac3', 'Atmos', null, null)).toBe('AC3')
    expect(getFullAudioCodecName('aac', null, 'Atmos', null)).toBe('AAC')
  })
})

// ============================================================================
// normalizeResolution
// ============================================================================

describe('normalizeResolution', () => {
  it('should classify 4K', () => {
    expect(normalizeResolution(3840, 2160)).toBe('4K')
    expect(normalizeResolution(4096, 2160)).toBe('4K')
    expect(normalizeResolution(null, 2160)).toBe('4K')
    expect(normalizeResolution(3840, null)).toBe('4K')
  })

  it('should classify 1080p', () => {
    expect(normalizeResolution(1920, 1080)).toBe('1080p')
    expect(normalizeResolution(null, 1080)).toBe('1080p')
    expect(normalizeResolution(1920, null)).toBe('1080p')
  })

  it('should classify 720p', () => {
    expect(normalizeResolution(1280, 720)).toBe('720p')
    expect(normalizeResolution(null, 720)).toBe('720p')
  })

  it('should classify 480p', () => {
    expect(normalizeResolution(720, 480)).toBe('480p')
    expect(normalizeResolution(null, 480)).toBe('480p')
    expect(normalizeResolution(720, null)).toBe('480p')
  })

  it('should classify SD for low resolution', () => {
    expect(normalizeResolution(320, 240)).toBe('SD')
  })

  it('should return empty for no dimensions', () => {
    expect(normalizeResolution(null, null)).toBe('')
    expect(normalizeResolution(0, 0)).toBe('')
    expect(normalizeResolution(undefined, undefined)).toBe('')
  })
})

// ============================================================================
// normalizeHdrFormat
// ============================================================================

describe('normalizeHdrFormat', () => {
  describe('explicit HDR type', () => {
    it('should detect Dolby Vision', () => {
      expect(normalizeHdrFormat('dolbyvision', null, null, null, null)).toBe('Dolby Vision')
      expect(normalizeHdrFormat('Dolby Vision', null, null, null, null)).toBe('Dolby Vision')
      expect(normalizeHdrFormat('dovi', null, null, null, null)).toBe('Dolby Vision')
    })

    it('should detect HDR10+', () => {
      expect(normalizeHdrFormat('HDR10+', null, null, null, null)).toBe('HDR10+')
      expect(normalizeHdrFormat('hdr10plus', null, null, null, null)).toBe('HDR10+')
    })

    it('should detect HDR10', () => {
      expect(normalizeHdrFormat('HDR10', null, null, null, null)).toBe('HDR10')
      expect(normalizeHdrFormat('hdr', null, null, null, null)).toBe('HDR10')
    })

    it('should detect HLG', () => {
      expect(normalizeHdrFormat('HLG', null, null, null, null)).toBe('HLG')
    })
  })

  describe('profile-based detection', () => {
    it('should detect Dolby Vision from profile', () => {
      expect(normalizeHdrFormat(null, null, null, null, 'Dolby Vision Profile 5')).toBe('Dolby Vision')
      expect(normalizeHdrFormat(null, null, null, null, 'dovi')).toBe('Dolby Vision')
    })
  })

  describe('color primaries/transfer detection', () => {
    it('should detect Dolby Vision from transfer characteristics', () => {
      expect(normalizeHdrFormat(null, 'dovi', null, null, null)).toBe('Dolby Vision')
    })

    it('should detect Dolby Vision from primaries', () => {
      expect(normalizeHdrFormat(null, null, 'dovi', null, null)).toBe('Dolby Vision')
    })

    it('should detect HDR10+ from transfer', () => {
      expect(normalizeHdrFormat(null, 'smpte2094', null, null, null)).toBe('HDR10+')
      expect(normalizeHdrFormat(null, 'hdr10+', null, null, null)).toBe('HDR10+')
    })

    it('should detect HLG from transfer', () => {
      expect(normalizeHdrFormat(null, 'hlg', null, null, null)).toBe('HLG')
      expect(normalizeHdrFormat(null, 'arib-std-b67', null, null, null)).toBe('HLG')
    })

    it('should detect HDR10 from BT.2020 + PQ', () => {
      expect(normalizeHdrFormat(null, 'smpte2084', 'bt2020', null, null)).toBe('HDR10')
      expect(normalizeHdrFormat(null, 'pq', 'rec2020', null, null)).toBe('HDR10')
      expect(normalizeHdrFormat(null, 'st2084', 'bt2020', null, null)).toBe('HDR10')
    })

    it('should detect HDR10 from BT.2020 + 10-bit', () => {
      expect(normalizeHdrFormat(null, null, 'bt2020', 10, null)).toBe('HDR10')
      expect(normalizeHdrFormat(null, null, 'rec2020', 12, null)).toBe('HDR10')
    })
  })

  it('should return undefined for SDR content', () => {
    expect(normalizeHdrFormat(null, null, null, null, null)).toBeUndefined()
    expect(normalizeHdrFormat(null, null, null, 8, null)).toBeUndefined()
    expect(normalizeHdrFormat(null, null, 'bt709', 10, null)).toBeUndefined()
  })
})

// ============================================================================
// normalizeBitrate
// ============================================================================

describe('normalizeBitrate', () => {
  it('should return 0 for null/undefined', () => {
    expect(normalizeBitrate(null)).toBe(0)
    expect(normalizeBitrate(undefined)).toBe(0)
  })

  it('should return 0 for negative/zero/NaN', () => {
    expect(normalizeBitrate(0)).toBe(0)
    expect(normalizeBitrate(-100)).toBe(0)
    expect(normalizeBitrate('abc')).toBe(0)
  })

  it('should convert from bps', () => {
    expect(normalizeBitrate(10000000, 'bps')).toBe(10000)
  })

  it('should convert from Mbps', () => {
    expect(normalizeBitrate(10, 'mbps')).toBe(10000)
  })

  it('should pass through kbps', () => {
    expect(normalizeBitrate(5000, 'kbps')).toBe(5000)
  })

  it('should auto-detect bps (>100000)', () => {
    expect(normalizeBitrate(10000000)).toBe(10000)
  })

  it('should auto-detect Mbps (<100)', () => {
    expect(normalizeBitrate(10)).toBe(10000)
  })

  it('should auto-detect kbps (100-100000)', () => {
    expect(normalizeBitrate(5000)).toBe(5000)
  })

  it('should parse string values', () => {
    expect(normalizeBitrate('5000')).toBe(5000)
    expect(normalizeBitrate('10', 'mbps')).toBe(10000)
  })
})

// ============================================================================
// normalizeFrameRate
// ============================================================================

describe('normalizeFrameRate', () => {
  it('should return undefined for null/undefined', () => {
    expect(normalizeFrameRate(null)).toBeUndefined()
    expect(normalizeFrameRate(undefined)).toBeUndefined()
  })

  it('should handle numeric input', () => {
    expect(normalizeFrameRate(23.976)).toBe(23.976)
    expect(normalizeFrameRate(24)).toBe(24)
    expect(normalizeFrameRate(0)).toBeUndefined()
    expect(normalizeFrameRate(-1)).toBeUndefined()
  })

  it('should parse string input', () => {
    expect(normalizeFrameRate('23.976')).toBe(23.976)
    expect(normalizeFrameRate('29.97fps')).toBe(29.97)
  })

  it('should handle fraction format', () => {
    expect(normalizeFrameRate('24000/1001')).toBe(23.976)
    expect(normalizeFrameRate('30000/1001')).toBe(29.97)
  })

  it('should return undefined for invalid fraction', () => {
    expect(normalizeFrameRate('24000/0')).toBeUndefined()
  })

  it('should return undefined for invalid string', () => {
    expect(normalizeFrameRate('abc')).toBeUndefined()
    expect(normalizeFrameRate('0')).toBeUndefined()
  })
})

// ============================================================================
// normalizeAudioChannels
// ============================================================================

describe('normalizeAudioChannels', () => {
  it('should handle numeric channel count', () => {
    expect(normalizeAudioChannels(6, null)).toBe(6)
    expect(normalizeAudioChannels(8, null)).toBe(8)
    expect(normalizeAudioChannels(2, null)).toBe(2)
  })

  it('should parse string channel count', () => {
    expect(normalizeAudioChannels('6', null)).toBe(6)
    expect(normalizeAudioChannels('8', null)).toBe(8)
  })

  it('should parse from channel layout', () => {
    expect(normalizeAudioChannels(null, '7.1')).toBe(8)
    expect(normalizeAudioChannels(null, '6.1')).toBe(7)
    expect(normalizeAudioChannels(null, '5.1')).toBe(6)
    expect(normalizeAudioChannels(null, '5.0')).toBe(5)
    expect(normalizeAudioChannels(null, '4.1')).toBe(5)
    expect(normalizeAudioChannels(null, '4.0')).toBe(4)
    expect(normalizeAudioChannels(null, 'quad')).toBe(4)
    expect(normalizeAudioChannels(null, 'stereo')).toBe(2)
    expect(normalizeAudioChannels(null, '2.0')).toBe(2)
    expect(normalizeAudioChannels(null, 'mono')).toBe(1)
    expect(normalizeAudioChannels(null, '1.0')).toBe(1)
  })

  it('should count channels from layout string (FL+FR+...)', () => {
    expect(normalizeAudioChannels(null, 'FL+FR+FC+LFE+BL+BR')).toBe(6)
  })

  it('should default to 2 when layout has no + separators and no pattern match', () => {
    expect(normalizeAudioChannels(null, 'unknown_layout')).toBe(2)
  })

  it('should default to 2 (stereo)', () => {
    expect(normalizeAudioChannels(null, null)).toBe(2)
    expect(normalizeAudioChannels(0, null)).toBe(2)
    expect(normalizeAudioChannels('invalid', null)).toBe(2)
  })
})

// ============================================================================
// normalizeSampleRate
// ============================================================================

describe('normalizeSampleRate', () => {
  it('should return undefined for null/undefined', () => {
    expect(normalizeSampleRate(null)).toBeUndefined()
    expect(normalizeSampleRate(undefined)).toBeUndefined()
  })

  it('should pass through Hz values', () => {
    expect(normalizeSampleRate(44100)).toBe(44100)
    expect(normalizeSampleRate(48000)).toBe(48000)
    expect(normalizeSampleRate(96000)).toBe(96000)
  })

  it('should convert kHz to Hz', () => {
    expect(normalizeSampleRate(44)).toBe(44000)
    expect(normalizeSampleRate(48)).toBe(48000)
  })

  it('should parse string values', () => {
    expect(normalizeSampleRate('44100')).toBe(44100)
    expect(normalizeSampleRate('48')).toBe(48000)
  })

  it('should return undefined for invalid values', () => {
    expect(normalizeSampleRate(0)).toBeUndefined()
    expect(normalizeSampleRate(-1)).toBeUndefined()
    expect(normalizeSampleRate('abc')).toBeUndefined()
  })
})

// ============================================================================
// normalizeContainer
// ============================================================================

describe('normalizeContainer', () => {
  it('should return empty for null/undefined', () => {
    expect(normalizeContainer(null)).toBe('')
    expect(normalizeContainer(undefined)).toBe('')
  })

  it('should normalize video containers', () => {
    expect(normalizeContainer('mkv')).toBe('MKV')
    expect(normalizeContainer('matroska')).toBe('MKV')
    expect(normalizeContainer('mp4')).toBe('MP4')
    expect(normalizeContainer('m4v')).toBe('MP4')
    expect(normalizeContainer('avi')).toBe('AVI')
    expect(normalizeContainer('mov')).toBe('MOV')
    expect(normalizeContainer('quicktime')).toBe('MOV')
    expect(normalizeContainer('wmv')).toBe('WMV')
    expect(normalizeContainer('asf')).toBe('WMV')
    expect(normalizeContainer('ts')).toBe('TS')
    expect(normalizeContainer('mpegts')).toBe('TS')
    expect(normalizeContainer('webm')).toBe('WebM')
    expect(normalizeContainer('flv')).toBe('FLV')
    expect(normalizeContainer('ogm')).toBe('OGG')
    expect(normalizeContainer('ogg')).toBe('OGG')
  })

  it('should handle Emby comma-separated containers', () => {
    expect(normalizeContainer('matroska,webm')).toBe('MKV')
  })

  it('should uppercase unknown containers', () => {
    expect(normalizeContainer('custom')).toBe('CUSTOM')
  })
})

// ============================================================================
// hasObjectAudio
// ============================================================================

describe('hasObjectAudio', () => {
  it('should detect TrueHD Atmos via profile', () => {
    expect(hasObjectAudio('truehd', 'atmos', null, null)).toBe(true)
  })

  it('should detect TrueHD Atmos via title', () => {
    expect(hasObjectAudio('truehd', null, 'English TrueHD Atmos 7.1', null)).toBe(true)
  })

  it('should detect TrueHD Atmos via layout', () => {
    expect(hasObjectAudio('truehd', null, null, 'atmos 7.1.4')).toBe(true)
  })

  it('should detect EAC3 Atmos', () => {
    expect(hasObjectAudio('eac3', 'Atmos', null, null)).toBe(true)
    expect(hasObjectAudio('ec3', null, 'Atmos', null)).toBe(true)
  })

  it('should detect DTS:X via profile', () => {
    expect(hasObjectAudio('dts', 'DTS:X', null, null)).toBe(true)
    expect(hasObjectAudio('dts', 'dtsx', null, null)).toBe(true)
  })

  it('should detect DTS:X via title', () => {
    expect(hasObjectAudio('dts', null, 'DTS:X 7.1', null)).toBe(true)
    expect(hasObjectAudio('dts', null, 'DTS-X', null)).toBe(true)
  })

  it('should return false for non-object audio', () => {
    expect(hasObjectAudio('truehd', null, null, null)).toBe(false)
    expect(hasObjectAudio('ac3', 'atmos', null, null)).toBe(false) // AC3 doesn't support Atmos
    expect(hasObjectAudio('aac', null, null, null)).toBe(false)
    expect(hasObjectAudio(null, null, null, null)).toBe(false)
  })
})

// ============================================================================
// normalizeMediaInfo (integration of all functions)
// ============================================================================

describe('normalizeMediaInfo', () => {
  it('should normalize all fields at once', () => {
    const result = normalizeMediaInfo({
      videoCodec: 'hevc',
      videoWidth: 3840,
      videoHeight: 2160,
      videoBitrate: 40000,
      videoFrameRate: '23.976',
      videoBitDepth: 10,
      videoProfile: 'Main 10',
      hdrType: 'HDR10',
      colorSpace: 'bt2020nc',
      audioCodec: 'truehd',
      audioChannels: 8,
      audioBitrate: 5000,
      audioSampleRate: 48000,
      audioProfile: 'Atmos',
      audioTitle: 'English TrueHD Atmos',
      container: 'mkv',
    })

    expect(result.videoCodec).toBe('HEVC')
    expect(result.resolution).toBe('4K')
    expect(result.width).toBe(3840)
    expect(result.height).toBe(2160)
    expect(result.videoBitrate).toBe(40000)
    expect(result.videoFrameRate).toBe(23.976)
    expect(result.videoBitDepth).toBe(10)
    expect(result.hdrFormat).toBe('HDR10')
    expect(result.audioCodec).toBe('TrueHD')
    expect(result.audioCodecFull).toBe('TrueHD Atmos')
    expect(result.audioChannels).toBe(8)
    expect(result.hasObjectAudio).toBe(true)
    expect(result.container).toBe('MKV')
  })

  it('should handle minimal input', () => {
    const result = normalizeMediaInfo({})
    expect(result.videoCodec).toBe('')
    expect(result.resolution).toBe('')
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
    expect(result.videoBitrate).toBe(0)
    expect(result.audioCodec).toBe('')
    expect(result.audioChannels).toBe(2)
    expect(result.hasObjectAudio).toBe(false)
    expect(result.container).toBe('')
  })

  it('should handle SDR content', () => {
    const result = normalizeMediaInfo({
      videoCodec: 'h264',
      videoWidth: 1920,
      videoHeight: 1080,
      audioCodec: 'ac3',
      audioChannels: 6,
    })
    expect(result.videoCodec).toBe('H.264')
    expect(result.resolution).toBe('1080p')
    expect(result.hdrFormat).toBeUndefined()
    expect(result.audioCodec).toBe('AC3')
    expect(result.hasObjectAudio).toBe(false)
  })
})
