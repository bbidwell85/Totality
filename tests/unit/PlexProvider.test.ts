/**
 * PlexProvider Unit Tests
 *
 * Tests high-priority logic: bitrate validation, data conversion,
 * authentication, cancellation, and deletion safety guards.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.hoisted ensures mocks are defined before vi.mock() runs
const mockFetchJSON = vi.hoisted(() => vi.fn())
const mockFetchWithTimeout = vi.hoisted(() => vi.fn())
const mockGetMediaItems = vi.hoisted(() => vi.fn())
const mockDeleteMediaItem = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/services/utils/httpClient', () => ({
  fetchJSON: mockFetchJSON,
  fetchWithTimeout: mockFetchWithTimeout,
  buildUrl: (base: string, params?: Record<string, unknown>) => {
    if (!params) return base
    const qs = Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `${base}?${qs}` : base
  },
}))

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getMediaItems: mockGetMediaItems,
    deleteMediaItem: mockDeleteMediaItem,
  })),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    loadThresholdsFromDatabase: vi.fn(),
    analyzeMediaItem: vi.fn(),
    analyzeVersion: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/FileNameParser', () => ({
  getFileNameParser: vi.fn(() => ({
    parse: vi.fn(() => null),
  })),
}))

vi.mock('../../src/main/services/utils/errorUtils', () => ({
  getErrorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
}))

import { PlexProvider } from '../../src/main/providers/plex/PlexProvider'
import { scoreVersion } from '../../src/main/providers/utils/ProviderUtils'
import type { PlexMediaItem, PlexMusicArtist, PlexMusicAlbum, PlexMusicTrack, PlexServer } from '../../src/main/types/plex'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_SERVER: PlexServer = {
  name: 'Test Server',
  host: '192.168.1.100',
  port: 32400,
  machineIdentifier: 'abc123',
  version: '1.32.0',
  scheme: 'http',
  address: '192.168.1.100',
  uri: 'http://192.168.1.100:32400',
  owned: true,
  accessToken: 'test-token-123',
}

function makeMovieItem(overrides: Partial<PlexMediaItem> = {}): PlexMediaItem {
  return {
    ratingKey: '12345',
    key: '/library/metadata/12345',
    guid: 'plex://movie/abc',
    type: 'movie',
    title: 'Test Movie',
    year: 2024,
    duration: 7200000,
    addedAt: 1700000000,
    updatedAt: 1700100000,
    viewCount: 3,
    lastViewedAt: 1700050000,
    Media: [{
      id: 1,
      duration: 7200000,
      bitrate: 15000,
      width: 1920,
      height: 1080,
      aspectRatio: 1.78,
      audioChannels: 6,
      audioCodec: 'eac3',
      videoCodec: 'hevc',
      videoResolution: '1080',
      container: 'mkv',
      videoFrameRate: '24p',
      Part: [{
        id: 1,
        key: '/library/parts/1',
        duration: 7200000,
        file: '/movies/Test Movie (2024)/Test.Movie.2024.1080p.mkv',
        size: 5000000000,
        container: 'mkv',
        Stream: [
          {
            id: 1, streamType: 1, codec: 'hevc', index: 0,
            bitrate: 12000, width: 1920, height: 1080,
            frameRate: 23.976, bitDepth: 10,
            colorTrc: 'smpte2084', colorPrimaries: 'bt2020',
            colorSpace: 'bt2020nc', profile: 'main 10',
          },
          {
            id: 2, streamType: 2, codec: 'eac3', index: 1,
            bitrate: 640, channels: 6,
            audioChannelLayout: '5.1(side)',
            samplingRate: 48000,
            language: 'English', languageCode: 'eng',
          },
        ],
      }],
    }],
    Guid: [
      { id: 'imdb://tt1234567' },
      { id: 'tmdb://12345' },
    ],
    ...overrides,
  } as PlexMediaItem
}

function makeMusicTrack(overrides: Partial<PlexMusicTrack> = {}): PlexMusicTrack {
  return {
    ratingKey: '99999',
    key: '/library/metadata/99999',
    guid: 'plex://track/xyz',
    type: 'track',
    title: 'Test Track',
    parentTitle: 'Test Album',
    grandparentTitle: 'Test Artist',
    index: 1,
    parentIndex: 1,
    duration: 240000,
    addedAt: 1700000000,
    updatedAt: 1700100000,
    Media: [{
      id: 1,
      duration: 240000,
      bitrate: 1411,
      audioChannels: 2,
      audioCodec: 'flac',
      container: 'flac',
      Part: [{
        id: 1,
        key: '/library/parts/1',
        duration: 240000,
        file: '/music/Artist/Album/01 - Track.flac',
        size: 42000000,
        container: 'flac',
        Stream: [{
          id: 1, streamType: 2, codec: 'flac', index: 0,
          samplingRate: 96000, bitDepth: 24,
        }],
      }],
    }],
    Guid: [{ id: 'mbid://abc-def-123' }],
    Mood: [{ tag: 'Melancholy' }, { tag: 'Chill' }],
    ...overrides,
  } as PlexMusicTrack
}

function createProvider(token?: string): PlexProvider {
  const provider = new PlexProvider({
    sourceId: 'test-source-1',
    connectionConfig: token ? { token } : {},
  })
  return provider
}

function createProviderWithServer(token = 'test-token'): PlexProvider {
  const provider = createProvider(token)
  provider.setSelectedServer(TEST_SERVER)
  return provider
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlexProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ========================================================================
  // Constructor & Getters/Setters
  // ========================================================================

  describe('constructor', () => {
    it('uses provided sourceId', () => {
      const provider = new PlexProvider({ sourceId: 'my-source', connectionConfig: {} })
      expect(provider.sourceId).toBe('my-source')
    })

    it('loads authToken from connectionConfig', () => {
      const provider = createProvider('my-token')
      expect(provider.getAuthToken()).toBe('my-token')
    })

    it('generates sourceId when not provided', () => {
      const provider = new PlexProvider({ connectionConfig: {} } as any)
      expect(provider.sourceId).toMatch(/^plex_/)
    })
  })

  // ========================================================================
  // Authentication
  // ========================================================================

  describe('authentication', () => {
    it('requestAuthPin calls Plex API and returns pin', async () => {
      const mockPin = { id: 123, code: 'ABCD', authToken: null }
      mockFetchJSON.mockResolvedValue(mockPin)

      const provider = createProvider()
      const pin = await provider.requestAuthPin()

      expect(pin).toEqual(mockPin)
      expect(mockFetchJSON).toHaveBeenCalledWith(
        expect.stringContaining('pins'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('checkAuthPin returns token when auth completes', async () => {
      mockFetchJSON.mockResolvedValue({ id: 123, authToken: 'new-token' })

      const provider = createProvider()
      const token = await provider.checkAuthPin(123)

      expect(token).toBe('new-token')
      expect(provider.getAuthToken()).toBe('new-token')
    })

    it('checkAuthPin returns null when auth is pending', async () => {
      mockFetchJSON.mockResolvedValue({ id: 123, authToken: null })

      const provider = createProvider()
      const token = await provider.checkAuthPin(123)

      expect(token).toBeNull()
    })

    it('authenticate returns success with valid token', async () => {
      mockFetchJSON.mockResolvedValue({ username: 'testuser' })

      const provider = createProvider()
      const result = await provider.authenticate({ token: 'valid-token' })

      expect(result.success).toBe(true)
      expect(result.token).toBe('valid-token')
      expect(result.userName).toBe('testuser')
    })

    it('authenticate returns failure without token', async () => {
      const provider = createProvider()
      const result = await provider.authenticate({})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('isAuthenticated returns true when token is set', async () => {
      const provider = createProvider('my-token')
      expect(await provider.isAuthenticated()).toBe(true)
    })

    it('disconnect clears token and server', async () => {
      const provider = createProviderWithServer()
      await provider.disconnect()

      expect(provider.getAuthToken()).toBeNull()
      expect(provider.getSelectedServer()).toBeNull()
    })
  })

  // ========================================================================
  // getReliableVideoBitrate (tested through convertToMediaMetadata)
  // ========================================================================

  describe('video bitrate validation (via convertToMediaMetadata)', () => {
    it('uses stream bitrate when >= 30% of container bitrate', () => {
      const item = makeMovieItem({
        Media: [{
          ...makeMovieItem().Media![0],
          bitrate: 15000, // container
          Part: [{
            ...makeMovieItem().Media![0].Part![0],
            Stream: [
              { id: 1, streamType: 1, codec: 'hevc', index: 0, bitrate: 12000 }, // 80% of container — valid
              { id: 2, streamType: 2, codec: 'eac3', index: 1, bitrate: 640 },
            ],
          }],
        }],
      })

      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(item)

      // Stream bitrate 12000 is >= 30% of 15000, so should use stream bitrate
      // After normalizeBitrate(12000, 'kbps') it stays 12000
      expect(metadata.videoBitrate).toBe(12000)
    })

    it('uses stream bitrate when no container bitrate available', () => {
      const item = makeMovieItem({
        Media: [{
          ...makeMovieItem().Media![0],
          bitrate: 0, // no container bitrate
          Part: [{
            ...makeMovieItem().Media![0].Part![0],
            Stream: [
              { id: 1, streamType: 1, codec: 'hevc', index: 0, bitrate: 8000 },
              { id: 2, streamType: 2, codec: 'aac', index: 1, bitrate: 128 },
            ],
          }],
        }],
      })

      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(item)

      expect(metadata.videoBitrate).toBe(8000)
    })

    it('falls back to calculated bitrate when stream is unreliably low', () => {
      const item = makeMovieItem({
        Media: [{
          ...makeMovieItem().Media![0],
          bitrate: 20000, // container
          Part: [{
            ...makeMovieItem().Media![0].Part![0],
            Stream: [
              { id: 1, streamType: 1, codec: 'hevc', index: 0, bitrate: 500 }, // only 2.5% of container — too low
              { id: 2, streamType: 2, codec: 'eac3', index: 1, bitrate: 640 },
            ],
          }],
        }],
      })

      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(item)

      // Should fall back to calculated: 20000 - 640 = 19360
      expect(metadata.videoBitrate).toBe(19360)
    })

    it('falls back to container bitrate when calculated is 0', () => {
      const item = makeMovieItem({
        Media: [{
          ...makeMovieItem().Media![0],
          bitrate: 5000,
          Part: [{
            ...makeMovieItem().Media![0].Part![0],
            Stream: [
              { id: 1, streamType: 1, codec: 'h264', index: 0, bitrate: 100 }, // too low (2%)
              { id: 2, streamType: 2, codec: 'aac', index: 1, bitrate: 6000 }, // audio > container
            ],
          }],
        }],
      })

      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(item)

      // calculated = max(0, 5000 - 6000) = 0, so falls back to container = 5000
      expect(metadata.videoBitrate).toBe(5000)
    })
  })

  // ========================================================================
  // convertToMediaMetadata
  // ========================================================================

  describe('convertToMediaMetadata', () => {
    it('converts movie with full media data', () => {
      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(makeMovieItem())

      expect(metadata.title).toBe('Test Movie')
      expect(metadata.year).toBe(2024)
      expect(metadata.type).toBe('movie')
      expect(metadata.itemId).toBe('12345')
      expect(metadata.providerType).toBe('plex')
      expect(metadata.width).toBe(1920)
      expect(metadata.height).toBe(1080)
      expect(metadata.container).toBe('MKV')
      expect(metadata.filePath).toBe('/movies/Test Movie (2024)/Test.Movie.2024.1080p.mkv')
    })

    it('extracts IMDB and TMDB IDs from Guid array', () => {
      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(makeMovieItem())

      expect(metadata.imdbId).toBe('tt1234567')
      expect(metadata.tmdbId).toBe(12345)
    })

    it('handles item with no Guid gracefully', () => {
      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(makeMovieItem({ Guid: undefined }))

      expect(metadata.imdbId).toBeUndefined()
      expect(metadata.tmdbId).toBeUndefined()
    })

    it('builds poster URL with server URI and token', () => {
      const provider = createProviderWithServer()
      const metadata = (provider as any).convertToMediaMetadata(makeMovieItem({ thumb: '/library/metadata/12345/thumb/1700000000' }))

      expect(metadata.posterUrl).toContain('http://192.168.1.100:32400')
      expect(metadata.posterUrl).toContain('X-Plex-Token=test-token-123')
    })
  })

  // ========================================================================
  // convertToMediaItem
  // ========================================================================

  describe('convertToMediaItem', () => {
    it('returns null when no Media entries', () => {
      const provider = createProviderWithServer()
      const result = (provider as any).convertToMediaItem(makeMovieItem({ Media: [] }))

      expect(result).toBeNull()
    })

    it('converts movie with single version', () => {
      const provider = createProviderWithServer()
      const result = (provider as any).convertToMediaItem(makeMovieItem())

      expect(result).not.toBeNull()
      expect(result.mediaItem.title).toBe('Test Movie')
      expect(result.mediaItem.plex_id).toBe('12345')
      expect(result.mediaItem.year).toBe(2024)
      expect(result.mediaItem.imdb_id).toBe('tt1234567')
      expect(result.mediaItem.tmdb_id).toBe('12345')
      expect(result.versions).toHaveLength(1)
    })

    it('picks best version from multiple Media entries', () => {
      const item = makeMovieItem({
        Media: [
          {
            id: 1, duration: 7200000, bitrate: 5000,
            width: 1920, height: 1080, aspectRatio: 1.78,
            audioChannels: 2, audioCodec: 'aac', videoCodec: 'h264',
            videoResolution: '1080', container: 'mp4', videoFrameRate: '24p',
            Part: [{
              id: 1, key: '/parts/1', duration: 7200000,
              file: '/movies/test_1080p.mp4', size: 2000000000, container: 'mp4',
              Stream: [
                { id: 1, streamType: 1, codec: 'h264', index: 0, bitrate: 4500 },
                { id: 2, streamType: 2, codec: 'aac', index: 1, bitrate: 256, channels: 2, audioChannelLayout: 'stereo', samplingRate: 48000 },
              ],
            }],
          },
          {
            id: 2, duration: 7200000, bitrate: 40000,
            width: 3840, height: 2160, aspectRatio: 1.78,
            audioChannels: 8, audioCodec: 'truehd', videoCodec: 'hevc',
            videoResolution: '4k', container: 'mkv', videoFrameRate: '24p',
            Part: [{
              id: 2, key: '/parts/2', duration: 7200000,
              file: '/movies/test_4k.mkv', size: 50000000000, container: 'mkv',
              Stream: [
                { id: 3, streamType: 1, codec: 'hevc', index: 0, bitrate: 35000, bitDepth: 10, colorTrc: 'smpte2084', colorPrimaries: 'bt2020', profile: 'main 10' },
                { id: 4, streamType: 2, codec: 'truehd', index: 1, bitrate: 4000, channels: 8, audioChannelLayout: '7.1', samplingRate: 48000 },
              ],
            }],
          },
        ],
      })

      const provider = createProviderWithServer()
      const result = (provider as any).convertToMediaItem(item)

      expect(result.versions).toHaveLength(2)
      expect(result.mediaItem.version_count).toBe(2)
      // Best version should be the 4K one (higher tier)
      expect(result.mediaItem.resolution).toBe('4K')
    })

    it('sets play_count and last_watched_at from Plex data', () => {
      const provider = createProviderWithServer()
      const result = (provider as any).convertToMediaItem(makeMovieItem())

      expect(result.mediaItem.play_count).toBe(3)
      expect(result.mediaItem.last_watched_at).toBeDefined()
    })

    it('sets created_at from addedAt timestamp', () => {
      const provider = createProviderWithServer()
      const result = (provider as any).convertToMediaItem(makeMovieItem())

      // addedAt: 1700000000 → 2023-11-14T22:13:20.000Z
      expect(result.mediaItem.created_at).toContain('2023')
    })
  })

  // ========================================================================
  // scoreVersion
  // ========================================================================

  // scoreVersion tests are in ProviderUtils.test.ts (shared function)
  // Here we verify it's correctly wired into convertToMediaItem

  describe('scoreVersion integration', () => {
    it('picks 4K version over 1080p in multi-version item', () => {
      // This was a bug — scoreVersion checked includes('2160') but normalizeResolution returns '4K'
      const uhd = scoreVersion({ resolution: '4K', video_bitrate: 30000, hdr_format: 'None' })
      const fhd = scoreVersion({ resolution: '1080p', video_bitrate: 30000, hdr_format: 'None' })

      expect(uhd).toBeGreaterThan(fhd)
    })
  })

  // ========================================================================
  // Music Converters
  // ========================================================================

  describe('convertToMusicArtist', () => {
    it('extracts MusicBrainz ID, genres, and country', () => {
      const artist: PlexMusicArtist = {
        ratingKey: '500', key: '/library/metadata/500', guid: 'plex://artist/abc',
        type: 'artist', title: 'Radiohead', addedAt: 1700000000, updatedAt: 1700100000,
        summary: 'English rock band',
        Guid: [{ id: 'mbid://a74b1b7f-71a5-4011-9441-d0b5e4122711' }],
        Genre: [{ tag: 'Alternative Rock' }, { tag: 'Art Rock' }],
        Country: [{ tag: 'United Kingdom' }],
      }

      const provider = createProviderWithServer()
      const result = provider.convertToMusicArtist(artist, 'lib-1')

      expect(result.name).toBe('Radiohead')
      expect(result.musicbrainz_id).toBe('a74b1b7f-71a5-4011-9441-d0b5e4122711')
      expect(JSON.parse(result.genres!)).toEqual(['Alternative Rock', 'Art Rock'])
      expect(result.country).toBe('United Kingdom')
      expect(result.source_type).toBe('plex')
      expect(result.library_id).toBe('lib-1')
      expect(result.biography).toBe('English rock band')
    })

    it('handles artist without external IDs or genres', () => {
      const artist: PlexMusicArtist = {
        ratingKey: '501', key: '/library/metadata/501', guid: 'plex://artist/def',
        type: 'artist', title: 'Unknown Artist', addedAt: 1700000000, updatedAt: 1700100000,
      }

      const provider = createProviderWithServer()
      const result = provider.convertToMusicArtist(artist)

      expect(result.musicbrainz_id).toBeUndefined()
      expect(JSON.parse(result.genres!)).toEqual([])
      expect(result.country).toBeUndefined()
    })
  })

  describe('convertToMusicAlbum', () => {
    it('maps all fields including release_date and studio', () => {
      const album: PlexMusicAlbum = {
        ratingKey: '600', key: '/library/metadata/600', guid: 'plex://album/abc',
        type: 'album', title: 'OK Computer', year: 1997,
        parentTitle: 'Radiohead', studio: 'Parlophone',
        addedAt: 1700000000, updatedAt: 1700100000,
        originallyAvailableAt: '1997-06-16',
        Guid: [{ id: 'mbid://b1392450-e0dc-4d8c-8b61-4f6e5e5f5143' }],
        Genre: [{ tag: 'Alternative Rock' }],
      }

      const provider = createProviderWithServer()
      const result = provider.convertToMusicAlbum(album, 42, 'lib-1')

      expect(result.title).toBe('OK Computer')
      expect(result.year).toBe(1997)
      expect(result.artist_id).toBe(42)
      expect(result.artist_name).toBe('Radiohead')
      expect(result.musicbrainz_id).toBe('b1392450-e0dc-4d8c-8b61-4f6e5e5f5143')
      expect(result.studio).toBe('Parlophone')
      expect(result.release_date).toBe('1997-06-16')
      expect(result.library_id).toBe('lib-1')
    })
  })

  describe('convertToMusicTrack', () => {
    it('detects lossless hi-res track', () => {
      const provider = createProviderWithServer()
      const result = provider.convertToMusicTrack(makeMusicTrack())

      expect(result).not.toBeNull()
      expect(result!.is_lossless).toBe(true)
      expect(result!.is_hi_res).toBe(true) // 96kHz > 44100
      expect(result!.audio_codec).toBe('flac')
      expect(result!.sample_rate).toBe(96000)
      expect(result!.bit_depth).toBe(24)
      expect(result!.musicbrainz_id).toBe('abc-def-123')
    })

    it('detects lossy non-hi-res track', () => {
      const track = makeMusicTrack({
        Media: [{
          id: 1, duration: 240000, bitrate: 320,
          audioChannels: 2, audioCodec: 'mp3', container: 'mp3',
          Part: [{
            id: 1, key: '/parts/1', duration: 240000,
            file: '/music/track.mp3', size: 8000000, container: 'mp3',
            Stream: [{ id: 1, streamType: 2, codec: 'mp3', index: 0, samplingRate: 44100, bitDepth: 16 }],
          }],
        }],
      })

      const provider = createProviderWithServer()
      const result = provider.convertToMusicTrack(track)

      expect(result!.is_lossless).toBe(false)
      expect(result!.is_hi_res).toBe(false)
    })

    it('returns null when no Media data', () => {
      const provider = createProviderWithServer()
      const result = provider.convertToMusicTrack(makeMusicTrack({ Media: undefined }))

      expect(result).toBeNull()
    })

    it('extracts mood tags', () => {
      const provider = createProviderWithServer()
      const result = provider.convertToMusicTrack(makeMusicTrack())

      expect(result!.mood).toBe(JSON.stringify(['Melancholy', 'Chill']))
    })
  })

  // ========================================================================
  // removeStaleItems (safety guard)
  // ========================================================================

  describe('removeStaleItems', () => {
    it('refuses deletion when Plex returns 0 IDs but DB has items', async () => {
      mockGetMediaItems.mockReturnValue([
        { id: 1, plex_id: '100', title: 'Movie A' },
        { id: 2, plex_id: '200', title: 'Movie B' },
      ])

      const provider = createProviderWithServer()
      const removed = await (provider as any).removeStaleItems(
        new Set<string>(), // empty — simulates Plex API failure
        'movie',
        'lib-1'
      )

      expect(removed).toBe(0)
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('deletes items not in valid ID set', async () => {
      mockGetMediaItems.mockReturnValue([
        { id: 1, plex_id: '100', title: 'Movie A' },
        { id: 2, plex_id: '200', title: 'Movie B' },
        { id: 3, plex_id: '300', title: 'Movie C' },
      ])

      const provider = createProviderWithServer()
      const validIds = new Set(['100', '300']) // '200' was deleted from Plex
      const removed = await (provider as any).removeStaleItems(validIds, 'movie', 'lib-1')

      expect(removed).toBe(1)
      expect(mockDeleteMediaItem).toHaveBeenCalledWith(2)
    })
  })

  // ========================================================================
  // Cancellation
  // ========================================================================

  describe('cancellation', () => {
    it('cancelScan sets flag and isScanCancelled returns true', () => {
      const provider = createProvider()

      expect(provider.isScanCancelled()).toBe(false)
      provider.cancelScan()
      expect(provider.isScanCancelled()).toBe(true)
    })

    it('cancelMusicScan sets flag independently', () => {
      const provider = createProvider()

      provider.cancelMusicScan()
      expect(provider.isMusicScanCancelled()).toBe(true)
      expect(provider.isScanCancelled()).toBe(false) // video scan unaffected
    })
  })

  // ========================================================================
  // Server selection helpers
  // ========================================================================

  describe('server state', () => {
    it('hasSelectedServer returns false initially', () => {
      const provider = createProvider()
      expect(provider.hasSelectedServer()).toBe(false)
    })

    it('setSelectedServer makes hasSelectedServer return true', () => {
      const provider = createProvider()
      provider.setSelectedServer(TEST_SERVER)
      expect(provider.hasSelectedServer()).toBe(true)
      expect(provider.getSelectedServer()?.name).toBe('Test Server')
    })
  })

  // ========================================================================
  // testConnection
  // ========================================================================

  describe('testConnection', () => {
    it('returns failure when no server selected', async () => {
      const provider = createProvider()
      const result = await provider.testConnection()

      expect(result.success).toBe(false)
      expect(result.error).toBe('No server selected')
    })

    it('returns success with latency on valid connection', async () => {
      mockFetchJSON.mockResolvedValue({
        MediaContainer: { friendlyName: 'My Plex', version: '1.40.0' },
      })

      const provider = createProviderWithServer()
      const result = await provider.testConnection()

      expect(result.success).toBe(true)
      expect(result.serverName).toBe('My Plex')
      expect(result.serverVersion).toBe('1.40.0')
      expect(result.latencyMs).toBeDefined()
    })
  })

  // ========================================================================
  // getLibraries
  // ========================================================================

  describe('getLibraries', () => {
    it('throws when no server selected', async () => {
      const provider = createProvider()
      await expect(provider.getLibraries()).rejects.toThrow('No server selected')
    })

    it('maps Plex library types correctly', async () => {
      mockFetchJSON.mockResolvedValue({
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Movies', type: 'movie', count: 500 },
            { key: '2', title: 'TV Shows', type: 'show', count: 100 },
            { key: '3', title: 'Music', type: 'artist', count: 200 },
          ],
        },
      })

      const provider = createProviderWithServer()
      const libraries = await provider.getLibraries()

      expect(libraries).toHaveLength(3)
      expect(libraries[0]).toEqual(expect.objectContaining({ id: '1', name: 'Movies', type: 'movie' }))
      expect(libraries[1]).toEqual(expect.objectContaining({ id: '2', name: 'TV Shows', type: 'show' }))
      expect(libraries[2]).toEqual(expect.objectContaining({ id: '3', name: 'Music', type: 'music' }))
    })
  })
})
