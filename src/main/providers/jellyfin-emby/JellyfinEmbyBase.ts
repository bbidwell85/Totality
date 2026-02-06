import { getErrorMessage, isAxiosError, isNodeError } from '../../services/utils/errorUtils'
/**
 * JellyfinEmbyBase
 *
 * Shared base class for Jellyfin and Emby providers.
 * Both servers share a very similar API since Jellyfin forked from Emby.
 */

import axios, { AxiosInstance } from 'axios'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import {
  normalizeVideoCodec,
  normalizeAudioCodec,
  normalizeResolution,
  normalizeHdrFormat,
  normalizeBitrate,
  normalizeFrameRate,
  normalizeAudioChannels,
  normalizeSampleRate,
  normalizeContainer,
  hasObjectAudio,
} from '../../services/MediaNormalizer'
import { selectBestAudioTrack } from '../utils/ProviderUtils'
import type {
  MediaProvider,
  ProviderType,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  SourceConfig,
} from '../base/MediaProvider'
import type { MediaItem, AudioTrack, MusicArtist, MusicAlbum, MusicTrack } from '../../types/database'
import {
  isLosslessCodec,
  isHiRes,
  extractMusicBrainzId,
  calculateAlbumStats,
  MUSICBRAINZ_ARTIST_KEYS,
  MUSICBRAINZ_ALBUM_KEYS,
  MUSICBRAINZ_TRACK_KEYS,
} from '../base/MusicScannerUtils'
import { getMediaFileAnalyzer } from '../../services/MediaFileAnalyzer'
import * as fs from 'fs'

// Jellyfin/Emby API response types
export interface JellyfinAuthResponse {
  User: {
    Id: string
    Name: string
    ServerId: string
  }
  AccessToken: string
  ServerId: string
}

export interface JellyfinLibrary {
  Id: string
  Name: string
  CollectionType?: string
  ItemCount?: number
  // VirtualFolders uses ItemId instead of Id
  ItemId?: string
}

export interface JellyfinMediaItem {
  Id: string
  Name: string
  Type: string
  ProductionYear?: number
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  Path?: string
  MediaSources?: JellyfinMediaSource[]
  ProviderIds?: {
    Imdb?: string
    Tmdb?: string
  }
  ImageTags?: {
    Primary?: string
    Thumb?: string
    Screenshot?: string
  }
  // For episodes: parent/grandparent references
  SeriesId?: string
  SeasonId?: string
  SeriesPrimaryImageTag?: string // Show poster tag
  ParentPrimaryImageTag?: string // Season poster tag
  ParentPrimaryImageItemId?: string // Season ID for primary image
  ParentThumbItemId?: string // ID for thumb image (usually episode thumb)
  ParentThumbImageTag?: string // Thumb tag
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  // Series-level provider IDs (fetched separately for episodes)
  SeriesProviderIds?: {
    Imdb?: string
    Tmdb?: string
  }
  // Date metadata
  DateCreated?: string
  PremiereDate?: string
}

export interface JellyfinMediaSource {
  Id: string
  Path?: string
  Size?: number
  Container?: string
  RunTimeTicks?: number
  Bitrate?: number
  MediaStreams?: JellyfinMediaStream[]
}

export interface JellyfinMediaStream {
  Type: 'Video' | 'Audio' | 'Subtitle'
  Index: number
  Codec?: string
  CodecTag?: string
  Language?: string
  Title?: string
  DisplayTitle?: string
  IsDefault?: boolean
  // Video properties
  Width?: number
  Height?: number
  BitRate?: number
  RealFrameRate?: number
  BitDepth?: number
  VideoRange?: string
  ColorSpace?: string
  Profile?: string
  Level?: number
  // Audio properties
  Channels?: number
  SampleRate?: number
  ChannelLayout?: string
}

// Music-specific types for Jellyfin/Emby
export interface JellyfinMusicArtist {
  Id: string
  Name: string
  Overview?: string
  ProviderIds?: Record<string, string>
  ImageTags?: { Primary?: string; Thumb?: string }
  PrimaryImageTag?: string  // Direct field for primary image
  Genres?: string[]
  SortName?: string
}

export interface JellyfinMusicAlbum {
  Id: string
  Name: string
  AlbumArtists?: Array<{ Id: string; Name: string }>
  AlbumArtist?: string
  Artists?: string[]
  ProductionYear?: number
  ProviderIds?: Record<string, string>
  ImageTags?: { Primary?: string; Thumb?: string }
  PrimaryImageTag?: string  // Direct field for primary image
  PrimaryImageAspectRatio?: number
  Genres?: string[]
  ChildCount?: number
  RunTimeTicks?: number
}

export interface JellyfinMusicTrack {
  Id: string
  Name: string
  AlbumId?: string
  Album?: string
  AlbumArtist?: string
  Artists?: string[]
  ArtistItems?: Array<{ Id: string; Name: string }>
  IndexNumber?: number      // Track number
  ParentIndexNumber?: number // Disc number
  RunTimeTicks?: number     // Duration in ticks (divide by 10,000,000 for seconds)
  MediaSources?: JellyfinMediaSource[]
  Path?: string
  ProviderIds?: Record<string, string>
  ImageTags?: { Primary?: string; Thumb?: string }
  PrimaryImageTag?: string
}

export abstract class JellyfinEmbyBase implements MediaProvider {
  abstract readonly providerType: ProviderType
  readonly sourceId: string

  protected serverUrl: string = ''
  protected apiKey: string = ''
  protected userId: string = ''
  protected accessToken: string = ''
  protected api: AxiosInstance
  protected config: SourceConfig

  // Cancellation support
  protected scanCancelled = false
  protected musicScanCancelled = false

  // Subclasses must define their auth header name
  protected abstract authHeaderName: string
  protected abstract clientName: string
  protected abstract clientVersion: string

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || this.generateSourceId()
    this.config = { ...config, sourceId: this.sourceId }

    // Load from connection config if provided
    if (config.connectionConfig) {
      this.serverUrl = (config.connectionConfig.serverUrl as string) || ''
      this.apiKey = (config.connectionConfig.apiKey as string) || ''
      this.accessToken = (config.connectionConfig.accessToken as string) || ''
      this.userId = (config.connectionConfig.userId as string) || ''
    }

    this.api = axios.create({
      timeout: 30000,
    })
  }

  protected generateSourceId(): string {
    return `${this.providerType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  protected getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    if (this.accessToken) {
      headers[this.authHeaderName] = this.buildAuthHeader()
      console.log(`[${this.providerType}] Using access token auth header: ${this.authHeaderName}`)
    } else if (this.apiKey) {
      headers['X-Emby-Token'] = this.apiKey
      console.log(`[${this.providerType}] Using API key auth`)
    } else {
      console.warn(`[${this.providerType}] No authentication credentials available!`)
    }

    return headers
  }

  protected buildAuthHeader(): string {
    const parts = [
      `MediaBrowser Client="${this.clientName}"`,
      `Device="Totality"`,
      `DeviceId="${this.sourceId}"`,
      `Version="${this.clientVersion}"`,
    ]

    if (this.accessToken) {
      parts.push(`Token="${this.accessToken}"`)
    }

    return parts.join(', ')
  }

  /**
   * Build an image URL for Jellyfin/Emby
   * @param itemId The item ID to get the image for
   * @param imageType The image type (Primary, Thumb, Banner, etc.)
   * @param imageTag Optional image tag for cache busting
   */
  protected buildImageUrl(itemId: string, imageType: string, imageTag?: string): string {
    if (!this.serverUrl || !itemId) return ''

    // Emby uses /emby prefix, Jellyfin does not
    const pathPrefix = this.providerType === 'emby' ? '/emby' : ''
    let url = `${this.serverUrl}${pathPrefix}/Items/${itemId}/Images/${imageType}`

    // Only add tag for cache busting - images may not require auth
    if (imageTag) {
      url += `?tag=${encodeURIComponent(imageTag)}`
    }

    return url
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      if (!credentials.serverUrl) {
        return { success: false, error: 'Server URL is required' }
      }

      this.serverUrl = credentials.serverUrl.replace(/\/$/, '') // Remove trailing slash

      // Option 1: API Key authentication
      if (credentials.apiKey) {
        this.apiKey = credentials.apiKey
        const testResult = await this.testConnection()

        if (testResult.success) {
          return {
            success: true,
            apiKey: credentials.apiKey,
            serverName: testResult.serverName,
          }
        }

        return { success: false, error: testResult.error || 'Invalid API key' }
      }

      // Option 2: Username/Password authentication
      if (credentials.username && credentials.password) {
        const response = await this.api.post<JellyfinAuthResponse>(
          `${this.serverUrl}/Users/AuthenticateByName`,
          {
            Username: credentials.username,
            Pw: credentials.password,
          },
          {
            headers: {
              ...this.getAuthHeaders(),
              'X-Emby-Authorization': this.buildAuthHeader(),
            },
          }
        )

        if (response.data.AccessToken) {
          this.accessToken = response.data.AccessToken
          this.userId = response.data.User.Id

          return {
            success: true,
            token: response.data.AccessToken,
            userId: response.data.User.Id,
            userName: response.data.User.Name,
            serverName: response.data.ServerId,
          }
        }
      }

      return { success: false, error: 'Invalid credentials' }
    } catch (error: unknown) {
      console.error(`${this.providerType} authentication failed:`, error)
      return {
        success: false,
        error: (isAxiosError(error) ? ((isAxiosError(error) ? error.response?.data : undefined) as any)?.message : undefined) || getErrorMessage(error) || 'Authentication failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!(this.accessToken || this.apiKey)
  }

  async disconnect(): Promise<void> {
    this.accessToken = ''
    this.apiKey = ''
    this.userId = ''
  }

  // ============================================================================
  // QUICK CONNECT
  // ============================================================================

  /**
   * Check if Quick Connect is enabled on the server
   */
  async isQuickConnectEnabled(): Promise<boolean> {
    if (!this.serverUrl) return false

    try {
      const response = await this.api.get(`${this.serverUrl}/QuickConnect/Enabled`, {
        timeout: 5000,
      })
      return response.data === true
    } catch {
      return false
    }
  }

  /**
   * Initiate Quick Connect - returns a code for user to enter in another client
   */
  async initiateQuickConnect(): Promise<{ secret: string; code: string } | null> {
    if (!this.serverUrl) {
      throw new Error('Server URL not configured')
    }

    try {
      const response = await this.api.post(
        `${this.serverUrl}/QuickConnect/Initiate`,
        null,
        {
          headers: {
            'X-Emby-Authorization': this.buildAuthHeader(),
          },
        }
      )

      return {
        secret: response.data.Secret,
        code: response.data.Code,
      }
    } catch (error: unknown) {
      console.error('Failed to initiate Quick Connect:', error)
      throw new Error((isAxiosError(error) ? ((isAxiosError(error) ? error.response?.data : undefined) as any)?.message : undefined) || 'Failed to initiate Quick Connect')
    }
  }

  /**
   * Check Quick Connect status - poll until authenticated
   */
  async checkQuickConnectStatus(secret: string): Promise<{
    authenticated: boolean
    error?: string
  }> {
    if (!this.serverUrl) {
      return { authenticated: false, error: 'Server URL not configured' }
    }

    try {
      const response = await this.api.get(
        `${this.serverUrl}/QuickConnect/Connect`,
        {
          params: { Secret: secret },
          headers: {
            'X-Emby-Authorization': this.buildAuthHeader(),
          },
        }
      )

      return {
        authenticated: response.data.Authenticated === true,
      }
    } catch (error: unknown) {
      return {
        authenticated: false,
        error: (isAxiosError(error) ? ((isAxiosError(error) ? error.response?.data : undefined) as any)?.message : undefined) || getErrorMessage(error),
      }
    }
  }

  /**
   * Complete Quick Connect authentication - exchange secret for access token
   */
  async completeQuickConnect(secret: string): Promise<AuthResult> {
    if (!this.serverUrl) {
      return { success: false, error: 'Server URL not configured' }
    }

    try {
      const response = await this.api.post<JellyfinAuthResponse>(
        `${this.serverUrl}/Users/AuthenticateWithQuickConnect`,
        { Secret: secret },
        {
          headers: {
            'X-Emby-Authorization': this.buildAuthHeader(),
          },
        }
      )

      if (response.data.AccessToken) {
        this.accessToken = response.data.AccessToken
        this.userId = response.data.User.Id

        return {
          success: true,
          token: response.data.AccessToken,
          userId: response.data.User.Id,
          userName: response.data.User.Name,
        }
      }

      return { success: false, error: 'No access token received' }
    } catch (error: unknown) {
      console.error('Quick Connect authentication failed:', error)
      return {
        success: false,
        error: (isAxiosError(error) ? ((isAxiosError(error) ? error.response?.data : undefined) as any)?.message : undefined) || getErrorMessage(error) || 'Quick Connect failed',
      }
    }
  }

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.serverUrl) {
      return { success: false, error: 'Server URL not configured' }
    }

    try {
      const startTime = Date.now()
      const response = await this.api.get(`${this.serverUrl}/System/Info/Public`, {
        headers: this.getAuthHeaders(),
        timeout: 10000,
      })
      const latencyMs = Date.now() - startTime

      return {
        success: true,
        serverName: response.data.ServerName,
        serverVersion: response.data.Version,
        latencyMs,
      }
    } catch (error: unknown) {
      // Provide more helpful error messages
      const status = (isAxiosError(error) ? error.response?.status : undefined)
      if (status === 401) {
        return {
          success: false,
          error: 'Authentication failed (401): Access token is invalid or expired',
        }
      } else if (status === 403) {
        return {
          success: false,
          error: 'Access denied (403): You do not have permission to access this server',
        }
      } else if (isNodeError(error) && error.code === 'ECONNREFUSED') {
        return {
          success: false,
          error: 'Connection refused: The server is not running or not accepting connections',
        }
      } else if (isNodeError(error) && (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT')) {
        return {
          success: false,
          error: 'Connection timed out: The server took too long to respond',
        }
      } else if (isNodeError(error) && error.code === 'ENOTFOUND') {
        return {
          success: false,
          error: 'Server not found: The hostname could not be resolved',
        }
      }

      return {
        success: false,
        error: getErrorMessage(error) || 'Connection failed',
      }
    }
  }

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  async getLibraries(): Promise<MediaLibrary[]> {
    if (!this.serverUrl) {
      throw new Error('Not connected to server')
    }

    console.log(`[${this.providerType}] getLibraries: serverUrl=${this.serverUrl}, userId=${this.userId}, hasToken=${!!this.accessToken}, hasApiKey=${!!this.apiKey}`)

    try {
      // First try to get user views (works for all users)
      if (this.userId) {
        try {
          console.log(`[${this.providerType}] Fetching user views for userId: ${this.userId}`)
          const response = await this.api.get<{ Items: JellyfinLibrary[] }>(
            `${this.serverUrl}/Users/${this.userId}/Views`,
            { headers: this.getAuthHeaders() }
          )

          console.log(`[${this.providerType}] Got ${response.data.Items?.length || 0} views`)

          // Filter for supported library types (video + music)
          const mediaTypes = ['movies', 'tvshows', 'homevideos', 'musicvideos', 'mixed', 'boxsets', 'music']
          const libraries = response.data.Items
            .filter(lib => {
              const collType = (lib.CollectionType || '').toLowerCase()
              // Include if it's a known media type, or if CollectionType is empty (might be a media folder)
              return mediaTypes.includes(collType) || !lib.CollectionType
            })
            .map(lib => ({
              id: lib.Id,
              name: lib.Name,
              type: this.mapLibraryType(lib.CollectionType),
              itemCount: lib.ItemCount,
            }))

          if (libraries.length > 0) {
            console.log(`[${this.providerType}] Returning ${libraries.length} libraries from user views`)
            return libraries
          }

          console.log(`[${this.providerType}] No video libraries found in views, trying VirtualFolders`)
        } catch (viewsError: any) {
          console.warn(`[${this.providerType}] Failed to get user views:`, viewsError.response?.status, viewsError.response?.data || viewsError.message)
        }
      }

      // Fallback to VirtualFolders (requires admin or API key)
      console.log(`[${this.providerType}] Fetching VirtualFolders`)
      const response = await this.api.get<JellyfinLibrary[]>(
        `${this.serverUrl}/Library/VirtualFolders`,
        { headers: this.getAuthHeaders() }
      )

      const folders = Array.isArray(response.data) ? response.data : (response.data as any).Items || []
      console.log(`[${this.providerType}] Got ${folders.length} virtual folders`)

      const mediaTypes = ['movies', 'tvshows', 'homevideos', 'musicvideos', 'music']
      return folders
        .filter((lib: JellyfinLibrary) => mediaTypes.includes((lib.CollectionType || '').toLowerCase()))
        .map((lib: JellyfinLibrary) => ({
          id: lib.ItemId || lib.Id, // VirtualFolders uses ItemId
          name: lib.Name,
          type: this.mapLibraryType(lib.CollectionType),
          itemCount: lib.ItemCount,
        }))
    } catch (error: unknown) {
      console.error(`[${this.providerType}] Failed to get libraries:`, (isAxiosError(error) ? error.response?.status : undefined), (isAxiosError(error) ? error.response?.data : undefined) || getErrorMessage(error))

      // Provide more helpful error messages
      const status = (isAxiosError(error) ? error.response?.status : undefined)
      if (status === 401) {
        throw new Error('Authentication failed (401): Access token is invalid or expired. Please re-authenticate this source.')
      } else if (status === 403) {
        throw new Error('Access denied (403): You do not have permission to access this server.')
      } else if (isNodeError(error) && error.code === 'ECONNREFUSED') {
        throw new Error('Connection refused: The server is not running or not accepting connections.')
      } else if (isNodeError(error) && (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT')) {
        throw new Error('Connection timed out: The server took too long to respond.')
      } else if (isNodeError(error) && error.code === 'ENOTFOUND') {
        throw new Error('Server not found: The hostname could not be resolved.')
      }

      throw new Error(`Failed to fetch libraries: ${(isAxiosError(error) ? ((isAxiosError(error) ? error.response?.data : undefined) as any)?.Message : undefined) || getErrorMessage(error)}`)
    }
  }

  protected mapLibraryType(collectionType?: string): 'movie' | 'show' | 'music' | 'unknown' {
    switch (collectionType) {
      case 'movies':
      case 'homevideos':
      case 'musicvideos':
        return 'movie'
      case 'tvshows':
        return 'show'
      case 'music':
        return 'music'
      default:
        return 'unknown'
    }
  }

  async getLibraryItems(libraryId: string, offset = 0, limit = 100): Promise<MediaMetadata[]> {
    if (!this.serverUrl) {
      throw new Error('Not connected to server')
    }

    try {
      const response = await this.api.get<{ Items: JellyfinMediaItem[] }>(
        `${this.serverUrl}/Items`,
        {
          headers: this.getAuthHeaders(),
          params: {
            ParentId: libraryId,
            Recursive: true,
            IncludeItemTypes: 'Movie,Episode',
            Fields: 'Path,MediaSources,ProviderIds',
            StartIndex: offset,
            Limit: limit,
          },
        }
      )

      return response.data.Items.map(item => this.convertToMediaMetadata(item))
    } catch (error: unknown) {
      console.error('Failed to get library items:', error)
      throw new Error('Failed to fetch library items')
    }
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    if (!this.serverUrl) {
      throw new Error('Not connected to server')
    }

    try {
      const response = await this.api.get<JellyfinMediaItem>(
        `${this.serverUrl}/Items/${itemId}`,
        {
          headers: this.getAuthHeaders(),
          params: {
            Fields: 'Path,MediaSources,ProviderIds',
          },
        }
      )

      return this.convertToMediaMetadata(response.data)
    } catch (error: unknown) {
      console.error('Failed to get item metadata:', error)
      throw error
    }
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress, sinceTimestamp, forceFullScan } = options || {}
    const isIncremental = !!sinceTimestamp && !forceFullScan

    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    try {
      // Get library info to determine type
      const libraries = await this.getLibraries()
      const library = libraries.find(l => l.id === libraryId)
      const libraryType = library?.type || 'movie'

      // Get all items in library
      const allItems: JellyfinMediaItem[] = []
      let offset = 0
      const batchSize = 100
      let hasMoreItems = true

      // Log incremental scan info
      if (isIncremental) {
        console.log(`[${this.providerType}Provider ${this.sourceId}] Incremental scan: fetching items modified after ${sinceTimestamp!.toISOString()}`)
      }

      // Fetch all items with pagination
      while (hasMoreItems) {
        // Build params with optional timestamp filter for incremental scan
        const params: Record<string, unknown> = {
          ParentId: libraryId,
          Recursive: true,
          IncludeItemTypes: libraryType === 'show' ? 'Episode' : 'Movie',
          // Request all needed fields including images and parent info
          Fields: 'Path,MediaSources,ProviderIds,DateCreated,PremiereDate,ParentId,SeriesId,SeasonId,ImageTags,SeriesPrimaryImageTag,ParentPrimaryImageItemId,ParentPrimaryImageTag,ParentThumbItemId,ParentThumbImageTag,ParentBackdropItemId,ParentBackdropImageTags',
          EnableImageTypes: 'Primary,Thumb,Screenshot,Banner,Backdrop',
          EnableTotalRecordCount: true,
          StartIndex: offset,
          Limit: batchSize,
        }

        // Add timestamp filter for incremental scans
        if (isIncremental && sinceTimestamp) {
          params.MinDateLastSaved = sinceTimestamp.toISOString()
        }

        const response = await this.api.get<{ Items: JellyfinMediaItem[]; TotalRecordCount: number }>(
          `${this.serverUrl}/Items`,
          {
            headers: this.getAuthHeaders(),
            params,
          }
        )

        allItems.push(...response.data.Items)

        if (allItems.length >= response.data.TotalRecordCount || response.data.Items.length === 0) {
          hasMoreItems = false
        } else {
          offset += batchSize
        }
      }

      const totalItems = allItems.length
      if (isIncremental) {
        console.log(`[${this.providerType}Provider ${this.sourceId}] Incremental scan found ${totalItems} new/updated items`)
      } else {
        console.log(`[${this.providerType}Provider ${this.sourceId}] Processing ${totalItems} items...`)
      }

      // For TV episodes, batch-fetch series metadata to get series TMDB IDs and image tags
      const seriesMetadataMap = new Map<string, {
        providerIds?: { Imdb?: string; Tmdb?: string }
        primaryImageTag?: string
      }>()
      if (libraryType === 'show') {
        // Collect unique series IDs
        const uniqueSeriesIds = new Set<string>()
        for (const item of allItems) {
          if (item.SeriesId) {
            uniqueSeriesIds.add(item.SeriesId)
          }
        }

        console.log(`[${this.providerType}Provider ${this.sourceId}] Fetching metadata for ${uniqueSeriesIds.size} series...`)

        // Batch fetch series metadata including image tags
        const seriesIds = Array.from(uniqueSeriesIds)
        for (let i = 0; i < seriesIds.length; i += 50) {
          const batchIds = seriesIds.slice(i, i + 50)
          try {
            const seriesResponse = await this.api.get<{ Items: JellyfinMediaItem[] }>(
              `${this.serverUrl}/Items`,
              {
                headers: this.getAuthHeaders(),
                params: {
                  Ids: batchIds.join(','),
                  Fields: 'ProviderIds,ImageTags',
                },
              }
            )

            for (const series of seriesResponse.data.Items) {
              seriesMetadataMap.set(series.Id, {
                providerIds: series.ProviderIds,
                primaryImageTag: series.ImageTags?.Primary,
              })
            }
          } catch (error) {
            console.warn(`[${this.providerType}Provider] Failed to fetch series batch:`, error)
          }
        }

        console.log(`[${this.providerType}Provider ${this.sourceId}] Fetched ${seriesMetadataMap.size} series metadata`)

        // Attach series provider IDs and image tags to episodes
        for (const item of allItems) {
          if (item.SeriesId && seriesMetadataMap.has(item.SeriesId)) {
            const seriesData = seriesMetadataMap.get(item.SeriesId)!
            item.SeriesProviderIds = seriesData.providerIds
            // If episode doesn't have SeriesPrimaryImageTag, use the one from series metadata
            if (!item.SeriesPrimaryImageTag && seriesData.primaryImageTag) {
              item.SeriesPrimaryImageTag = seriesData.primaryImageTag
            }
          }
        }
      }

      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()

      const scannedProviderIds = new Set<string>()

      // Start batch mode
      db.startBatch()

      try {
        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i]

          try {
            // Skip items without media sources
            if (!item.MediaSources || item.MediaSources.length === 0) {
              continue
            }

            const mediaItem = await this.convertToMediaItem(item)
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = this.providerType
              mediaItem.library_id = libraryId

              const id = await db.upsertMediaItem(mediaItem)
              scannedProviderIds.add(mediaItem.plex_id)

              // Analyze quality
              mediaItem.id = id
              const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
              await db.upsertQualityScore(qualityScore)

              result.itemsScanned++
            }

            if (onProgress) {
              onProgress({
                current: i + 1,
                total: totalItems,
                phase: 'processing',
                currentItem: item.Name,
                percentage: ((i + 1) / totalItems) * 100,
              })
            }
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${item.Name}: ${getErrorMessage(error)}`)
          }

          // Periodic checkpoint
          if (result.itemsScanned % 50 === 0 && result.itemsScanned > 0) {
            await db.forceSave()
          }
        }
      } finally {
        await db.endBatch()
      }

      // Remove stale items (only for full scans, not incremental)
      if (!isIncremental && scannedProviderIds.size > 0) {
        const itemType = libraryType === 'show' ? 'episode' : 'movie'
        const items = db.getMediaItems({ type: itemType, sourceId: this.sourceId })

        for (const item of items) {
          if (!scannedProviderIds.has(item.plex_id)) {
            if (item.id) {
              await db.deleteMediaItem(item.id)
              result.itemsRemoved++
            }
          }
        }
      }

      // Update scan time
      await db.updateSourceScanTime(this.sourceId)

      result.success = true
      result.durationMs = Date.now() - startTime

      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  // ============================================================================
  // CONVERSION HELPERS
  // ============================================================================

  protected convertToMediaMetadata(item: JellyfinMediaItem): MediaMetadata {
    const mediaSource = item.MediaSources?.[0]
    const videoStream = mediaSource?.MediaStreams?.find(s => s.Type === 'Video')
    const audioStream = mediaSource?.MediaStreams?.find(s => s.Type === 'Audio')
    const isEpisode = item.Type === 'Episode'

    // Build poster URL
    // For movies: the movie's primary image
    // For episodes: the series poster (show artwork)
    let posterUrl: string | undefined
    if (isEpisode) {
      if (item.SeriesId && item.SeriesPrimaryImageTag) {
        posterUrl = this.buildImageUrl(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag)
      } else if (item.SeriesId) {
        posterUrl = this.buildImageUrl(item.SeriesId, 'Primary')
      }
    } else {
      if (item.ImageTags?.Primary) {
        posterUrl = this.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      }
    }

    // Normalize video/audio properties using shared normalizer
    const width = videoStream?.Width || 0
    const height = videoStream?.Height || 0

    // Calculate fallback audio bitrate for lossless codecs that don't report BitRate
    let audioBitrate = audioStream?.BitRate
    if (!audioBitrate && mediaSource?.Bitrate && videoStream?.BitRate) {
      // Single audio stream: estimate as total minus video
      audioBitrate = mediaSource.Bitrate - videoStream.BitRate
    } else if (!audioBitrate && audioStream) {
      // Estimate based on codec type for lossless formats
      const codecLower = (audioStream.Codec || '').toLowerCase()
      const channels = audioStream.Channels || 6
      if (codecLower.includes('truehd') || codecLower.includes('mlp')) {
        audioBitrate = channels * 500 * 1000 // ~500 kbps per channel in bps
      } else if (codecLower.includes('dts') && (codecLower.includes('hd') || codecLower.includes('ma') || codecLower.includes('x'))) {
        audioBitrate = channels * 400 * 1000 // ~400 kbps per channel in bps
      } else if (codecLower === 'flac') {
        audioBitrate = channels * 200 * 1000 // ~200 kbps per channel in bps
      }
    }

    return {
      providerId: this.sourceId,
      providerType: this.providerType,
      itemId: item.Id,
      title: item.Name,
      type: isEpisode ? 'episode' : 'movie',
      year: item.ProductionYear,
      seriesTitle: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      imdbId: item.ProviderIds?.Imdb,
      tmdbId: item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb, 10) : undefined,
      filePath: mediaSource?.Path,
      fileSize: mediaSource?.Size,
      duration: mediaSource?.RunTimeTicks ? Math.floor(mediaSource.RunTimeTicks / 10000) : undefined,
      container: normalizeContainer(mediaSource?.Container),
      resolution: normalizeResolution(width, height),
      width,
      height,
      videoCodec: normalizeVideoCodec(videoStream?.Codec),
      // Jellyfin returns BitRate in bps - prefer mediaSource.Bitrate (total) over videoStream.BitRate (video only)
      videoBitrate: normalizeBitrate(mediaSource?.Bitrate || videoStream?.BitRate, 'bps'),
      videoFrameRate: normalizeFrameRate(videoStream?.RealFrameRate),
      colorBitDepth: videoStream?.BitDepth,
      hdrFormat: normalizeHdrFormat(
        videoStream?.VideoRange,
        undefined,
        undefined,
        videoStream?.BitDepth,
        videoStream?.Profile
      ),
      colorSpace: videoStream?.ColorSpace,
      videoProfile: videoStream?.Profile,
      audioCodec: normalizeAudioCodec(audioStream?.Codec),
      audioChannels: normalizeAudioChannels(audioStream?.Channels, audioStream?.ChannelLayout),
      audioBitrate: normalizeBitrate(audioBitrate, 'bps'),
      audioSampleRate: normalizeSampleRate(audioStream?.SampleRate),
      hasObjectAudio: hasObjectAudio(
        audioStream?.Codec,
        audioStream?.Profile,
        audioStream?.DisplayTitle || audioStream?.Title,
        audioStream?.ChannelLayout
      ),
      posterUrl,
    }
  }

  protected async convertToMediaItem(item: JellyfinMediaItem): Promise<MediaItem | null> {
    const mediaSource = item.MediaSources?.[0]
    if (!mediaSource) return null

    const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video')
    const audioStreams = mediaSource.MediaStreams?.filter(s => s.Type === 'Audio') || []

    if (!videoStream || audioStreams.length === 0) {
      return null
    }

    // Build audio tracks array with normalized values
    // Note: Jellyfin returns BitRate in bps
    // For advanced codecs (TrueHD, DTS-HD MA, Atmos), Jellyfin often doesn't report stream-level BitRate
    const totalBitrate = mediaSource.Bitrate || 0
    const videoBitrate = videoStream.BitRate || 0

    // Check if any audio streams are missing bitrate - if so, try FFprobe first
    const hasMissingBitrate = audioStreams.some(s => !s.BitRate)
    let ffprobeBitrates: Map<number, number> | null = null

    if (hasMissingBitrate && mediaSource.Path) {
      // Try FFprobe as backup for missing bitrates (works if file is locally accessible)
      ffprobeBitrates = await this.getAudioBitratesViaFFprobe(mediaSource.Path)
    }

    const audioTracks: AudioTrack[] = audioStreams.map((stream, index) => {
      // Try stream BitRate first
      let streamBitrate = stream.BitRate

      // If missing, try FFprobe data
      if (!streamBitrate && ffprobeBitrates) {
        const ffprobeBitrate = ffprobeBitrates.get(stream.Index)
        if (ffprobeBitrate) {
          // FFprobe returns kbps, convert to bps for consistency with Jellyfin data
          streamBitrate = ffprobeBitrate * 1000
        }
      }

      // If still missing, fall back to estimates
      if (!streamBitrate && totalBitrate > videoBitrate && audioStreams.length === 1) {
        // Single audio track: estimate as total minus video
        streamBitrate = totalBitrate - videoBitrate
      } else if (!streamBitrate && totalBitrate > videoBitrate && audioStreams.length > 1) {
        // Multiple audio tracks: estimate based on codec type for lossless formats
        const codecLower = (stream.Codec || '').toLowerCase()
        const channels = stream.Channels || 6
        if (codecLower.includes('truehd') || codecLower.includes('mlp')) {
          // TrueHD: ~400-600 kbps per channel typical, convert to bps
          streamBitrate = channels * 500 * 1000
        } else if (codecLower.includes('dts') && (codecLower.includes('hd') || codecLower.includes('ma') || codecLower.includes('x'))) {
          // DTS-HD MA / DTS:X: ~300-500 kbps per channel typical, convert to bps
          streamBitrate = channels * 400 * 1000
        } else if (codecLower === 'flac') {
          // FLAC: ~150-300 kbps per channel typical, convert to bps
          streamBitrate = channels * 200 * 1000
        }
      }

      return {
        index,
        codec: normalizeAudioCodec(stream.Codec),
        channels: normalizeAudioChannels(stream.Channels, stream.ChannelLayout),
        bitrate: normalizeBitrate(streamBitrate, 'bps'),
        language: stream.Language,
        title: stream.DisplayTitle || stream.Title,
        profile: stream.Profile,
        sampleRate: normalizeSampleRate(stream.SampleRate),
        isDefault: stream.IsDefault,
        hasObjectAudio: hasObjectAudio(
          stream.Codec,
          stream.Profile,
          stream.DisplayTitle || stream.Title,
          stream.ChannelLayout
        ),
      }
    })

    // Find best audio track using shared utility
    const bestAudioTrack = selectBestAudioTrack(audioTracks) || audioTracks[0]

    const audioStream = audioStreams[bestAudioTrack.index] || audioStreams[0]

    // Normalize video/audio properties
    const width = videoStream.Width || 0
    const height = videoStream.Height || 0
    const resolution = normalizeResolution(width, height)
    const isEpisode = item.Type === 'Episode'

    // Build poster URL
    // For movies: the movie's primary image
    // For episodes: the series poster (show artwork)
    let posterUrl: string | undefined
    if (isEpisode) {
      // Episodes always use series poster as main poster
      if (item.SeriesId && item.SeriesPrimaryImageTag) {
        posterUrl = this.buildImageUrl(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag)
      } else if (item.SeriesId) {
        // Try without tag if we have series ID
        posterUrl = this.buildImageUrl(item.SeriesId, 'Primary')
      }
    } else {
      // Movies use their own primary image
      if (item.ImageTags?.Primary) {
        posterUrl = this.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      }
    }

    // Build episode thumbnail URL (episode's own thumb or primary image)
    let episodeThumbUrl: string | undefined
    if (isEpisode) {
      // Try episode's own Primary image first (Jellyfin often stores episode screenshots as Primary)
      if (item.ImageTags?.Primary) {
        episodeThumbUrl = this.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      } else if (item.ImageTags?.Screenshot) {
        // Try episode's Screenshot image
        episodeThumbUrl = this.buildImageUrl(item.Id, 'Screenshot', item.ImageTags.Screenshot)
      } else if (item.ImageTags?.Thumb) {
        // Try episode's Thumb image
        episodeThumbUrl = this.buildImageUrl(item.Id, 'Thumb', item.ImageTags.Thumb)
      } else if (item.ParentThumbItemId && item.ParentThumbImageTag) {
        // Fall back to parent thumb (usually from season)
        episodeThumbUrl = this.buildImageUrl(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag)
      } else {
        // Final fallback: try to get episode image without a tag
        episodeThumbUrl = this.buildImageUrl(item.Id, 'Primary')
      }
    }

    // Build season poster URL
    let seasonPosterUrl: string | undefined
    if (isEpisode && item.SeasonId) {
      if (item.ParentPrimaryImageItemId && item.ParentPrimaryImageTag) {
        // Use explicit parent primary image item ID with tag if available
        seasonPosterUrl = this.buildImageUrl(item.ParentPrimaryImageItemId, 'Primary', item.ParentPrimaryImageTag)
      } else if (item.ParentPrimaryImageTag) {
        // Use season ID with parent image tag
        seasonPosterUrl = this.buildImageUrl(item.SeasonId, 'Primary', item.ParentPrimaryImageTag)
      } else {
        // Try without tag using season ID
        seasonPosterUrl = this.buildImageUrl(item.SeasonId, 'Primary')
      }
    }

    // Get series TMDB ID for episodes (from SeriesProviderIds if available, set during batch fetch)
    const seriesTmdbId = isEpisode ? item.SeriesProviderIds?.Tmdb : undefined

    return {
      plex_id: item.Id, // Use provider's item ID
      title: item.Name,
      year: item.ProductionYear,
      type: isEpisode ? 'episode' : 'movie',
      series_title: item.SeriesName,
      season_number: item.ParentIndexNumber,
      episode_number: item.IndexNumber,
      file_path: mediaSource.Path || '',
      file_size: mediaSource.Size || 0,
      duration: mediaSource.RunTimeTicks ? Math.floor(mediaSource.RunTimeTicks / 10000) : 0,
      resolution,
      width,
      height,
      video_codec: normalizeVideoCodec(videoStream.Codec),
      // Jellyfin returns BitRate in bps - prefer mediaSource.Bitrate (total) over videoStream.BitRate (video only)
      video_bitrate: normalizeBitrate(mediaSource.Bitrate || videoStream.BitRate, 'bps'),
      audio_codec: normalizeAudioCodec(audioStream.Codec),
      audio_channels: normalizeAudioChannels(audioStream.Channels, audioStream.ChannelLayout),
      // Use the bitrate from bestAudioTrack which already has fallback logic for lossless codecs
      audio_bitrate: bestAudioTrack.bitrate,
      video_frame_rate: normalizeFrameRate(videoStream.RealFrameRate),
      color_bit_depth: videoStream.BitDepth,
      hdr_format: normalizeHdrFormat(
        videoStream.VideoRange,
        undefined,
        undefined,
        videoStream.BitDepth,
        videoStream.Profile
      ) || 'None',
      color_space: videoStream.ColorSpace,
      video_profile: videoStream.Profile,
      video_level: videoStream.Level,
      audio_profile: audioStream.Profile,
      audio_sample_rate: normalizeSampleRate(audioStream.SampleRate),
      has_object_audio: hasObjectAudio(
        audioStream.Codec,
        audioStream.Profile,
        audioStream.DisplayTitle || audioStream.Title,
        audioStream.ChannelLayout
      ),
      audio_tracks: JSON.stringify(audioTracks),
      container: normalizeContainer(mediaSource.Container),
      imdb_id: item.ProviderIds?.Imdb,
      tmdb_id: item.ProviderIds?.Tmdb,
      series_tmdb_id: seriesTmdbId,
      poster_url: posterUrl,
      episode_thumb_url: episodeThumbUrl,
      season_poster_url: seasonPosterUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  // NOTE: normalizeResolution, detectHdrFormat, and detectObjectAudio are now
  // imported from MediaNormalizer. The duplicate protected methods were removed.

  /**
   * Get audio bitrates from a file using FFprobe as a backup
   * Only used when Jellyfin doesn't provide bitrate for certain codecs (TrueHD, DTS-HD, Atmos)
   * @param filePath Path to the media file
   * @returns Map of stream index to bitrate in kbps, or null if FFprobe unavailable/file inaccessible
   */
  protected async getAudioBitratesViaFFprobe(filePath: string): Promise<Map<number, number> | null> {
    // Check if file is accessible locally
    if (!filePath || !fs.existsSync(filePath)) {
      return null
    }

    try {
      const analyzer = getMediaFileAnalyzer()
      if (!await analyzer.isAvailable()) {
        return null
      }

      const result = await analyzer.analyzeFile(filePath)
      if (!result.success || result.audioTracks.length === 0) {
        return null
      }

      const bitrateMap = new Map<number, number>()
      for (const track of result.audioTracks) {
        if (track.bitrate) {
          bitrateMap.set(track.index, track.bitrate)
        }
      }

      if (bitrateMap.size > 0) {
        console.log(`[${this.providerType}] Got audio bitrates via FFprobe for: ${filePath}`)
      }

      return bitrateMap.size > 0 ? bitrateMap : null
    } catch (error) {
      console.warn(`[${this.providerType}] FFprobe analysis failed for ${filePath}:`, error)
      return null
    }
  }

  // ============================================================================
  // MUSIC LIBRARY SUPPORT
  // ============================================================================

  /**
   * Get all music artists from a library (Album Artists only)
   * Uses the /Artists/AlbumArtists endpoint which returns only artists with albums
   */
  async getMusicArtists(libraryId: string): Promise<JellyfinMusicArtist[]> {
    if (!this.serverUrl) {
      throw new Error('Not connected to server')
    }

    try {
      const allArtists: JellyfinMusicArtist[] = []
      let startIndex = 0
      const batchSize = 100
      let hasMore = true

      while (hasMore) {
        // Use /Artists/AlbumArtists endpoint - this returns the actual album artists
        // that appear in the Emby/Jellyfin UI, not all artist metadata entries
        const response = await this.api.get<{ Items: JellyfinMusicArtist[]; TotalRecordCount?: number }>(
          `${this.serverUrl}/Artists/AlbumArtists`,
          {
            headers: this.getAuthHeaders(),
            params: {
              ParentId: libraryId,
              Fields: 'ProviderIds,Genres,Overview,ImageTags,SortName',
              StartIndex: startIndex,
              Limit: batchSize,
              EnableTotalRecordCount: true,
            },
          }
        )

        const items = response.data.Items || []
        allArtists.push(...items)

        const total = response.data.TotalRecordCount || items.length
        startIndex += items.length
        hasMore = startIndex < total && items.length === batchSize
      }

      console.log(`[${this.providerType}] getMusicArtists: Found ${allArtists.length} album artists`)
      return allArtists
    } catch (error: unknown) {
      console.error(`[${this.providerType}] Failed to get music artists:`, error)
      throw new Error('Failed to fetch music artists')
    }
  }

  /**
   * Get music albums - optionally filtered by artist
   */
  async getMusicAlbums(libraryId: string, artistId?: string): Promise<JellyfinMusicAlbum[]> {
    if (!this.serverUrl) {
      throw new Error('Not connected to server')
    }

    try {
      const allAlbums: JellyfinMusicAlbum[] = []
      let startIndex = 0
      const batchSize = 100
      let hasMore = true

      while (hasMore) {
        const params: Record<string, unknown> = {
          IncludeItemTypes: 'MusicAlbum',
          Recursive: true,
          Fields: 'ProviderIds,Genres,ImageTags,ChildCount,RunTimeTicks,AlbumArtist,AlbumArtists,Artists,PrimaryImageAspectRatio',
          EnableImages: true,
          EnableImageTypes: 'Primary,Thumb',
          StartIndex: startIndex,
          Limit: batchSize,
          EnableTotalRecordCount: true,
        }

        // If artistId provided, get albums by that artist; otherwise get all from library
        if (artistId) {
          params.AlbumArtistIds = artistId
        } else {
          params.ParentId = libraryId
        }

        const response = await this.api.get<{ Items: JellyfinMusicAlbum[]; TotalRecordCount?: number }>(
          `${this.serverUrl}/Items`,
          {
            headers: this.getAuthHeaders(),
            params,
          }
        )

        const items = response.data.Items || []
        allAlbums.push(...items)

        const total = response.data.TotalRecordCount || items.length
        startIndex += items.length
        hasMore = startIndex < total && items.length === batchSize
      }

      return allAlbums
    } catch (error: unknown) {
      console.error(`[${this.providerType}] Failed to get music albums:`, error)
      throw new Error('Failed to fetch music albums')
    }
  }

  /**
   * Get tracks for an album
   */
  async getMusicTracks(albumId: string): Promise<JellyfinMusicTrack[]> {
    if (!this.serverUrl) {
      throw new Error('Not connected to server')
    }

    try {
      const response = await this.api.get<{ Items: JellyfinMusicTrack[] }>(
        `${this.serverUrl}/Items`,
        {
          headers: this.getAuthHeaders(),
          params: {
            ParentId: albumId,
            IncludeItemTypes: 'Audio',
            Fields: 'MediaSources,Path,ProviderIds,Artists,ArtistItems,ImageTags,PrimaryImageTag',
          },
        }
      )

      return response.data.Items || []
    } catch (error: unknown) {
      console.error(`[${this.providerType}] Failed to get music tracks:`, error)
      throw new Error('Failed to fetch music tracks')
    }
  }

  /**
   * Convert Jellyfin artist to MusicArtist type
   */
  convertToMusicArtist(item: JellyfinMusicArtist, libraryId?: string): MusicArtist {
    const musicbrainzId = extractMusicBrainzId(item.ProviderIds, ...MUSICBRAINZ_ARTIST_KEYS)

    // Build artist image URL - only use ImageTags.Primary (not PrimaryImageTag which can be stale)
    const thumbUrl = item.ImageTags?.Primary
      ? this.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      : undefined

    return {
      source_id: this.sourceId,
      source_type: this.providerType,
      library_id: libraryId,
      provider_id: item.Id,
      name: item.Name,
      sort_name: item.SortName,
      musicbrainz_id: musicbrainzId,
      genres: item.Genres ? JSON.stringify(item.Genres) : undefined,
      biography: item.Overview,
      thumb_url: thumbUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Jellyfin album to MusicAlbum type
   */
  convertToMusicAlbum(item: JellyfinMusicAlbum, artistId?: number, libraryId?: string): MusicAlbum {
    const musicbrainzId = extractMusicBrainzId(item.ProviderIds, ...MUSICBRAINZ_ALBUM_KEYS)
    const artistName = item.AlbumArtist || item.AlbumArtists?.[0]?.Name || item.Artists?.[0] || 'Unknown Artist'

    // Build album art URL - ONLY use ImageTags.Primary (which is reliable)
    // PrimaryImageTag is NOT reliable - Emby sets it for embedded artwork but doesn't serve the image
    let thumbUrl: string | undefined
    if (item.ImageTags?.Primary) {
      thumbUrl = this.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
    } else if (item.ImageTags?.Thumb) {
      thumbUrl = this.buildImageUrl(item.Id, 'Thumb', item.ImageTags.Thumb)
    }
    // Note: Don't use PrimaryImageTag - it's often set but the image returns 404
    // The scanMusicLibrary function will check track artwork as a fallback

    return {
      source_id: this.sourceId,
      source_type: this.providerType,
      library_id: libraryId,
      provider_id: item.Id,
      artist_id: artistId,
      artist_name: artistName,
      title: item.Name,
      year: item.ProductionYear,
      musicbrainz_id: musicbrainzId,
      genres: item.Genres ? JSON.stringify(item.Genres) : undefined,
      track_count: item.ChildCount,
      total_duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000) : undefined, // ticks to ms
      thumb_url: thumbUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Jellyfin track to MusicTrack type
   */
  convertToMusicTrack(
    item: JellyfinMusicTrack,
    albumId?: number,
    artistId?: number,
    libraryId?: string
  ): MusicTrack | null {
    const mediaSource = item.MediaSources?.[0]
    const audioStream = mediaSource?.MediaStreams?.find(s => s.Type === 'Audio')

    if (!mediaSource) {
      console.warn(`[${this.providerType}] Skipping track "${item.Name}" - no MediaSource data`)
      return null
    }

    const audioCodec = audioStream?.Codec || 'unknown'
    const sampleRate = audioStream?.SampleRate || 44100
    const bitDepth = audioStream?.BitDepth || 16
    const lossless = isLosslessCodec(audioCodec)
    const hiRes = isHiRes(sampleRate, bitDepth, lossless)

    const musicbrainzId = extractMusicBrainzId(item.ProviderIds, ...MUSICBRAINZ_TRACK_KEYS)
    const artistName = item.AlbumArtist || item.ArtistItems?.[0]?.Name || item.Artists?.[0] || 'Unknown Artist'

    return {
      source_id: this.sourceId,
      source_type: this.providerType,
      library_id: libraryId,
      provider_id: item.Id,
      album_id: albumId,
      artist_id: artistId,
      album_name: item.Album,
      artist_name: artistName,
      title: item.Name,
      track_number: item.IndexNumber,
      disc_number: item.ParentIndexNumber || 1,
      duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000) : undefined, // ticks to ms
      file_path: mediaSource.Path,
      file_size: mediaSource.Size,
      container: mediaSource.Container,
      audio_codec: audioCodec,
      audio_bitrate: normalizeBitrate(mediaSource.Bitrate, 'bps'), // Emby returns bps, convert to kbps
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      channels: audioStream?.Channels,
      is_lossless: lossless,
      is_hi_res: hiRes,
      musicbrainz_id: musicbrainzId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Scan a music library
   */
  async scanMusicLibrary(
    libraryId: string,
    onProgress?: (progress: { current: number; total: number; phase: string; currentItem?: string; percentage: number }) => void
  ): Promise<ScanResult> {
    // Reset cancellation flag
    this.musicScanCancelled = false

    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
      cancelled: false,
    }

    try {
      const db = getDatabase()

      // Track scanned IDs for cleanup
      const scannedArtistIds = new Set<string>()
      const scannedAlbumIds = new Set<string>()
      const scannedTrackIds = new Set<string>()

      // Helper to process an album
      const processAlbum = async (
        jellyfinAlbum: JellyfinMusicAlbum,
        artistId: number | undefined,
        artistName?: string
      ): Promise<{ trackCount: number }> => {
        const albumData = this.convertToMusicAlbum(jellyfinAlbum, artistId, libraryId)

        // Override artist name if provided (for compilations)
        if (artistName && !albumData.artist_name) {
          albumData.artist_name = artistName
        }

        // Get all tracks for this album
        const tracks = await this.getMusicTracks(jellyfinAlbum.Id)

        // If album has no artwork, try to get it from the first track's embedded image
        // Emby/Jellyfin expose embedded artwork on tracks via ImageTags.Primary
        if (!albumData.thumb_url && tracks.length > 0) {
          const firstTrack = tracks[0]
          if (firstTrack.ImageTags?.Primary) {
            albumData.thumb_url = this.buildImageUrl(firstTrack.Id, 'Primary', firstTrack.ImageTags.Primary)
          }
        }

        // Convert and collect tracks
        const trackDataList: MusicTrack[] = []
        for (const jellyfinTrack of tracks) {
          const trackData = this.convertToMusicTrack(jellyfinTrack, undefined, artistId, libraryId)
          if (trackData) {
            trackDataList.push(trackData)
          }
        }

        // Calculate album stats from tracks
        const stats = calculateAlbumStats(trackDataList)
        albumData.track_count = stats.trackCount
        albumData.total_duration = stats.totalDuration
        albumData.total_size = stats.totalSize
        albumData.best_audio_codec = stats.bestCodec
        albumData.best_audio_bitrate = stats.bestBitrate
        albumData.best_sample_rate = stats.bestSampleRate
        albumData.best_bit_depth = stats.bestBitDepth
        albumData.avg_audio_bitrate = stats.avgBitrate

        // Upsert album
        const albumId = await db.upsertMusicAlbum(albumData)
        scannedAlbumIds.add(jellyfinAlbum.Id)

        // Upsert tracks
        for (const trackData of trackDataList) {
          trackData.album_id = albumId
          await db.upsertMusicTrack(trackData)
          scannedTrackIds.add(trackData.provider_id)
          result.itemsScanned++
        }

        return { trackCount: trackDataList.length }
      }

      // Phase 1: Get all artists and scan their albums (0-50% progress)
      const artists = await this.getMusicArtists(libraryId)
      const totalArtists = artists.length

      console.log(`[${this.providerType}Provider ${this.sourceId}] Scanning music library: ${totalArtists} artists`)

      let processed = 0

      for (const jellyfinArtist of artists) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[${this.providerType}Provider ${this.sourceId}] Music scan cancelled at artist ${processed}/${totalArtists}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          const artistData = this.convertToMusicArtist(jellyfinArtist, libraryId)

          // Upsert artist
          const artistId = await db.upsertMusicArtist(artistData)
          scannedArtistIds.add(jellyfinArtist.Id)

          // Get all albums for this artist
          const albums = await this.getMusicAlbums(libraryId, jellyfinArtist.Id)

          let artistTrackCount = 0
          let artistAlbumCount = 0

          for (const jellyfinAlbum of albums) {
            const { trackCount } = await processAlbum(jellyfinAlbum, artistId)
            artistTrackCount += trackCount
            artistAlbumCount++
          }

          // Update artist counts
          await db.updateMusicArtistCounts(artistId, artistAlbumCount, artistTrackCount)

          processed++
          if (onProgress) {
            onProgress({
              current: processed,
              total: totalArtists,
              phase: 'processing',
              currentItem: jellyfinArtist.Name,
              percentage: (processed / totalArtists) * 50, // First 50% for artists
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process artist ${jellyfinArtist.Name}: ${getErrorMessage(error)}`)
        }
      }

      // Phase 2: Get all albums directly to catch compilations and orphaned albums (50-100% progress)
      console.log(`[${this.providerType}Provider ${this.sourceId}] Scanning for compilations and orphaned albums...`)

      const allAlbums = await this.getMusicAlbums(libraryId)
      const unprocessedAlbums = allAlbums.filter(a => !scannedAlbumIds.has(a.Id))

      console.log(`[${this.providerType}Provider ${this.sourceId}] Found ${unprocessedAlbums.length} additional albums (compilations/orphaned)`)

      let compilationProcessed = 0
      const totalCompilations = unprocessedAlbums.length

      for (const jellyfinAlbum of unprocessedAlbums) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[${this.providerType}Provider ${this.sourceId}] Music scan cancelled at compilation ${compilationProcessed}/${totalCompilations}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          const artistName = jellyfinAlbum.AlbumArtist || jellyfinAlbum.AlbumArtists?.[0]?.Name || 'Various Artists'
          await processAlbum(jellyfinAlbum, undefined, artistName)

          compilationProcessed++
          if (onProgress) {
            onProgress({
              current: compilationProcessed,
              total: totalCompilations,
              phase: 'processing compilations',
              currentItem: jellyfinAlbum.Name,
              percentage: 50 + (compilationProcessed / Math.max(totalCompilations, 1)) * 50,
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process album ${jellyfinAlbum.Name}: ${getErrorMessage(error)}`)
        }
      }

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[${this.providerType}Provider ${this.sourceId}] Music scan complete: ${result.itemsScanned} tracks scanned in ${result.durationMs}ms`)

      return result
    } catch (error: unknown) {
      console.error(`[${this.providerType}Provider ${this.sourceId}] Music scan failed:`, error)
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  /**
   * Cancel an in-progress music scan
   */
  cancelMusicScan(): void {
    this.musicScanCancelled = true
    console.log(`[${this.providerType}Provider ${this.sourceId}] Music scan cancellation requested`)
  }
}
