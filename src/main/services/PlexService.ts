import { getErrorMessage, isAxiosError } from './utils/errorUtils'
import axios, { AxiosInstance } from 'axios'
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { AudioCodecRanker } from './AudioCodecRanker'
import type {
  PlexAuthPin,
  PlexUser,
  PlexServer,
  PlexLibrary,
  PlexMediaItem,
  PlexCollection,
  ScanProgress,
} from '../types/plex'
import type { MediaItem, AudioTrack } from '../types/database'

const PLEX_API_URL = 'https://plex.tv/api/v2'
const PLEX_TV_URL = 'https://plex.tv'
const CLIENT_IDENTIFIER = 'totality'
const PRODUCT_NAME = 'Totality'

export class PlexService {
  private authToken: string | null = null
  private selectedServer: PlexServer | null = null
  private api: AxiosInstance
  private initPromise: Promise<void> | null = null

  constructor() {
    this.api = axios.create({
      timeout: 30000, // 30 second timeout for API requests
      headers: {
        'X-Plex-Client-Identifier': CLIENT_IDENTIFIER,
        'X-Plex-Product': PRODUCT_NAME,
        'X-Plex-Version': '1.0.0',
        'X-Plex-Platform': 'Windows',
        Accept: 'application/json',
      },
    })

    // Auth token will be loaded via initialize() when needed
  }

  /**
   * Initialize the service - loads auth token from database
   * This is called automatically by public methods
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadAuthToken()
    }
    return this.initPromise
  }

  /**
   * Load saved auth token from database
   */
  private async loadAuthToken(): Promise<void> {
    try {
      const db = getDatabase()
      const token = await db.getSetting('plex_token')
      if (token) {
        this.authToken = token
      }
    } catch (error) {
      console.error('Failed to load auth token:', error)
    }
  }

  /**
   * Save auth token to database
   */
  private async saveAuthToken(token: string): Promise<void> {
    try {
      const db = getDatabase()
      await db.setSetting('plex_token', token)
      this.authToken = token
    } catch (error) {
      console.error('Failed to save auth token:', error)
      throw error
    }
  }

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
        await this.saveAuthToken(pin.authToken)
        return pin.authToken
      }

      return null
    } catch (error) {
      console.error('Failed to check auth PIN:', error)
      return null
    }
  }

  /**
   * Authenticate with a token directly (for testing or manual entry)
   */
  async authenticateWithToken(token: string): Promise<boolean> {
    try {
      // Verify the token works
      const response = await this.api.get(`${PLEX_TV_URL}/users/account`, {
        headers: {
          'X-Plex-Token': token,
        },
      })

      if (response.data) {
        await this.saveAuthToken(token)
        return true
      }

      return false
    } catch (error) {
      console.error('Failed to authenticate with token:', error)
      return false
    }
  }

  /**
   * Get user account info
   */
  async getUserInfo(): Promise<PlexUser | null> {
    await this.initialize()

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

  /**
   * Get available Plex servers
   */
  async getServers(): Promise<PlexServer[]> {
    await this.initialize()

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

      // API v2 returns array of resources directly
      const resources = Array.isArray(response.data) ? response.data : []

      // Filter for server resources only
      const servers = resources.filter((r: any) => r.provides === 'server')

      return servers.map((server: any) => {
        // Prefer local HTTP connections to avoid SSL certificate issues
        // Otherwise use the first available connection
        const localHttp = server.connections?.find((c: any) => c.local && c.protocol === 'http')
        const preferredConnection = localHttp || server.connections?.[0]

        if (!preferredConnection) {
          console.warn(`No valid connection found for server ${server.name}`)
        }

        return {
          name: server.name,
          host: server.publicAddress || server.address,
          port: parseInt(preferredConnection?.port, 10) || 32400,
          machineIdentifier: server.clientIdentifier,
          version: server.productVersion,
          scheme: preferredConnection?.protocol || 'https',
          address: preferredConnection?.address || server.publicAddress,
          uri: preferredConnection?.uri || `${preferredConnection?.protocol}://${preferredConnection?.address}:${preferredConnection?.port}`,
          localAddresses: server.connections
            ?.filter((c: any) => c.local)
            .map((c: any) => c.address)
            .join(',') || '',
          owned: server.owned === true || server.owned === 1,
          accessToken: server.accessToken,
        }
      })
    } catch (error) {
      console.error('Failed to get servers:', error)
      throw new Error('Failed to fetch Plex servers')
    }
  }

  /**
   * Select a server to use
   */
  async selectServer(machineIdentifier: string): Promise<boolean> {
    const servers = await this.getServers()
    const server = servers.find((s) => s.machineIdentifier === machineIdentifier)

    if (!server) {
      throw new Error('Server not found')
    }

    this.selectedServer = server

    // Save selected server to database
    const db = getDatabase()
    await db.setSetting('plex_server_id', server.machineIdentifier)
    await db.setSetting('plex_server_url', server.uri)

    return true
  }

  /**
   * Get libraries from selected server
   */
  async getLibraries(): Promise<PlexLibrary[]> {
    await this.initialize()

    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const baseUrl = this.selectedServer.uri
      const response = await this.api.get(`${baseUrl}/library/sections`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      const directories = (response.data as any)?.MediaContainer?.Directory || []
      return directories.map((dir: any) => ({
        key: dir.key,
        title: dir.title,
        type: dir.type,
        agent: dir.agent,
        scanner: dir.scanner,
        language: dir.language,
        uuid: dir.uuid,
        updatedAt: dir.updatedAt,
        createdAt: dir.createdAt,
        scannedAt: dir.scannedAt,
        content: dir.content,
        directory: dir.directory,
        contentChangedAt: dir.contentChangedAt,
        hidden: dir.hidden,
      }))
    } catch (error) {
      console.error('Failed to get libraries:', error)
      throw new Error('Failed to fetch Plex libraries')
    }
  }

  /**
   * Get all media items from a library
   */
  async getLibraryItems(libraryKey: string): Promise<PlexMediaItem[]> {
    await this.initialize()

    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const baseUrl = this.selectedServer.uri
      const response = await this.api.get(`${baseUrl}/library/sections/${libraryKey}/all`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      return (response.data as any)?.MediaContainer?.Metadata || []
    } catch (error) {
      console.error('Failed to get library items:', error)
      throw new Error('Failed to fetch library items')
    }
  }

  /**
   * Get detailed metadata for a specific item
   */
  async getItemMetadata(ratingKey: string): Promise<PlexMediaItem | null> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const baseUrl = this.selectedServer.uri
      const response = await this.api.get(`${baseUrl}/library/metadata/${ratingKey}`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      const metadata = (response.data as any)?.MediaContainer?.Metadata?.[0]
      return metadata || null
    } catch (error) {
      console.error('Failed to get item metadata:', error)
      return null
    }
  }

  /**
   * Get all episodes for a TV show
   */
  async getAllEpisodes(showKey: string): Promise<PlexMediaItem[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const baseUrl = this.selectedServer.uri
      const response = await this.api.get(`${baseUrl}/library/metadata/${showKey}/allLeaves`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      return (response.data as any)?.MediaContainer?.Metadata || []
    } catch (error) {
      console.error('Failed to get episodes:', error)
      return []
    }
  }

  /**
   * Get season metadata
   */
  async getSeasonMetadata(seasonKey: string): Promise<PlexMediaItem | null> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const baseUrl = this.selectedServer.uri
      const response = await this.api.get(`${baseUrl}/library/metadata/${seasonKey}`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      const metadata = (response.data as any)?.MediaContainer?.Metadata?.[0]
      return metadata || null
    } catch (error) {
      console.error('Failed to get season metadata:', error)
      return null
    }
  }

  /**
   * Get all collections from a library
   */
  async getLibraryCollections(libraryKey: string): Promise<PlexCollection[]> {
    await this.initialize()

    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const baseUrl = this.selectedServer.uri

      // Try the /all endpoint with type=18 (collections) - more reliable
      console.log(`[PlexService] Fetching collections with type=18 for library ${libraryKey}`)
      const response = await this.api.get(
        `${baseUrl}/library/sections/${libraryKey}/all`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
          params: {
            type: 18, // Type 18 is collections in Plex
          },
        }
      )

      const mediaContainer = (response.data as any)?.MediaContainer
      console.log(`[PlexService] Response MediaContainer:`, JSON.stringify({
        size: mediaContainer?.size,
        totalSize: mediaContainer?.totalSize,
        metadataCount: mediaContainer?.Metadata?.length || 0
      }))

      const collections = mediaContainer?.Metadata || []
      console.log(`[PlexService] Found ${collections.length} collections`)

      if (collections.length > 0) {
        console.log(`[PlexService] First collection:`, JSON.stringify(collections[0], null, 2))
      }

      return collections
    } catch (error: unknown) {
      console.error('[PlexService] Failed to get library collections:', getErrorMessage(error))
      if (isAxiosError(error) && error.response) {
        console.error('[PlexService] Response status:', error.response.status)
        console.error('[PlexService] Response data:', JSON.stringify(error.response.data))
      }
      throw new Error('Failed to fetch library collections')
    }
  }

  /**
   * Get all items in a collection
   */
  async getCollectionChildren(collectionKey: string): Promise<PlexMediaItem[]> {
    await this.initialize()

    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const baseUrl = this.selectedServer.uri
      const response = await this.api.get(
        `${baseUrl}/library/collections/${collectionKey}/children`,
        {
          headers: {
            'X-Plex-Token': this.selectedServer.accessToken,
          },
        }
      )

      return (response.data as any)?.MediaContainer?.Metadata || []
    } catch (error) {
      console.error('Failed to get collection children:', error)
      throw new Error('Failed to fetch collection items')
    }
  }

  /**
   * Build full image URL for collection artwork
   */
  buildCollectionImageUrl(imagePath: string | undefined): string | undefined {
    if (!imagePath || !this.selectedServer) return undefined
    return `${this.selectedServer.uri}${imagePath}?X-Plex-Token=${this.selectedServer.accessToken}`
  }

  /**
   * Scan a library and save items to database
   */
  async scanLibrary(
    libraryKey: string,
    onProgress?: (progress: ScanProgress) => void
  ): Promise<number> {
    const items = await this.getLibraryItems(libraryKey)
    const db = getDatabase()
    const analyzer = getQualityAnalyzer()
    await analyzer.loadThresholdsFromDatabase()

    let scanned = 0
    let totalItems = items.length

    // Track scanned plex_ids to remove stale items later
    const scannedPlexIds = new Set<string>()

    // Determine library type based on first item
    let libraryType: 'movie' | 'show' | null = null

    // Cache for season metadata to avoid repeated fetches
    const seasonCache = new Map<string, PlexMediaItem | null>()

    // Cache for show-level TMDB IDs (from show metadata GUIDs)
    const showTmdbIdCache = new Map<string, string | undefined>()

    // First pass: count total episodes for TV shows
    const itemsToProcess: Array<PlexMediaItem & { _showTmdbId?: string }> = []
    for (const item of items) {
      // Determine library type from first item
      if (libraryType === null) {
        libraryType = (item as any).type === 'show' ? 'show' : 'movie'
      }

      if ((item as any).type === 'show') {
        // For TV shows, get show metadata to extract show-level TMDB ID
        const showMetadata = await this.getItemMetadata(item.ratingKey)
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
          console.log(`Show "${item.title}" has TMDB ID: ${showTmdbId}`)
        }

        // Get all episodes
        const episodes = await this.getAllEpisodes(item.ratingKey)
        // Attach show TMDB ID to each episode for later use
        for (const ep of episodes) {
          (ep as any)._showTmdbId = showTmdbId
        }
        itemsToProcess.push(...episodes)
      } else {
        // For movies, concerts, etc., add directly
        itemsToProcess.push(item)
      }
    }

    totalItems = itemsToProcess.length
    console.log(`Processing ${totalItems} items...`)

    // Start batch mode for better performance (reduces disk writes)
    db.startBatch()

    // Process items in parallel batches for better performance
    const BATCH_SIZE = 10 // Number of concurrent API requests

    try {
      for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
        const batch = itemsToProcess.slice(i, i + BATCH_SIZE)

        // Fetch metadata for all items in batch concurrently
        const metadataResults = await Promise.allSettled(
          batch.map(item => this.getItemMetadata(item.ratingKey))
        )

        // Process each result
        for (let j = 0; j < batch.length; j++) {
          const item = batch[j]
          const result = metadataResults[j]

          try {
            if (result.status === 'rejected') {
              console.error(`Failed to fetch metadata for ${item.title}:`, result.reason)
              continue
            }

            const detailed = result.value
            if (!detailed || !detailed.Media || detailed.Media.length === 0) {
              console.warn(`No media info for ${item.title}, skipping`)
              continue
            }

            // For TV episodes, fetch season metadata if we have a parentKey
            if (detailed.type === 'episode' && detailed.parentKey) {
              const seasonKey = detailed.parentKey.split('/').pop()
              if (seasonKey && !seasonCache.has(seasonKey)) {
                const seasonMetadata = await this.getSeasonMetadata(seasonKey)
                seasonCache.set(seasonKey, seasonMetadata)
              }

              // Add season thumb to episode metadata if available
              const seasonMetadata = seasonCache.get(seasonKey!)
              if (seasonMetadata?.thumb && !detailed.parentThumb) {
                detailed.parentThumb = seasonMetadata.thumb
              }
            }

            // Convert to MediaItem (pass show TMDB ID for episodes)
            const showTmdbId = (item as any)._showTmdbId
            const mediaItem = this.convertToMediaItem(detailed, showTmdbId)
            if (mediaItem) {
              const id = await db.upsertMediaItem(mediaItem)

              // Track this plex_id as valid
              if (mediaItem.plex_id) {
                scannedPlexIds.add(mediaItem.plex_id)
              }

              // Analyze quality
              mediaItem.id = id
              const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
              await db.upsertQualityScore(qualityScore)

              scanned++
            }

            // Report progress
            if (onProgress) {
              onProgress({
                scanned,
                total: totalItems,
                currentItem: item.title,
                percentage: (scanned / totalItems) * 100,
              })
            }
          } catch (error) {
            console.error(`Failed to process ${item.title}:`, error)
          }
        }

        // Periodic checkpoint save every 50 items for crash recovery
        if (scanned % 50 === 0 && scanned > 0) {
          await db.forceSave()
          console.log(`Checkpoint saved at ${scanned} items`)
        }
      }
    } finally {
      // Always end batch mode to ensure data is saved
      await db.endBatch()
    }

    // Remove items that are no longer in Plex library
    if (libraryType && scannedPlexIds.size > 0) {
      const itemType = libraryType === 'show' ? 'episode' : 'movie'
      const removedCount = await db.removeStaleMediaItems(scannedPlexIds, itemType)
      if (removedCount > 0) {
        console.log(`Removed ${removedCount} stale ${itemType}(s) no longer in Plex library`)
      }
    }

    // Update last scan time
    await db.setSetting('last_scan_time', new Date().toISOString())

    return scanned
  }

  /**
   * Detect HDR format from color metadata
   */
  private detectHDRFormat(
    colorTrc?: string,
    colorPrimaries?: string
  ): string {
    if (!colorTrc) return 'None'

    const trcLower = colorTrc.toLowerCase()
    const primariesLower = (colorPrimaries || '').toLowerCase()

    // Dolby Vision: PQ + BT.2020
    if (trcLower.includes('smpte2084') && primariesLower.includes('bt2020')) {
      return 'Dolby Vision'
    }

    // HDR10: PQ transfer
    if (trcLower.includes('smpte2084') || trcLower.includes('st2084')) {
      return 'HDR10'
    }

    // HLG: Hybrid Log-Gamma
    if (trcLower.includes('arib-std-b67') || trcLower.includes('hlg')) {
      return 'HLG'
    }

    return 'None'
  }

  /**
   * Detect object-based audio (Atmos, DTS:X)
   */
  private detectObjectAudio(
    codec: string,
    audioChannelLayout?: string,
    channels?: number
  ): boolean {
    const codecLower = codec.toLowerCase()
    const layoutLower = (audioChannelLayout || '').toLowerCase()

    // Dolby Atmos
    if (codecLower.includes('atmos')) return true
    if (codecLower === 'truehd' && (channels || 0) > 6) return true
    if (layoutLower.includes('atmos')) return true

    // DTS:X
    if (codecLower.includes('dts:x') || codecLower.includes('dtsx')) return true

    return false
  }

  /**
   * Convert Plex media item to our MediaItem format
   * @param item The Plex media item
   * @param showTmdbId For episodes, the show-level TMDB ID from show metadata
   */
  private convertToMediaItem(item: PlexMediaItem, showTmdbId?: string): MediaItem | null {
    const media = item.Media?.[0]
    const part = media?.Part?.[0]

    if (!media || !part) {
      return null
    }

    // Get video stream
    const videoStream = part.Stream?.find((s) => s.streamType === 1)
    // Get ALL audio streams
    const audioStreams = part.Stream?.filter((s) => s.streamType === 2) || []

    if (!videoStream || audioStreams.length === 0) {
      console.warn(`Missing streams for ${item.title}`)
      return null
    }

    // Build audio tracks array and find the best one for quality scoring
    const audioTracks: AudioTrack[] = audioStreams.map((stream, index) => ({
      index,
      codec: stream.codec || 'unknown',
      channels: stream.channels || 2,
      bitrate: stream.bitrate || 0,
      language: stream.language || stream.languageCode,
      title: stream.displayTitle || stream.title,
      profile: stream.profile,
      sampleRate: stream.samplingRate,
      isDefault: stream.selected === true,
      hasObjectAudio: this.detectObjectAudio(stream.codec || '', stream.audioChannelLayout, stream.channels)
    }))

    // Find best audio track using AudioCodecRanker: prioritize codec quality tier, then channels, then bitrate
    const bestAudioTrack = audioTracks.reduce((best, current) => {
      const bestTier = AudioCodecRanker.getTier(best.codec, best.hasObjectAudio || false)
      const currentTier = AudioCodecRanker.getTier(current.codec, current.hasObjectAudio || false)

      // Higher codec quality tier wins
      if (currentTier > bestTier) return current
      if (bestTier > currentTier) return best

      // Same tier: more channels is better
      if (current.channels > best.channels) return current
      if (best.channels > current.channels) return best

      // Same channels: higher bitrate is better
      if (current.bitrate > best.bitrate) return current
      return best
    }, audioTracks[0])

    // Use best audio stream for primary fields
    const audioStream = audioStreams.find((_, i) => i === bestAudioTrack.index) || audioStreams[0]

    // Extract IMDb/TMDb IDs from GUIDs
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

    // Build full poster URLs with server and token
    let posterUrl: string | undefined
    let episodeThumbUrl: string | undefined
    let seasonPosterUrl: string | undefined

    if (this.selectedServer) {
      // For movies: use item thumb
      // For TV episodes: use grandparent thumb (show poster)
      if (item.thumb) {
        const thumbPath = item.type === 'episode' && item.grandparentThumb
          ? item.grandparentThumb
          : item.thumb
        posterUrl = `${this.selectedServer.uri}${thumbPath}?X-Plex-Token=${this.selectedServer.accessToken}`
      }

      // For episodes: also store episode thumbnail and season poster
      if (item.type === 'episode') {
        if (item.thumb) {
          episodeThumbUrl = `${this.selectedServer.uri}${item.thumb}?X-Plex-Token=${this.selectedServer.accessToken}`
        }
        if (item.parentThumb) {
          seasonPosterUrl = `${this.selectedServer.uri}${item.parentThumb}?X-Plex-Token=${this.selectedServer.accessToken}`
          console.log(`Episode "${item.title}" - Season poster URL: ${seasonPosterUrl}`)
        } else {
          console.log(`Episode "${item.title}" - No parentThumb available`)
        }
      }
    }

    // Extract enhanced metadata from streams
    const videoFrameRate = videoStream.frameRate
    const colorBitDepth = videoStream.bitDepth
    const hdrFormat = this.detectHDRFormat(
      videoStream.colorTrc,
      videoStream.colorPrimaries
    )
    const colorSpace = videoStream.colorSpace
    const videoProfile = videoStream.profile
    const videoLevel = videoStream.level

    const audioProfile = audioStream.profile
    const audioSampleRate = audioStream.samplingRate
    const hasObjectAudio = this.detectObjectAudio(
      audioStream.codec,
      audioStream.audioChannelLayout,
      audioStream.channels
    )

    const container = part.container || media.container

    // Use Plex's resolution classification (prefer stream resolution over media resolution)
    const resolution = videoStream.displayTitle?.match(/\d+p|4K|SD/i)?.[0] ||
                       media.videoResolution ||
                       `${media.width}x${media.height}`

    return {
      plex_id: item.ratingKey,
      title: item.title,
      year: item.year,
      type: item.type,
      series_title: item.grandparentTitle,
      season_number: item.parentIndex,
      episode_number: item.index,

      file_path: part.file,
      file_size: part.size,
      duration: item.duration,

      resolution: resolution,
      width: media.width,
      height: media.height,
      video_codec: media.videoCodec,
      video_bitrate: media.bitrate,

      audio_codec: media.audioCodec,
      audio_channels: media.audioChannels,
      audio_bitrate: audioStream.bitrate || 0,

      // Enhanced video quality metadata
      video_frame_rate: videoFrameRate,
      color_bit_depth: colorBitDepth,
      hdr_format: hdrFormat,
      color_space: colorSpace,
      video_profile: videoProfile,
      video_level: videoLevel,

      // Enhanced audio quality metadata
      audio_profile: audioProfile,
      audio_sample_rate: audioSampleRate,
      has_object_audio: hasObjectAudio,

      // Container metadata
      container: container,

      // All audio tracks
      audio_tracks: JSON.stringify(audioTracks),

      imdb_id: imdbId,
      tmdb_id: tmdbId,
      series_tmdb_id: showTmdbId, // Show-level TMDB ID (for episodes)
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

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    await this.initialize()
    return this.authToken !== null
  }

  /**
   * Check if server is selected
   */
  hasSelectedServer(): boolean {
    return this.selectedServer !== null
  }

  /**
   * Get current auth token
   */
  getAuthToken(): string | null {
    return this.authToken
  }

  /**
   * Sign out
   */
  async signOut(): Promise<void> {
    this.authToken = null
    this.selectedServer = null

    const db = getDatabase()
    await db.setSetting('plex_token', '')
    await db.setSetting('plex_server_id', '')
    await db.setSetting('plex_server_url', '')
  }
}

// Export singleton instance
let plexInstance: PlexService | null = null

export function getPlexService(): PlexService {
  if (!plexInstance) {
    plexInstance = new PlexService()
  }
  return plexInstance
}
