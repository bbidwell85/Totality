/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchJSON = vi.hoisted(() => vi.fn())
const mockFetchWithTimeout = vi.hoisted(() => vi.fn())
const mockGetMediaItems = vi.hoisted(() => vi.fn((): Array<{ id: number; plex_id: string }> => []))
const mockDeleteMediaItem = vi.hoisted(() => vi.fn())
const mockCountMediaItems = vi.hoisted(() => vi.fn(() => 0))
const mockUpdateSourceScanTime = vi.hoisted(() => vi.fn())

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
  isHttpError: vi.fn((e: any) => e && typeof e.status === 'number'),
  HttpError: class HttpError extends Error { status: number; data: any; constructor(s: number, d: any) { super(); this.status = s; this.data = d } },
}))

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
    getMediaItems: mockGetMediaItems,
    upsertMediaItem: vi.fn(),
    deleteMediaItem: mockDeleteMediaItem,
    countMediaItems: mockCountMediaItems,
    updateSourceScanTime: mockUpdateSourceScanTime,
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    getLibraryScan: vi.fn(() => null),
    upsertLibraryScan: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    loadThresholdsFromDatabase: vi.fn(),
    analyzeMediaItem: vi.fn(),
    analyzeVersion: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: vi.fn(() => ({
    analyzeFile: vi.fn(),
    analyzeWithWorker: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    initialize: vi.fn(),
    searchMovie: vi.fn(() => null),
    searchTVShow: vi.fn(() => null),
  })),
}))

vi.mock('../../src/main/services/FileNameParser', () => ({
  getFileNameParser: vi.fn(() => ({
    parse: vi.fn(() => null),
  })),
}))

vi.mock('../../src/main/services/MovieCollectionService', () => ({
  getMovieCollectionService: vi.fn(() => ({
    processCollectionsFromProvider: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/utils/retryWithBackoff', () => ({
  retryWithBackoff: vi.fn((fn: () => any) => fn()),
}))

import { JellyfinProvider } from '@main/providers/jellyfin-emby/JellyfinProvider'

const makeConfig = (overrides: Record<string, any> = {}) => ({
  sourceId: 'test-jf',
  connectionConfig: {
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-api-key',
    accessToken: '',
    userId: 'user-1',
    ...overrides,
  },
})

describe('JellyfinEmbyBase (via JellyfinProvider)', () => {
  let provider: JellyfinProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMediaItems.mockReset().mockReturnValue([])
    mockCountMediaItems.mockReset().mockReturnValue(0)
    provider = new JellyfinProvider(makeConfig())
  })

  describe('scan-safety reconciliation', () => {
    it('reports missing video libraries instead of assuming movie type', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([])
      const result = await provider.scanLibrary('unknown-library')
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Library unknown-library not found')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('rejects partial library pagination before deleting existing media', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'lib-1', type: 'movie' }] as any)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1', Type: 'Movie' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 2 })
      const result = await provider.scanLibrary('lib-1')
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Incomplete jellyfin library inventory')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
      expect(mockUpdateSourceScanTime).not.toHaveBeenCalled()
    })

    it('rejects empty inventories that conflict with stored media', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'lib-1', type: 'movie' }] as any)
      mockFetchJSON.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
      mockGetMediaItems.mockReturnValueOnce([{ id: 1, plex_id: 'stored-1' }])
      const result = await provider.scanLibrary('lib-1')
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('server returned no items while 1 are stored')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('rejects sourceless media without deleting the stored inventory', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'lib-1', type: 'movie' }] as any)
      mockFetchJSON.mockResolvedValueOnce({
        Items: [{ Id: 'film-1', Name: 'No media', Type: 'Movie', MediaSources: [] }],
        TotalRecordCount: 1,
      })
      const result = await provider.scanLibrary('lib-1')
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('No media sources returned for No media')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('rejects truncated deletion inventory pages', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 2 })
      await expect((provider as any).getAllLibraryItemIds('lib-1', 'movie'))
        .rejects.toThrow('Incomplete deletion inventory')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('requests subsequent pages of movies in large BoxSets', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'lib-1', type: 'movie', collectionType: 'boxsets' }] as any)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'box-1', ProviderIds: {} }], TotalRecordCount: 1 })
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'film-2' }], TotalRecordCount: 2 })
      await provider.scanLibrary('lib-1')
      const requests = mockFetchJSON.mock.calls.filter(([url]) => String(url).includes('ParentId=box-1'))
      expect(requests).toHaveLength(2)
      expect(requests[1][0]).toContain('StartIndex=1')
    })

    it('fails an incremental scan when an empty server count conflicts with stored media', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'lib-1', type: 'movie' }] as any)
      mockCountMediaItems.mockReturnValueOnce(1)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
      const result = await provider.scanLibrary('lib-1', { sinceTimestamp: new Date('2026-01-01') })
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('server reported no items while 1 are stored')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })
  })

  describe('music inventory completeness', () => {
    it('continues through short artist and album pages', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'artist-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'artist-2' }], TotalRecordCount: 2 })
      const artists = await provider.getMusicArtists('music-lib')
      expect(artists.map(a => a.Id)).toEqual(['artist-1', 'artist-2'])
      expect(String(mockFetchJSON.mock.calls[1][0])).toContain('StartIndex=1')
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'album-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'album-2' }], TotalRecordCount: 2 })
      const albums = await provider.getMusicAlbums('music-lib')
      expect(albums.map(a => a.Id)).toEqual(['album-1', 'album-2'])
    })

    it('retrieves every track rather than only the first page', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'track-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'track-2' }], TotalRecordCount: 2 })
      const tracks = await provider.getMusicTracks('album-1')
      expect(tracks.map(t => t.Id)).toEqual(['track-1', 'track-2'])
      expect(String(mockFetchJSON.mock.calls[1][0])).toContain('StartIndex=1')
    })

    it('reports failed artists as unsuccessful music scans', async () => {
      vi.spyOn(provider, 'getMusicArtists').mockResolvedValue([{ Id: 'artist-1', Name: 'Artist' }] as any)
      vi.spyOn(provider, 'getMusicAlbums').mockResolvedValue([])
      vi.spyOn(provider, 'convertToMusicArtist').mockImplementation(() => { throw new Error('Invalid artist metadata') })
      const result = await provider.scanMusicLibrary('music-lib')
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Invalid artist metadata')
    })
  })

  // ==========================================================================
  // buildImageUrl (protected — access via any cast)
  // ==========================================================================
  describe('buildImageUrl', () => {
    it('builds correct URL structure', () => {
      const url = (provider as any).buildImageUrl('item-123', 'Primary')
      expect(url).toBe('http://localhost:8096/Items/item-123/Images/Primary?api_key=test-api-key')
    })

    it('includes tag param when provided', () => {
      const url = (provider as any).buildImageUrl('item-123', 'Primary', 'tag-abc')
      expect(url).toContain('tag=tag-abc')
      expect(url).toContain('api_key=test-api-key')
    })

    it('returns empty string for missing serverUrl', () => {
      const p = new JellyfinProvider(makeConfig({ serverUrl: '' }))
      expect((p as any).buildImageUrl('item-123', 'Primary')).toBe('')
    })

    it('returns empty string for missing itemId', () => {
      expect((provider as any).buildImageUrl('', 'Primary')).toBe('')
    })

    it('uses accessToken when apiKey is empty', () => {
      const p = new JellyfinProvider(makeConfig({ apiKey: '', accessToken: 'tok-123' }))
      const url = (p as any).buildImageUrl('item-1', 'Primary')
      expect(url).toContain('api_key=tok-123')
    })
  })

  // ==========================================================================
  // mapLibraryType (protected)
  // ==========================================================================
  describe('mapLibraryType', () => {
    it('maps movies', () => {
      expect((provider as any).mapLibraryType('movies')).toBe('movie')
    })

    it('maps homevideos to movie', () => {
      expect((provider as any).mapLibraryType('homevideos')).toBe('movie')
    })

    it('maps tvshows', () => {
      expect((provider as any).mapLibraryType('tvshows')).toBe('show')
    })

    it('maps music', () => {
      expect((provider as any).mapLibraryType('music')).toBe('music')
    })

    it('returns unknown for undefined', () => {
      expect((provider as any).mapLibraryType(undefined)).toBe('unknown')
    })

    it('returns unknown for unrecognized type', () => {
      expect((provider as any).mapLibraryType('photos')).toBe('unknown')
    })
  })

  // ==========================================================================
  // buildAuthHeader (protected)
  // ==========================================================================
  describe('buildAuthHeader', () => {
    it('includes client name and device', () => {
      const p = new JellyfinProvider(makeConfig({ accessToken: 'tok' }))
      const header = (p as any).buildAuthHeader()
      expect(header).toContain('Client="Totality"')
      expect(header).toContain('Device="Totality"')
    })

    it('includes token when accessToken set', () => {
      const p = new JellyfinProvider(makeConfig({ accessToken: 'tok-abc' }))
      const header = (p as any).buildAuthHeader()
      expect(header).toContain('Token="tok-abc"')
    })

    it('omits token when accessToken empty', () => {
      const header = (provider as any).buildAuthHeader()
      expect(header).not.toContain('Token=')
    })
  })

  // ==========================================================================
  // getAuthHeaders (protected)
  // ==========================================================================
  describe('getAuthHeaders', () => {
    it('uses API key when no access token', () => {
      const headers = (provider as any).getAuthHeaders()
      expect(headers['X-Emby-Token']).toBe('test-api-key')
    })

    it('uses auth header when access token present', () => {
      const p = new JellyfinProvider(makeConfig({ accessToken: 'tok', apiKey: '' }))
      const headers = (p as any).getAuthHeaders()
      expect(headers['Authorization']).toBeDefined()
      expect(headers['X-Emby-Token']).toBeUndefined()
    })
  })

  // ==========================================================================
  // authenticate
  // ==========================================================================
  describe('authenticate', () => {
    it('requires serverUrl', async () => {
      const result = await provider.authenticate({ serverUrl: '' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Server URL')
    })

    it('succeeds with API key', async () => {
      mockFetchJSON.mockResolvedValueOnce({ ServerName: 'Test', Id: 'srv-1' })
      const result = await provider.authenticate({
        serverUrl: 'http://localhost:8096',
        apiKey: 'key-123',
      })
      expect(result.success).toBe(true)
    })
  })

  // ==========================================================================
  // testConnection
  // ==========================================================================
  describe('testConnection', () => {
    it('succeeds when server responds', async () => {
      mockFetchJSON.mockResolvedValueOnce({ ServerName: 'Test', Version: '10.8.0' })
      const result = await provider.testConnection()
      expect(result.success).toBe(true)
      expect(result.serverName).toBe('Test')
    })

    it('fails on network error', async () => {
      mockFetchJSON.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await provider.testConnection()
      expect(result.success).toBe(false)
    })
  })
})
