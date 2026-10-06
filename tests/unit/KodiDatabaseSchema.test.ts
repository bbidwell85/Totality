import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
  })),
}))

import {
  parseHdrType,
  normalizeResolution,
  normalizeVideoCodec,
  normalizeAudioCodec,
  convertKodiPathToLocal,
  convertKodiImageUrl,
  buildFilePath,
  estimateBitrate,
} from '@main/providers/kodi/KodiDatabaseSchema'

describe('KodiDatabaseSchema', () => {
  // ==========================================================================
  // parseHdrType
  // ==========================================================================
  describe('parseHdrType', () => {
    it('returns None for null', () => {
      expect(parseHdrType(null)).toBe('None')
    })

    it('returns None for empty string', () => {
      expect(parseHdrType('')).toBe('None')
    })

    it('detects Dolby Vision variants', () => {
      expect(parseHdrType('dolbyvision')).toBe('Dolby Vision')
      expect(parseHdrType('dolby vision')).toBe('Dolby Vision')
      expect(parseHdrType('dovi')).toBe('Dolby Vision')
    })

    it('detects HDR10+', () => {
      expect(parseHdrType('hdr10+')).toBe('HDR10+')
      expect(parseHdrType('hdr10plus')).toBe('HDR10+')
    })

    it('detects HDR10', () => {
      expect(parseHdrType('hdr10')).toBe('HDR10')
      expect(parseHdrType('hdr')).toBe('HDR10')
    })

    it('detects HLG', () => {
      expect(parseHdrType('hlg')).toBe('HLG')
    })

    it('is case insensitive', () => {
      expect(parseHdrType('DOLBYVISION')).toBe('Dolby Vision')
      expect(parseHdrType('HDR10')).toBe('HDR10')
      expect(parseHdrType('HLG')).toBe('HLG')
    })

    it('returns None for unknown strings', () => {
      expect(parseHdrType('something')).toBe('None')
    })
  })

  // ==========================================================================
  // normalizeResolution
  // ==========================================================================
  describe('normalizeResolution', () => {
    it('returns SD for null/0', () => {
      expect(normalizeResolution(null, null)).toBe('SD')
      expect(normalizeResolution(0, 0)).toBe('SD')
    })

    it('detects 4K', () => {
      expect(normalizeResolution(3840, 2160)).toBe('4K')
    })

    it('detects 1080p', () => {
      expect(normalizeResolution(1920, 1080)).toBe('1080p')
    })

    it('detects 720p', () => {
      expect(normalizeResolution(1280, 720)).toBe('720p')
    })

    it('detects 480p', () => {
      expect(normalizeResolution(720, 480)).toBe('480p')
    })

    it('detects SD for low values', () => {
      expect(normalizeResolution(640, 360)).toBe('SD')
    })

    it('uses height alone when width is null', () => {
      expect(normalizeResolution(null, 1080)).toBe('1080p')
    })

    it('uses width alone when height is null', () => {
      expect(normalizeResolution(3840, null)).toBe('4K')
    })
  })

  // ==========================================================================
  // normalizeVideoCodec
  // ==========================================================================
  describe('normalizeVideoCodec', () => {
    it('returns empty string for null', () => {
      expect(normalizeVideoCodec(null)).toBe('')
    })

    it('normalizes HEVC variants', () => {
      expect(normalizeVideoCodec('hevc')).toBe('HEVC')
      expect(normalizeVideoCodec('h265')).toBe('HEVC')
      expect(normalizeVideoCodec('x265')).toBe('HEVC')
    })

    it('normalizes H.264 variants', () => {
      expect(normalizeVideoCodec('avc')).toBe('H.264')
      expect(normalizeVideoCodec('h264')).toBe('H.264')
      expect(normalizeVideoCodec('x264')).toBe('H.264')
    })

    it('normalizes AV1', () => {
      expect(normalizeVideoCodec('av1')).toBe('AV1')
    })

    it('normalizes VP9', () => {
      expect(normalizeVideoCodec('vp9')).toBe('VP9')
    })

    it('normalizes MPEG-4 variants', () => {
      expect(normalizeVideoCodec('mpeg4')).toBe('MPEG-4')
      expect(normalizeVideoCodec('xvid')).toBe('MPEG-4')
      expect(normalizeVideoCodec('divx')).toBe('MPEG-4')
    })

    it('normalizes MPEG-2', () => {
      expect(normalizeVideoCodec('mpeg2')).toBe('MPEG-2')
    })

    it('normalizes VC-1', () => {
      expect(normalizeVideoCodec('vc1')).toBe('VC-1')
      expect(normalizeVideoCodec('wmv')).toBe('VC-1')
    })

    it('uppercases unknown codecs', () => {
      expect(normalizeVideoCodec('somecodec')).toBe('SOMECODEC')
    })
  })

  // ==========================================================================
  // normalizeAudioCodec
  // ==========================================================================
  describe('normalizeAudioCodec', () => {
    it('returns empty string for null', () => {
      expect(normalizeAudioCodec(null)).toBe('')
    })

    it('handles DTS with profile variants', () => {
      expect(normalizeAudioCodec('dca', 'ma')).toBe('DTS-HD MA')
      expect(normalizeAudioCodec('dca', 'hra')).toBe('DTS-HD')
      expect(normalizeAudioCodec('dca', 'dts:x')).toBe('DTS:X')
      expect(normalizeAudioCodec('dca')).toBe('DTS')
    })

    it('handles dts with profile', () => {
      expect(normalizeAudioCodec('dts', 'dts-hd ma')).toBe('DTS-HD MA')
      expect(normalizeAudioCodec('dts', 'dts-hd hra')).toBe('DTS-HD')
      expect(normalizeAudioCodec('dts', 'dtsx')).toBe('DTS:X')
    })

    it('handles TrueHD', () => {
      expect(normalizeAudioCodec('truehd')).toBe('TrueHD')
    })

    it('handles Atmos', () => {
      expect(normalizeAudioCodec('atmos')).toBe('TrueHD Atmos')
    })

    it('handles DTS-HD MA by string', () => {
      expect(normalizeAudioCodec('dts-hd ma')).toBe('DTS-HD MA')
      expect(normalizeAudioCodec('dtshd_ma')).toBe('DTS-HD MA')
    })

    it('handles E-AC-3', () => {
      expect(normalizeAudioCodec('eac3')).toBe('E-AC-3')
      expect(normalizeAudioCodec('e-ac-3')).toBe('E-AC-3')
      expect(normalizeAudioCodec('ec3')).toBe('E-AC-3')
    })

    it('handles AC-3', () => {
      expect(normalizeAudioCodec('ac3')).toBe('AC-3')
      expect(normalizeAudioCodec('ac-3')).toBe('AC-3')
    })

    it('handles lossless codecs', () => {
      expect(normalizeAudioCodec('flac')).toBe('FLAC')
      expect(normalizeAudioCodec('pcm')).toBe('PCM')
      expect(normalizeAudioCodec('lpcm')).toBe('PCM')
    })

    it('handles lossy codecs', () => {
      expect(normalizeAudioCodec('aac')).toBe('AAC')
      expect(normalizeAudioCodec('mp3')).toBe('MP3')
      expect(normalizeAudioCodec('opus')).toBe('Opus')
      expect(normalizeAudioCodec('vorbis')).toBe('Vorbis')
    })

    it('uppercases unknown codecs', () => {
      expect(normalizeAudioCodec('unknowncodec')).toBe('UNKNOWNCODEC')
    })
  })

  // ==========================================================================
  // convertKodiPathToLocal
  // ==========================================================================
  describe('convertKodiPathToLocal', () => {
    it('returns empty for empty string', () => {
      expect(convertKodiPathToLocal('')).toBe('')
    })

    it('converts SMB URLs to UNC paths', () => {
      expect(convertKodiPathToLocal('smb://server/share/file.mkv'))
        .toBe('\\\\server\\share\\file.mkv')
    })

    it('strips section prefixes before conversion', () => {
      expect(convertKodiPathToLocal('music@smb://server/share/song.flac'))
        .toBe('\\\\server\\share\\song.flac')
      expect(convertKodiPathToLocal('video@smb://nas/movies/movie.mkv'))
        .toBe('\\\\nas\\movies\\movie.mkv')
    })

    it('strips file:// prefix', () => {
      expect(convertKodiPathToLocal('file:///C:/Movies/test.mkv'))
        .toBe('/C:/Movies/test.mkv')
    })

    it('returns local paths as-is', () => {
      expect(convertKodiPathToLocal('C:\\Movies\\test.mkv'))
        .toBe('C:\\Movies\\test.mkv')
      expect(convertKodiPathToLocal('/home/user/movies/test.mkv'))
        .toBe('/home/user/movies/test.mkv')
    })

    it('returns unknown URL schemes as-is', () => {
      expect(convertKodiPathToLocal('ftp://server/file'))
        .toBe('ftp://server/file')
    })
  })

  // ==========================================================================
  // convertKodiImageUrl
  // ==========================================================================
  describe('convertKodiImageUrl', () => {
    it('returns undefined for null/undefined', () => {
      expect(convertKodiImageUrl(null)).toBeUndefined()
      expect(convertKodiImageUrl(undefined)).toBeUndefined()
    })

    it('passes through http/https URLs', () => {
      expect(convertKodiImageUrl('http://example.com/img.jpg')).toBe('http://example.com/img.jpg')
      expect(convertKodiImageUrl('https://example.com/img.jpg')).toBe('https://example.com/img.jpg')
    })

    it('passes through local-artwork URLs', () => {
      expect(convertKodiImageUrl('local-artwork://albums/123.jpg'))
        .toBe('local-artwork://albums/123.jpg')
    })

    it('converts image:// URLs', () => {
      const result = convertKodiImageUrl('image://C%3A%5CMovies%5Cposter.jpg/')
      expect(result).toContain('local-artwork://file?path=')
    })

    it('converts file:// URLs', () => {
      const result = convertKodiImageUrl('file:///C:/Movies/poster.jpg')
      expect(result).toContain('local-artwork://file?path=')
    })

    it('wraps bare paths', () => {
      const result = convertKodiImageUrl('/home/user/poster.jpg')
      expect(result).toContain('local-artwork://file?path=')
    })
  })

  // ==========================================================================
  // buildFilePath
  // ==========================================================================
  describe('buildFilePath', () => {
    it('joins with trailing slash', () => {
      expect(buildFilePath('C:\\Movies\\', 'movie.mkv')).toBe('C:\\Movies\\movie.mkv')
    })

    it('joins with trailing forward slash', () => {
      expect(buildFilePath('/home/movies/', 'movie.mkv')).toBe('/home/movies/movie.mkv')
    })

    it('adds backslash separator for Windows paths', () => {
      expect(buildFilePath('C:\\Movies', 'movie.mkv')).toBe('C:\\Movies\\movie.mkv')
    })

    it('adds forward slash for Unix paths', () => {
      expect(buildFilePath('/home/movies', 'movie.mkv')).toBe('/home/movies/movie.mkv')
    })

    it('converts SMB paths before joining', () => {
      const result = buildFilePath('smb://server/share/', 'movie.mkv')
      expect(result).toBe('\\\\server\\share\\movie.mkv')
    })
  })

  // ==========================================================================
  // estimateBitrate
  // ==========================================================================
  describe('estimateBitrate', () => {
    it('returns 0 for null dimensions', () => {
      expect(estimateBitrate(null, null, null)).toBe(0)
      expect(estimateBitrate(null, 1080, 'hevc')).toBe(0)
    })

    it('estimates 4K HEVC', () => {
      expect(estimateBitrate(3840, 2160, 'hevc')).toBe(18000)
    })

    it('estimates 4K H.264', () => {
      expect(estimateBitrate(3840, 2160, 'h264')).toBe(30000)
    })

    it('estimates 1080p HEVC', () => {
      expect(estimateBitrate(1920, 1080, 'hevc')).toBe(8000)
    })

    it('estimates 1080p H.264', () => {
      expect(estimateBitrate(1920, 1080, 'h264')).toBe(12000)
    })

    it('estimates SD', () => {
      expect(estimateBitrate(640, 480, null)).toBe(3000)
    })
  })
})
