import { getErrorMessage } from '../../services/utils/errorUtils'
/**
 * PlexProvider
 *
 * Implements the MediaProvider interface for Plex Media Server.
 * Handles authentication, server discovery, library operations, and scanning.
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
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  ServerInstance,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  ProgressCallback,
  SourceConfig,
} from '../base/MediaProvider'
import type {
  PlexAuthPin,
  PlexUser,
  PlexServer,
  PlexLibrary,
  PlexMediaItem,
  PlexMusicArtist,
  PlexMusicAlbum,
  PlexMusicTrack,
  PlexResource,
} from '../../types/plex'
import type { MediaItem, AudioTrack, MusicArtist, MusicAlbum, MusicTrack } from '../../types/database'

const PLEX_API_URL = 'https://plex.tv/api/v2'
const PLEX_TV_URL = 'https://plex.tv'
const CLIENT_IDENTIFIER = 'totality'
const PRODUCT_NAME = 'Totality'

export class PlexProvider implements MediaProvider {
  readonly providerType = 'plex' as const
  readonly sourceId: string

  private authToken: string | null = null
  private selectedServer: PlexServer | null = null
  private api: AxiosInstance

  // Cancellation support
  private scanCancelled = false
  private musicScanCancelled = false

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || this.generateSourceId()

    this.api = axios.create({
      headers: {
        'X-Plex-Client-Identifier': CLIENT_IDENTIFIER,
        'X-Plex-Product': PRODUCT_NAME,
        'X-Plex-Version': '1.0.0',
        'X-Plex-Platform': 'Windows',
        Accept: 'application/json',
      },
    })

    // Load token from connection config if provided
    if (config.connectionConfig?.token) {
      this.authToken = config.connectionConfig.token
    }
  }

  private generateSourceId(): string {
    return `plex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  /**
   * Step 1: Request a PIN for authentication
   */
  async requestAuthPin(): Promise<PlexAuthPin> {
    try {
      const response = await this.api.post(`${PLEX_API_URL}/pins`, {
        strong: true,
      })
      return response.data as PlexAuthPin
    } catch (error) {
      console.error('Failed to request auth PIN:', error)
      throw new Error('Failed to initiate Plex authentication')
    }
  }

  /**
   * Step 2: Get the auth URL for the user to visit
   */
  getAuthUrl(_pinId: number, code: string): string {
    return `https://app.plex.tv/auth#?clientID=${CLIENT_IDENTIFIER}&code=${code}&context[device][product]=${PRODUCT_NAME}`
  }

  /**
   * Step 3: Poll for auth token
   */
  async checkAuthPin(pinId: number): Promise<string | null> {
    try {
      const response = await this.api.get(`${PLEX_API_URL}/pins/${pinId}`)
      const pin = response.data as PlexAuthPin

      if (pin.authToken) {
        this.authToken = pin.authToken
        return pin.authToken
      }

      return null
    } catch (error) {
      console.error('Failed to check auth PIN:', error)
      return null
    }
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      if (credentials.token) {
        // Verify the token works
        const response = await this.api.get(`${PLEX_TV_URL}/users/account`, {
          headers: {
            'X-Plex-Token': credentials.token,
          },
        })

        if (response.data) {
          this.authToken = credentials.token
          return {
            success: true,
            token: credentials.token,
            userName: response.data.username || response.data.title,
          }
        }
      }

      return {
        success: false,
        error: 'Invalid or missing token',
      }
    } catch (error: unknown) {
      console.error('Plex authentication failed:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return this.authToken !== null
  }

  async disconnect(): Promise<void> {
    this.authToken = null
    this.selectedServer = null
  }

  // ============================================================================
  // SERVER DISCOVERY
  // ============================================================================

  async discoverServers(): Promise<ServerInstance[]> {
    if (!this.authToken) {
      throw new Error('Not authenticated')
    }

    try {
      const response = await this.api.get(`${PLEX_API_URL}/resources`, {
        headers: {
          'X-Plex-Token': this.authToken,
        },
        params: {
          includeHttps: 1,
          includeRelay: 1,
        },
      })

      const resources: PlexResource[] = Array.isArray(response.data) ? response.data : []
      const servers = resources.filter((r) => r.provides === 'server')

      return servers.map((server) => {
        const localHttp = server.connections?.find((c) => c.local && c.protocol === 'http')
        const preferredConnection = localHttp || server.connections?.[0]

        return {
          id: server.clientIdentifier,
          name: server.name,
          address: preferredConnection?.address || server.publicAddress || '',
          port: preferredConnection?.port || 32400,
          version: server.productVersion,
          isLocal: preferredConnection?.local || false,
          isOwned: server.owned === true || server.owned === 1,
          protocol: preferredConnection?.protocol || 'https',
        }
      })
    } catch (error) {
      console.error('Failed to discover servers:', error)
      throw new Error('Failed to discover Plex servers')
    }
  }

  async selectServer(serverId: string): Promise<boolean> {
    if (!this.authToken) {
      throw new Error('Not authenticated')
    }

    try {
      const response = await this.api.get(`${PLEX_API_URL}/resources`, {
        headers: {
          'X-Plex-Token': this.authToken,
        },
        params: {
          includeHttps: 1,
          includeRelay: 1,
        },
      })

      const resources: PlexResource[] = Array.isArray(response.data) ? response.data : []
      const server = resources.find(
        (r) => r.provides === 'server' && r.clientIdentifier === serverId
      )

      if (!server) {
        throw new Error('Server not found')
      }

      const localHttp = server.connections?.find((c) => c.local && c.protocol === 'http')
      const preferredConnection = localHttp || server.connections?.[0]

      this.selectedServer = {
        name: server.name,
        host: server.publicAddress || '',
        port: preferredConnection?.port || 32400,
        machineIdentifier: server.clientIdentifier,
        version: server.productVersion,
        scheme: preferredConnection?.protocol || 'https',
        address: preferredConnection?.address || server.publicAddress || '',
        uri: preferredConnection?.uri || `${preferredConnection?.protocol}://${preferredConnection?.address}:${preferredConnection?.port}`,
        localAddresses: server.connections
          ?.filter((c) => c.local)
          .map((c) => c.address)
          .join(',') || '',
        owned: server.owned === true || server.owned === 1,
        accessToken: server.accessToken || '',
      }

      return true
    } catch (error) {
      console.error('Failed to select server:', error)
      return false
    }
  }

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.selectedServer) {
      return {
        success: false,
        error: 'No server selected',
      }
    }

    try {
      const startTime = Date.now()
      const response = await this.api.get(`${this.selectedServer.uri}/identity`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
        timeout: 10000,
      })
      const latencyMs = Date.now() - startTime

      return {
        success: true,
        serverName: response.data?.MediaContainer?.friendlyName || this.selectedServer.name,
        serverVersion: response.data?.MediaContainer?.version || this.selectedServer.version,
        latencyMs,
      }
    } catch (error: unknown) {
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
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(`${this.selectedServer.uri}/library/sections`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      const responseData = response.data as { MediaContainer?: { Directory?: PlexLibrary[] } }
      const directories = responseData?.MediaContainer?.Directory || []
      return directories.map((dir: PlexLibrary) => ({
        id: dir.key,
        name: dir.title,
        type: dir.type === 'show' ? 'show' : dir.type === 'movie' ? 'movie' : dir.type === 'artist' ? 'music' : 'unknown',
        itemCount: dir.count,
        scannedAt: dir.scannedAt ? new Date(dir.scannedAt * 1000).toISOString() : undefined,
      }))
    } catch (error) {
      console.error('Failed to get libraries:', error)
      throw new Error('Failed to fetch Plex libraries')
    }
  }

  async getLibraryItems(libraryId: string, _offset?: number, _limit?: number): Promise<MediaMetadata[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(
        `${this.selectedServer.uri}/library/sections/${libraryId}/all`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      const responseData = response.data as { MediaContainer?: { Metadata?: PlexMediaItem[] } }
      const items = responseData?.MediaContainer?.Metadata || []
      return items.map((item: PlexMediaItem) => this.convertToMediaMetadata(item))
    } catch (error) {
      console.error('Failed to get library items:', error)
      throw new Error('Failed to fetch library items')
    }
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(
        `${this.selectedServer.uri}/library/metadata/${itemId}`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      const responseData = response.data as { MediaContainer?: { Metadata?: PlexMediaItem[] } }
      const metadata = responseData?.MediaContainer?.Metadata?.[0]
      if (!metadata) {
        throw new Error('Item not found')
      }

      return this.convertToMediaMetadata(metadata)
    } catch (error) {
      console.error('Failed to get item metadata:', error)
      throw error
    }
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    // Reset cancellation flag at start
    this.scanCancelled = false

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
      cancelled: false,
    }

    try {
      const items = await this.getPlexLibraryItems(libraryId, sinceTimestamp)
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()

      let scanned = 0
      let totalItems = items.length
      const scannedProviderIds = new Set<string>()
      let libraryType: 'movie' | 'show' | null = null

      // Cache for season metadata and show TMDB IDs
      const seasonCache = new Map<string, PlexMediaItem | null>()
      const showTmdbIdCache = new Map<string, string | undefined>()

      // First pass: count total items (including episodes for TV shows)
      const itemsToProcess: Array<PlexMediaItem & { _showTmdbId?: string }> = []
      for (const item of items) {
        if (libraryType === null) {
          libraryType = item.type === 'show' ? 'show' : 'movie'
        }

        if (item.type === 'show') {
          // Get show metadata for TMDB ID
          const showMetadata = await this.getPlexItemMetadata(item.ratingKey)
          let showTmdbId: string | undefined

          if (showMetadata?.Guid) {
            for (const guid of showMetadata.Guid) {
              if (guid.id.includes('tmdb://')) {
                showTmdbId = guid.id.replace('tmdb://', '').split('?')[0]
                break
              }
            }
          }

          if (showTmdbId) {
            showTmdbIdCache.set(item.ratingKey, showTmdbId)
          }

          // Get all episodes
          const episodes = await this.getAllEpisodes(item.ratingKey)
          for (const ep of episodes) {
            (ep as PlexMediaItem & { _showTmdbId?: string })._showTmdbId = showTmdbId
          }
          itemsToProcess.push(...episodes)
        } else {
          itemsToProcess.push(item)
        }
      }

      totalItems = itemsToProcess.length
      console.log(`[PlexProvider ${this.sourceId}] Processing ${totalItems} items...`)

      // Start batch mode
      db.startBatch()

      const BATCH_SIZE = 10

      try {
        for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
          // Check for cancellation
          if (this.scanCancelled) {
            console.log(`[PlexProvider ${this.sourceId}] Scan cancelled at ${scanned}/${totalItems}`)
            result.cancelled = true
            break
          }

          const batch = itemsToProcess.slice(i, i + BATCH_SIZE)

          const metadataResults = await Promise.allSettled(
            batch.map(item => this.getPlexItemMetadata(item.ratingKey))
          )

          for (let j = 0; j < batch.length; j++) {
            const item = batch[j]
            const metaResult = metadataResults[j]

            try {
              if (metaResult.status === 'rejected') {
                result.errors.push(`Failed to fetch metadata for ${item.title}: ${metaResult.reason}`)
                continue
              }

              const detailed = metaResult.value
              if (!detailed || !detailed.Media || detailed.Media.length === 0) {
                continue
              }

              // Fetch season metadata for episodes
              if (detailed.type === 'episode' && detailed.parentKey) {
                const seasonKey = detailed.parentKey.split('/').pop()
                if (seasonKey && !seasonCache.has(seasonKey)) {
                  const seasonMetadata = await this.getSeasonMetadata(seasonKey)
                  seasonCache.set(seasonKey, seasonMetadata)
                }

                const seasonMetadata = seasonCache.get(seasonKey!)
                if (seasonMetadata?.thumb && !detailed.parentThumb) {
                  detailed.parentThumb = seasonMetadata.thumb
                }
              }

              const showTmdbId = (item as PlexMediaItem & { _showTmdbId?: string })._showTmdbId
              const mediaItem = this.convertToMediaItem(detailed, showTmdbId)

              if (mediaItem) {
                // Set source tracking fields
                mediaItem.source_id = this.sourceId
                mediaItem.source_type = 'plex'
                mediaItem.library_id = libraryId

                const id = await db.upsertMediaItem(mediaItem)
                scannedProviderIds.add(mediaItem.plex_id)

                // Analyze quality
                mediaItem.id = id
                const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
                await db.upsertQualityScore(qualityScore)

                scanned++
                result.itemsScanned++
              }

              if (onProgress) {
                onProgress({
                  current: scanned,
                  total: totalItems,
                  phase: 'processing',
                  currentItem: item.title,
                  percentage: (scanned / totalItems) * 100,
                })
              }
            } catch (error: unknown) {
              result.errors.push(`Failed to process ${item.title}: ${getErrorMessage(error)}`)
            }
          }

          // Periodic checkpoint
          if (scanned % 50 === 0 && scanned > 0) {
            await db.forceSave()
          }
        }
      } finally {
        await db.endBatch()
      }

      // Remove stale items
      if (!isIncremental && libraryType && scannedProviderIds.size > 0) {
        // Full scan: use the IDs we just scanned
        const itemType = libraryType === 'show' ? 'episode' : 'movie'
        const removedCount = await this.removeStaleItems(scannedProviderIds, itemType)
        result.itemsRemoved = removedCount
      } else if (isIncremental) {
        // Incremental scan: fetch all current IDs from Plex to detect changes
        const libType = libraryType || await this.getPlexLibraryType(libraryId)
        if (libType) {
          console.log(`[PlexProvider ${this.sourceId}] Checking for changes in ${libType} library...`)
          const currentPlexIds = await this.getPlexLibraryItemIds(libraryId, libType)
          const itemType = libType === 'show' ? 'episode' : 'movie'

          // Check for deletions (items in DB but not in Plex)
          const removedCount = await this.removeStaleItems(currentPlexIds, itemType)
          if (removedCount > 0) {
            console.log(`[PlexProvider ${this.sourceId}] Removed ${removedCount} deleted items`)
          }
          result.itemsRemoved = removedCount

          // Check for additions (items in Plex but not in DB)
          const dbItems = db.getMediaItems({ type: itemType, sourceId: this.sourceId }) as Array<{ plex_id?: string }>
          const dbIds = new Set(dbItems.map((item: typeof dbItems[0]) => item.plex_id))
          const missingIds: string[] = []
          for (const plexId of currentPlexIds) {
            if (!dbIds.has(plexId)) {
              missingIds.push(plexId)
            }
          }

          if (missingIds.length > 0) {
            console.log(`[PlexProvider ${this.sourceId}] Found ${missingIds.length} items in Plex not in DB, fetching...`)
            // Fetch and process the missing items
            const addedCount = await this.fetchAndProcessMissingItems(missingIds, libraryId, libType, analyzer, onProgress)
            result.itemsAdded += addedCount
            console.log(`[PlexProvider ${this.sourceId}] Added ${addedCount} missing items`)
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

  private async removeStaleItems(validIds: Set<string>, type: 'movie' | 'episode'): Promise<number> {
    const db = getDatabase()
    const items = db.getMediaItems({ type, sourceId: this.sourceId })

    console.log(`[PlexProvider ${this.sourceId}] Reconciling ${type}s: ${items.length} in DB, ${validIds.size} in Plex`)

    let removedCount = 0
    for (const item of items) {
      if (!validIds.has(item.plex_id)) {
        if (item.id) {
          console.log(`[PlexProvider ${this.sourceId}] Removing deleted ${type}: "${item.title}" (ID: ${item.plex_id})`)
          await db.deleteMediaItem(item.id)
          removedCount++
        }
      }
    }

    return removedCount
  }

  /**
   * Get library type from Plex metadata
   */
  private async getPlexLibraryType(libraryKey: string): Promise<'movie' | 'show' | null> {
    if (!this.selectedServer) {
      return null
    }

    try {
      const response = await this.api.get(`${this.selectedServer.uri}/library/sections`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      const responseData = response.data as { MediaContainer?: { Directory?: PlexMediaItem[] } }
      const directories = responseData?.MediaContainer?.Directory || []
      const library = directories.find((dir: PlexMediaItem) => dir.key === libraryKey)

      if (library) {
        return library.type === 'show' ? 'show' : library.type === 'movie' ? 'movie' : null
      }
      return null
    } catch (error) {
      console.error(`[PlexProvider ${this.sourceId}] Failed to get library type:`, error)
      return null
    }
  }

  /**
   * Get all item IDs (ratingKeys) from a library - lightweight for deletion reconciliation
   */
  private async getPlexLibraryItemIds(libraryKey: string, libraryType: 'movie' | 'show'): Promise<Set<string>> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    const url = `${this.selectedServer.uri}/library/sections/${libraryKey}/all`
    const response = await this.api.get(url, {
      headers: {
        'X-Plex-Token': this.selectedServer.accessToken,
      },
    })

    const responseData = response.data as { MediaContainer?: { Metadata?: PlexMediaItem[] } }
    const items = responseData?.MediaContainer?.Metadata || []
    const ids = new Set<string>()

    for (const item of items) {
      if (libraryType === 'show') {
        // For TV, we need episode ratingKeys
        const episodes = await this.getAllEpisodes(item.ratingKey)
        for (const ep of episodes) {
          ids.add(ep.ratingKey)
        }
      } else {
        ids.add(item.ratingKey)
      }
    }

    console.log(`[PlexProvider ${this.sourceId}] Got ${ids.size} item IDs for reconciliation`)
    return ids
  }

  /**
   * Fetch and process items that exist in Plex but not in our DB
   */
  private async fetchAndProcessMissingItems(
    missingIds: string[],
    libraryId: string,
    libraryType: 'movie' | 'show',
    analyzer: ReturnType<typeof getQualityAnalyzer>,
    _onProgress?: ProgressCallback
  ): Promise<number> {
    const db = getDatabase()
    let addedCount = 0

    for (const ratingKey of missingIds) {
      try {
        // Fetch the item metadata
        const metadata = await this.getPlexItemMetadata(ratingKey)
        if (!metadata) continue

        // Convert and add the item
        const itemType = libraryType === 'show' ? 'episode' : 'movie'
        const mediaItem = this.convertToMediaItem(metadata)
        if (mediaItem) {
          // Set source tracking fields (required for proper DB storage)
          mediaItem.source_id = this.sourceId
          mediaItem.source_type = 'plex'
          mediaItem.library_id = libraryId

          // Upsert will handle duplicates via unique constraint
          db.upsertMediaItem(mediaItem)

          // Analyze quality
          try {
            const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
            if (qualityScore) {
              db.upsertQualityScore(qualityScore)
            }
          } catch (qualityError) {
            console.warn(`[PlexProvider ${this.sourceId}] Failed to analyze quality for ${mediaItem.title}`)
          }

          addedCount++
          console.log(`[PlexProvider ${this.sourceId}] Added missing ${itemType}: "${mediaItem.title}"`)
        }
      } catch (error) {
        console.error(`[PlexProvider ${this.sourceId}] Failed to fetch item ${ratingKey}:`, error)
      }
    }

    return addedCount
  }

  // ============================================================================
  // PLEX-SPECIFIC HELPERS
  // ============================================================================

  private async getPlexLibraryItems(libraryKey: string, sinceTimestamp?: Date): Promise<PlexMediaItem[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    // Build URL with optional timestamp filter for incremental scan
    let url = `${this.selectedServer.uri}/library/sections/${libraryKey}/all`
    if (sinceTimestamp) {
      const unixSeconds = Math.floor(sinceTimestamp.getTime() / 1000)
      url += `?addedAt>=${unixSeconds}`
      console.log(`[PlexProvider ${this.sourceId}] Incremental scan: fetching items added after ${sinceTimestamp.toISOString()}`)
    }

    const response = await this.api.get(url, {
      headers: {
        'X-Plex-Token': this.selectedServer.accessToken,
      },
    })

    const responseData = response.data as { MediaContainer?: { Metadata?: PlexMediaItem[] } }
    const items = responseData?.MediaContainer?.Metadata || []
    if (sinceTimestamp) {
      console.log(`[PlexProvider ${this.sourceId}] Incremental scan found ${items.length} new/updated items`)
    }
    return items
  }

  private async getPlexItemMetadata(ratingKey: string): Promise<PlexMediaItem | null> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(
        `${this.selectedServer.uri}/library/metadata/${ratingKey}`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      const responseData = response.data as { MediaContainer?: { Metadata?: PlexMediaItem[] } }
      return responseData?.MediaContainer?.Metadata?.[0] || null
    } catch (error) {
      console.error('Failed to get item metadata:', error)
      return null
    }
  }

  async getAllEpisodes(showKey: string): Promise<PlexMediaItem[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(
        `${this.selectedServer.uri}/library/metadata/${showKey}/allLeaves`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      const responseData = response.data as { MediaContainer?: { Metadata?: PlexMediaItem[] } }
      return responseData?.MediaContainer?.Metadata || []
    } catch (error) {
      console.error('Failed to get episodes:', error)
      return []
    }
  }

  private async getSeasonMetadata(seasonKey: string): Promise<PlexMediaItem | null> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(
        `${this.selectedServer.uri}/library/metadata/${seasonKey}`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      const responseData = response.data as { MediaContainer?: { Metadata?: PlexMediaItem[] } }
      return responseData?.MediaContainer?.Metadata?.[0] || null
    } catch (error) {
      return null
    }
  }

  // ============================================================================
  // USER INFO
  // ============================================================================

  async getUserInfo(): Promise<PlexUser | null> {
    if (!this.authToken) {
      throw new Error('Not authenticated')
    }

    try {
      const response = await this.api.get(`${PLEX_TV_URL}/users/account`, {
        headers: {
          'X-Plex-Token': this.authToken,
        },
      })

      return response.data as PlexUser
    } catch (error) {
      console.error('Failed to get user info:', error)
      return null
    }
  }

  // ============================================================================
  // CONVERSION HELPERS
  // ============================================================================

  private convertToMediaMetadata(item: PlexMediaItem): MediaMetadata {
    const media = item.Media?.[0]
    const part = media?.Part?.[0]
    const videoStream = part?.Stream?.find((s) => s.streamType === 1)
    const audioStream = part?.Stream?.find((s) => s.streamType === 2)

    // Extract external IDs
    let imdbId: string | undefined
    let tmdbId: number | undefined

    if (item.Guid) {
      for (const guid of item.Guid) {
        if (guid.id.includes('imdb://')) {
          imdbId = guid.id.replace('imdb://', '')
        } else if (guid.id.includes('tmdb://')) {
          tmdbId = parseInt(guid.id.replace('tmdb://', '').split('?')[0], 10)
        }
      }
    }

    // Normalize video/audio properties using shared normalizer
    const width = media?.width || 0
    const height = media?.height || 0

    return {
      providerId: this.sourceId,
      providerType: 'plex',
      itemId: item.ratingKey,
      title: item.title,
      type: item.type as 'movie' | 'episode',
      year: item.year,
      seriesTitle: item.grandparentTitle,
      seasonNumber: item.parentIndex,
      episodeNumber: item.index,
      imdbId,
      tmdbId,
      filePath: part?.file,
      fileSize: part?.size,
      duration: item.duration,
      container: normalizeContainer(part?.container || media?.container),
      resolution: normalizeResolution(width, height),
      width,
      height,
      videoCodec: normalizeVideoCodec(media?.videoCodec),
      videoBitrate: normalizeBitrate(media?.bitrate, 'kbps'),
      videoFrameRate: normalizeFrameRate(videoStream?.frameRate),
      colorBitDepth: videoStream?.bitDepth,
      hdrFormat: normalizeHdrFormat(
        undefined,
        videoStream?.colorTrc,
        videoStream?.colorPrimaries,
        videoStream?.bitDepth,
        videoStream?.profile
      ),
      colorSpace: videoStream?.colorSpace,
      videoProfile: videoStream?.profile,
      audioCodec: normalizeAudioCodec(media?.audioCodec),
      audioChannels: normalizeAudioChannels(media?.audioChannels, audioStream?.audioChannelLayout),
      audioBitrate: normalizeBitrate(audioStream?.bitrate, 'kbps'),
      audioSampleRate: normalizeSampleRate(audioStream?.samplingRate),
      hasObjectAudio: hasObjectAudio(
        audioStream?.codec,
        audioStream?.profile,
        audioStream?.displayTitle || audioStream?.title,
        audioStream?.audioChannelLayout
      ),
      posterUrl: item.thumb ? `${this.selectedServer?.uri}${item.thumb}?X-Plex-Token=${this.selectedServer?.accessToken}` : undefined,
    }
  }

  private convertToMediaItem(item: PlexMediaItem, showTmdbId?: string): MediaItem | null {
    const media = item.Media?.[0]
    const part = media?.Part?.[0]

    if (!media || !part) {
      return null
    }

    const videoStream = part.Stream?.find((s) => s.streamType === 1)
    const audioStreams = part.Stream?.filter((s) => s.streamType === 2) || []

    if (!videoStream || audioStreams.length === 0) {
      console.warn(`Missing streams for ${item.title}`)
      return null
    }

    // Build audio tracks array with normalized values
    const audioTracks: AudioTrack[] = audioStreams.map((stream, index) => ({
      index,
      codec: normalizeAudioCodec(stream.codec),
      channels: normalizeAudioChannels(stream.channels, stream.audioChannelLayout),
      bitrate: normalizeBitrate(stream.bitrate, 'kbps'),
      language: stream.language || stream.languageCode,
      title: stream.displayTitle || stream.title,
      profile: stream.profile,
      sampleRate: normalizeSampleRate(stream.samplingRate),
      isDefault: stream.selected === true,
      hasObjectAudio: hasObjectAudio(
        stream.codec,
        stream.profile,
        stream.displayTitle || stream.title,
        stream.audioChannelLayout
      ),
    }))

    // Find best audio track using shared utility
    const bestAudioTrack = selectBestAudioTrack(audioTracks) || audioTracks[0]

    const audioStream = audioStreams[bestAudioTrack.index] || audioStreams[0]

    // Extract external IDs
    let imdbId: string | undefined
    let tmdbId: string | undefined

    if (item.Guid) {
      for (const guid of item.Guid) {
        if (guid.id.includes('imdb://')) {
          imdbId = guid.id.replace('imdb://', '')
        } else if (guid.id.includes('tmdb://')) {
          tmdbId = guid.id.replace('tmdb://', '').split('?')[0]
        }
      }
    }

    // Build poster URLs
    let posterUrl: string | undefined
    let episodeThumbUrl: string | undefined
    let seasonPosterUrl: string | undefined

    if (this.selectedServer) {
      if (item.thumb) {
        const thumbPath = item.type === 'episode' && item.grandparentThumb
          ? item.grandparentThumb
          : item.thumb
        posterUrl = `${this.selectedServer.uri}${thumbPath}?X-Plex-Token=${this.selectedServer.accessToken}`
      }

      if (item.type === 'episode') {
        if (item.thumb) {
          episodeThumbUrl = `${this.selectedServer.uri}${item.thumb}?X-Plex-Token=${this.selectedServer.accessToken}`
        }
        if (item.parentThumb) {
          seasonPosterUrl = `${this.selectedServer.uri}${item.parentThumb}?X-Plex-Token=${this.selectedServer.accessToken}`
        }
      }
    }

    // Normalize all video/audio properties
    const width = media.width || 0
    const height = media.height || 0

    return {
      plex_id: item.ratingKey,
      title: item.title,
      year: item.year,
      type: item.type as 'movie' | 'episode',
      series_title: item.grandparentTitle,
      season_number: item.parentIndex,
      episode_number: item.index,
      file_path: part.file,
      file_size: part.size,
      duration: item.duration,
      resolution: normalizeResolution(width, height),
      width,
      height,
      video_codec: normalizeVideoCodec(media.videoCodec),
      video_bitrate: normalizeBitrate(media.bitrate, 'kbps'),
      audio_codec: normalizeAudioCodec(media.audioCodec),
      audio_channels: normalizeAudioChannels(media.audioChannels, audioStream.audioChannelLayout),
      audio_bitrate: normalizeBitrate(audioStream.bitrate, 'kbps'),
      video_frame_rate: normalizeFrameRate(videoStream.frameRate),
      color_bit_depth: videoStream.bitDepth,
      hdr_format: normalizeHdrFormat(
        undefined,
        videoStream.colorTrc,
        videoStream.colorPrimaries,
        videoStream.bitDepth,
        videoStream.profile
      ) || 'None',
      color_space: videoStream.colorSpace,
      video_profile: videoStream.profile,
      video_level: videoStream.level,
      audio_profile: audioStream.profile,
      audio_sample_rate: normalizeSampleRate(audioStream.samplingRate),
      has_object_audio: hasObjectAudio(
        audioStream.codec,
        audioStream.profile,
        audioStream.displayTitle || audioStream.title,
        audioStream.audioChannelLayout
      ),
      audio_tracks: JSON.stringify(audioTracks),
      container: normalizeContainer(part.container || media.container),
      imdb_id: imdbId,
      tmdb_id: tmdbId,
      series_tmdb_id: showTmdbId,
      poster_url: posterUrl,
      episode_thumb_url: episodeThumbUrl,
      season_poster_url: seasonPosterUrl,
      created_at: item.addedAt && item.addedAt > 0
        ? new Date(item.addedAt * 1000).toISOString()
        : new Date().toISOString(),
      updated_at: item.updatedAt && item.updatedAt > 0
        ? new Date(item.updatedAt * 1000).toISOString()
        : new Date().toISOString(),
    }
  }

  // ============================================================================
  // MUSIC LIBRARY METHODS
  // ============================================================================

  /**
   * Get all artists from a music library
   */
  async getMusicArtists(libraryKey: string): Promise<PlexMusicArtist[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    console.log(`[PlexProvider] Fetching artists from library ${libraryKey}`)
    console.log(`[PlexProvider] Server URI: ${this.selectedServer.uri}`)

    // For music libraries (type 'artist'), calling /all returns artists by default
    // We explicitly request type=8 (artist) to ensure we get artists only
    const response = await this.api.get(
      `${this.selectedServer.uri}/library/sections/${libraryKey}/all`,
      {
        params: { type: 8 }, // 8 = artist in Plex API
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
          Accept: 'application/json',
        },
      }
    )

    console.log(`[PlexProvider] Response status: ${response.status}`)
    const responseData = response.data as { MediaContainer?: { size?: number; Metadata?: PlexMusicArtist[] } }
    console.log(`[PlexProvider] MediaContainer size: ${responseData?.MediaContainer?.size || 0}`)

    const artists = responseData?.MediaContainer?.Metadata || []
    console.log(`[PlexProvider] Found ${artists.length} artists in library ${libraryKey}`)

    // Log first artist for debugging
    if (artists.length > 0) {
      console.log(`[PlexProvider] First artist sample:`, JSON.stringify(artists[0], null, 2).substring(0, 500))
    }

    return artists
  }

  /**
   * Get all albums from a music library (optionally filtered by artist)
   */
  async getMusicAlbums(libraryKey: string, artistKey?: string): Promise<PlexMusicAlbum[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    let url: string
    if (artistKey) {
      // Get albums for specific artist using /children endpoint
      url = `${this.selectedServer.uri}/library/metadata/${artistKey}/children`
    } else {
      // Get all albums in library
      url = `${this.selectedServer.uri}/library/sections/${libraryKey}/all`
    }

    console.log(`[PlexProvider] Fetching albums from ${artistKey ? `artist ${artistKey}` : `library ${libraryKey}`}`)
    console.log(`[PlexProvider] URL: ${url}`)

    const response = await this.api.get(url, {
      params: artistKey ? undefined : { type: 9 }, // 9 = album
      headers: {
        'X-Plex-Token': this.selectedServer.accessToken,
        Accept: 'application/json',
      },
    })

    const responseData = response.data as { MediaContainer?: { Metadata?: PlexMusicAlbum[] } }
    const albums = responseData?.MediaContainer?.Metadata || []
    console.log(`[PlexProvider] Found ${albums.length} albums`)

    // Log first album for debugging
    if (albums.length > 0) {
      console.log(`[PlexProvider] First album sample:`, JSON.stringify(albums[0], null, 2).substring(0, 500))
    }

    return albums
  }

  /**
   * Get all tracks for an album
   */
  async getMusicTracks(albumKey: string): Promise<PlexMusicTrack[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    console.log(`[PlexProvider] Fetching tracks for album ${albumKey}`)

    // Request tracks with Media information included
    // Using includeFields to ensure we get all track data
    const response = await this.api.get(
      `${this.selectedServer.uri}/library/metadata/${albumKey}/children`,
      {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
          Accept: 'application/json',
        },
      }
    )

    const responseData = response.data as { MediaContainer?: { Metadata?: PlexMusicTrack[] } }
    const tracks = responseData?.MediaContainer?.Metadata || []
    console.log(`[PlexProvider] Found ${tracks.length} tracks`)

    // Log first track to check if Media data is present
    if (tracks.length > 0) {
      const firstTrack = tracks[0]
      console.log(`[PlexProvider] First track sample:`, JSON.stringify(firstTrack, null, 2).substring(0, 800))
      console.log(`[PlexProvider] First track has Media: ${!!firstTrack.Media}`)

      // If no Media data, we may need to fetch each track individually
      if (!firstTrack.Media) {
        console.log(`[PlexProvider] Tracks missing Media data, fetching individual metadata...`)
        const detailedTracks: PlexMusicTrack[] = []
        for (const track of tracks) {
          try {
            const detailResponse = await this.api.get(
              `${this.selectedServer.uri}/library/metadata/${track.ratingKey}`,
              {
                headers: {
                  'X-Plex-Token': this.selectedServer.accessToken,
                  Accept: 'application/json',
                },
              }
            )
            const detailData = detailResponse.data as { MediaContainer?: { Metadata?: PlexMusicTrack[] } }
            const detailedTrack = detailData?.MediaContainer?.Metadata?.[0]
            if (detailedTrack) {
              detailedTracks.push(detailedTrack)
            }
          } catch (error) {
            console.warn(`[PlexProvider] Failed to fetch track ${track.ratingKey}:`, error)
            detailedTracks.push(track) // Use basic track data as fallback
          }
        }
        console.log(`[PlexProvider] Fetched ${detailedTracks.length} detailed tracks`)
        return detailedTracks
      }
    }

    return tracks
  }

  /**
   * Get artist metadata with external IDs
   */
  async getArtistMetadata(artistKey: string): Promise<PlexMusicArtist | null> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(
        `${this.selectedServer.uri}/library/metadata/${artistKey}`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      const responseData = response.data as { MediaContainer?: { Metadata?: PlexMusicArtist[] } }
      return responseData?.MediaContainer?.Metadata?.[0] || null
    } catch (error) {
      console.error('Failed to get artist metadata:', error)
      return null
    }
  }

  /**
   * Get album metadata with external IDs
   */
  async getAlbumMetadata(albumKey: string): Promise<PlexMusicAlbum | null> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(
        `${this.selectedServer.uri}/library/metadata/${albumKey}`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      const responseData = response.data as { MediaContainer?: { Metadata?: PlexMusicAlbum[] } }
      return responseData?.MediaContainer?.Metadata?.[0] || null
    } catch (error) {
      console.error('Failed to get album metadata:', error)
      return null
    }
  }

  /**
   * Convert Plex artist to MusicArtist type
   */
  convertToMusicArtist(item: PlexMusicArtist, libraryId?: string): MusicArtist {
    // Extract MusicBrainz ID
    let musicbrainzId: string | undefined
    if (item.Guid) {
      for (const guid of item.Guid) {
        if (guid.id.includes('mbid://')) {
          musicbrainzId = guid.id.replace('mbid://', '')
          break
        }
      }
    }

    // Extract genres
    const genres = item.Genre?.map(g => g.tag) || []

    // Extract country
    const country = item.Country?.[0]?.tag

    return {
      source_id: this.sourceId,
      source_type: 'plex',
      library_id: libraryId,
      provider_id: item.ratingKey,
      name: item.title,
      sort_name: item.title,
      musicbrainz_id: musicbrainzId,
      genres: JSON.stringify(genres),
      country,
      biography: item.summary,
      thumb_url: item.thumb ? `${this.selectedServer?.uri}${item.thumb}?X-Plex-Token=${this.selectedServer?.accessToken}` : undefined,
      art_url: item.art ? `${this.selectedServer?.uri}${item.art}?X-Plex-Token=${this.selectedServer?.accessToken}` : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Plex album to MusicAlbum type
   */
  convertToMusicAlbum(item: PlexMusicAlbum, artistId?: number, libraryId?: string): MusicAlbum {
    // Extract MusicBrainz ID
    let musicbrainzId: string | undefined
    if (item.Guid) {
      for (const guid of item.Guid) {
        if (guid.id.includes('mbid://')) {
          musicbrainzId = guid.id.replace('mbid://', '')
          break
        }
      }
    }

    // Extract genres
    const genres = item.Genre?.map(g => g.tag) || []

    return {
      source_id: this.sourceId,
      source_type: 'plex',
      library_id: libraryId,
      provider_id: item.ratingKey,
      artist_id: artistId,
      artist_name: item.parentTitle || 'Unknown Artist',
      title: item.title,
      sort_title: item.title,
      year: item.year,
      musicbrainz_id: musicbrainzId,
      genres: JSON.stringify(genres),
      studio: item.studio,
      album_type: 'album', // Default, could be refined
      thumb_url: item.thumb ? `${this.selectedServer?.uri}${item.thumb}?X-Plex-Token=${this.selectedServer?.accessToken}` : undefined,
      art_url: item.art ? `${this.selectedServer?.uri}${item.art}?X-Plex-Token=${this.selectedServer?.accessToken}` : undefined,
      release_date: item.originallyAvailableAt,
      added_at: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Plex track to MusicTrack type
   */
  convertToMusicTrack(item: PlexMusicTrack, albumId?: number, artistId?: number, libraryId?: string): MusicTrack | null {
    const media = item.Media?.[0]
    const part = media?.Part?.[0]
    const audioStream = part?.Stream?.find(s => s.streamType === 2)

    if (!media || !part) {
      console.warn(`[PlexProvider] Skipping track "${item.title}" - no Media/Part data`)
      return null
    }

    // audio_codec is required - use a default if not available
    const audioCodec = media.audioCodec || audioStream?.codec || 'unknown'

    // Extract MusicBrainz ID
    let musicbrainzId: string | undefined
    if (item.Guid) {
      for (const guid of item.Guid) {
        if (guid.id.includes('mbid://')) {
          musicbrainzId = guid.id.replace('mbid://', '')
          break
        }
      }
    }

    // Determine if lossless
    const codec = audioCodec.toLowerCase()
    const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'pcm', 'ape', 'wavpack']
    const isLossless = losslessCodecs.some(lc => codec.includes(lc))

    // Determine if hi-res (sample rate > 44100 or bit depth > 16)
    const sampleRate = audioStream?.samplingRate || 44100
    const bitDepth = audioStream?.bitDepth || 16
    const isHiRes = isLossless && (sampleRate > 44100 || bitDepth > 16)

    return {
      source_id: this.sourceId,
      source_type: 'plex',
      library_id: libraryId,
      provider_id: item.ratingKey,
      album_id: albumId,
      artist_id: artistId,
      album_name: item.parentTitle,
      artist_name: item.grandparentTitle || 'Unknown Artist',
      title: item.title,
      track_number: item.index,
      disc_number: item.parentIndex || 1,
      duration: item.duration,
      file_path: part.file,
      file_size: part.size,
      container: media.container,
      audio_codec: audioCodec,
      audio_bitrate: media.bitrate,
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      channels: media.audioChannels,
      is_lossless: isLossless,
      is_hi_res: isHiRes,
      musicbrainz_id: musicbrainzId,
      added_at: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Scan a music library
   */
  async scanMusicLibrary(libraryId: string, onProgress?: ProgressCallback): Promise<ScanResult> {
    // Reset cancellation flag at start
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
        plexAlbum: PlexMusicAlbum,
        artistId: number | undefined,
        artistName?: string
      ): Promise<{ trackCount: number }> => {
        // Get album metadata with external IDs
        const albumMetadata = await this.getAlbumMetadata(plexAlbum.ratingKey)
        const albumData = albumMetadata
          ? this.convertToMusicAlbum(albumMetadata, artistId, libraryId)
          : this.convertToMusicAlbum(plexAlbum, artistId, libraryId)

        // Override artist name if provided (for compilations)
        if (artistName && !albumData.artist_name) {
          albumData.artist_name = artistName
        }

        // Get all tracks for this album
        const tracks = await this.getMusicTracks(plexAlbum.ratingKey)

        // Calculate album stats
        let totalDuration = 0
        let totalSize = 0
        let bestBitrate = 0
        let bestSampleRate = 0
        let bestBitDepth = 0
        let bestCodec = ''
        let totalBitrate = 0

        const trackDataList: MusicTrack[] = []

        for (const plexTrack of tracks) {
          const trackData = this.convertToMusicTrack(plexTrack, undefined, artistId, libraryId)
          if (trackData) {
            trackDataList.push(trackData)
            totalDuration += trackData.duration || 0
            totalSize += trackData.file_size || 0

            if ((trackData.audio_bitrate || 0) > bestBitrate) {
              bestBitrate = trackData.audio_bitrate || 0
              bestCodec = trackData.audio_codec
            }
            if ((trackData.sample_rate || 0) > bestSampleRate) {
              bestSampleRate = trackData.sample_rate || 0
            }
            if ((trackData.bit_depth || 0) > bestBitDepth) {
              bestBitDepth = trackData.bit_depth || 0
            }
            totalBitrate += trackData.audio_bitrate || 0
          }
        }

        // Update album with aggregated data
        albumData.track_count = trackDataList.length
        albumData.total_duration = totalDuration
        albumData.total_size = totalSize
        albumData.best_audio_codec = bestCodec
        albumData.best_audio_bitrate = bestBitrate
        albumData.best_sample_rate = bestSampleRate
        albumData.best_bit_depth = bestBitDepth
        albumData.avg_audio_bitrate = trackDataList.length > 0
          ? Math.round(totalBitrate / trackDataList.length)
          : 0

        // Upsert album
        const albumId = await db.upsertMusicAlbum(albumData)
        scannedAlbumIds.add(plexAlbum.ratingKey)

        // Upsert tracks
        for (const trackData of trackDataList) {
          trackData.album_id = albumId
          await db.upsertMusicTrack(trackData)
          scannedTrackIds.add(trackData.provider_id)
          result.itemsScanned++
        }

        return { trackCount: trackDataList.length }
      }

      // Phase 1: Get all artists and scan their albums
      const artists = await this.getMusicArtists(libraryId)
      const totalArtists = artists.length

      console.log(`[PlexProvider ${this.sourceId}] Scanning music library: ${totalArtists} artists`)

      let processed = 0

      for (const plexArtist of artists) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[PlexProvider ${this.sourceId}] Music scan cancelled at artist ${processed}/${totalArtists}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          // Get artist metadata with external IDs
          const artistMetadata = await this.getArtistMetadata(plexArtist.ratingKey)
          const artistData = artistMetadata ? this.convertToMusicArtist(artistMetadata, libraryId) : this.convertToMusicArtist(plexArtist, libraryId)

          // Upsert artist
          const artistId = await db.upsertMusicArtist(artistData)
          scannedArtistIds.add(plexArtist.ratingKey)

          // Get all albums for this artist
          const albums = await this.getMusicAlbums(libraryId, plexArtist.ratingKey)

          let artistTrackCount = 0
          let artistAlbumCount = 0

          for (const plexAlbum of albums) {
            const { trackCount } = await processAlbum(plexAlbum, artistId)
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
              currentItem: plexArtist.title,
              percentage: (processed / totalArtists) * 50, // First 50% for artists
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process artist ${plexArtist.title}: ${getErrorMessage(error)}`)
        }
      }

      // Phase 2: Get all albums directly to catch compilations and orphaned albums
      console.log(`[PlexProvider ${this.sourceId}] Scanning for compilations and orphaned albums...`)

      const allAlbums = await this.getMusicAlbums(libraryId)
      const unprocessedAlbums = allAlbums.filter(a => !scannedAlbumIds.has(a.ratingKey))

      console.log(`[PlexProvider ${this.sourceId}] Found ${unprocessedAlbums.length} additional albums (compilations/orphaned)`)

      let compilationProcessed = 0
      const totalCompilations = unprocessedAlbums.length

      for (const plexAlbum of unprocessedAlbums) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[PlexProvider ${this.sourceId}] Music scan cancelled at compilation ${compilationProcessed}/${totalCompilations}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          // Determine artist for the album
          // For compilations, use the album's parentTitle or "Various Artists"
          const artistName = plexAlbum.parentTitle || 'Various Artists'

          // Check if we have this artist already, otherwise create
          let artistId: number | undefined

          // Try to find existing artist
          const existingArtists = db.getMusicArtists({ sourceId: this.sourceId }) as Array<{ id?: number; name: string }>
          const existingArtist = existingArtists.find((a: typeof existingArtists[0]) =>
            a.name.toLowerCase() === artistName.toLowerCase()
          )

          if (existingArtist) {
            artistId = existingArtist.id
          } else {
            // Create a new artist entry for compilations/Various Artists
            const newArtistData: MusicArtist = {
              source_id: this.sourceId,
              source_type: 'plex',
              library_id: libraryId,
              provider_id: `compilation_${artistName.replace(/\s+/g, '_').toLowerCase()}`,
              name: artistName,
              sort_name: artistName,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
            artistId = await db.upsertMusicArtist(newArtistData)
          }

          await processAlbum(plexAlbum, artistId, artistName)

          // Update artist counts
          if (artistId) {
            const artistAlbums = db.getMusicAlbums({ artistId })
            const artistTracks = db.getMusicTracks({ artistId })
            await db.updateMusicArtistCounts(artistId, artistAlbums.length, artistTracks.length)
          }

          compilationProcessed++
          if (onProgress) {
            onProgress({
              current: compilationProcessed,
              total: totalCompilations,
              phase: 'processing',
              currentItem: plexAlbum.title,
              percentage: 50 + (compilationProcessed / Math.max(totalCompilations, 1)) * 50, // Last 50%
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process album ${plexAlbum.title}: ${getErrorMessage(error)}`)
        }
      }

      // Update scan time
      await db.updateSourceScanTime(this.sourceId)

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[PlexProvider ${this.sourceId}] Music scan complete: ${result.itemsScanned} tracks (including ${totalCompilations} compilation albums)`)

      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  // ============================================================================
  // CANCELLATION
  // ============================================================================

  /**
   * Cancel the current library scan
   */
  cancelScan(): void {
    this.scanCancelled = true
    console.log('[PlexProvider] Library scan cancellation requested')
  }

  /**
   * Cancel the current music library scan
   */
  cancelMusicScan(): void {
    this.musicScanCancelled = true
    console.log('[PlexProvider] Music library scan cancellation requested')
  }

  /**
   * Check if scan is cancelled
   */
  isScanCancelled(): boolean {
    return this.scanCancelled
  }

  /**
   * Check if music scan is cancelled
   */
  isMusicScanCancelled(): boolean {
    return this.musicScanCancelled
  }

  // ============================================================================
  // GETTERS
  // ============================================================================

  getAuthToken(): string | null {
    return this.authToken
  }

  getSelectedServer(): PlexServer | null {
    return this.selectedServer
  }

  hasSelectedServer(): boolean {
    return this.selectedServer !== null
  }

  setAuthToken(token: string): void {
    this.authToken = token
  }

  setSelectedServer(server: PlexServer): void {
    this.selectedServer = server
  }
}
