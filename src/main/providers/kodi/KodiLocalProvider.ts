import { getErrorMessage } from '../../services/utils/errorUtils'
/**
 * KodiLocalProvider
 *
 * Implements the MediaProvider interface for Kodi by reading its local SQLite database directly.
 * This allows accessing Kodi's library without Kodi running and without JSON-RPC.
 *
 * Advantages over JSON-RPC:
 * - Kodi doesn't need to be running
 * - Faster data access (direct database read)
 * - Works even if JSON-RPC is disabled
 *
 * Requirements:
 * - Kodi must be installed locally with a scanned library
 * - Database file must be readable (not locked by Kodi)
 */

import initSqlJs, { Database } from 'sql.js'
import * as fs from 'fs'
import * as path from 'path'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getKodiLocalDiscoveryService } from '../../services/KodiLocalDiscoveryService'
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
  ProviderType,
} from '../base/MediaProvider'
import type { MediaItem, AudioTrack, MusicArtist, MusicAlbum, MusicTrack, AlbumType } from '../../types/database'
import {
  QUERY_MOVIES_WITH_DETAILS,
  QUERY_EPISODES_WITH_DETAILS,
  QUERY_MOVIE_BY_ID,
  QUERY_EPISODE_BY_ID,
  QUERY_MOVIE_COUNT,
  QUERY_EPISODE_COUNT,
  QUERY_ALL_SETS,
  KodiMovieWithDetails,
  KodiEpisodeWithDetails,
  KodiSetWithDetails,
  buildFilePath,
  convertKodiImageUrl,
} from './KodiDatabaseSchema'
import {
  QUERY_MUSIC_ARTISTS,
  QUERY_MUSIC_ALBUMS,
  QUERY_MUSIC_ALBUMS_BY_ARTIST,
  QUERY_MUSIC_SONGS_BY_ALBUM,
  QUERY_MUSIC_SONG_COUNT,
  KodiMusicArtistResult,
  KodiMusicAlbumResult,
  KodiMusicSongResult,
  parseTrackNumber,
  buildMusicFilePath,
  guessCodecFromExtension,
} from './KodiMusicDatabaseSchema'
import {
  isLosslessCodec,
  calculateAlbumStats,
} from '../base/MusicScannerUtils'
import {
  normalizeVideoCodec,
  normalizeAudioCodec,
  normalizeResolution,
  normalizeHdrFormat,
  normalizeAudioChannels,
  hasObjectAudio,
} from '../../services/MediaNormalizer'
import {
  estimateAudioBitrate,
  calculateAudioBitrateFromFile,
} from '../utils/ProviderUtils'
import type { AudioStreamInfo } from '../base/MediaProvider'

// Type for audio stream query result
interface KodiAudioStream {
  idFile: number
  codec: string | null
  channels: number | null
  language: string | null
}

export class KodiLocalProvider implements MediaProvider {
  readonly providerType: ProviderType = 'kodi-local' as ProviderType
  readonly sourceId: string

  private _config: SourceConfig
  private databasePath: string = ''
  private databaseVersion: number = 0
  private db: Database | null = null
  private sqlJs: Awaited<ReturnType<typeof initSqlJs>> | null = null

  // Music database support
  private musicDatabasePath: string = ''
  private musicDb: Database | null = null
  private musicScanCancelled = false

  // Database inclusion settings (reserved for future configurability)
  // Currently not read - always includes both if available
  private _includeVideo: boolean = true
  private _includeMusic: boolean = true

  // FFprobe file analysis settings - enabled by default for accurate quality scoring
  private useFFprobeAnalysis: boolean = true
  private ffprobeAvailable: boolean | null = null

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || this.generateSourceId()
    this._config = { ...config, sourceId: this.sourceId }
    void this._config // Suppress unused warning - config stored for potential future use

    // Load from connection config if provided
    if (config.connectionConfig) {
      this.databasePath = config.connectionConfig.databasePath || ''
      this.databaseVersion = config.connectionConfig.databaseVersion || 0
      this.musicDatabasePath = config.connectionConfig.musicDatabasePath || ''
      // Default to true if not explicitly set (reserved for future use)
      this._includeVideo = config.connectionConfig.includeVideo !== false
      this._includeMusic = config.connectionConfig.includeMusic !== false
    }
    // Suppress unused warnings - these are placeholders for future configurability
    void this._includeVideo
    void this._includeMusic
  }

  private generateSourceId(): string {
    return `kodi_local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Initialize SQL.js if not already done
   */
  private async initSqlJs(): Promise<void> {
    if (!this.sqlJs) {
      // sql.js WASM file is bundled with the package
      this.sqlJs = await initSqlJs()
    }
  }

  /**
   * Open the Kodi database for reading
   */
  private async openDatabase(): Promise<void> {
    if (this.db) {
      return // Already open
    }

    if (!this.databasePath) {
      throw new Error('Database path not configured')
    }

    if (!fs.existsSync(this.databasePath)) {
      throw new Error(`Database file not found: ${this.databasePath}`)
    }

    await this.initSqlJs()

    try {
      // Read database file as buffer
      const dbBuffer = fs.readFileSync(this.databasePath)
      this.db = new this.sqlJs!.Database(dbBuffer)
      console.log(`[KodiLocalProvider] Database opened: ${path.basename(this.databasePath)}`)
    } catch (error: unknown) {
      throw new Error(`Failed to open database: ${getErrorMessage(error)}`)
    }
  }

  /**
   * Close the database connection
   */
  private closeDatabase(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      console.log('[KodiLocalProvider] Database closed')
    }
  }

  /**
   * Execute a query and return results as array of objects
   */
  private query<T>(sql: string, params: (string | number | null)[] = []): T[] {
    if (!this.db) {
      throw new Error('Database not opened')
    }

    const results: T[] = []
    const stmt = this.db.prepare(sql)

    if (params.length > 0) {
      stmt.bind(params)
    }

    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push(row as T)
    }

    stmt.free()
    return results
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      // For local provider, credentials contain the database path
      const dbPath = credentials.databasePath
      const dbVersion = credentials.databaseVersion

      if (!dbPath) {
        // Try auto-detection
        const discovery = getKodiLocalDiscoveryService()
        const installation = await discovery.detectLocalInstallation()

        if (!installation) {
          return {
            success: false,
            error: 'Could not find local Kodi installation',
          }
        }

        this.databasePath = installation.databasePath
        this.databaseVersion = installation.databaseVersion
      } else {
        // Validate provided path
        const discovery = getKodiLocalDiscoveryService()
        const validation = discovery.validateDatabasePath(dbPath)

        if (!validation.valid) {
          return {
            success: false,
            error: validation.error,
          }
        }

        this.databasePath = dbPath
        this.databaseVersion = dbVersion || discovery.extractVersionFromPath(dbPath)
      }

      // Test connection
      const testResult = await this.testConnection()
      if (!testResult.success) {
        return {
          success: false,
          error: testResult.error,
        }
      }

      return {
        success: true,
        serverName: `Kodi Local (v${this.databaseVersion})`,
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.databasePath && fs.existsSync(this.databasePath)
  }

  async disconnect(): Promise<void> {
    this.closeDatabase()
  }

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  /**
   * Check if FFprobe is available on the system
   */
  async isFFprobeAvailable(): Promise<boolean> {
    if (this.ffprobeAvailable !== null) {
      return this.ffprobeAvailable
    }
    const analyzer = getMediaFileAnalyzer()
    this.ffprobeAvailable = await analyzer.isAvailable()
    return this.ffprobeAvailable
  }

  /**
   * Get FFprobe version if available
   */
  async getFFprobeVersion(): Promise<string | null> {
    const analyzer = getMediaFileAnalyzer()
    return analyzer.getVersion()
  }

  /**
   * Enable or disable FFprobe file analysis during scans
   */
  setFFprobeAnalysis(enabled: boolean): void {
    this.useFFprobeAnalysis = enabled
    console.log(`[KodiLocalProvider ${this.sourceId}] FFprobe analysis ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Check if FFprobe analysis is enabled
   */
  isFFprobeAnalysisEnabled(): boolean {
    return this.useFFprobeAnalysis
  }

  /**
   * Analyze a single file with FFprobe
   */
  async analyzeFileWithFFprobe(filePath: string): Promise<FileAnalysisResult> {
    const analyzer = getMediaFileAnalyzer()
    return analyzer.analyzeFile(filePath)
  }

  /**
   * Enhance metadata with FFprobe analysis results
   * Merges accurate FFprobe data with existing Kodi metadata
   */
  private enhanceMetadataWithFFprobe(metadata: MediaMetadata, analysis: FileAnalysisResult): MediaMetadata {
    // Only skip if FFprobe completely failed
    if (!analysis.success) {
      return metadata
    }

    const enhanced = { ...metadata }

    // Video properties - only enhance if video track exists
    if (analysis.video) {
      if (analysis.video.width && analysis.video.height) {
        enhanced.width = analysis.video.width
        enhanced.height = analysis.video.height
        enhanced.resolution = this.normalizeResolutionFromDimensions(analysis.video.width, analysis.video.height)
      }

      if (analysis.video.codec) {
        enhanced.videoCodec = this.normalizeVideoCodecName(analysis.video.codec)
      }

      if (analysis.video.bitrate !== undefined) {
        enhanced.videoBitrate = analysis.video.bitrate
      }

      if (analysis.video.frameRate) {
        enhanced.videoFrameRate = analysis.video.frameRate
      }

      if (analysis.video.bitDepth) {
        enhanced.colorBitDepth = analysis.video.bitDepth
      }

      if (analysis.video.hdrFormat) {
        enhanced.hdrFormat = analysis.video.hdrFormat
      }

      if (analysis.video.profile) {
        enhanced.videoProfile = analysis.video.profile
      }

      if (analysis.video.level) {
        enhanced.videoLevel = analysis.video.level.toString()
      }

      if (analysis.video.colorSpace) {
        enhanced.colorSpace = analysis.video.colorSpace
      }
    }

    // Duration from FFprobe
    if (analysis.duration) {
      enhanced.duration = analysis.duration
    }

    // File size from FFprobe
    if (analysis.fileSize) {
      enhanced.fileSize = analysis.fileSize
    }

    // Container format
    if (analysis.container) {
      enhanced.container = analysis.container
    }

    // Audio tracks - replace with accurate FFprobe data (independent of video)
    if (analysis.audioTracks.length > 0) {
      enhanced.audioTracks = analysis.audioTracks.map(track => ({
        codec: this.normalizeAudioCodecName(track.codec),
        profile: track.profile,
        channels: track.channels,
        bitrate: track.bitrate,
        sampleRate: track.sampleRate,
        language: track.language,
        title: track.title,
        isDefault: track.isDefault,
        hasObjectAudio: track.hasObjectAudio,
      }))

      // Find the best audio track (not just default/first) for primary audio fields
      const primaryAudio = this.selectBestFFprobeAudioTrack(analysis.audioTracks)
      if (primaryAudio) {
        enhanced.audioCodec = this.normalizeAudioCodecName(primaryAudio.codec)
        enhanced.audioChannels = primaryAudio.channels
        enhanced.audioBitrate = primaryAudio.bitrate
        enhanced.audioSampleRate = primaryAudio.sampleRate
        enhanced.audioProfile = primaryAudio.profile
        enhanced.hasObjectAudio = primaryAudio.hasObjectAudio
      }
    }

    // Subtitle tracks
    if (analysis.subtitleTracks.length > 0) {
      enhanced.subtitleTracks = analysis.subtitleTracks.map(track => ({
        codec: track.codec,
        language: track.language,
        title: track.title,
        isDefault: track.isDefault,
        isForced: track.isForced,
      }))
    }

    return enhanced
  }

  /**
   * Normalize resolution string from dimensions
   */
  private normalizeResolutionFromDimensions(width: number, height: number): string {
    if (height >= 2160 || width >= 3840) return '4K'
    if (height >= 1080 || width >= 1920) return '1080p'
    if (height >= 720 || width >= 1280) return '720p'
    if (height >= 480 || width >= 720) return '480p'
    return 'SD'
  }

  /**
   * Normalize video codec name from FFprobe output
   */
  private normalizeVideoCodecName(codec: string): string {
    const codecLower = codec.toLowerCase()
    if (codecLower === 'hevc' || codecLower === 'h265') return 'HEVC'
    if (codecLower === 'h264' || codecLower === 'avc1' || codecLower === 'avc') return 'H.264'
    if (codecLower === 'av1') return 'AV1'
    if (codecLower === 'vp9') return 'VP9'
    if (codecLower === 'vp8') return 'VP8'
    if (codecLower === 'mpeg4' || codecLower === 'mpeg-4') return 'MPEG-4'
    if (codecLower === 'mpeg2video') return 'MPEG-2'
    if (codecLower === 'vc1') return 'VC-1'
    return codec.toUpperCase()
  }

  /**
   * Normalize audio codec name from FFprobe output
   */
  private normalizeAudioCodecName(codec: string): string {
    const codecLower = codec.toLowerCase()
    if (codecLower === 'truehd') return 'TrueHD'
    if (codecLower === 'dts') return 'DTS'
    if (codecLower.includes('dts-hd') || codecLower === 'dtshd') return 'DTS-HD MA'
    if (codecLower === 'eac3' || codecLower === 'ec-3') return 'E-AC-3'
    if (codecLower === 'ac3' || codecLower === 'ac-3') return 'AC-3'
    if (codecLower === 'aac') return 'AAC'
    if (codecLower === 'flac') return 'FLAC'
    if (codecLower === 'pcm_s16le' || codecLower === 'pcm_s24le' || codecLower.startsWith('pcm')) return 'PCM'
    if (codecLower === 'mp3' || codecLower === 'mp3float') return 'MP3'
    if (codecLower === 'opus') return 'Opus'
    if (codecLower === 'vorbis') return 'Vorbis'
    return codec.toUpperCase()
  }

  /**
   * Select the best audio track from FFprobe analysis results
   * Prioritizes: Object audio > Lossless > Premium surround > Standard surround > Stereo
   */
  private selectBestFFprobeAudioTrack(tracks: Array<{
    codec: string
    channels: number
    bitrate?: number
    hasObjectAudio: boolean
    profile?: string
    sampleRate?: number
    language?: string
    title?: string
    isDefault: boolean
  }>): typeof tracks[0] | undefined {
    if (!tracks || tracks.length === 0) return undefined
    if (tracks.length === 1) return tracks[0]

    let bestTrack = tracks[0]
    let bestScore = this.calculateAudioTrackScore(bestTrack)

    for (let i = 1; i < tracks.length; i++) {
      const score = this.calculateAudioTrackScore(tracks[i])
      if (score > bestScore) {
        bestScore = score
        bestTrack = tracks[i]
      }
    }

    return bestTrack
  }

  /**
   * Calculate quality score for an audio track (higher = better)
   * Matches logic in QualityAnalyzer.calculateAudioTrackQualityScore()
   */
  private calculateAudioTrackScore(track: {
    codec: string
    channels: number
    bitrate?: number
    hasObjectAudio: boolean
  }): number {
    let score = 0
    const codecLower = track.codec.toLowerCase()

    // Object audio (Atmos, DTS:X) - highest priority
    if (track.hasObjectAudio) {
      score += 10000
    }

    // Lossless codecs
    if (codecLower.includes('truehd') || codecLower.includes('dts-hd') || codecLower === 'dtshd' ||
        codecLower === 'flac' || codecLower.includes('pcm') || codecLower === 'alac') {
      score += 5000
    }

    // Premium lossy codecs
    if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('dd+')) {
      score += 3000
    } else if (codecLower.includes('ac3') || codecLower.includes('ac-3') || codecLower === 'dts') {
      score += 2000
    } else if (codecLower === 'aac') {
      score += 1000
    }

    // More channels = better (7.1 > 5.1 > stereo)
    score += (track.channels || 2) * 100

    // Higher bitrate = better
    score += (track.bitrate || 0)

    return score
  }

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.databasePath) {
      return { success: false, error: 'Database path not configured' }
    }

    if (!fs.existsSync(this.databasePath)) {
      return { success: false, error: 'Database file not found' }
    }

    const startTime = Date.now()

    try {
      await this.openDatabase()

      // Test by counting movies
      const movieCount = this.query<{ count: number }>(QUERY_MOVIE_COUNT)
      const episodeCount = this.query<{ count: number }>(QUERY_EPISODE_COUNT)

      const movies = movieCount[0]?.count || 0
      const episodes = episodeCount[0]?.count || 0

      this.closeDatabase()

      return {
        success: true,
        serverName: `Kodi Local Database (${movies} movies, ${episodes} episodes)`,
        serverVersion: `MyVideos${this.databaseVersion}`,
        latencyMs: Date.now() - startTime,
      }
    } catch (error: unknown) {
      this.closeDatabase()
      return {
        success: false,
        error: getErrorMessage(error) || 'Connection test failed',
      }
    }
  }

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  async getLibraries(): Promise<MediaLibrary[]> {
    // Kodi local database provides virtual libraries for Movies, TV Shows, and Music
    // Return all available databases as library options
    const libraries: MediaLibrary[] = []

    // Check video database
    if (this.databasePath) {
      try {
        await this.openDatabase()

        const movieCount = this.query<{ count: number }>(QUERY_MOVIE_COUNT)
        const episodeCount = this.query<{ count: number }>(QUERY_EPISODE_COUNT)

        this.closeDatabase()

        const movies = movieCount[0]?.count || 0
        const episodes = episodeCount[0]?.count || 0

        // Always add Movies library if video database exists
        libraries.push({
          id: 'movies',
          name: 'Movies',
          type: 'movie',
          itemCount: movies,
        })

        // Always add TV Shows library if video database exists
        libraries.push({
          id: 'tvshows',
          name: 'TV Shows',
          type: 'show',
          itemCount: episodes,
        })
      } catch (error: unknown) {
        this.closeDatabase()
        console.error('[KodiLocalProvider] Error getting video libraries:', error)
      }
    }

    // Check music database
    try {
      const musicDbAvailable = await this.openMusicDatabase()
      if (musicDbAvailable) {
        const songCount = this.queryMusicDb<{ count: number }>(QUERY_MUSIC_SONG_COUNT)
        this.closeMusicDatabase()

        const songs = songCount[0]?.count || 0

        // Always add Music library if music database exists
        libraries.push({
          id: 'music',
          name: 'Music',
          type: 'music',
          itemCount: songs,
        })
      }
    } catch (error: unknown) {
      this.closeMusicDatabase()
      console.log('[KodiLocalProvider] Music library not available:', getErrorMessage(error))
    }

    return libraries
  }

  async getLibraryItems(libraryId: string): Promise<MediaMetadata[]> {
    if (libraryId === 'movies') {
      return this.getMovies()
    } else if (libraryId === 'tvshows') {
      return this.getEpisodes()
    } else if (libraryId === 'music') {
      // Music items are handled separately via scanMusicLibrary()
      return []
    }

    throw new Error(`Unknown library: ${libraryId}`)
  }

  /**
   * Fetch all audio streams from the database and group them by file ID
   */
  private getAudioStreamsByFileId(): Map<number, KodiAudioStream[]> {
    const query = `
      SELECT
        idFile,
        strAudioCodec AS codec,
        iAudioChannels AS channels,
        strAudioLanguage AS language
      FROM streamdetails
      WHERE iStreamType = 1
      ORDER BY idFile, iAudioChannels DESC
    `
    const streams = this.query<KodiAudioStream>(query)

    const streamsByFile = new Map<number, KodiAudioStream[]>()
    for (const stream of streams) {
      const fileId = stream.idFile
      if (!streamsByFile.has(fileId)) {
        streamsByFile.set(fileId, [])
      }
      streamsByFile.get(fileId)!.push(stream)
    }

    return streamsByFile
  }

  // NOTE: detectObjectAudio, estimateAudioBitrate, and calculateAudioBitrateFromFile
  // are now imported from MediaNormalizer/ProviderUtils.
  // The duplicate private methods were removed.

  /**
   * Convert Kodi audio streams to AudioStreamInfo array
   * Now includes object audio detection and better bitrate calculation
   */
  private convertAudioStreams(
    streams: KodiAudioStream[] | undefined,
    title?: string,
    totalBitrate?: number,
    videoBitrate?: number
  ): AudioStreamInfo[] {
    if (!streams || streams.length === 0) return []

    // Try to calculate audio bitrate from file if we have the data
    const numTracks = streams.length
    const calculatedBitrate = (totalBitrate && videoBitrate)
      ? calculateAudioBitrateFromFile(totalBitrate, videoBitrate, numTracks)
      : 0

    return streams.map((stream, index) => {
      const hasObjAudio = hasObjectAudio(stream.codec, null, title, null)
      // Use calculated bitrate if reasonable, otherwise estimate
      let bitrate = calculatedBitrate
      if (bitrate <= 0 || bitrate > 20000) {
        bitrate = estimateAudioBitrate(stream.codec, stream.channels)
      }

      return {
        codec: normalizeAudioCodec(stream.codec) || 'Unknown',
        channels: normalizeAudioChannels(stream.channels, undefined) || 2,
        language: stream.language || undefined,
        isDefault: index === 0,
        bitrate,
        hasObjectAudio: hasObjAudio,
      }
    })
  }

  /**
   * Get file size from filesystem
   * Returns size in bytes, or 0 if file doesn't exist or can't be read
   */
  private getFileSize(filePath: string): number {
    try {
      const stats = fs.statSync(filePath)
      return stats.size
    } catch {
      // File may not be accessible (network drive, removed, etc.)
      return 0
    }
  }

  /**
   * Calculate video bitrate from file size and duration
   * Returns bitrate in kbps, or 0 if calculation not possible
   */
  private calculateBitrate(fileSizeBytes: number, durationSeconds: number): number {
    if (!fileSizeBytes || !durationSeconds || durationSeconds <= 0) {
      return 0
    }
    // bitrate (kbps) = (file_size_bytes * 8) / duration_seconds / 1000
    return Math.round((fileSizeBytes * 8) / durationSeconds / 1000)
  }

  private async getMovies(): Promise<MediaMetadata[]> {
    await this.openDatabase()

    try {
      const movies = this.query<KodiMovieWithDetails>(QUERY_MOVIES_WITH_DETAILS)
      const audioStreamsByFile = this.getAudioStreamsByFileId()

      return movies.map((movie) => {
        const audioStreams = audioStreamsByFile.get(movie.idFile)
        return this.convertMovieToMetadata(movie, audioStreams)
      })
    } finally {
      this.closeDatabase()
    }
  }

  private async getEpisodes(): Promise<MediaMetadata[]> {
    await this.openDatabase()

    try {
      const episodes = this.query<KodiEpisodeWithDetails>(QUERY_EPISODES_WITH_DETAILS)
      const audioStreamsByFile = this.getAudioStreamsByFileId()

      return episodes.map((episode) => {
        const audioStreams = audioStreamsByFile.get(episode.idFile)
        return this.convertEpisodeToMetadata(episode, audioStreams)
      })
    } finally {
      this.closeDatabase()
    }
  }

  /**
   * Get movies added after a specific timestamp (for incremental scans)
   */
  private async getMoviesSince(sinceTimestamp: Date): Promise<MediaMetadata[]> {
    await this.openDatabase()

    try {
      // Format timestamp for SQLite: "YYYY-MM-DD HH:MM:SS"
      const dateStr = sinceTimestamp.toISOString().replace('T', ' ').split('.')[0]

      // Add WHERE clause to filter by dateAdded
      const query = QUERY_MOVIES_WITH_DETAILS + ` WHERE f.dateAdded > '${dateStr}'`
      const movies = this.query<KodiMovieWithDetails>(query)
      const audioStreamsByFile = this.getAudioStreamsByFileId()

      return movies.map((movie) => {
        const audioStreams = audioStreamsByFile.get(movie.idFile)
        return this.convertMovieToMetadata(movie, audioStreams)
      })
    } finally {
      this.closeDatabase()
    }
  }

  /**
   * Get episodes added after a specific timestamp (for incremental scans)
   */
  private async getEpisodesSince(sinceTimestamp: Date): Promise<MediaMetadata[]> {
    await this.openDatabase()

    try {
      // Format timestamp for SQLite: "YYYY-MM-DD HH:MM:SS"
      const dateStr = sinceTimestamp.toISOString().replace('T', ' ').split('.')[0]

      // Add WHERE clause to filter by dateAdded
      const query = QUERY_EPISODES_WITH_DETAILS + ` WHERE f.dateAdded > '${dateStr}'`
      const episodes = this.query<KodiEpisodeWithDetails>(query)
      const audioStreamsByFile = this.getAudioStreamsByFileId()

      return episodes.map((episode) => {
        const audioStreams = audioStreamsByFile.get(episode.idFile)
        return this.convertEpisodeToMetadata(episode, audioStreams)
      })
    } finally {
      this.closeDatabase()
    }
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    // Item ID format: "movie_123" or "episode_456"
    const [type, id] = itemId.split('_')
    const numId = parseInt(id, 10)

    await this.openDatabase()

    try {
      if (type === 'movie') {
        const movies = this.query<KodiMovieWithDetails>(QUERY_MOVIE_BY_ID, [numId])
        if (movies.length === 0) {
          throw new Error(`Movie not found: ${numId}`)
        }
        return this.convertMovieToMetadata(movies[0])
      } else if (type === 'episode') {
        const episodes = this.query<KodiEpisodeWithDetails>(QUERY_EPISODE_BY_ID, [numId])
        if (episodes.length === 0) {
          throw new Error(`Episode not found: ${numId}`)
        }
        return this.convertEpisodeToMetadata(episodes[0])
      }

      throw new Error(`Unknown item type: ${type}`)
    } finally {
      this.closeDatabase()
    }
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress, sinceTimestamp, forceFullScan, targetFiles } = options || {}

    // Handle targeted file scanning (for rescan of specific files)
    if (targetFiles && targetFiles.length > 0) {
      console.log(`[KodiLocalProvider ${this.sourceId}] Targeted scan for ${targetFiles.length} files`)
      return this.scanTargetedFiles(libraryId, targetFiles, onProgress)
    }

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
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()

      const scannedProviderIds = new Set<string>()
      let items: MediaMetadata[]

      // Log incremental scan info
      if (isIncremental) {
        console.log(`[KodiLocalProvider ${this.sourceId}] Incremental scan: fetching items added after ${sinceTimestamp!.toISOString()}`)
      }

      if (libraryId === 'music') {
        // Music library uses dedicated scanning method
        // Type cast needed: scanMusicLibrary uses string for phase, ProgressCallback uses union
        return await this.scanMusicLibrary(onProgress as Parameters<typeof this.scanMusicLibrary>[0])
      } else if (libraryId === 'movies') {
        items = isIncremental
          ? await this.getMoviesSince(sinceTimestamp!)
          : await this.getMovies()
      } else if (libraryId === 'tvshows') {
        items = isIncremental
          ? await this.getEpisodesSince(sinceTimestamp!)
          : await this.getEpisodes()
      } else {
        throw new Error(`Unknown library: ${libraryId}`)
      }

      const totalItems = items.length
      const ffprobeEnabled = this.useFFprobeAnalysis && await this.isFFprobeAvailable()
      if (isIncremental) {
        console.log(`[KodiLocalProvider ${this.sourceId}] Incremental scan found ${totalItems} new/updated items (FFprobe: ${ffprobeEnabled ? 'enabled' : 'disabled'})`)
      } else {
        console.log(`[KodiLocalProvider ${this.sourceId}] Processing ${totalItems} items... (FFprobe: ${ffprobeEnabled ? 'enabled' : 'disabled'})`)
      }

      // Start batch mode
      db.startBatch()

      try {
        for (let i = 0; i < items.length; i++) {
          let metadata = items[i]

          try {
            // Enhance metadata with FFprobe analysis if enabled
            if (ffprobeEnabled && metadata.filePath) {
              // Log first item's file path for debugging
              if (i === 0) {
                console.log(`[KodiLocalProvider] FFprobe analyzing first file: "${path.basename(metadata.filePath)}"`)

              }
              try {
                const ffprobeResult = await this.analyzeFileWithFFprobe(metadata.filePath)
                // Log first result regardless of success
                if (i === 0) {
                  console.log(`[KodiLocalProvider] FFprobe result for "${metadata.title}":`, {
                    success: ffprobeResult.success,
                    error: ffprobeResult.error,
                    hasVideo: !!ffprobeResult.video,
                    videoBitrate: ffprobeResult.video?.bitrate,
                    colorBitDepth: ffprobeResult.video?.bitDepth,
                    colorSpace: ffprobeResult.video?.colorSpace,
                    frameRate: ffprobeResult.video?.frameRate,
                    audioTracks: ffprobeResult.audioTracks?.length,
                  })
                }
                if (ffprobeResult.success) {
                  metadata = this.enhanceMetadataWithFFprobe(metadata, ffprobeResult)
                } else if (i < 5) {
                  // Log FFprobe failures (file not found, network path issues, etc.)
                  console.warn(`[KodiLocalProvider] FFprobe failed for "${metadata.title}": ${ffprobeResult.error}`)
                }
              } catch (ffprobeError: unknown) {
                // Log but continue - FFprobe failure shouldn't stop the scan
                console.warn(`[KodiLocalProvider] FFprobe exception for ${metadata.title}: ${(ffprobeError as Error).message}`)
              }
            } else if (i === 0) {
              console.log(`[KodiLocalProvider] FFprobe skipped - enabled: ${ffprobeEnabled}, hasFilePath: ${!!metadata.filePath}`)            }

            const mediaItem = this.convertMetadataToMediaItem(metadata)
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = 'kodi-local'
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
                phase: ffprobeEnabled ? 'analyzing' : 'processing',
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
  // TARGETED FILE SCANNING
  // ============================================================================

  /**
   * Scan specific files by their paths (for rescan of individual items)
   * Much faster than full library scan when only a few files need updating
   */
  private async scanTargetedFiles(
    libraryId: string,
    filePaths: string[],
    onProgress?: (progress: {
      current: number
      total: number
      phase: 'fetching' | 'processing' | 'analyzing' | 'saving'
      currentItem?: string
      percentage: number
    }) => void
  ): Promise<ScanResult> {
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
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()

      // Check FFprobe availability (respects user setting)
      const ffprobeEnabled = db.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && this.useFFprobeAnalysis && await this.isFFprobeAvailable()

      console.log(`[KodiLocalProvider ${this.sourceId}] Targeted scan - FFprobe: ${ffprobeAvailable ? 'enabled' : 'disabled'}`)

      await this.openDatabase()

      try {
        // Get audio streams for all files at once
        const audioStreamsByFile = this.getAudioStreamsByFileId()

        for (let i = 0; i < filePaths.length; i++) {
          const inputFilePath = filePaths[i]

          onProgress?.({
            current: i + 1,
            total: filePaths.length,
            phase: 'processing',
            currentItem: inputFilePath.split(/[\\/]/).pop() || inputFilePath,
            percentage: ((i + 1) / filePaths.length) * 100,
          })

          try {
            // Find the item in Kodi database by file path
            let kodiItem: KodiMovieWithDetails | KodiEpisodeWithDetails | null = null
            let itemType: 'movie' | 'episode' = 'movie'

            if (libraryId === 'movies') {
              kodiItem = await this.findMovieByFilePath(inputFilePath)
              itemType = 'movie'
            } else if (libraryId === 'tvshows') {
              kodiItem = await this.findEpisodeByFilePath(inputFilePath)
              itemType = 'episode'
            } else {
              result.errors.push(`Unsupported library type for targeted scan: ${libraryId}`)
              continue
            }

            if (!kodiItem) {
              console.log(`[KodiLocalProvider ${this.sourceId}] File not found in Kodi database: ${path.basename(inputFilePath)}`)
              result.errors.push(`File not found in Kodi database: ${path.basename(inputFilePath)}`)
              continue
            }

            console.log(`[KodiLocalProvider ${this.sourceId}] Found item in Kodi: ${itemType === 'movie' ? (kodiItem as KodiMovieWithDetails).title : (kodiItem as KodiEpisodeWithDetails).title}`)

            // Get audio streams for this file
            const audioStreams = audioStreamsByFile.get(kodiItem.idFile)

            // Convert to metadata
            let metadata: MediaMetadata
            if (itemType === 'movie') {
              metadata = this.convertMovieToMetadata(kodiItem as KodiMovieWithDetails, audioStreams)
            } else {
              metadata = this.convertEpisodeToMetadata(kodiItem as KodiEpisodeWithDetails, audioStreams)
            }

            // Enhance with FFprobe analysis if available
            if (ffprobeAvailable && metadata.filePath) {
              onProgress?.({
                current: i + 1,
                total: filePaths.length,
                phase: 'analyzing',
                currentItem: metadata.title,
                percentage: ((i + 1) / filePaths.length) * 100,
              })

              try {
                const ffprobeResult = await this.analyzeFileWithFFprobe(metadata.filePath)
                console.log(`[KodiLocalProvider ${this.sourceId}] FFprobe result for "${metadata.title}":`, {
                  success: ffprobeResult.success,
                  error: ffprobeResult.error,
                  hasVideo: !!ffprobeResult.video,
                  videoBitrate: ffprobeResult.video?.bitrate,
                })
                if (ffprobeResult.success) {
                  metadata = this.enhanceMetadataWithFFprobe(metadata, ffprobeResult)
                }
              } catch (ffprobeError: unknown) {
                console.warn(`[KodiLocalProvider ${this.sourceId}] FFprobe exception for ${metadata.title}: ${(ffprobeError as Error).message}`)
              }
            }

            // Convert to MediaItem and save
            const mediaItem = this.convertMetadataToMediaItem(metadata)
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = 'kodi-local'
              mediaItem.library_id = libraryId

              const id = await db.upsertMediaItem(mediaItem)

              // Analyze quality
              mediaItem.id = id
              const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
              await db.upsertQualityScore(qualityScore)

              result.itemsScanned++
              result.itemsUpdated++
              console.log(`[KodiLocalProvider ${this.sourceId}] Updated: ${metadata.title}`)
            }
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${inputFilePath}: ${getErrorMessage(error)}`)
          }
        }
      } finally {
        this.closeDatabase()
      }

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[KodiLocalProvider ${this.sourceId}] Targeted scan complete: ${result.itemsScanned} items updated in ${result.durationMs}ms`)

      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  /**
   * Find a movie in Kodi database by file path
   * Handles path format conversion between Windows UNC and Kodi smb:// format
   */
  private async findMovieByFilePath(inputPath: string): Promise<KodiMovieWithDetails | null> {
    // Get all possible path variants for matching
    const pathVariants = this.getKodiPathVariants(inputPath)

    for (const { dirPath, fileName } of pathVariants) {
      // Query for movie matching this path
      const query = `
        ${QUERY_MOVIES_WITH_DETAILS}
        WHERE p.strPath = ? AND f.strFilename = ?
        LIMIT 1
      `
      const results = this.query<KodiMovieWithDetails>(query, [dirPath, fileName])
      if (results.length > 0) {
        return results[0]
      }
    }

    return null
  }

  /**
   * Find an episode in Kodi database by file path
   * Handles path format conversion between Windows UNC and Kodi smb:// format
   */
  private async findEpisodeByFilePath(inputPath: string): Promise<KodiEpisodeWithDetails | null> {
    // Get all possible path variants for matching
    const pathVariants = this.getKodiPathVariants(inputPath)

    for (const { dirPath, fileName } of pathVariants) {
      // Query for episode matching this path
      const query = `
        ${QUERY_EPISODES_WITH_DETAILS}
        WHERE p.strPath = ? AND f.strFilename = ?
        LIMIT 1
      `
      const results = this.query<KodiEpisodeWithDetails>(query, [dirPath, fileName])
      if (results.length > 0) {
        return results[0]
      }
    }

    return null
  }

  /**
   * Generate possible Kodi database path variants from an input file path
   * Kodi may store paths in different formats (smb://, local, etc.)
   */
  private getKodiPathVariants(inputPath: string): Array<{ dirPath: string; fileName: string }> {
    const variants: Array<{ dirPath: string; fileName: string }> = []

    // Split into directory and filename
    const isWindowsPath = inputPath.includes('\\')
    const separator = isWindowsPath ? '\\' : '/'
    const lastSepIndex = inputPath.lastIndexOf(separator)

    if (lastSepIndex === -1) {
      return variants
    }

    const fileName = inputPath.slice(lastSepIndex + 1)
    const dirPath = inputPath.slice(0, lastSepIndex + 1) // Keep trailing separator

    // Variant 1: Original path as-is (with trailing separator)
    variants.push({ dirPath, fileName })

    // Variant 2: If it's a Windows UNC path, convert to Kodi smb:// format
    if (inputPath.startsWith('\\\\')) {
      // \\server\share\path\ -> smb://server/share/path/
      const smbPath = 'smb://' + inputPath.slice(2).replace(/\\/g, '/')
      const smbLastSep = smbPath.lastIndexOf('/')
      const smbDirPath = smbPath.slice(0, smbLastSep + 1)
      variants.push({ dirPath: smbDirPath, fileName })
    }

    // Variant 3: If it's an smb:// path, also try UNC format
    if (inputPath.startsWith('smb://')) {
      // smb://server/share/path/ -> \\server\share\path\
      const uncPath = '\\\\' + inputPath.slice(6).replace(/\//g, '\\')
      const uncLastSep = uncPath.lastIndexOf('\\')
      const uncDirPath = uncPath.slice(0, uncLastSep + 1)
      variants.push({ dirPath: uncDirPath, fileName })
    }

    return variants
  }

  // ============================================================================
  // COLLECTION SUPPORT
  // ============================================================================

  /**
   * Get all movie collections/sets from Kodi database
   */
  async getCollections(): Promise<KodiSetWithDetails[]> {
    await this.openDatabase()

    try {
      const sets = this.query<KodiSetWithDetails>(QUERY_ALL_SETS)
      console.log(`[KodiLocalProvider] Found ${sets.length} collections in Kodi`)
      return sets
    } finally {
      this.closeDatabase()
    }
  }

  /**
   * Get movies grouped by collection
   * Returns a map of collection name -> movies in that collection
   */
  async getMoviesGroupedByCollection(): Promise<Map<string, KodiMovieWithDetails[]>> {
    await this.openDatabase()

    try {
      const movies = this.query<KodiMovieWithDetails>(QUERY_MOVIES_WITH_DETAILS)
      const collectionMap = new Map<string, KodiMovieWithDetails[]>()

      for (const movie of movies) {
        if (movie.setName) {
          if (!collectionMap.has(movie.setName)) {
            collectionMap.set(movie.setName, [])
          }
          collectionMap.get(movie.setName)!.push(movie)
        }
      }

      console.log(`[KodiLocalProvider] Found ${collectionMap.size} collections with movies`)
      return collectionMap
    } finally {
      this.closeDatabase()
    }
  }

  /**
   * Import Kodi collections into the app's database
   * Maps Kodi sets to the movie_collections table using TMDB IDs where available
   */
  async importCollections(
    onProgress?: (progress: { current: number; total: number; currentItem: string }) => void
  ): Promise<{ imported: number; skipped: number }> {
    const db = getDatabase()
    const collections = await this.getCollections()
    const moviesByCollection = await this.getMoviesGroupedByCollection()

    let imported = 0
    let skipped = 0

    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i]
      const movies = moviesByCollection.get(collection.name) || []

      onProgress?.({
        current: i + 1,
        total: collections.length,
        currentItem: collection.name,
      })

      // Get TMDB IDs from movies in this collection
      const ownedTmdbIds = movies
        .map(m => m.tmdbId)
        .filter((id): id is string => !!id)

      // Skip if no TMDB IDs (can't match with TMDB collections)
      if (ownedTmdbIds.length === 0) {
        console.log(`[KodiLocalProvider] Skipping collection "${collection.name}" - no TMDB IDs`)
        skipped++
        continue
      }

      // Try to find a matching TMDB collection ID from our existing data
      // or create a Kodi-based collection entry
      const collectionData = {
        // Use Kodi set ID as a fallback identifier (prefixed to avoid conflicts)
        tmdb_collection_id: `kodi_${collection.idSet}`,
        collection_name: collection.name,
        source_id: this.sourceId,
        library_id: 'movies',
        total_movies: movies.length,
        owned_movies: movies.length,
        missing_movies: JSON.stringify([]), // Kodi doesn't track missing movies
        owned_movie_ids: JSON.stringify(ownedTmdbIds),
        completeness_percentage: 100, // All movies in Kodi set are owned
        poster_url: convertKodiImageUrl(collection.posterUrl) || convertKodiImageUrl(movies[0]?.posterUrl),
        backdrop_url: convertKodiImageUrl(collection.fanartUrl) || convertKodiImageUrl(movies[0]?.fanartUrl),
      }

      await db.upsertMovieCollection(collectionData)
      imported++

      console.log(`[KodiLocalProvider] Imported collection "${collection.name}" with ${movies.length} movies`)
    }

    return { imported, skipped }
  }

  // ============================================================================
  // CONVERSION HELPERS
  // ============================================================================

  private convertMovieToMetadata(movie: KodiMovieWithDetails, audioStreams?: KodiAudioStream[]): MediaMetadata {
    const filePath = buildFilePath(movie.filepath || '', movie.filename || '')

    // Normalize video/audio properties using shared normalizer
    const width = movie.videoWidth || 0
    const height = movie.videoHeight || 0
    const resolution = normalizeResolution(width, height)
    const hdrFormat = normalizeHdrFormat(movie.hdrType, undefined, undefined, undefined, undefined)
    const videoCodec = normalizeVideoCodec(movie.videoCodec)

    // Duration: prefer streamdetails (seconds), fall back to movie runtime (minutes)
    let durationSeconds = movie.videoDuration || 0
    if (!durationSeconds && movie.runtime && movie.runtime > 0) {
      durationSeconds = movie.runtime * 60 // minutes to seconds
    }
    const duration = durationSeconds > 0 ? durationSeconds * 1000 : undefined // to ms

    // Get actual file size and calculate total bitrate
    const fileSize = this.getFileSize(filePath)
    const totalBitrate = this.calculateBitrate(fileSize, durationSeconds)
    // Estimate video portion (~90% of total)
    const videoBitrate = totalBitrate > 0 ? Math.round(totalBitrate * 0.90) : 0

    // Convert audio streams with object audio detection and calculated bitrate
    const audioTracks = this.convertAudioStreams(audioStreams, movie.title, totalBitrate, videoBitrate)

    // Find the best audio track (highest quality, prefer object audio)
    let bestAudio = audioTracks[0]
    let hasAnyObjectAudio = false
    for (const track of audioTracks) {
      if (track.hasObjectAudio) {
        hasAnyObjectAudio = true
        if (!bestAudio?.hasObjectAudio || (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
          bestAudio = track
        }
      } else if (!bestAudio?.hasObjectAudio && (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
        bestAudio = track
      }
    }

    const audioCodec = bestAudio?.codec || normalizeAudioCodec(movie.audioCodec) || undefined
    const audioChannels = bestAudio?.channels || normalizeAudioChannels(movie.audioChannels, undefined) || undefined
    const audioBitrate = bestAudio?.bitrate || undefined

    // Debug logging for year extraction
    const extractedYear = movie.year || undefined
    if (extractedYear) {
      console.log(`[KodiLocalProvider] Movie "${movie.title}" - year from DB: ${extractedYear}`)
    } else {
      console.log(`[KodiLocalProvider] Movie "${movie.title}" - no year in DB (c07: "${movie.c07_raw || ''}", premiered: "${movie.premiered_raw || ''}")`)
    }

    return {
      providerId: this.sourceId,
      providerType: 'kodi-local' as ProviderType,
      itemId: `movie_${movie.idMovie}`,
      title: movie.title,
      type: 'movie',
      year: extractedYear,
      imdbId: movie.imdbId || undefined,
      tmdbId: movie.tmdbId ? parseInt(movie.tmdbId, 10) : undefined,
      filePath,
      fileSize: fileSize || undefined,
      duration,
      resolution,
      width: width || undefined,
      height: height || undefined,
      videoCodec: videoCodec || undefined,
      videoBitrate: videoBitrate || undefined,
      hdrFormat: hdrFormat || undefined,
      audioCodec: audioCodec || undefined,
      audioChannels: audioChannels || undefined,
      audioBitrate: audioBitrate,
      hasObjectAudio: hasAnyObjectAudio,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      posterUrl: convertKodiImageUrl(movie.posterUrl),
      backdropUrl: convertKodiImageUrl(movie.fanartUrl),
    }
  }

  private convertEpisodeToMetadata(episode: KodiEpisodeWithDetails, audioStreams?: KodiAudioStream[]): MediaMetadata {
    const filePath = buildFilePath(episode.filepath || '', episode.filename || '')

    // Normalize video/audio properties using shared normalizer
    const width = episode.videoWidth || 0
    const height = episode.videoHeight || 0
    const resolution = normalizeResolution(width, height)
    const hdrFormat = normalizeHdrFormat(episode.hdrType, undefined, undefined, undefined, undefined)
    const videoCodec = normalizeVideoCodec(episode.videoCodec)

    // Duration from streamdetails (seconds)
    const durationSeconds = episode.videoDuration || 0
    const duration = durationSeconds > 0 ? durationSeconds * 1000 : undefined // to ms

    // Get actual file size and calculate total bitrate
    const fileSize = this.getFileSize(filePath)
    const totalBitrate = this.calculateBitrate(fileSize, durationSeconds)
    const videoBitrate = totalBitrate > 0 ? Math.round(totalBitrate * 0.90) : 0

    // Convert audio streams with object audio detection and calculated bitrate
    const audioTracks = this.convertAudioStreams(audioStreams, episode.title, totalBitrate, videoBitrate)

    // Find the best audio track
    let bestAudio = audioTracks[0]
    let hasAnyObjectAudio = false
    for (const track of audioTracks) {
      if (track.hasObjectAudio) {
        hasAnyObjectAudio = true
        if (!bestAudio?.hasObjectAudio || (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
          bestAudio = track
        }
      } else if (!bestAudio?.hasObjectAudio && (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
        bestAudio = track
      }
    }

    const audioCodec = bestAudio?.codec || normalizeAudioCodec(episode.audioCodec) || undefined
    const audioChannels = bestAudio?.channels || normalizeAudioChannels(episode.audioChannels, undefined) || undefined
    const audioBitrate = bestAudio?.bitrate || undefined

    return {
      providerId: this.sourceId,
      providerType: 'kodi-local' as ProviderType,
      itemId: `episode_${episode.idEpisode}`,
      title: episode.title,
      type: 'episode',
      seriesTitle: episode.showTitle,
      seasonNumber: episode.seasonNumber || undefined,
      episodeNumber: episode.episodeNumber || undefined,
      imdbId: episode.showImdbId || undefined,
      filePath,
      fileSize: fileSize || undefined,
      duration,
      resolution,
      width: width || undefined,
      height: height || undefined,
      videoCodec: videoCodec || undefined,
      videoBitrate: videoBitrate || undefined,
      hdrFormat: hdrFormat || undefined,
      audioCodec: audioCodec || undefined,
      audioChannels: audioChannels || undefined,
      audioBitrate: audioBitrate,
      hasObjectAudio: hasAnyObjectAudio,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      episodeThumbUrl: convertKodiImageUrl(episode.thumbUrl),
      posterUrl: convertKodiImageUrl(episode.seasonPosterUrl) || convertKodiImageUrl(episode.showPosterUrl),
      seasonPosterUrl: convertKodiImageUrl(episode.seasonPosterUrl),
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
      video_level: metadata.videoLevel ? parseInt(metadata.videoLevel, 10) : undefined,
      audio_codec: metadata.audioCodec || '',
      audio_channels: metadata.audioChannels || 2,
      audio_bitrate: metadata.audioBitrate || 0,
      has_object_audio: metadata.hasObjectAudio || false,
      hdr_format: metadata.hdrFormat,
      audio_tracks: JSON.stringify(audioTracks),
      imdb_id: metadata.imdbId,
      tmdb_id: metadata.tmdbId?.toString(),
      poster_url: metadata.posterUrl,
      episode_thumb_url: metadata.episodeThumbUrl,
      season_poster_url: metadata.seasonPosterUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  // ============================================================================
  // MUSIC LIBRARY SUPPORT
  // ============================================================================

  /**
   * Find and open the Kodi music database
   * Returns true if music database is available, false otherwise
   */
  private async openMusicDatabase(): Promise<boolean> {
    if (this.musicDb) {
      return true // Already open
    }

    // Try to find the music database path from the video database path
    if (!this.musicDatabasePath && this.databasePath) {
      // Replace MyVideosXXX.db with MyMusicXXX.db
      const videoDbDir = this.databasePath.replace(/[\\/][^\\/]+$/, '')

      // Look for music database files
      try {
        const files = fs.readdirSync(videoDbDir)
        const musicDbFiles = files.filter(f => f.match(/^MyMusic\d+\.db$/))

        if (musicDbFiles.length > 0) {
          // Use the latest version (highest number)
          musicDbFiles.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0')
            const numB = parseInt(b.match(/\d+/)?.[0] || '0')
            return numB - numA
          })
          this.musicDatabasePath = videoDbDir + (videoDbDir.includes('\\') ? '\\' : '/') + musicDbFiles[0]
          console.log(`[KodiLocalProvider] Found music database: ${path.basename(this.musicDatabasePath)}`)
        }
      } catch (error: unknown) {
        console.log(`[KodiLocalProvider] Could not search for music database: ${getErrorMessage(error)}`)
        return false
      }
    }

    if (!this.musicDatabasePath) {
      console.log('[KodiLocalProvider] Music database path not configured')
      return false
    }

    if (!fs.existsSync(this.musicDatabasePath)) {
      console.log(`[KodiLocalProvider] Music database file not found: ${path.basename(this.musicDatabasePath)}`)
      return false
    }

    await this.initSqlJs()

    try {
      const dbBuffer = fs.readFileSync(this.musicDatabasePath)
      this.musicDb = new this.sqlJs!.Database(dbBuffer)
      console.log(`[KodiLocalProvider] Music database opened: ${path.basename(this.musicDatabasePath)}`)
      return true
    } catch (error: unknown) {
      console.error(`[KodiLocalProvider] Failed to open music database: ${getErrorMessage(error)}`)
      return false
    }
  }

  /**
   * Close the music database connection
   */
  private closeMusicDatabase(): void {
    if (this.musicDb) {
      this.musicDb.close()
      this.musicDb = null
      console.log('[KodiLocalProvider] Music database closed')
    }
  }

  /**
   * Execute a query on the music database
   */
  private queryMusicDb<T>(sql: string, params: (string | number | null)[] = []): T[] {
    if (!this.musicDb) {
      throw new Error('Music database not opened')
    }

    try {
      const stmt = this.musicDb.prepare(sql)
      stmt.bind(params)

      const results: T[] = []
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T)
      }
      stmt.free()

      return results
    } catch (error: unknown) {
      console.error('[KodiLocalProvider] Music query error:', getErrorMessage(error))
      throw error
    }
  }

  /**
   * Convert Kodi artist result to MusicArtist type
   */
  private convertToMusicArtist(item: KodiMusicArtistResult): MusicArtist {
    return {
      source_id: this.sourceId,
      source_type: 'kodi-local',
      library_id: 'music',
      provider_id: String(item.idArtist),
      name: item.strArtist,
      sort_name: item.strSortName || undefined,
      musicbrainz_id: item.strMusicBrainzArtistID || undefined,
      genres: item.strGenres || undefined,
      biography: item.strBiography || undefined,
      thumb_url: convertKodiImageUrl(item.thumbUrl),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Kodi album result to MusicAlbum type
   */
  private convertToMusicAlbum(item: KodiMusicAlbumResult, artistId?: number): MusicAlbum {
    // Map Kodi album types to our AlbumType
    const kodiType = (item.strType || '').toLowerCase()
    let albumType: AlbumType | undefined = undefined
    if (kodiType === 'album') albumType = 'album'
    else if (kodiType === 'ep') albumType = 'ep'
    else if (kodiType === 'single') albumType = 'single'
    else if (kodiType === 'compilation') albumType = 'compilation'
    else if (kodiType === 'live') albumType = 'live'
    else if (kodiType === 'soundtrack') albumType = 'soundtrack'
    else if (kodiType) albumType = 'unknown'

    return {
      source_id: this.sourceId,
      source_type: 'kodi-local',
      library_id: 'music',
      provider_id: String(item.idAlbum),
      artist_id: artistId,
      artist_name: item.strArtistDisp || 'Unknown Artist',
      title: item.strAlbum,
      // Note: year field removed for compatibility with older Kodi database versions
      musicbrainz_id: item.strMusicBrainzAlbumID || undefined,
      musicbrainz_release_group_id: item.strReleaseGroupMBID || undefined,
      genres: item.strGenres || undefined,
      studio: item.strLabel || undefined,
      album_type: albumType,
      thumb_url: convertKodiImageUrl(item.thumbUrl),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Kodi song result to MusicTrack type
   */
  private convertToMusicTrack(item: KodiMusicSongResult, albumId?: number, artistId?: number): MusicTrack {
    const { disc, track } = parseTrackNumber(item.iTrack)
    const filePath = buildMusicFilePath(item.strPath, item.strFileName)
    const audioCodec = guessCodecFromExtension(item.strFileName)
    const lossless = isLosslessCodec(audioCodec)

    return {
      source_id: this.sourceId,
      source_type: 'kodi-local',
      library_id: 'music',
      provider_id: String(item.idSong),
      album_id: albumId,
      artist_id: artistId,
      album_name: item.albumTitle || undefined,
      artist_name: item.artistDisp || 'Unknown Artist',
      title: item.strTitle,
      track_number: track,
      disc_number: disc,
      duration: item.iDuration ? item.iDuration * 1000 : undefined, // Kodi stores seconds, we want ms
      file_path: filePath,
      audio_codec: audioCodec,
      is_lossless: lossless,
      is_hi_res: false, // Will be updated by FFprobe if available
      musicbrainz_id: item.strMusicBrainzTrackID || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Enhance music track data with FFprobe analysis
   */
  private async enhanceMusicTrackWithFFprobe(track: MusicTrack): Promise<MusicTrack> {
    if (!track.file_path) return track

    try {
      const analyzer = getMediaFileAnalyzer()
      const analysis = await analyzer.analyzeFile(track.file_path)

      if (!analysis.success || !analysis.audioTracks || analysis.audioTracks.length === 0) {
        return track
      }

      const audioStream = analysis.audioTracks[0]

      // Update with accurate FFprobe data
      if (audioStream.codec) {
        track.audio_codec = normalizeAudioCodec(audioStream.codec)
        track.is_lossless = isLosslessCodec(track.audio_codec)
      }

      if (audioStream.bitrate) {
        track.audio_bitrate = audioStream.bitrate
      }

      if (audioStream.sampleRate) {
        track.sample_rate = audioStream.sampleRate
        // Hi-res audio: sample rate > 48kHz
        if (audioStream.sampleRate > 48000) {
          track.is_hi_res = true
        }
      }

      if (audioStream.bitDepth) {
        track.bit_depth = audioStream.bitDepth
        // Hi-res audio: bit depth > 16
        if (audioStream.bitDepth > 16) {
          track.is_hi_res = true
        }
      }

      if (audioStream.channels) {
        track.channels = audioStream.channels
      }

      // Update duration from FFprobe if available
      if (analysis.duration) {
        track.duration = Math.round(analysis.duration * 1000) // Convert to ms
      }

      // Update file size
      if (analysis.fileSize) {
        track.file_size = analysis.fileSize
      }

      return track
    } catch (error: unknown) {
      // Log but don't fail - continue with guessed data
      console.warn(`[KodiLocalProvider] FFprobe failed for music track "${track.title}": ${getErrorMessage(error)}`)
      return track
    }
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
      const musicDbAvailable = await this.openMusicDatabase()
      if (!musicDbAvailable) {
        result.errors.push('Music database not available')
        result.durationMs = Date.now() - startTime
        return result
      }

      const db = getDatabase()

      // Check if FFprobe is available for enhanced audio analysis
      const ffprobeEnabled = this.useFFprobeAnalysis && await this.isFFprobeAvailable()
      console.log(`[KodiLocalProvider ${this.sourceId}] Music scan - FFprobe: ${ffprobeEnabled ? 'enabled' : 'disabled'}`)

      // Track scanned IDs for cleanup
      const scannedArtistIds = new Set<string>()
      const scannedAlbumIds = new Set<string>()
      const scannedTrackIds = new Set<string>()

      // Helper to process an album
      const processAlbum = async (
        kodiAlbum: KodiMusicAlbumResult,
        artistId: number | undefined,
        artistName?: string
      ): Promise<{ trackCount: number; cancelled?: boolean }> => {
        const albumData = this.convertToMusicAlbum(kodiAlbum, artistId)

        // Override artist name if provided (for compilations)
        if (artistName && !albumData.artist_name) {
          albumData.artist_name = artistName
        }

        // Get all tracks for this album
        const songs = this.queryMusicDb<KodiMusicSongResult>(QUERY_MUSIC_SONGS_BY_ALBUM, [kodiAlbum.idAlbum])

        // Convert and collect tracks, optionally enhancing with FFprobe
        const trackDataList: MusicTrack[] = []
        for (const kodiSong of songs) {
          // Check for cancellation during track processing (FFprobe can be slow)
          if (this.musicScanCancelled) {
            return { trackCount: 0, cancelled: true }
          }

          let trackData = this.convertToMusicTrack(kodiSong, undefined, artistId)

          // Enhance with FFprobe if enabled
          if (ffprobeEnabled && trackData.file_path) {
            trackData = await this.enhanceMusicTrackWithFFprobe(trackData)
          }

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
        scannedAlbumIds.add(String(kodiAlbum.idAlbum))

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
      const artists = this.queryMusicDb<KodiMusicArtistResult>(QUERY_MUSIC_ARTISTS)
      const totalArtists = artists.length

      console.log(`[KodiLocalProvider ${this.sourceId}] Scanning music library: ${totalArtists} artists`)

      let processed = 0

      for (const kodiArtist of artists) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[KodiLocalProvider ${this.sourceId}] Music scan cancelled at artist ${processed}/${totalArtists}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          this.closeMusicDatabase()
          return result
        }

        try {
          const artistData = this.convertToMusicArtist(kodiArtist)

          // Upsert artist
          const artistId = await db.upsertMusicArtist(artistData)
          scannedArtistIds.add(String(kodiArtist.idArtist))

          // Get all albums for this artist
          const albums = this.queryMusicDb<KodiMusicAlbumResult>(QUERY_MUSIC_ALBUMS_BY_ARTIST, [kodiArtist.idArtist])

          let artistTrackCount = 0
          let artistAlbumCount = 0

          for (const kodiAlbum of albums) {
            const { trackCount, cancelled } = await processAlbum(kodiAlbum, artistId)
            if (cancelled) {
              console.log(`[KodiLocalProvider ${this.sourceId}] Music scan cancelled during album processing`)
              result.cancelled = true
              result.durationMs = Date.now() - startTime
              this.closeMusicDatabase()
              return result
            }
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
              currentItem: kodiArtist.strArtist,
              percentage: (processed / totalArtists) * 50, // First 50% for artists
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process artist ${kodiArtist.strArtist}: ${getErrorMessage(error)}`)
        }
      }

      // Phase 2: Get all albums directly to catch compilations and orphaned albums (50-100% progress)
      console.log(`[KodiLocalProvider ${this.sourceId}] Scanning for compilations and orphaned albums...`)

      const allAlbums = this.queryMusicDb<KodiMusicAlbumResult>(QUERY_MUSIC_ALBUMS)
      const unprocessedAlbums = allAlbums.filter(a => !scannedAlbumIds.has(String(a.idAlbum)))

      console.log(`[KodiLocalProvider ${this.sourceId}] Found ${unprocessedAlbums.length} additional albums (compilations/orphaned)`)

      let compilationProcessed = 0
      const totalCompilations = unprocessedAlbums.length

      for (const kodiAlbum of unprocessedAlbums) {
        // Check for cancellation
        if (this.musicScanCancelled) {
          console.log(`[KodiLocalProvider ${this.sourceId}] Music scan cancelled at compilation ${compilationProcessed}/${totalCompilations}`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          this.closeMusicDatabase()
          return result
        }

        try {
          const artistName = kodiAlbum.strArtistDisp || 'Various Artists'
          const { cancelled } = await processAlbum(kodiAlbum, undefined, artistName)
          if (cancelled) {
            console.log(`[KodiLocalProvider ${this.sourceId}] Music scan cancelled during compilation processing`)
            result.cancelled = true
            result.durationMs = Date.now() - startTime
            this.closeMusicDatabase()
            return result
          }

          compilationProcessed++
          if (onProgress) {
            onProgress({
              current: compilationProcessed,
              total: totalCompilations,
              phase: 'processing compilations',
              currentItem: kodiAlbum.strAlbum,
              percentage: 50 + (compilationProcessed / Math.max(totalCompilations, 1)) * 50,
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process album ${kodiAlbum.strAlbum}: ${getErrorMessage(error)}`)
        }
      }

      this.closeMusicDatabase()

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[KodiLocalProvider ${this.sourceId}] Music scan complete: ${result.itemsScanned} tracks scanned in ${result.durationMs}ms`)

      return result
    } catch (error: unknown) {
      this.closeMusicDatabase()
      console.error(`[KodiLocalProvider ${this.sourceId}] Music scan failed:`, error)
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
    console.log(`[KodiLocalProvider ${this.sourceId}] Music scan cancellation requested`)
  }
}
