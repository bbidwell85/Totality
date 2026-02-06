import { getErrorMessage } from '../../services/utils/errorUtils'
/**
 * KodiProvider
 *
 * Implements the MediaProvider interface for Kodi Media Center.
 * Uses Kodi's JSON-RPC API for communication.
 *
 * Note: Kodi must have the web interface enabled and may require authentication.
 * The library must already be scanned in Kodi before it can be accessed.
 */

import axios, { AxiosInstance } from 'axios'
import * as fs from 'fs'
import { getDatabaseService } from '../../services/DatabaseService'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getMediaFileAnalyzer, FileAnalysisResult } from '../../services/MediaFileAnalyzer'
import type {
  MediaProvider,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  SourceConfig,
  AudioStreamInfo,
} from '../base/MediaProvider'
import type { MediaItem, AudioTrack, MusicArtist, MusicAlbum, MusicTrack } from '../../types/database'
import {
  isLosslessCodec,
  isHiRes,
  calculateAlbumStats,
} from '../base/MusicScannerUtils'

// Kodi JSON-RPC types
interface KodiRpcResponse<T> {
  jsonrpc: string
  id: number
  result?: T
  error?: {
    code: number
    message: string
  }
}

interface KodiMovie {
  movieid: number
  title: string
  file: string
  year?: number
  runtime?: number // Duration in minutes
  streamdetails: KodiStreamDetails
  imdbnumber?: string
  art?: {
    poster?: string
    fanart?: string
  }
}

interface KodiTVShow {
  tvshowid: number
  title: string
  year?: number
  imdbnumber?: string
  art?: {
    poster?: string
  }
}

interface KodiEpisode {
  episodeid: number
  title: string
  file: string
  tvshowid: number
  showtitle: string
  season: number
  episode: number
  runtime?: number // Duration in minutes
  streamdetails: KodiStreamDetails
  art?: {
    thumb?: string
    'season.poster'?: string
    'tvshow.poster'?: string
  }
}

interface KodiStreamDetails {
  video?: Array<{
    codec?: string
    width?: number
    height?: number
    duration?: number
    stereomode?: string
    hdrtype?: string
  }>
  audio?: Array<{
    codec?: string
    channels?: number
    language?: string
  }>
  subtitle?: Array<{
    language?: string
  }>
}

// Kodi Music types
interface KodiMusicArtist {
  artistid: number
  artist: string
  musicbrainzartistid?: string
  genre?: string[]
  description?: string
  thumbnail?: string
}

interface KodiMusicAlbum {
  albumid: number
  title: string
  artistid: number[]
  artist: string[]
  displayartist?: string
  year?: number
  musicbrainzalbumid?: string
  musicbrainzreleasegroupid?: string
  genre?: string[]
  type?: string  // 'album', 'ep', 'single'
  thumbnail?: string
}

interface KodiMusicSong {
  songid: number
  title: string
  albumid: number
  album: string
  artistid: number[]
  artist: string[]
  displayartist?: string
  track: number
  disc?: number
  duration: number  // seconds
  file: string
  musicbrainztrackid?: string
  // Audio stream details
  samplerate?: number
  bitrate?: number
  channels?: number
}

export class KodiProvider implements MediaProvider {
  readonly providerType = 'kodi' as const
  readonly sourceId: string

  private host: string = ''
  private port: number = 8080
  private username?: string
  private password?: string
  private api: AxiosInstance
  private rpcId: number = 1

  // Cancellation support
  private musicScanCancelled = false

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || this.generateSourceId()

    // Load from connection config if provided
    if (config.connectionConfig) {
      this.host = (config.connectionConfig.host as string) || ''
      this.port = (config.connectionConfig.port as number) || 8080
      this.username = config.connectionConfig.username as string | undefined
      this.password = config.connectionConfig.password as string | undefined
    }

    this.api = axios.create({
      timeout: 30000,
    })
  }

  private generateSourceId(): string {
    return `kodi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private getBaseUrl(): string {
    return `http://${this.host}:${this.port}`
  }

  private getAuthConfig(): { auth?: { username: string; password: string } } {
    if (this.username && this.password) {
      return {
        auth: {
          username: this.username,
          password: this.password,
        },
      }
    }
    return {}
  }

  private async rpcCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.api.post<KodiRpcResponse<T>>(
      `${this.getBaseUrl()}/jsonrpc`,
      {
        jsonrpc: '2.0',
        method,
        params,
        id: this.rpcId++,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        ...this.getAuthConfig(),
      }
    )

    if (response.data.error) {
      throw new Error(`Kodi RPC error: ${response.data.error.message}`)
    }

    return response.data.result as T
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      if (!credentials.host) {
        return { success: false, error: 'Host is required' }
      }

      this.host = credentials.host
      this.port = credentials.port || 8080
      this.username = credentials.username
      this.password = credentials.password

      // Test connection
      const testResult = await this.testConnection()

      if (testResult.success) {
        return {
          success: true,
          serverName: testResult.serverName,
        }
      }

      return { success: false, error: testResult.error }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.host
  }

  async disconnect(): Promise<void> {
    // Kodi doesn't require session management
  }

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.host) {
      return { success: false, error: 'Host not configured' }
    }

    try {
      const startTime = Date.now()

      const result = await this.rpcCall<{
        version: { major: number; minor: number; revision: number; tag: string }
        name: string
      }>('JSONRPC.Version')

      const latencyMs = Date.now() - startTime

      const versionString = `${result.version.major}.${result.version.minor}.${result.version.revision}`

      return {
        success: true,
        serverName: `Kodi ${result.name || ''}`,
        serverVersion: versionString,
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
    // Kodi doesn't have the concept of separate libraries in the same way
    // Instead, we return "virtual" libraries for Movies, TV Shows, and Music
    return [
      {
        id: 'movies',
        name: 'Movies',
        type: 'movie',
      },
      {
        id: 'tvshows',
        name: 'TV Shows',
        type: 'show',
      },
      {
        id: 'music',
        name: 'Music',
        type: 'music',
      },
    ]
  }

  async getLibraryItems(libraryId: string): Promise<MediaMetadata[]> {
    if (libraryId === 'movies') {
      return this.getMovies()
    } else if (libraryId === 'tvshows') {
      return this.getEpisodes()
    }

    throw new Error(`Unknown library: ${libraryId}`)
  }

  private async getMovies(): Promise<MediaMetadata[]> {
    const result = await this.rpcCall<{ movies: KodiMovie[] }>('VideoLibrary.GetMovies', {
      properties: ['title', 'year', 'file', 'streamdetails', 'imdbnumber', 'art', 'runtime'],
    })

    const movies = result.movies || []

    // Fetch file sizes for all movies in parallel (batched to avoid overwhelming Kodi)
    const batchSize = 10
    const moviesWithSizes: Array<{ movie: KodiMovie; fileSize: number }> = []

    for (let i = 0; i < movies.length; i += batchSize) {
      const batch = movies.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (movie) => {
          const fileDetails = movie.file ? await this.getFileDetails(movie.file) : null
          return { movie, fileSize: fileDetails?.size || 0 }
        })
      )
      moviesWithSizes.push(...batchResults)
    }

    return moviesWithSizes.map(({ movie, fileSize }) => this.convertMovieToMetadata(movie, fileSize))
  }

  private async getTVShows(): Promise<KodiTVShow[]> {
    const result = await this.rpcCall<{ tvshows: KodiTVShow[] }>('VideoLibrary.GetTVShows', {
      properties: ['title', 'year', 'imdbnumber', 'art'],
    })

    return result.tvshows || []
  }

  private async getEpisodesForShow(tvshowid: number, showtitle: string): Promise<MediaMetadata[]> {
    const result = await this.rpcCall<{ episodes: KodiEpisode[] }>('VideoLibrary.GetEpisodes', {
      tvshowid,
      properties: ['title', 'file', 'season', 'episode', 'streamdetails', 'art', 'runtime'],
    })

    const episodes = result.episodes || []

    // Fetch file sizes in batches
    const batchSize = 10
    const episodesWithSizes: Array<{ episode: KodiEpisode; fileSize: number }> = []

    for (let i = 0; i < episodes.length; i += batchSize) {
      const batch = episodes.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (episode) => {
          const fileDetails = episode.file ? await this.getFileDetails(episode.file) : null
          return { episode, fileSize: fileDetails?.size || 0 }
        })
      )
      episodesWithSizes.push(...batchResults)
    }

    return episodesWithSizes.map(({ episode, fileSize }) =>
      this.convertEpisodeToMetadata({ ...episode, showtitle }, fileSize)
    )
  }

  private async getEpisodes(): Promise<MediaMetadata[]> {
    const shows = await this.getTVShows()
    const allEpisodes: MediaMetadata[] = []

    for (const show of shows) {
      const episodes = await this.getEpisodesForShow(show.tvshowid, show.title)
      allEpisodes.push(...episodes)
    }

    return allEpisodes
  }

  /**
   * Get movies added after a specific timestamp (for incremental scans)
   */
  private async getRecentlyAddedMovies(sinceTimestamp: Date): Promise<MediaMetadata[]> {
    // Format timestamp for Kodi: "YYYY-MM-DD HH:MM:SS"
    const dateStr = sinceTimestamp.toISOString().replace('T', ' ').split('.')[0]

    const result = await this.rpcCall<{ movies: KodiMovie[] }>('VideoLibrary.GetMovies', {
      properties: ['title', 'year', 'file', 'streamdetails', 'imdbnumber', 'art', 'runtime'],
      filter: {
        operator: 'greaterthan',
        field: 'dateadded',
        value: dateStr,
      },
    })

    const movies = result.movies || []

    // Fetch file sizes in batches
    const batchSize = 10
    const moviesWithSizes: Array<{ movie: KodiMovie; fileSize: number }> = []

    for (let i = 0; i < movies.length; i += batchSize) {
      const batch = movies.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (movie) => {
          const fileDetails = movie.file ? await this.getFileDetails(movie.file) : null
          return { movie, fileSize: fileDetails?.size || 0 }
        })
      )
      moviesWithSizes.push(...batchResults)
    }

    return moviesWithSizes.map(({ movie, fileSize }) => this.convertMovieToMetadata(movie, fileSize))
  }

  /**
   * Get episodes added after a specific timestamp (for incremental scans)
   */
  private async getRecentlyAddedEpisodes(sinceTimestamp: Date): Promise<MediaMetadata[]> {
    // Format timestamp for Kodi: "YYYY-MM-DD HH:MM:SS"
    const dateStr = sinceTimestamp.toISOString().replace('T', ' ').split('.')[0]

    const result = await this.rpcCall<{ episodes: KodiEpisode[] }>('VideoLibrary.GetEpisodes', {
      properties: ['title', 'file', 'season', 'episode', 'streamdetails', 'showtitle', 'art', 'runtime'],
      filter: {
        operator: 'greaterthan',
        field: 'dateadded',
        value: dateStr,
      },
    })

    const episodes = result.episodes || []

    // Fetch file sizes in batches
    const batchSize = 10
    const episodesWithSizes: Array<{ episode: KodiEpisode; fileSize: number }> = []

    for (let i = 0; i < episodes.length; i += batchSize) {
      const batch = episodes.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (episode) => {
          const fileDetails = episode.file ? await this.getFileDetails(episode.file) : null
          return { episode, fileSize: fileDetails?.size || 0 }
        })
      )
      episodesWithSizes.push(...batchResults)
    }

    return episodesWithSizes.map(({ episode, fileSize }) =>
      this.convertEpisodeToMetadata(episode, fileSize)
    )
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    // Item ID format: "movie_123" or "episode_456"
    const [type, id] = itemId.split('_')
    const numId = parseInt(id, 10)

    if (type === 'movie') {
      const result = await this.rpcCall<{ moviedetails: KodiMovie }>('VideoLibrary.GetMovieDetails', {
        movieid: numId,
        properties: ['title', 'year', 'file', 'streamdetails', 'imdbnumber', 'art'],
      })
      return this.convertMovieToMetadata(result.moviedetails)
    } else if (type === 'episode') {
      const result = await this.rpcCall<{ episodedetails: KodiEpisode }>('VideoLibrary.GetEpisodeDetails', {
        episodeid: numId,
        properties: ['title', 'file', 'season', 'episode', 'streamdetails', 'showtitle', 'art'],
      })
      return this.convertEpisodeToMetadata(result.episodedetails)
    }

    throw new Error(`Unknown item type: ${type}`)
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
      const db = getDatabaseService()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()

      const scannedProviderIds = new Set<string>()
      let items: MediaMetadata[]

      // Log incremental scan info
      if (isIncremental) {
        console.log(`[KodiProvider ${this.sourceId}] Incremental scan: fetching items added after ${sinceTimestamp!.toISOString()}`)
      }

      if (libraryId === 'movies') {
        items = isIncremental
          ? await this.getRecentlyAddedMovies(sinceTimestamp!)
          : await this.getMovies()
      } else if (libraryId === 'tvshows') {
        items = isIncremental
          ? await this.getRecentlyAddedEpisodes(sinceTimestamp!)
          : await this.getEpisodes()
      } else {
        throw new Error(`Unknown library: ${libraryId}`)
      }

      const totalItems = items.length
      if (isIncremental) {
        console.log(`[KodiProvider ${this.sourceId}] Incremental scan found ${totalItems} new/updated items`)
      } else {
        console.log(`[KodiProvider ${this.sourceId}] Processing ${totalItems} items...`)
      }

      // Start batch mode
      db.startBatch()

      // Check if ffprobe is available for metadata enhancement
      const fileAnalyzer = getMediaFileAnalyzer()
      const ffprobeAvailable = await fileAnalyzer.isAvailable()
      if (ffprobeAvailable) {
        console.log(`[KodiProvider ${this.sourceId}] FFprobe available - will enhance metadata for accessible files`)
      }

      try {
        for (let i = 0; i < items.length; i++) {
          let metadata = items[i]

          try {
            // Enhance with FFprobe if available and file is locally accessible
            if (ffprobeAvailable && this.needsFFprobeEnhancement(metadata)) {
              if (onProgress) {
                onProgress({
                  current: i + 1,
                  total: totalItems,
                  phase: 'analyzing',
                  currentItem: metadata.title,
                  percentage: ((i + 1) / totalItems) * 100,
                })
              }
              metadata = await this.enhanceWithFFprobe(metadata)
            }

            const mediaItem = this.convertMetadataToMediaItem(metadata)
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = 'kodi'
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
                currentItem: metadata.title,
                percentage: ((i + 1) / totalItems) * 100,
              })
            }
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${metadata.title}: ${getErrorMessage(error)}`)
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
        const itemType = libraryId === 'movies' ? 'movie' : 'episode'
        const existingItems = db.getMediaItems({ type: itemType, sourceId: this.sourceId })

        for (const item of existingItems) {
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

  /**
   * Detect if audio codec indicates object-based audio (Dolby Atmos, DTS:X)
   * Kodi doesn't provide explicit object audio detection, so we infer from codec name
   */
  private detectObjectAudio(codec: string | undefined, title?: string): boolean {
    const codecLower = (codec || '').toLowerCase()
    const titleLower = (title || '').toLowerCase()

    // Dolby Atmos detection
    // Atmos is typically carried in TrueHD or E-AC-3 containers
    if (codecLower.includes('atmos') || titleLower.includes('atmos')) {
      return true
    }
    // TrueHD with 7.1 or more channels is often Atmos
    if (codecLower.includes('truehd') && titleLower.includes('atmos')) {
      return true
    }

    // DTS:X detection
    if (codecLower.includes('dts:x') || codecLower.includes('dtsx') ||
        titleLower.includes('dts:x') || titleLower.includes('dts-x') || titleLower.includes('dtsx')) {
      return true
    }

    // DTS-HD MA with object audio indicator
    if ((codecLower.includes('dtshd_ma') || codecLower.includes('dts-hd ma')) &&
        (titleLower.includes(':x') || titleLower.includes('-x'))) {
      return true
    }

    return false
  }

  /**
   * Estimate audio bitrate based on codec and channel count
   * Returns estimated bitrate in kbps
   * Used as fallback when we can't calculate from file size
   */
  private estimateAudioBitrate(codec: string | undefined, channels: number | undefined): number {
    const codecLower = (codec || '').toLowerCase()
    const ch = channels || 2

    // Lossless codecs - these have much higher bitrates
    if (codecLower.includes('truehd') || codecLower.includes('atmos')) {
      // TrueHD Atmos typically 4-8 Mbps for 7.1, 2-4 Mbps for 5.1
      return ch >= 8 ? 6000 : ch >= 6 ? 4000 : 2500
    }
    if (codecLower.includes('dtshd_ma') || codecLower.includes('dts-hd ma')) {
      // DTS-HD MA typically 3-6 Mbps
      return ch >= 8 ? 5000 : ch >= 6 ? 3500 : 2000
    }
    if (codecLower.includes('dtshd') || codecLower.includes('dts-hd')) {
      return ch >= 6 ? 2500 : 1500
    }
    if (codecLower.includes('flac') || codecLower.includes('pcm')) {
      return ch >= 6 ? 3000 : 1500
    }

    // Lossy codecs
    if (codecLower.includes('dts')) {
      return ch >= 6 ? 1509 : 768
    }
    if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('ec3')) {
      return ch >= 8 ? 1024 : ch >= 6 ? 640 : 384
    }
    if (codecLower.includes('ac3') || codecLower.includes('ac-3')) {
      return ch >= 6 ? 640 : 384
    }
    if (codecLower.includes('aac')) {
      return ch >= 6 ? 384 : 256
    }

    return ch >= 6 ? 640 : 256
  }

  /**
   * Calculate audio bitrate from total file bitrate minus video bitrate
   * This is more accurate than estimation for lossless codecs
   * @param totalBitrate Total file bitrate in kbps
   * @param videoBitrate Video bitrate in kbps
   * @param numAudioTracks Number of audio tracks
   * @returns Audio bitrate per track in kbps
   */
  private calculateAudioBitrateFromFile(
    totalBitrate: number,
    videoBitrate: number,
    numAudioTracks: number
  ): number {
    if (totalBitrate <= 0 || videoBitrate <= 0 || numAudioTracks <= 0) {
      return 0
    }

    // Remaining bitrate after video is for audio + subtitles + overhead
    // Assume ~5% overhead for container/subtitles
    const audioBitrate = (totalBitrate - videoBitrate) * 0.95

    if (audioBitrate <= 0) {
      return 0
    }

    // Divide among audio tracks (primary track usually gets more, but approximate evenly)
    return Math.round(audioBitrate / numAudioTracks)
  }

  /**
   * Get file details from Kodi including file size
   */
  private async getFileDetails(filePath: string): Promise<{ size: number } | null> {
    try {
      const result = await this.rpcCall<{ filedetails: { file: string; size?: number } }>('Files.GetFileDetails', {
        file: filePath,
        properties: ['size'],
      })
      return result.filedetails?.size ? { size: result.filedetails.size } : null
    } catch (error) {
      // File might not be accessible or path format issue
      return null
    }
  }

  /**
   * Calculate bitrate from file size and duration
   * @param fileSizeBytes File size in bytes
   * @param durationSeconds Duration in seconds
   * @returns Bitrate in kbps
   */
  private calculateBitrate(fileSizeBytes: number, durationSeconds: number): number {
    if (!fileSizeBytes || !durationSeconds || durationSeconds <= 0) {
      return 0
    }
    // bitrate (kbps) = (file_size_bytes * 8) / duration_seconds / 1000
    return Math.round((fileSizeBytes * 8) / durationSeconds / 1000)
  }

  /**
   * Estimate video bitrate based on resolution (fallback when file size unavailable)
   */
  private estimateVideoBitrate(height: number): number {
    if (height >= 2160) {
      return 25000 // 4K: ~25 Mbps
    } else if (height >= 1080) {
      return 10000 // 1080p: ~10 Mbps
    } else if (height >= 720) {
      return 5000 // 720p: ~5 Mbps
    } else if (height >= 480) {
      return 2500 // SD: ~2.5 Mbps
    } else {
      return 1500 // Low res
    }
  }

  private convertMovieToMetadata(movie: KodiMovie, fileSize: number = 0): MediaMetadata {
    const video = movie.streamdetails.video?.[0]
    const audioStreams = movie.streamdetails.audio || []

    // Calculate duration in seconds (prefer streamdetails, fall back to runtime in minutes)
    let durationSeconds = video?.duration || 0
    if (!durationSeconds && movie.runtime) {
      durationSeconds = movie.runtime * 60 // runtime is in minutes
    }

    // Calculate total bitrate from file size
    let totalBitrate = 0
    let videoBitrate = 0
    if (fileSize > 0 && durationSeconds > 0) {
      totalBitrate = this.calculateBitrate(fileSize, durationSeconds)
      // Estimate video portion (~85-95% of total for movies with lossless audio)
      // We'll refine this after calculating audio
      videoBitrate = Math.round(totalBitrate * 0.90)
      console.log(`[KodiProvider] Movie "${movie.title}": fileSize=${fileSize}, duration=${durationSeconds}s, totalBitrate=${totalBitrate}kbps`)
    } else {
      videoBitrate = this.estimateVideoBitrate(video?.height || 0)
      console.log(`[KodiProvider] Movie "${movie.title}": No file size, estimated bitrate=${videoBitrate}kbps from ${video?.height || 0}p`)
    }

    // Convert all audio streams to AudioStreamInfo array with object audio detection
    // Calculate audio bitrate from file if possible, otherwise estimate
    const numAudioTracks = audioStreams.length || 1
    const calculatedAudioBitrate = totalBitrate > 0
      ? this.calculateAudioBitrateFromFile(totalBitrate, videoBitrate, numAudioTracks)
      : 0

    const audioTracks: AudioStreamInfo[] = audioStreams.map((audio, index) => {
      const hasObjectAudio = this.detectObjectAudio(audio.codec, movie.title)
      // Use calculated bitrate if available and reasonable, otherwise estimate
      let bitrate = calculatedAudioBitrate
      if (bitrate <= 0 || bitrate > 20000) {
        // Fallback to estimation if calculated value is unreasonable
        bitrate = this.estimateAudioBitrate(audio.codec, audio.channels)
      }

      return {
        codec: audio.codec || 'Unknown',
        channels: audio.channels || 2,
        language: audio.language || undefined,
        isDefault: index === 0,
        bitrate,
        hasObjectAudio,
      }
    })

    // Find the best audio track (highest quality, prefer object audio)
    let bestAudio = audioTracks[0]
    let hasAnyObjectAudio = false
    for (const track of audioTracks) {
      if (track.hasObjectAudio) {
        hasAnyObjectAudio = true
        if (!bestAudio.hasObjectAudio || (track.bitrate || 0) > (bestAudio.bitrate || 0)) {
          bestAudio = track
        }
      } else if (!bestAudio.hasObjectAudio && (track.bitrate || 0) > (bestAudio.bitrate || 0)) {
        bestAudio = track
      }
    }

    return {
      providerId: this.sourceId,
      providerType: 'kodi',
      itemId: `movie_${movie.movieid}`,
      title: movie.title,
      type: 'movie',
      year: movie.year,
      imdbId: movie.imdbnumber,
      filePath: movie.file,
      fileSize: fileSize || undefined,
      duration: durationSeconds > 0 ? durationSeconds * 1000 : undefined,
      resolution: this.normalizeResolution(video?.width || 0, video?.height || 0),
      width: video?.width,
      height: video?.height,
      videoCodec: video?.codec,
      videoBitrate,
      videoFrameRate: undefined, // Kodi doesn't provide - will be filled by ffprobe
      colorBitDepth: undefined, // Kodi doesn't provide - will be filled by ffprobe
      colorSpace: undefined, // Kodi doesn't provide - will be filled by ffprobe
      videoProfile: undefined, // Kodi doesn't provide - will be filled by ffprobe
      hdrFormat: this.detectHdrFormat(video?.hdrtype),
      audioCodec: bestAudio?.codec,
      audioChannels: bestAudio?.channels,
      audioBitrate: bestAudio?.bitrate,
      audioSampleRate: undefined, // Kodi doesn't provide - will be filled by ffprobe
      hasObjectAudio: hasAnyObjectAudio,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      posterUrl: movie.art?.poster,
    }
  }

  private convertEpisodeToMetadata(episode: KodiEpisode, fileSize: number = 0): MediaMetadata {
    const video = episode.streamdetails.video?.[0]
    const audioStreams = episode.streamdetails.audio || []

    // Calculate duration in seconds (prefer streamdetails, fall back to runtime in minutes)
    let durationSeconds = video?.duration || 0
    if (!durationSeconds && episode.runtime) {
      durationSeconds = episode.runtime * 60
    }

    // Calculate total bitrate from file size
    let totalBitrate = 0
    let videoBitrate = 0
    if (fileSize > 0 && durationSeconds > 0) {
      totalBitrate = this.calculateBitrate(fileSize, durationSeconds)
      videoBitrate = Math.round(totalBitrate * 0.90)
    } else {
      videoBitrate = this.estimateVideoBitrate(video?.height || 0)
    }

    // Convert all audio streams with object audio detection and calculated bitrate
    const numAudioTracks = audioStreams.length || 1
    const calculatedAudioBitrate = totalBitrate > 0
      ? this.calculateAudioBitrateFromFile(totalBitrate, videoBitrate, numAudioTracks)
      : 0

    const audioTracks: AudioStreamInfo[] = audioStreams.map((audio, index) => {
      const hasObjectAudio = this.detectObjectAudio(audio.codec, episode.title)
      let bitrate = calculatedAudioBitrate
      if (bitrate <= 0 || bitrate > 20000) {
        bitrate = this.estimateAudioBitrate(audio.codec, audio.channels)
      }

      return {
        codec: audio.codec || 'Unknown',
        channels: audio.channels || 2,
        language: audio.language || undefined,
        isDefault: index === 0,
        bitrate,
        hasObjectAudio,
      }
    })

    // Find the best audio track
    let bestAudio = audioTracks[0]
    let hasAnyObjectAudio = false
    for (const track of audioTracks) {
      if (track.hasObjectAudio) {
        hasAnyObjectAudio = true
        if (!bestAudio.hasObjectAudio || (track.bitrate || 0) > (bestAudio.bitrate || 0)) {
          bestAudio = track
        }
      } else if (!bestAudio.hasObjectAudio && (track.bitrate || 0) > (bestAudio.bitrate || 0)) {
        bestAudio = track
      }
    }

    const seasonPosterUrl = episode.art?.['season.poster']
    const showPosterUrl = episode.art?.['tvshow.poster']

    return {
      providerId: this.sourceId,
      providerType: 'kodi',
      itemId: `episode_${episode.episodeid}`,
      title: episode.title,
      type: 'episode',
      seriesTitle: episode.showtitle,
      seasonNumber: episode.season,
      episodeNumber: episode.episode,
      filePath: episode.file,
      fileSize: fileSize || undefined,
      duration: durationSeconds > 0 ? durationSeconds * 1000 : undefined,
      resolution: this.normalizeResolution(video?.width || 0, video?.height || 0),
      width: video?.width,
      height: video?.height,
      videoCodec: video?.codec,
      videoBitrate,
      videoFrameRate: undefined, // Kodi doesn't provide - will be filled by ffprobe
      colorBitDepth: undefined, // Kodi doesn't provide - will be filled by ffprobe
      colorSpace: undefined, // Kodi doesn't provide - will be filled by ffprobe
      videoProfile: undefined, // Kodi doesn't provide - will be filled by ffprobe
      hdrFormat: this.detectHdrFormat(video?.hdrtype),
      audioCodec: bestAudio?.codec,
      audioChannels: bestAudio?.channels,
      audioBitrate: bestAudio?.bitrate,
      audioSampleRate: undefined, // Kodi doesn't provide - will be filled by ffprobe
      hasObjectAudio: hasAnyObjectAudio,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      episodeThumbUrl: episode.art?.thumb,
      posterUrl: seasonPosterUrl || showPosterUrl,
      seasonPosterUrl: seasonPosterUrl,
    }
  }

  private convertMetadataToMediaItem(metadata: MediaMetadata): MediaItem | null {
    // Build audio tracks from metadata.audioTracks if available, otherwise from primary audio info
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks && metadata.audioTracks.length > 0) {
      // Use all audio tracks from metadata, preserving object audio detection
      metadata.audioTracks.forEach((track, index) => {
        audioTracks.push({
          index,
          codec: track.codec || 'Unknown',
          channels: track.channels || 2,
          bitrate: track.bitrate || 0,
          language: track.language,
          hasObjectAudio: track.hasObjectAudio || false,
        })
      })
    } else if (metadata.audioCodec) {
      // Fallback to single track from primary audio info
      audioTracks.push({
        index: 0,
        codec: metadata.audioCodec,
        channels: metadata.audioChannels || 2,
        bitrate: metadata.audioBitrate || 0,
        hasObjectAudio: metadata.hasObjectAudio || false,
      })
    }

    return {
      plex_id: metadata.itemId,
      title: metadata.title,
      year: metadata.year,
      type: metadata.type,
      series_title: metadata.seriesTitle,
      season_number: metadata.seasonNumber,
      episode_number: metadata.episodeNumber,
      file_path: metadata.filePath || '',
      file_size: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      resolution: metadata.resolution || 'SD',
      width: metadata.width || 0,
      height: metadata.height || 0,
      video_codec: metadata.videoCodec || '',
      video_bitrate: metadata.videoBitrate || 0,
      video_frame_rate: metadata.videoFrameRate,
      color_bit_depth: metadata.colorBitDepth,
      color_space: metadata.colorSpace,
      video_profile: metadata.videoProfile,
      audio_codec: metadata.audioCodec || '',
      audio_channels: metadata.audioChannels || 2,
      audio_bitrate: metadata.audioBitrate || 0,
      audio_sample_rate: metadata.audioSampleRate,
      has_object_audio: metadata.hasObjectAudio,
      hdr_format: metadata.hdrFormat || 'None',
      audio_tracks: JSON.stringify(audioTracks),
      container: metadata.container,
      imdb_id: metadata.imdbId,
      tmdb_id: metadata.tmdbId?.toString(),
      poster_url: metadata.posterUrl,
      episode_thumb_url: metadata.episodeThumbUrl,
      season_poster_url: metadata.seasonPosterUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private normalizeResolution(width: number, height: number): string {
    if (height >= 2160 || width >= 3840) return '4K'
    if (height >= 1080 || width >= 1920) return '1080p'
    if (height >= 720 || width >= 1280) return '720p'
    if (height >= 480 || width >= 720) return '480p'
    return 'SD'
  }

  private detectHdrFormat(hdrtype?: string): string {
    if (!hdrtype) return 'None'

    const hdrLower = hdrtype.toLowerCase()

    if (hdrLower.includes('dolby vision') || hdrLower.includes('dovi')) {
      return 'Dolby Vision'
    }
    if (hdrLower.includes('hdr10+')) {
      return 'HDR10+'
    }
    if (hdrLower.includes('hdr')) {
      return 'HDR10'
    }
    if (hdrLower.includes('hlg')) {
      return 'HLG'
    }

    return 'None'
  }

  // ============================================================================
  // FFPROBE ENHANCEMENT
  // ============================================================================

  /**
   * Check if metadata is missing key quality indicators that ffprobe can provide
   */
  private needsFFprobeEnhancement(metadata: MediaMetadata): boolean {
    // Check if we're missing important metadata
    // Kodi typically doesn't provide: frame rate, color bit depth, color space, audio sample rate
    const hasFrameRate = metadata.videoFrameRate && metadata.videoFrameRate > 0
    const hasColorBitDepth = metadata.colorBitDepth && metadata.colorBitDepth > 0
    const hasAudioBitrate = metadata.audioBitrate && metadata.audioBitrate > 0 && !this.isEstimatedBitrate(metadata.audioBitrate)

    // If any key indicator is missing, we should try ffprobe
    return !hasFrameRate || !hasColorBitDepth || !hasAudioBitrate
  }

  /**
   * Check if the bitrate appears to be estimated (typical estimated values)
   */
  private isEstimatedBitrate(bitrate: number): boolean {
    // Our estimated bitrates fall into these ranges
    const estimatedValues = [256, 384, 640, 768, 1024, 1500, 1509, 2500, 3000, 3500, 4500]
    return estimatedValues.includes(bitrate)
  }

  /**
   * Check if a file path is locally accessible
   */
  private isFileAccessible(filePath: string): boolean {
    if (!filePath) return false

    try {
      // Handle Windows UNC paths and mapped drives
      // Handle Kodi special protocol paths (e.g., smb://, nfs://)
      if (filePath.startsWith('smb://') || filePath.startsWith('nfs://') ||
          filePath.startsWith('upnp://') || filePath.startsWith('ftp://')) {
        return false // Network protocols not directly accessible via fs
      }

      // Check if file exists
      return fs.existsSync(filePath)
    } catch {
      return false
    }
  }

  /**
   * Enhance metadata with ffprobe analysis
   * Returns the enhanced metadata or the original if enhancement fails
   */
  private async enhanceWithFFprobe(metadata: MediaMetadata): Promise<MediaMetadata> {
    const filePath = metadata.filePath
    if (!filePath || !this.isFileAccessible(filePath)) {
      return metadata
    }

    const fileAnalyzer = getMediaFileAnalyzer()
    const ffprobeAvailable = await fileAnalyzer.isAvailable()
    if (!ffprobeAvailable) {
      return metadata
    }

    try {
      const analysis = await fileAnalyzer.analyzeFile(filePath)
      if (!analysis.success) {
        console.log(`[KodiProvider] FFprobe analysis failed for "${metadata.title}": ${analysis.error}`)
        return metadata
      }

      return this.mergeFFprobeData(metadata, analysis)
    } catch (error: unknown) {
      console.warn(`[KodiProvider] FFprobe enhancement failed for "${metadata.title}": ${getErrorMessage(error)}`)
      return metadata
    }
  }

  /**
   * Merge ffprobe analysis data into existing metadata
   * Only fills in missing values - doesn't override existing Kodi data
   */
  private mergeFFprobeData(metadata: MediaMetadata, analysis: FileAnalysisResult): MediaMetadata {
    const enhanced = { ...metadata }

    if (analysis.video) {
      // Fill in missing video data
      if (!enhanced.width || enhanced.width === 0) {
        enhanced.width = analysis.video.width
      }
      if (!enhanced.height || enhanced.height === 0) {
        enhanced.height = analysis.video.height
      }
      if (!enhanced.videoFrameRate || enhanced.videoFrameRate === 0) {
        enhanced.videoFrameRate = analysis.video.frameRate
      }
      if (!enhanced.colorBitDepth || enhanced.colorBitDepth === 0) {
        enhanced.colorBitDepth = analysis.video.bitDepth
      }
      if (!enhanced.colorSpace) {
        enhanced.colorSpace = analysis.video.colorSpace
      }
      if (!enhanced.videoProfile) {
        enhanced.videoProfile = analysis.video.profile
      }
      // Only use ffprobe video bitrate if we don't have one from file size calculation
      if (!enhanced.videoBitrate || enhanced.videoBitrate === 0) {
        enhanced.videoBitrate = analysis.video.bitrate
      }
      // HDR format - ffprobe is more accurate than Kodi's hdrtype
      if (!enhanced.hdrFormat || enhanced.hdrFormat === 'None') {
        enhanced.hdrFormat = analysis.video.hdrFormat
      }
    }

    if (analysis.duration && (!enhanced.duration || enhanced.duration === 0)) {
      enhanced.duration = analysis.duration
    }

    if (analysis.container && !enhanced.container) {
      enhanced.container = analysis.container
    }

    // Audio tracks - merge ffprobe data with Kodi data
    if (analysis.audioTracks && analysis.audioTracks.length > 0) {
      // Build enhanced audio tracks
      const enhancedAudioTracks: AudioStreamInfo[] = []

      for (let i = 0; i < analysis.audioTracks.length; i++) {
        const ffprobeTrack = analysis.audioTracks[i]
        const existingTrack = metadata.audioTracks?.[i]

        enhancedAudioTracks.push({
          codec: existingTrack?.codec || ffprobeTrack.codec,
          channels: existingTrack?.channels || ffprobeTrack.channels,
          bitrate: ffprobeTrack.bitrate || existingTrack?.bitrate, // Prefer ffprobe bitrate
          sampleRate: ffprobeTrack.sampleRate,
          language: existingTrack?.language || ffprobeTrack.language,
          isDefault: existingTrack?.isDefault ?? ffprobeTrack.isDefault,
          hasObjectAudio: ffprobeTrack.hasObjectAudio || existingTrack?.hasObjectAudio,
        })
      }

      enhanced.audioTracks = enhancedAudioTracks

      // Update primary audio info from first (best) track
      const bestTrack = enhancedAudioTracks[0]
      if (bestTrack) {
        if (!enhanced.audioCodec) {
          enhanced.audioCodec = bestTrack.codec
        }
        if (!enhanced.audioChannels || enhanced.audioChannels === 0) {
          enhanced.audioChannels = bestTrack.channels
        }
        // Always prefer ffprobe audio bitrate over estimated
        if (bestTrack.bitrate && (!enhanced.audioBitrate || this.isEstimatedBitrate(enhanced.audioBitrate))) {
          enhanced.audioBitrate = bestTrack.bitrate
        }
        if (bestTrack.sampleRate) {
          enhanced.audioSampleRate = bestTrack.sampleRate
        }
        if (bestTrack.hasObjectAudio !== undefined) {
          enhanced.hasObjectAudio = bestTrack.hasObjectAudio
        }
      }
    }

    console.log(`[KodiProvider] Enhanced "${metadata.title}" with ffprobe data (frameRate=${enhanced.videoFrameRate}, bitDepth=${enhanced.colorBitDepth}, audioBitrate=${enhanced.audioBitrate})`)

    return enhanced
  }

  // ============================================================================
  // MUSIC LIBRARY SUPPORT
  // ============================================================================

  /**
   * Get all music artists from Kodi
   */
  async getMusicArtists(): Promise<KodiMusicArtist[]> {
    try {
      const result = await this.rpcCall<{ artists: KodiMusicArtist[] }>('AudioLibrary.GetArtists', {
        properties: ['artist', 'musicbrainzartistid', 'genre', 'description', 'thumbnail'],
      })

      return result.artists || []
    } catch (error: unknown) {
      console.error('[KodiProvider] Failed to get music artists:', error)
      throw new Error('Failed to fetch music artists')
    }
  }

  /**
   * Get music albums - optionally filtered by artist
   */
  async getMusicAlbums(artistId?: number): Promise<KodiMusicAlbum[]> {
    try {
      const params: Record<string, unknown> = {
        properties: [
          'title', 'artistid', 'artist', 'displayartist', 'year',
          'musicbrainzalbumid', 'musicbrainzreleasegroupid', 'genre', 'type', 'thumbnail'
        ],
      }

      if (artistId !== undefined) {
        params.filter = { artistid: artistId }
      }

      const result = await this.rpcCall<{ albums: KodiMusicAlbum[] }>('AudioLibrary.GetAlbums', params)

      return result.albums || []
    } catch (error: unknown) {
      console.error('[KodiProvider] Failed to get music albums:', error)
      throw new Error('Failed to fetch music albums')
    }
  }

  /**
   * Get music songs - optionally filtered by album
   */
  async getMusicSongs(albumId?: number): Promise<KodiMusicSong[]> {
    try {
      const params: Record<string, unknown> = {
        properties: [
          'title', 'albumid', 'album', 'artistid', 'artist', 'displayartist',
          'track', 'disc', 'duration', 'file', 'musicbrainztrackid',
          'samplerate', 'bitrate', 'channels'
        ],
      }

      if (albumId !== undefined) {
        params.filter = { albumid: albumId }
      }

      const result = await this.rpcCall<{ songs: KodiMusicSong[] }>('AudioLibrary.GetSongs', params)

      return result.songs || []
    } catch (error: unknown) {
      console.error('[KodiProvider] Failed to get music songs:', error)
      throw new Error('Failed to fetch music songs')
    }
  }

  /**
   * Convert Kodi artist to MusicArtist type
   */
  convertToMusicArtist(item: KodiMusicArtist): MusicArtist {
    // Convert Kodi image URL format if needed
    const thumbUrl = item.thumbnail ? this.convertKodiImageUrl(item.thumbnail) : undefined

    return {
      source_id: this.sourceId,
      source_type: 'kodi',
      library_id: 'music',
      provider_id: String(item.artistid),
      name: item.artist,
      musicbrainz_id: item.musicbrainzartistid,
      genres: item.genre ? JSON.stringify(item.genre) : undefined,
      biography: item.description,
      thumb_url: thumbUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Kodi album to MusicAlbum type
   */
  convertToMusicAlbum(item: KodiMusicAlbum, artistId?: number): MusicAlbum {
    const thumbUrl = item.thumbnail ? this.convertKodiImageUrl(item.thumbnail) : undefined
    const artistName = item.displayartist || item.artist?.[0] || 'Unknown Artist'

    return {
      source_id: this.sourceId,
      source_type: 'kodi',
      library_id: 'music',
      provider_id: String(item.albumid),
      artist_id: artistId,
      artist_name: artistName,
      title: item.title,
      year: item.year,
      musicbrainz_id: item.musicbrainzalbumid,
      musicbrainz_release_group_id: item.musicbrainzreleasegroupid,
      genres: item.genre ? JSON.stringify(item.genre) : undefined,
      album_type: item.type as any, // Kodi uses 'album', 'ep', 'single'
      thumb_url: thumbUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Kodi song to MusicTrack type
   */
  convertToMusicTrack(item: KodiMusicSong, albumId?: number, artistId?: number): MusicTrack {
    const artistName = item.displayartist || item.artist?.[0] || 'Unknown Artist'

    // Kodi may provide codec info via file extension analysis
    // For now, we'll try to guess from the file path
    const filePath = item.file || ''
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    let audioCodec = 'unknown'

    // Map common extensions to codecs
    const codecMap: Record<string, string> = {
      'flac': 'flac',
      'alac': 'alac',
      'm4a': 'aac',
      'mp3': 'mp3',
      'ogg': 'vorbis',
      'opus': 'opus',
      'wav': 'wav',
      'aiff': 'aiff',
      'aif': 'aiff',
      'wma': 'wma',
      'ape': 'ape',
      'wv': 'wavpack',
    }
    audioCodec = codecMap[ext] || ext || 'unknown'

    const lossless = isLosslessCodec(audioCodec)
    const sampleRate = item.samplerate || 44100
    const bitDepth = 16 // Kodi doesn't always provide bit depth
    const hiRes = isHiRes(sampleRate, bitDepth, lossless)

    return {
      source_id: this.sourceId,
      source_type: 'kodi',
      library_id: 'music',
      provider_id: String(item.songid),
      album_id: albumId,
      artist_id: artistId,
      album_name: item.album,
      artist_name: artistName,
      title: item.title,
      track_number: item.track,
      disc_number: item.disc || 1,
      duration: item.duration ? item.duration * 1000 : undefined, // Kodi returns seconds, we want ms
      file_path: filePath,
      audio_codec: audioCodec,
      audio_bitrate: item.bitrate,
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      channels: item.channels,
      is_lossless: lossless,
      is_hi_res: hiRes,
      musicbrainz_id: item.musicbrainztrackid,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Kodi image URL (image://...) to a usable URL
   */
  private convertKodiImageUrl(kodiUrl: string): string {
    if (!kodiUrl) return ''

    // If it's already a regular URL, return as-is
    if (kodiUrl.startsWith('http://') || kodiUrl.startsWith('https://')) {
      return kodiUrl
    }

    // For Kodi's image:// URLs, we need to use the Kodi web server to fetch them
    // The URL format is: http://host:port/image/encoded_url
    if (kodiUrl.startsWith('image://')) {
      const encodedUrl = encodeURIComponent(kodiUrl)
      return `${this.getBaseUrl()}/image/${encodedUrl}`
    }

    return kodiUrl
  }

  /**
   * Scan the music library
   */
  async scanMusicLibrary(
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
      const db = getDatabaseService()

      // Track scanned IDs for cleanup
      const scannedArtistIds = new Set<string>()
      const scannedAlbumIds = new Set<string>()
      const scannedTrackIds = new Set<string>()

      // Helper to process an album
      const processAlbum = async (
        kodiAlbum: KodiMusicAlbum,
        artistId: number | undefined,
        artistName?: string
      ): Promise<{ trackCount: number }> => {
        const albumData = this.convertToMusicAlbum(kodiAlbum, artistId)

        // Override artist name if provided (for compilations)
        if (artistName && !albumData.artist_name) {
          albumData.artist_name = artistName
        }

        // Get all tracks for this album
        const songs = await this.getMusicSongs(kodiAlbum.albumid)

        // Convert and collect tracks
        const trackDataList: MusicTrack[] = []
        for (const kodiSong of songs) {
          const trackData = this.convertToMusicTrack(kodiSong, undefined, artistId)
          trackDataList.push(trackData)
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
        scannedAlbumIds.add(String(kodiAlbum.albumid))

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
      const artists = await this.getMusicArtists()
      const totalArtists = artists.length

      console.log(`[KodiProvider ${this.sourceId}] Scanning music library: ${totalArtists} artists`)

      let processed = 0

      for (const kodiArtist of artists) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[KodiProvider ${this.sourceId}] Music scan cancelled at artist ${processed}/${totalArtists}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          const artistData = this.convertToMusicArtist(kodiArtist)

          // Upsert artist
          const artistId = await db.upsertMusicArtist(artistData)
          scannedArtistIds.add(String(kodiArtist.artistid))

          // Get all albums for this artist
          const albums = await this.getMusicAlbums(kodiArtist.artistid)

          let artistTrackCount = 0
          let artistAlbumCount = 0

          for (const kodiAlbum of albums) {
            const { trackCount } = await processAlbum(kodiAlbum, artistId)
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
              currentItem: kodiArtist.artist,
              percentage: (processed / totalArtists) * 50, // First 50% for artists
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process artist ${kodiArtist.artist}: ${getErrorMessage(error)}`)
        }
      }

      // Phase 2: Get all albums directly to catch compilations and orphaned albums (50-100% progress)
      console.log(`[KodiProvider ${this.sourceId}] Scanning for compilations and orphaned albums...`)

      const allAlbums = await this.getMusicAlbums()
      const unprocessedAlbums = allAlbums.filter(a => !scannedAlbumIds.has(String(a.albumid)))

      console.log(`[KodiProvider ${this.sourceId}] Found ${unprocessedAlbums.length} additional albums (compilations/orphaned)`)

      let compilationProcessed = 0
      const totalCompilations = unprocessedAlbums.length

      for (const kodiAlbum of unprocessedAlbums) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[KodiProvider ${this.sourceId}] Music scan cancelled at compilation ${compilationProcessed}/${totalCompilations}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          const artistName = kodiAlbum.displayartist || kodiAlbum.artist?.[0] || 'Various Artists'
          await processAlbum(kodiAlbum, undefined, artistName)

          compilationProcessed++
          if (onProgress) {
            onProgress({
              current: compilationProcessed,
              total: totalCompilations,
              phase: 'processing compilations',
              currentItem: kodiAlbum.title,
              percentage: 50 + (compilationProcessed / Math.max(totalCompilations, 1)) * 50,
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process album ${kodiAlbum.title}: ${getErrorMessage(error)}`)
        }
      }

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[KodiProvider ${this.sourceId}] Music scan complete: ${result.itemsScanned} tracks scanned in ${result.durationMs}ms`)

      return result
    } catch (error: unknown) {
      console.error(`[KodiProvider ${this.sourceId}] Music scan failed:`, error)
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
    console.log(`[KodiProvider ${this.sourceId}] Music scan cancellation requested`)
  }
}
