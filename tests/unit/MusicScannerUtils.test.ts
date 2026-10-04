/**
 * MusicScannerUtils Tests
 *
 * Tests shared music scanning utilities used by all providers:
 * codec detection, hi-res detection, MusicBrainz ID extraction,
 * mood parsing, and album statistics calculation.
 */

import {
  isLosslessCodec,
  isHiRes,
  extractMusicBrainzId,
  guessCodecFromExtension,
  parseKodiMoodString,
  calculateAlbumStats,
  LOSSLESS_CODECS,
} from '../../src/main/providers/base/MusicScannerUtils'
import type { MusicTrack } from '../../src/main/types/database'

describe('MusicScannerUtils', () => {
  describe('isLosslessCodec', () => {
    it('returns true for FLAC', () => {
      expect(isLosslessCodec('flac')).toBe(true)
      expect(isLosslessCodec('FLAC')).toBe(true)
    })

    it('returns true for all lossless codecs', () => {
      for (const codec of LOSSLESS_CODECS) {
        expect(isLosslessCodec(codec)).toBe(true)
      }
    })

    it('returns false for lossy codecs', () => {
      expect(isLosslessCodec('mp3')).toBe(false)
      expect(isLosslessCodec('aac')).toBe(false)
      expect(isLosslessCodec('opus')).toBe(false)
      expect(isLosslessCodec('vorbis')).toBe(false)
    })

    it('returns false for undefined/empty', () => {
      expect(isLosslessCodec(undefined)).toBe(false)
      expect(isLosslessCodec('')).toBe(false)
    })

    it('handles partial matches', () => {
      expect(isLosslessCodec('pcm_s16le')).toBe(true)
      expect(isLosslessCodec('alac_apple')).toBe(true)
    })
  })

  describe('isHiRes', () => {
    it('returns true for high sample rate lossless', () => {
      expect(isHiRes(96000, 16, true)).toBe(true)
      expect(isHiRes(192000, 16, true)).toBe(true)
    })

    it('returns true for high bit depth lossless', () => {
      expect(isHiRes(44100, 24, true)).toBe(true)
      expect(isHiRes(44100, 32, true)).toBe(true)
    })

    it('returns false for CD quality', () => {
      expect(isHiRes(44100, 16, true)).toBe(false)
    })

    it('returns false for lossy regardless of specs', () => {
      expect(isHiRes(192000, 24, false)).toBe(false)
    })

    it('returns false when isLossless undefined', () => {
      expect(isHiRes(96000, 24, undefined)).toBe(false)
    })

    it('handles undefined sample rate and bit depth', () => {
      expect(isHiRes(undefined, undefined, true)).toBe(false)
    })
  })

  describe('extractMusicBrainzId', () => {
    it('extracts UUID from direct value', () => {
      const result = extractMusicBrainzId(
        { MusicBrainzArtist: 'a466c2a2-6517-42fb-a160-1087c3bafd9f' },
        'MusicBrainzArtist'
      )
      expect(result).toBe('a466c2a2-6517-42fb-a160-1087c3bafd9f')
    })

    it('extracts UUID from URL format', () => {
      const result = extractMusicBrainzId(
        { MusicBrainzArtist: 'mbid://a466c2a2-6517-42fb-a160-1087c3bafd9f' },
        'MusicBrainzArtist'
      )
      expect(result).toBe('a466c2a2-6517-42fb-a160-1087c3bafd9f')
    })

    it('tries multiple keys in order', () => {
      const result = extractMusicBrainzId(
        { altKey: 'abc-def', mainKey: 'a466c2a2-6517-42fb-a160-1087c3bafd9f' },
        'missing', 'mainKey'
      )
      expect(result).toBe('a466c2a2-6517-42fb-a160-1087c3bafd9f')
    })

    it('returns undefined when no valid ID found', () => {
      expect(extractMusicBrainzId({ key: 'not-a-uuid' }, 'key')).toBeUndefined()
      expect(extractMusicBrainzId(undefined, 'key')).toBeUndefined()
      expect(extractMusicBrainzId({}, 'missing')).toBeUndefined()
    })
  })

  describe('guessCodecFromExtension', () => {
    it('maps common extensions', () => {
      expect(guessCodecFromExtension('/music/song.flac')).toBe('flac')
      expect(guessCodecFromExtension('/music/song.mp3')).toBe('mp3')
      expect(guessCodecFromExtension('/music/song.m4a')).toBe('aac')
      expect(guessCodecFromExtension('/music/song.ogg')).toBe('vorbis')
      expect(guessCodecFromExtension('/music/song.opus')).toBe('opus')
      expect(guessCodecFromExtension('/music/song.wav')).toBe('pcm')
    })

    it('handles case insensitivity', () => {
      expect(guessCodecFromExtension('/music/song.FLAC')).toBe('flac')
      expect(guessCodecFromExtension('/music/song.MP3')).toBe('mp3')
    })

    it('returns unknown for unrecognized extensions', () => {
      expect(guessCodecFromExtension('/music/song.xyz')).toBe('unknown')
      expect(guessCodecFromExtension('/music/song')).toBe('unknown')
    })

    it('maps hi-res formats', () => {
      expect(guessCodecFromExtension('/music/song.dsf')).toBe('dsd')
      expect(guessCodecFromExtension('/music/song.dff')).toBe('dsd')
      expect(guessCodecFromExtension('/music/song.aiff')).toBe('aiff')
    })
  })

  describe('parseKodiMoodString', () => {
    it('parses slash-separated moods', () => {
      expect(parseKodiMoodString('Happy / Energetic / Upbeat')).toBe(
        JSON.stringify(['Happy', 'Energetic', 'Upbeat'])
      )
    })

    it('handles single mood', () => {
      expect(parseKodiMoodString('Melancholy')).toBe(JSON.stringify(['Melancholy']))
    })

    it('returns undefined for empty/null', () => {
      expect(parseKodiMoodString(null)).toBeUndefined()
      expect(parseKodiMoodString(undefined)).toBeUndefined()
      expect(parseKodiMoodString('')).toBeUndefined()
    })

    it('trims whitespace', () => {
      const result = JSON.parse(parseKodiMoodString('  Happy  /  Sad  ')!)
      expect(result).toEqual(['Happy', 'Sad'])
    })
  })

  describe('calculateAlbumStats', () => {
    const createTrack = (overrides: Partial<MusicTrack> = {}): MusicTrack => ({
      id: 1,
      source_id: 'src1',
      source_type: 'plex',
      provider_id: 'p1',
      title: 'Track',
      artist_name: 'Artist',
      album_name: 'Album',
      audio_codec: 'flac',
      audio_bitrate: 1411,
      duration: 240000,
      file_size: 40000000,
      file_path: '/music/track.flac',
      sample_rate: 44100,
      bit_depth: 16,
      track_number: 1,
      disc_number: 1,
      ...overrides,
    } as MusicTrack)

    it('calculates stats for multiple tracks', () => {
      const tracks = [
        createTrack({ audio_bitrate: 1411, duration: 200000, file_size: 30000000 }),
        createTrack({ audio_bitrate: 320, duration: 180000, file_size: 7000000 }),
      ]

      const stats = calculateAlbumStats(tracks)

      expect(stats.trackCount).toBe(2)
      expect(stats.bestBitrate).toBe(1411)
      expect(stats.avgBitrate).toBe(866) // (1411 + 320) / 2 rounded
      expect(stats.totalDuration).toBe(380000)
      expect(stats.totalSize).toBe(37000000)
    })

    it('handles empty track list', () => {
      const stats = calculateAlbumStats([])

      expect(stats.trackCount).toBe(0)
      expect(stats.bestBitrate).toBe(0)
      expect(stats.avgBitrate).toBe(0)
      expect(stats.totalDuration).toBe(0)
    })

    it('picks best sample rate and bit depth', () => {
      const tracks = [
        createTrack({ sample_rate: 44100, bit_depth: 16 }),
        createTrack({ sample_rate: 96000, bit_depth: 24 }),
      ]

      const stats = calculateAlbumStats(tracks)

      expect(stats.bestSampleRate).toBe(96000)
      expect(stats.bestBitDepth).toBe(24)
    })

    it('picks codec from highest bitrate track', () => {
      const tracks = [
        createTrack({ audio_codec: 'mp3', audio_bitrate: 320 }),
        createTrack({ audio_codec: 'flac', audio_bitrate: 1411 }),
      ]

      const stats = calculateAlbumStats(tracks)

      expect(stats.bestCodec).toBe('flac')
    })
  })
})
