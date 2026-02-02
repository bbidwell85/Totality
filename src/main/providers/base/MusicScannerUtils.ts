/**
 * MusicScannerUtils
 *
 * Shared utilities for music scanning across all providers.
 * Contains codec detection, hi-res detection, and album statistics calculation.
 */

import type { MusicTrack } from '../../types/database'

/**
 * List of lossless audio codecs
 */
export const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'pcm', 'ape', 'wavpack']

/**
 * Check if a codec is lossless
 */
export function isLosslessCodec(codec?: string): boolean {
  if (!codec) return false
  const lowerCodec = codec.toLowerCase()
  return LOSSLESS_CODECS.some(lc => lowerCodec.includes(lc))
}

/**
 * Check if audio is hi-res (sample rate > 44.1kHz or bit depth > 16)
 * Note: Hi-res requires lossless codec
 */
export function isHiRes(sampleRate?: number, bitDepth?: number, isLossless?: boolean): boolean {
  if (!isLossless) return false
  return (sampleRate !== undefined && sampleRate > 44100) ||
         (bitDepth !== undefined && bitDepth > 16)
}

/**
 * Extract MusicBrainz ID from provider-specific ID locations
 */
export function extractMusicBrainzId(
  providerIds: Record<string, string> | undefined,
  ...keys: string[]
): string | undefined {
  if (!providerIds) return undefined

  for (const key of keys) {
    const value = providerIds[key]
    if (value) {
      // Handle URLs like "mbid://..." or "musicbrainz://..."
      if (value.includes('://')) {
        const match = value.match(/([a-f0-9-]{36})/i)
        if (match) return match[1]
      }
      // Return raw value if it looks like a UUID
      if (/^[a-f0-9-]{36}$/i.test(value)) {
        return value
      }
    }
  }

  return undefined
}

/**
 * Album statistics calculated from tracks
 */
export interface AlbumStats {
  bestCodec: string
  bestBitrate: number
  bestSampleRate: number
  bestBitDepth: number
  avgBitrate: number
  totalDuration: number
  totalSize: number
  trackCount: number
}

/**
 * Calculate aggregated album statistics from tracks
 */
export function calculateAlbumStats(tracks: MusicTrack[]): AlbumStats {
  let totalDuration = 0
  let totalSize = 0
  let bestBitrate = 0
  let bestSampleRate = 0
  let bestBitDepth = 0
  let bestCodec = ''
  let totalBitrate = 0

  for (const track of tracks) {
    totalDuration += track.duration || 0
    totalSize += track.file_size || 0

    const bitrate = track.audio_bitrate || 0
    if (bitrate > bestBitrate) {
      bestBitrate = bitrate
      bestCodec = track.audio_codec
    }
    if ((track.sample_rate || 0) > bestSampleRate) {
      bestSampleRate = track.sample_rate || 0
    }
    if ((track.bit_depth || 0) > bestBitDepth) {
      bestBitDepth = track.bit_depth || 0
    }
    totalBitrate += bitrate
  }

  return {
    bestCodec,
    bestBitrate,
    bestSampleRate,
    bestBitDepth,
    avgBitrate: tracks.length > 0 ? Math.round(totalBitrate / tracks.length) : 0,
    totalDuration,
    totalSize,
    trackCount: tracks.length,
  }
}

/**
 * Common provider IDs keys for MusicBrainz across different providers
 */
export const MUSICBRAINZ_ARTIST_KEYS = [
  'MusicBrainzArtist',      // Jellyfin/Emby
  'musicbrainzartistid',    // Kodi
  'MusicBrainzArtistId',    // Alternative casing
]

export const MUSICBRAINZ_ALBUM_KEYS = [
  'MusicBrainzAlbum',       // Jellyfin/Emby
  'MusicBrainzReleaseGroup',// Jellyfin/Emby (release group)
  'musicbrainzalbumid',     // Kodi
  'MusicBrainzAlbumId',     // Alternative casing
]

export const MUSICBRAINZ_TRACK_KEYS = [
  'MusicBrainzTrack',       // Jellyfin/Emby
  'musicbrainztrackid',     // Kodi
  'MusicBrainzTrackId',     // Alternative casing
]
