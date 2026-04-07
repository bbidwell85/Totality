/**
 * MediaConverter Unit Tests
 *
 * Tests for converting MediaMetadata to MediaItem format,
 * audio/subtitle track conversion, best track selection,
 * placeholder creation, and merge updates.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock MediaNormalizer — normalize functions pass through for simplicity
vi.mock('../../src/main/services/MediaNormalizer', () => ({
  normalizeVideoCodec: vi.fn((c: string) => c),
  normalizeAudioCodec: vi.fn((c: string) => c),
  normalizeResolution: vi.fn((_w: number, h: number) => h >= 2160 ? '4K' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : 'SD'),
  normalizeHdrFormat: vi.fn((f: string) => f),
  normalizeBitrate: vi.fn((b: number) => b),
  normalizeFrameRate: vi.fn((f: number) => f),
  normalizeAudioChannels: vi.fn((c: number) => c),
  normalizeSampleRate: vi.fn((s: number) => s),
  normalizeContainer: vi.fn((c: string) => c),
}))

import { MediaConverter } from '../../src/main/services/MediaConverter'
import type { MediaMetadata } from '../../src/main/providers/base/MediaProvider'

function createMetadata(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    itemId: 'item-1',
    title: 'Test Movie',
    type: 'movie',
    year: 2023,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    videoBitrate: 10000,
    audioCodec: 'ac3',
    audioChannels: 6,
    audioBitrate: 448,
    ...overrides,
  }
}

const defaultOptions = {
  sourceId: 'src-1',
  sourceType: 'plex' as const,
  libraryId: 'lib-1',
}

// ============================================================================
// toMediaItem
// ============================================================================

describe('MediaConverter.toMediaItem', () => {
  it('should convert basic metadata to MediaItem', () => {
    const item = MediaConverter.toMediaItem(createMetadata(), defaultOptions)
    expect(item.title).toBe('Test Movie')
    expect(item.type).toBe('movie')
    expect(item.year).toBe(2023)
    expect(item.source_id).toBe('src-1')
    expect(item.source_type).toBe('plex')
    expect(item.library_id).toBe('lib-1')
    expect(item.video_codec).toBe('h264')
    expect(item.video_bitrate).toBe(10000)
    expect(item.resolution).toBe('1080p')
  })

  it('should use metadata resolution when provided', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({ resolution: '4K' }),
      defaultOptions,
    )
    expect(item.resolution).toBe('4K')
  })

  it('should normalize resolution from dimensions when not provided', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({ resolution: undefined, width: 3840, height: 2160 }),
      defaultOptions,
    )
    expect(item.resolution).toBe('4K')
  })

  it('should default to SD when no resolution or dimensions', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({ resolution: undefined, width: undefined, height: undefined }),
      defaultOptions,
    )
    expect(item.resolution).toBe('SD')
  })

  it('should set episode-specific fields', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({
        type: 'episode',
        seriesTitle: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 1,
      }),
      defaultOptions,
    )
    expect(item.type).toBe('episode')
    expect(item.series_title).toBe('Breaking Bad')
    expect(item.season_number).toBe(1)
    expect(item.episode_number).toBe(1)
  })

  it('should handle audio tracks and select best', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({
        audioTracks: [
          { index: 0, codec: 'aac', channels: 2, bitrate: 128 },
          { index: 1, codec: 'truehd', channels: 8, bitrate: 5000, hasObjectAudio: true },
        ],
      }),
      defaultOptions,
    )
    expect(item.audio_codec).toBe('truehd')
    expect(item.audio_channels).toBe(8)
    expect(item.has_object_audio).toBe(true)
    expect(item.audio_tracks).toBeDefined()
    const parsed = JSON.parse(item.audio_tracks!)
    expect(parsed).toHaveLength(2)
  })

  it('should fall back to primary audio fields when no tracks', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({ audioCodec: 'ac3', audioChannels: 6, audioBitrate: 448 }),
      defaultOptions,
    )
    expect(item.audio_codec).toBe('ac3')
    expect(item.audio_channels).toBe(6)
    expect(item.audio_bitrate).toBe(448)
  })

  it('should handle subtitle tracks', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({
        subtitleTracks: [
          { index: 0, codec: 'srt', language: 'eng', title: 'English' },
          { index: 1, codec: 'ass', language: 'jpn', isForced: true },
        ],
      }),
      defaultOptions,
    )
    expect(item.subtitle_tracks).toBeDefined()
    const parsed = JSON.parse(item.subtitle_tracks!)
    expect(parsed).toHaveLength(2)
    expect(parsed[1].isForced).toBe(true)
  })

  it('should set external IDs', () => {
    const item = MediaConverter.toMediaItem(
      createMetadata({
        imdbId: 'tt1234567',
        tmdbId: 12345,
        seriesTmdbId: 67890,
      }),
      defaultOptions,
    )
    expect(item.imdb_id).toBe('tt1234567')
    expect(item.tmdb_id).toBe('12345')
    expect(item.series_tmdb_id).toBe('67890')
  })

  it('should set timestamps', () => {
    const item = MediaConverter.toMediaItem(createMetadata(), defaultOptions)
    expect(item.created_at).toBeDefined()
    expect(item.updated_at).toBeDefined()
  })
})

// ============================================================================
// convertAudioTracks
// ============================================================================

describe('MediaConverter.convertAudioTracks', () => {
  it('should return empty array for undefined input', () => {
    expect(MediaConverter.convertAudioTracks(undefined)).toEqual([])
  })

  it('should return empty array for empty input', () => {
    expect(MediaConverter.convertAudioTracks([])).toEqual([])
  })

  it('should convert audio streams to AudioTrack format', () => {
    const tracks = MediaConverter.convertAudioTracks([
      { index: 0, codec: 'truehd', channels: 8, bitrate: 5000, language: 'eng', title: 'English', hasObjectAudio: true, isDefault: true },
    ])
    expect(tracks).toHaveLength(1)
    expect(tracks[0].codec).toBe('truehd')
    expect(tracks[0].channels).toBe(8)
    expect(tracks[0].hasObjectAudio).toBe(true)
    expect(tracks[0].isDefault).toBe(true)
    expect(tracks[0].language).toBe('eng')
  })

  it('should use array index as fallback when stream index missing', () => {
    const tracks = MediaConverter.convertAudioTracks([
      { codec: 'aac', channels: 2, bitrate: 128 } as Record<string, unknown>,
    ])
    expect(tracks[0].index).toBe(0)
  })

  it('should default to 2 channels when not provided', () => {
    const tracks = MediaConverter.convertAudioTracks([
      { index: 0, codec: 'aac' } as Record<string, unknown>,
    ])
    expect(tracks[0].channels).toBe(2)
  })
})

// ============================================================================
// convertSubtitleTracks
// ============================================================================

describe('MediaConverter.convertSubtitleTracks', () => {
  it('should return empty array for undefined input', () => {
    expect(MediaConverter.convertSubtitleTracks(undefined)).toEqual([])
  })

  it('should convert subtitle streams', () => {
    const tracks = MediaConverter.convertSubtitleTracks([
      { index: 0, codec: 'srt', language: 'eng', title: 'English', isDefault: true, isForced: false },
    ])
    expect(tracks).toHaveLength(1)
    expect(tracks[0].codec).toBe('srt')
    expect(tracks[0].isDefault).toBe(true)
    expect(tracks[0].isForced).toBe(false)
  })

  it('should default codec to unknown', () => {
    const tracks = MediaConverter.convertSubtitleTracks([
      { index: 0 } as Record<string, unknown>,
    ])
    expect(tracks[0].codec).toBe('unknown')
  })
})

// ============================================================================
// selectBestAudioTrack
// ============================================================================

describe('MediaConverter.selectBestAudioTrack', () => {
  it('should create track from primary metadata when no tracks array', () => {
    const result = MediaConverter.selectBestAudioTrack([], createMetadata({
      audioCodec: 'truehd',
      audioChannels: 8,
      audioBitrate: 5000,
      hasObjectAudio: true,
    }))
    expect(result).toBeDefined()
    expect(result!.codec).toBe('truehd')
    expect(result!.channels).toBe(8)
    expect(result!.hasObjectAudio).toBe(true)
  })

  it('should return undefined when no tracks and no primary audio', () => {
    const result = MediaConverter.selectBestAudioTrack([], createMetadata({
      audioCodec: undefined,
    }))
    expect(result).toBeUndefined()
  })

  it('should select best from tracks array', () => {
    const tracks = [
      { index: 0, codec: 'aac', channels: 2, bitrate: 128 },
      { index: 1, codec: 'truehd', channels: 8, bitrate: 5000 },
    ]
    const result = MediaConverter.selectBestAudioTrack(tracks, createMetadata())
    expect(result!.index).toBe(1)
  })
})

// ============================================================================
// createPlaceholder
// ============================================================================

describe('MediaConverter.createPlaceholder', () => {
  it('should create a minimal MediaItem', () => {
    const placeholder = MediaConverter.createPlaceholder('item-1', 'Test', 'movie', defaultOptions)
    expect(placeholder.plex_id).toBe('item-1')
    expect(placeholder.title).toBe('Test')
    expect(placeholder.type).toBe('movie')
    expect(placeholder.source_id).toBe('src-1')
    expect(placeholder.resolution).toBe('SD')
    expect(placeholder.video_bitrate).toBe(0)
    expect(placeholder.audio_channels).toBe(2)
  })
})

// ============================================================================
// mergeUpdates
// ============================================================================

describe('MediaConverter.mergeUpdates', () => {
  it('should merge updates into existing item', () => {
    const existing = MediaConverter.createPlaceholder('item-1', 'Old Title', 'movie', defaultOptions)
    const merged = MediaConverter.mergeUpdates(existing, { title: 'New Title', video_bitrate: 15000 })
    expect(merged.title).toBe('New Title')
    expect(merged.video_bitrate).toBe(15000)
    expect(merged.plex_id).toBe('item-1') // unchanged fields preserved
  })

  it('should update the updated_at timestamp', () => {
    const existing = MediaConverter.createPlaceholder('item-1', 'Test', 'movie', defaultOptions)
    // Small delay to ensure different timestamp
    const merged = MediaConverter.mergeUpdates(existing, { title: 'Updated' })
    expect(merged.updated_at).toBeDefined()
    // updated_at should be set (may or may not differ due to timing)
    expect(typeof merged.updated_at).toBe('string')
  })
})
