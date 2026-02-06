import { getErrorMessage } from '../../services/utils/errorUtils'
/**
 * KodiMySQLProvider
 *
 * Implements the MediaProvider interface for Kodi by connecting to a MySQL/MariaDB
 * shared database. This is the preferred method for multi-device Kodi setups.
 *
 * Advantages:
 * - Works with multiple Kodi devices sharing the same database
 * - No need for local Kodi installation
 * - Database is always accessible (unlike local SQLite)
 *
 * Requirements:
 * - MySQL/MariaDB server configured for Kodi shared database
 * - Network access to the database server
 * - Valid credentials with read access to Kodi databases
 */

import { getDatabaseService } from '../../services/DatabaseService'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import {
  getKodiMySQLConnectionService,
  type KodiMySQLConfig,
} from '../../services/KodiMySQLConnectionService'
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
  AudioStreamInfo,
} from '../base/MediaProvider'
import type { MediaItem, AudioTrack, MusicArtist, MusicAlbum, MusicTrack } from '../../types/database'
import {
  KodiMovieWithDetails,
  KodiEpisodeWithDetails,
  KodiSetWithDetails,
  buildFilePath,
} from './KodiDatabaseSchema'
import {
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
} from '../../services/MediaNormalizer'
import type { Pool } from 'mysql2/promise'

// Type for audio stream query result
interface KodiAudioStream {
  idFile: number
  codec: string | null
  channels: number | null
  language: string | null
}

// SQL Queries for MySQL (same as SQLite, both use standard SQL)
const QUERY_MOVIES_WITH_DETAILS = `
SELECT
  m.idMovie,
  m.idFile,
  m.c00 AS title,
  COALESCE(CAST(NULLIF(m.c07, '') AS SIGNED), CAST(SUBSTRING(m.premiered, 1, 4) AS SIGNED)) AS year,
  m.c07 AS c07_raw,
  m.premiered AS premiered_raw,
  NULLIF(m.c09, '') AS imdbId,
  (SELECT value FROM uniqueid WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'tmdb' LIMIT 1) AS tmdbId,
  CAST(NULLIF(m.c11, '') AS SIGNED) AS runtime,
  f.strFilename AS filename,
  p.strPath AS filepath,
  (SELECT iVideoWidth FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoWidth,
  (SELECT iVideoHeight FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoHeight,
  (SELECT strVideoCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoCodec,
  (SELECT iVideoDuration FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoDuration,
  (SELECT fVideoAspect FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoAspect,
  (SELECT strHdrType FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS hdrType,
  (SELECT strAudioCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioCodec,
  (SELECT iAudioChannels FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioChannels,
  (SELECT strAudioLanguage FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioLanguage,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'poster' LIMIT 1) AS posterUrl,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'fanart' LIMIT 1) AS fanartUrl,
  m.idSet AS setId,
  s.strSet AS setName,
  (SELECT url FROM art WHERE media_id = m.idSet AND media_type = 'set' AND type = 'poster' LIMIT 1) AS setPosterUrl
FROM movie m
JOIN files f ON m.idFile = f.idFile
JOIN path p ON f.idPath = p.idPath
LEFT JOIN sets s ON m.idSet = s.idSet
`

const QUERY_EPISODES_WITH_DETAILS = `
SELECT
  e.idEpisode,
  e.idFile,
  e.c00 AS title,
  CAST(NULLIF(e.c12, '') AS SIGNED) AS seasonNumber,
  CAST(NULLIF(e.c13, '') AS SIGNED) AS episodeNumber,
  s.c00 AS showTitle,
  NULLIF(s.c21, '') AS showImdbId,
  s.idShow AS showId,
  f.strFilename AS filename,
  p.strPath AS filepath,
  (SELECT iVideoWidth FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoWidth,
  (SELECT iVideoHeight FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoHeight,
  (SELECT strVideoCodec FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoCodec,
  (SELECT iVideoDuration FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoDuration,
  (SELECT fVideoAspect FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoAspect,
  (SELECT strHdrType FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS hdrType,
  (SELECT strAudioCodec FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioCodec,
  (SELECT iAudioChannels FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioChannels,
  (SELECT strAudioLanguage FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioLanguage,
  (SELECT url FROM art WHERE media_id = e.idEpisode AND media_type = 'episode' AND type = 'thumb' LIMIT 1) AS thumbUrl,
  (SELECT url FROM art WHERE media_id = s.idShow AND media_type = 'tvshow' AND type = 'poster' LIMIT 1) AS showPosterUrl,
  (SELECT url FROM art WHERE media_id = sea.idSeason AND media_type = 'season' AND type = 'poster' LIMIT 1) AS seasonPosterUrl
FROM episode e
JOIN tvshow s ON e.idShow = s.idShow
JOIN files f ON e.idFile = f.idFile
JOIN path p ON f.idPath = p.idPath
LEFT JOIN seasons sea ON sea.idShow = e.idShow AND sea.season = CAST(NULLIF(e.c12, '') AS SIGNED)
`

const QUERY_MOVIE_COUNT = `SELECT COUNT(*) as count FROM movie`
const QUERY_EPISODE_COUNT = `SELECT COUNT(*) as count FROM episode`

const QUERY_AUDIO_STREAMS = `
SELECT
  idFile,
  strAudioCodec AS codec,
  iAudioChannels AS channels,
  strAudioLanguage AS language
FROM streamdetails
WHERE iStreamType = 1
ORDER BY idFile, iAudioChannels DESC
`

const QUERY_ALL_SETS = `
SELECT
  s.idSet,
  s.strSet AS name,
  s.strOverview AS overview,
  COUNT(m.idMovie) AS movieCount,
  (SELECT url FROM art WHERE media_id = s.idSet AND media_type = 'set' AND type = 'poster' LIMIT 1) AS posterUrl,
  (SELECT url FROM art WHERE media_id = s.idSet AND media_type = 'set' AND type = 'fanart' LIMIT 1) AS fanartUrl
FROM sets s
LEFT JOIN movie m ON m.idSet = s.idSet
GROUP BY s.idSet
HAVING movieCount > 0
ORDER BY s.strSet
`

// Music queries
const QUERY_MUSIC_ARTISTS = `
SELECT
  a.idArtist,
  a.strArtist,
  a.strSortName,
  a.strMusicBrainzArtistID,
  a.strGenres,
  a.strBiography,
  (SELECT url FROM art WHERE media_id = a.idArtist AND media_type = 'artist' AND type = 'thumb' LIMIT 1) AS thumbUrl
FROM artist a
WHERE a.strArtist != ''
ORDER BY a.strSortName, a.strArtist
`

const QUERY_MUSIC_ALBUMS = `
SELECT
  al.idAlbum,
  al.strAlbum,
  al.strArtistDisp,
  al.strMusicBrainzAlbumID,
  al.strReleaseGroupMBID,
  al.strGenres,
  al.strLabel,
  al.strType,
  (SELECT url FROM art WHERE media_id = al.idAlbum AND media_type = 'album' AND type = 'thumb' LIMIT 1) AS thumbUrl
FROM album al
ORDER BY al.strAlbum
`

const QUERY_MUSIC_ALBUMS_BY_ARTIST = `
SELECT
  al.idAlbum,
  al.strAlbum,
  al.strArtistDisp,
  al.strMusicBrainzAlbumID,
  al.strReleaseGroupMBID,
  al.strGenres,
  al.strLabel,
  al.strType,
  (SELECT url FROM art WHERE media_id = al.idAlbum AND media_type = 'album' AND type = 'thumb' LIMIT 1) AS thumbUrl
FROM album al
JOIN album_artist aa ON al.idAlbum = aa.idAlbum
WHERE aa.idArtist = ?
ORDER BY al.strAlbum
`

const QUERY_MUSIC_SONGS_BY_ALBUM = `
SELECT
  s.idSong,
  s.strTitle,
  s.iTrack,
  s.iDuration,
  s.strFileName,
  p.strPath,
  s.strMusicBrainzTrackID,
  al.strAlbum AS albumTitle,
  s.strArtistDisp AS artistDisp
FROM song s
JOIN path p ON s.idPath = p.idPath
JOIN album al ON s.idAlbum = al.idAlbum
WHERE s.idAlbum = ?
ORDER BY s.iTrack
`

const QUERY_MUSIC_SONG_COUNT = `SELECT COUNT(*) as count FROM song`

export class KodiMySQLProvider implements MediaProvider {
  readonly providerType: ProviderType = 'kodi-mysql' as ProviderType
  readonly sourceId: string

  private mysqlConfig: KodiMySQLConfig | null = null
  private pool: Pool | null = null
  private videoDatabaseName: string = ''
  private musicDatabaseName: string = ''
  private databaseVersion: number = 0
  private musicScanCancelled = false

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || this.generateSourceId()

    // Load from connection config if provided
    if (config.connectionConfig) {
      const cc = config.connectionConfig as any
      this.mysqlConfig = {
        host: cc.host || '',
        port: cc.port || 3306,
        username: cc.username || '',
        password: cc.password || '',
        videoDatabaseName: cc.videoDatabaseName,
        musicDatabaseName: cc.musicDatabaseName,
        databasePrefix: cc.databasePrefix || 'kodi_',
        ssl: cc.ssl,
        connectionTimeout: cc.connectionTimeout,
      }
      this.videoDatabaseName = cc.videoDatabaseName || ''
      this.musicDatabaseName = cc.musicDatabaseName || ''
      this.databaseVersion = cc.videoDatabaseVersion || 0
    }
  }

  private generateSourceId(): string {
    return `kodi_mysql_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      const creds = credentials as any

      this.mysqlConfig = {
        host: creds.host,
        port: creds.port || 3306,
        username: creds.username,
        password: creds.password,
        databasePrefix: creds.databasePrefix || 'kodi_',
        ssl: creds.ssl,
        connectionTimeout: creds.connectionTimeout || 10000,
      }

      // Test connection and detect databases
      const connectionService = getKodiMySQLConnectionService()
      const testResult = await connectionService.testConnection(this.mysqlConfig)

      if (!testResult.success) {
        return {
          success: false,
          error: testResult.error || 'Connection failed',
        }
      }

      // Use detected database names or provided ones
      this.videoDatabaseName = creds.videoDatabaseName || testResult.videoDatabaseName || ''
      this.musicDatabaseName = creds.musicDatabaseName || testResult.musicDatabaseName || ''
      this.databaseVersion = testResult.videoDatabaseVersion || 0

      if (!this.videoDatabaseName) {
        return {
          success: false,
          error: 'No Kodi video database found on server',
        }
      }

      // Store updated config with detected databases
      this.mysqlConfig.videoDatabaseName = this.videoDatabaseName
      this.mysqlConfig.musicDatabaseName = this.musicDatabaseName

      // Create connection pool
      this.pool = await connectionService.createPool(this.mysqlConfig)

      return {
        success: true,
        serverName: `Kodi MySQL (${testResult.serverVersion})`,
        serverVersion: `${this.videoDatabaseName}`,
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.pool && !!this.videoDatabaseName
  }

  async disconnect(): Promise<void> {
    if (this.mysqlConfig) {
      const connectionService = getKodiMySQLConnectionService()
      await connectionService.closePool(this.mysqlConfig)
      this.pool = null
    }
  }

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.mysqlConfig) {
      return { success: false, error: 'MySQL configuration not set' }
    }

    const connectionService = getKodiMySQLConnectionService()
    const testResult = await connectionService.testConnection(this.mysqlConfig)

    if (!testResult.success) {
      return {
        success: false,
        error: testResult.error,
      }
    }

    return {
      success: true,
      serverName: `Kodi MySQL - ${testResult.videoDatabaseName || 'Unknown'}`,
      serverVersion: testResult.serverVersion,
      latencyMs: testResult.latencyMs,
    }
  }

  // ============================================================================
  // QUERY HELPERS
  // ============================================================================

  private async query<T>(database: string, sql: string, params?: any[]): Promise<T[]> {
    if (!this.pool || !this.mysqlConfig) {
      throw new Error('Not connected to MySQL')
    }

    const connectionService = getKodiMySQLConnectionService()
    return connectionService.query<T>(this.pool, database, sql, params)
  }

  private async queryVideo<T>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.videoDatabaseName) {
      throw new Error('Video database not configured')
    }
    return this.query<T>(this.videoDatabaseName, sql, params)
  }

  private async queryMusic<T>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.musicDatabaseName) {
      throw new Error('Music database not configured')
    }
    return this.query<T>(this.musicDatabaseName, sql, params)
  }

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  async getLibraries(): Promise<MediaLibrary[]> {
    const libraries: MediaLibrary[] = []

    // Check video library
    try {
      const movieCount = await this.queryVideo<{ count: number }>(QUERY_MOVIE_COUNT)
      const episodeCount = await this.queryVideo<{ count: number }>(QUERY_EPISODE_COUNT)

      const movies = movieCount[0]?.count || 0
      const episodes = episodeCount[0]?.count || 0

      if (movies > 0) {
        libraries.push({
          id: 'movies',
          name: 'Movies',
          type: 'movie',
          itemCount: movies,
        })
      }

      if (episodes > 0) {
        libraries.push({
          id: 'tvshows',
          name: 'TV Shows',
          type: 'show',
          itemCount: episodes,
        })
      }
    } catch (error: unknown) {
      console.error('[KodiMySQLProvider] Error getting video libraries:', error)
    }

    // Check music library
    if (this.musicDatabaseName) {
      try {
        const songCount = await this.queryMusic<{ count: number }>(QUERY_MUSIC_SONG_COUNT)
        const songs = songCount[0]?.count || 0

        if (songs > 0) {
          libraries.push({
            id: 'music',
            name: 'Music',
            type: 'music',
            itemCount: songs,
          })
        }
      } catch (error: unknown) {
        console.log('[KodiMySQLProvider] Music library not available:', getErrorMessage(error))
      }
    }

    return libraries
  }

  async getLibraryItems(libraryId: string): Promise<MediaMetadata[]> {
    if (libraryId === 'movies') {
      return this.getMovies()
    } else if (libraryId === 'tvshows') {
      return this.getEpisodes()
    }

    throw new Error(`Unknown library: ${libraryId}`)
  }

  // ============================================================================
  // VIDEO DATA RETRIEVAL
  // ============================================================================

  private async getAudioStreamsByFileId(): Promise<Map<number, KodiAudioStream[]>> {
    const streams = await this.queryVideo<KodiAudioStream>(QUERY_AUDIO_STREAMS)

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

  private async getMovies(): Promise<MediaMetadata[]> {
    const movies = await this.queryVideo<KodiMovieWithDetails>(QUERY_MOVIES_WITH_DETAILS)
    const audioStreamsByFile = await this.getAudioStreamsByFileId()

    return movies.map((movie) => {
      const audioStreams = audioStreamsByFile.get(movie.idFile)
      return this.convertMovieToMetadata(movie, audioStreams)
    })
  }

  private async getEpisodes(): Promise<MediaMetadata[]> {
    const episodes = await this.queryVideo<KodiEpisodeWithDetails>(QUERY_EPISODES_WITH_DETAILS)
    const audioStreamsByFile = await this.getAudioStreamsByFileId()

    return episodes.map((episode) => {
      const audioStreams = audioStreamsByFile.get(episode.idFile)
      return this.convertEpisodeToMetadata(episode, audioStreams)
    })
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    const [type, id] = itemId.split('_')
    const numId = parseInt(id, 10)

    if (type === 'movie') {
      const query = QUERY_MOVIES_WITH_DETAILS + ` WHERE m.idMovie = ?`
      const movies = await this.queryVideo<KodiMovieWithDetails>(query, [numId])
      if (movies.length === 0) {
        throw new Error(`Movie not found: ${numId}`)
      }
      return this.convertMovieToMetadata(movies[0])
    } else if (type === 'episode') {
      const query = QUERY_EPISODES_WITH_DETAILS + ` WHERE e.idEpisode = ?`
      const episodes = await this.queryVideo<KodiEpisodeWithDetails>(query, [numId])
      if (episodes.length === 0) {
        throw new Error(`Episode not found: ${numId}`)
      }
      return this.convertEpisodeToMetadata(episodes[0])
    }

    throw new Error(`Unknown item type: ${type}`)
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress } = options || {}

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

      if (libraryId === 'movies') {
        items = await this.getMovies()
      } else if (libraryId === 'tvshows') {
        items = await this.getEpisodes()
      } else {
        throw new Error(`Unknown library: ${libraryId}`)
      }

      const totalItems = items.length
      console.log(`[KodiMySQLProvider ${this.sourceId}] Processing ${totalItems} items...`)

      // Start batch mode
      db.startBatch()

      try {
        for (let i = 0; i < items.length; i++) {
          const metadata = items[i]

          try {
            const mediaItem = this.convertMetadataToMediaItem(metadata)
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = 'kodi-mysql' as any
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

      // Remove stale items
      if (scannedProviderIds.size > 0) {
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
  // COLLECTION SUPPORT
  // ============================================================================

  async getCollections(): Promise<KodiSetWithDetails[]> {
    const sets = await this.queryVideo<KodiSetWithDetails>(QUERY_ALL_SETS)
    console.log(`[KodiMySQLProvider] Found ${sets.length} collections`)
    return sets
  }

  async getMoviesGroupedByCollection(): Promise<Map<string, KodiMovieWithDetails[]>> {
    const movies = await this.queryVideo<KodiMovieWithDetails>(QUERY_MOVIES_WITH_DETAILS)
    const collectionMap = new Map<string, KodiMovieWithDetails[]>()

    for (const movie of movies) {
      if (movie.setName) {
        if (!collectionMap.has(movie.setName)) {
          collectionMap.set(movie.setName, [])
        }
        collectionMap.get(movie.setName)!.push(movie)
      }
    }

    console.log(`[KodiMySQLProvider] Found ${collectionMap.size} collections with movies`)
    return collectionMap
  }

  // ============================================================================
  // AUDIO STREAM HELPERS
  // ============================================================================

  private detectObjectAudio(codec: string | null, title?: string): boolean {
    const codecLower = (codec || '').toLowerCase()
    const titleLower = (title || '').toLowerCase()

    if (codecLower.includes('atmos') || titleLower.includes('atmos')) return true
    if (codecLower.includes('truehd') && titleLower.includes('atmos')) return true
    if (codecLower.includes('dts:x') || codecLower.includes('dtsx') ||
        titleLower.includes('dts:x') || titleLower.includes('dts-x') || titleLower.includes('dtsx')) {
      return true
    }
    if ((codecLower.includes('dtshd_ma') || codecLower.includes('dts-hd ma')) &&
        (titleLower.includes(':x') || titleLower.includes('-x'))) {
      return true
    }

    return false
  }

  private estimateAudioBitrate(codec: string | null, channels: number | null): number {
    const codecLower = (codec || '').toLowerCase()
    const ch = channels || 2

    if (codecLower.includes('truehd') || codecLower.includes('atmos')) {
      return ch >= 8 ? 6000 : ch >= 6 ? 4000 : 2500
    }
    if (codecLower.includes('dtshd_ma') || codecLower.includes('dts-hd ma')) {
      return ch >= 8 ? 5000 : ch >= 6 ? 3500 : 2000
    }
    if (codecLower.includes('dtshd') || codecLower.includes('dts-hd')) {
      return ch >= 6 ? 2500 : 1500
    }
    if (codecLower.includes('flac') || codecLower.includes('pcm') || codecLower.includes('lpcm')) {
      return ch >= 6 ? 3000 : 1500
    }
    if (codecLower.includes('dts:x') || codecLower.includes('dtsx')) {
      return ch >= 8 ? 4000 : 3000
    }
    if (codecLower.includes('dts')) {
      return ch >= 6 ? 1509 : 768
    }
    if (codecLower.includes('eac3') || codecLower.includes('ec3') || codecLower.includes('e-ac-3')) {
      return ch >= 8 ? 1024 : ch >= 6 ? 640 : 384
    }
    if (codecLower.includes('ac3') || codecLower.includes('ac-3')) {
      return ch >= 6 ? 640 : 384
    }
    if (codecLower.includes('aac')) {
      return ch >= 6 ? 384 : 256
    }
    if (codecLower.includes('mp3')) {
      return 320
    }
    if (codecLower.includes('opus')) {
      return ch >= 6 ? 256 : 128
    }
    if (codecLower.includes('vorbis')) {
      return 256
    }

    return ch >= 6 ? 640 : 256
  }

  private convertAudioStreams(
    streams: KodiAudioStream[] | undefined,
    title?: string
  ): AudioStreamInfo[] {
    if (!streams || streams.length === 0) return []

    return streams.map((stream, index) => {
      const hasObjectAudio = this.detectObjectAudio(stream.codec, title)
      const bitrate = this.estimateAudioBitrate(stream.codec, stream.channels)

      return {
        codec: normalizeAudioCodec(stream.codec) || 'Unknown',
        channels: normalizeAudioChannels(stream.channels, undefined) || 2,
        language: stream.language || undefined,
        isDefault: index === 0,
        bitrate,
        hasObjectAudio,
      }
    })
  }

  // ============================================================================
  // CONVERSION HELPERS
  // ============================================================================

  private convertMovieToMetadata(movie: KodiMovieWithDetails, audioStreams?: KodiAudioStream[]): MediaMetadata {
    const filePath = buildFilePath(movie.filepath || '', movie.filename || '')

    const width = movie.videoWidth || 0
    const height = movie.videoHeight || 0
    const resolution = normalizeResolution(width, height)
    const hdrFormat = normalizeHdrFormat(movie.hdrType, undefined, undefined, undefined, undefined)
    const videoCodec = normalizeVideoCodec(movie.videoCodec)

    let durationSeconds = movie.videoDuration || 0
    if (!durationSeconds && movie.runtime && movie.runtime > 0) {
      durationSeconds = movie.runtime * 60
    }
    const duration = durationSeconds > 0 ? durationSeconds * 1000 : undefined

    const audioTracks = this.convertAudioStreams(audioStreams, movie.title)

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
      console.log(`[KodiMySQLProvider] Movie "${movie.title}" - year from DB: ${extractedYear}`)
    } else {
      console.log(`[KodiMySQLProvider] Movie "${movie.title}" - no year in DB (c07: "${movie.c07_raw || ''}", premiered: "${movie.premiered_raw || ''}")`)
    }

    return {
      providerId: this.sourceId,
      providerType: 'kodi-mysql' as ProviderType,
      itemId: `movie_${movie.idMovie}`,
      title: movie.title,
      type: 'movie',
      year: extractedYear,
      imdbId: movie.imdbId || undefined,
      tmdbId: movie.tmdbId ? parseInt(movie.tmdbId, 10) : undefined,
      filePath,
      duration,
      resolution,
      width: width || undefined,
      height: height || undefined,
      videoCodec: videoCodec || undefined,
      hdrFormat: hdrFormat || undefined,
      audioCodec: audioCodec || undefined,
      audioChannels: audioChannels || undefined,
      audioBitrate: audioBitrate,
      hasObjectAudio: hasAnyObjectAudio,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      posterUrl: movie.posterUrl || undefined,
      backdropUrl: movie.fanartUrl || undefined,
    }
  }

  private convertEpisodeToMetadata(episode: KodiEpisodeWithDetails, audioStreams?: KodiAudioStream[]): MediaMetadata {
    const filePath = buildFilePath(episode.filepath || '', episode.filename || '')

    const width = episode.videoWidth || 0
    const height = episode.videoHeight || 0
    const resolution = normalizeResolution(width, height)
    const hdrFormat = normalizeHdrFormat(episode.hdrType, undefined, undefined, undefined, undefined)
    const videoCodec = normalizeVideoCodec(episode.videoCodec)

    const durationSeconds = episode.videoDuration || 0
    const duration = durationSeconds > 0 ? durationSeconds * 1000 : undefined

    const audioTracks = this.convertAudioStreams(audioStreams, episode.title)

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
      providerType: 'kodi-mysql' as ProviderType,
      itemId: `episode_${episode.idEpisode}`,
      title: episode.title,
      type: 'episode',
      seriesTitle: episode.showTitle,
      seasonNumber: episode.seasonNumber || undefined,
      episodeNumber: episode.episodeNumber || undefined,
      imdbId: episode.showImdbId || undefined,
      filePath,
      duration,
      resolution,
      width: width || undefined,
      height: height || undefined,
      videoCodec: videoCodec || undefined,
      hdrFormat: hdrFormat || undefined,
      audioCodec: audioCodec || undefined,
      audioChannels: audioChannels || undefined,
      audioBitrate: audioBitrate,
      hasObjectAudio: hasAnyObjectAudio,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      episodeThumbUrl: episode.thumbUrl || undefined,
      posterUrl: episode.seasonPosterUrl || episode.showPosterUrl || undefined,
      seasonPosterUrl: episode.seasonPosterUrl || undefined,
    }
  }

  private convertMetadataToMediaItem(metadata: MediaMetadata): MediaItem | null {
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks && metadata.audioTracks.length > 0) {
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

  private convertToMusicArtist(item: KodiMusicArtistResult): MusicArtist {
    return {
      source_id: this.sourceId,
      source_type: 'kodi-mysql' as any,
      library_id: 'music',
      provider_id: String(item.idArtist),
      name: item.strArtist,
      sort_name: item.strSortName || undefined,
      musicbrainz_id: item.strMusicBrainzArtistID || undefined,
      genres: item.strGenres || undefined,
      biography: item.strBiography || undefined,
      thumb_url: item.thumbUrl || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private convertToMusicAlbum(item: KodiMusicAlbumResult, artistId?: number): MusicAlbum {
    return {
      source_id: this.sourceId,
      source_type: 'kodi-mysql' as any,
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
      album_type: item.strType as any || undefined,
      thumb_url: item.thumbUrl || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private convertToMusicTrack(item: KodiMusicSongResult, albumId?: number, artistId?: number): MusicTrack {
    const { disc, track } = parseTrackNumber(item.iTrack)
    const filePath = buildMusicFilePath(item.strPath, item.strFileName)
    const audioCodec = guessCodecFromExtension(item.strFileName)
    const lossless = isLosslessCodec(audioCodec)

    return {
      source_id: this.sourceId,
      source_type: 'kodi-mysql' as any,
      library_id: 'music',
      provider_id: String(item.idSong),
      album_id: albumId,
      artist_id: artistId,
      album_name: item.albumTitle || undefined,
      artist_name: item.artistDisp || 'Unknown Artist',
      title: item.strTitle,
      track_number: track,
      disc_number: disc,
      duration: item.iDuration ? item.iDuration * 1000 : undefined,
      file_path: filePath,
      audio_codec: audioCodec,
      is_lossless: lossless,
      is_hi_res: false,
      musicbrainz_id: item.strMusicBrainzTrackID || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  async scanMusicLibrary(
    onProgress?: (progress: { current: number; total: number; phase: string; currentItem?: string; percentage: number }) => void
  ): Promise<ScanResult> {
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

    if (!this.musicDatabaseName) {
      result.errors.push('Music database not available')
      result.durationMs = Date.now() - startTime
      return result
    }

    try {
      const db = getDatabaseService()

      const scannedArtistIds = new Set<string>()
      const scannedAlbumIds = new Set<string>()
      const scannedTrackIds = new Set<string>()

      const processAlbum = async (
        kodiAlbum: KodiMusicAlbumResult,
        artistId: number | undefined,
        artistName?: string
      ): Promise<{ trackCount: number }> => {
        const albumData = this.convertToMusicAlbum(kodiAlbum, artistId)

        if (artistName && !albumData.artist_name) {
          albumData.artist_name = artistName
        }

        const songs = await this.queryMusic<KodiMusicSongResult>(QUERY_MUSIC_SONGS_BY_ALBUM, [kodiAlbum.idAlbum])

        const trackDataList: MusicTrack[] = []
        for (const kodiSong of songs) {
          const trackData = this.convertToMusicTrack(kodiSong, undefined, artistId)
          trackDataList.push(trackData)
        }

        const stats = calculateAlbumStats(trackDataList)
        albumData.track_count = stats.trackCount
        albumData.total_duration = stats.totalDuration
        albumData.total_size = stats.totalSize
        albumData.best_audio_codec = stats.bestCodec
        albumData.best_audio_bitrate = stats.bestBitrate
        albumData.best_sample_rate = stats.bestSampleRate
        albumData.best_bit_depth = stats.bestBitDepth
        albumData.avg_audio_bitrate = stats.avgBitrate

        const albumId = await db.upsertMusicAlbum(albumData)
        scannedAlbumIds.add(String(kodiAlbum.idAlbum))

        for (const trackData of trackDataList) {
          trackData.album_id = albumId
          await db.upsertMusicTrack(trackData)
          scannedTrackIds.add(trackData.provider_id)
          result.itemsScanned++
        }

        return { trackCount: trackDataList.length }
      }

      // Phase 1: Scan artists
      const artists = await this.queryMusic<KodiMusicArtistResult>(QUERY_MUSIC_ARTISTS)
      const totalArtists = artists.length

      console.log(`[KodiMySQLProvider ${this.sourceId}] Scanning music library: ${totalArtists} artists`)

      let processed = 0

      for (const kodiArtist of artists) {
        if (this.musicScanCancelled) {
          console.log(`[KodiMySQLProvider ${this.sourceId}] Music scan cancelled`)
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          const artistData = this.convertToMusicArtist(kodiArtist)
          const artistId = await db.upsertMusicArtist(artistData)
          scannedArtistIds.add(String(kodiArtist.idArtist))

          const albums = await this.queryMusic<KodiMusicAlbumResult>(QUERY_MUSIC_ALBUMS_BY_ARTIST, [kodiArtist.idArtist])

          let artistTrackCount = 0
          let artistAlbumCount = 0

          for (const kodiAlbum of albums) {
            const { trackCount } = await processAlbum(kodiAlbum, artistId)
            artistTrackCount += trackCount
            artistAlbumCount++
          }

          await db.updateMusicArtistCounts(artistId, artistAlbumCount, artistTrackCount)

          processed++
          if (onProgress) {
            onProgress({
              current: processed,
              total: totalArtists,
              phase: 'processing',
              currentItem: kodiArtist.strArtist,
              percentage: (processed / totalArtists) * 50,
            })
          }
        } catch (error: unknown) {
          result.errors.push(`Failed to process artist ${kodiArtist.strArtist}: ${getErrorMessage(error)}`)
        }
      }

      // Phase 2: Scan orphaned albums
      console.log(`[KodiMySQLProvider ${this.sourceId}] Scanning for compilations and orphaned albums...`)

      const allAlbums = await this.queryMusic<KodiMusicAlbumResult>(QUERY_MUSIC_ALBUMS)
      const unprocessedAlbums = allAlbums.filter(a => !scannedAlbumIds.has(String(a.idAlbum)))

      console.log(`[KodiMySQLProvider ${this.sourceId}] Found ${unprocessedAlbums.length} additional albums`)

      let compilationProcessed = 0
      const totalCompilations = unprocessedAlbums.length

      for (const kodiAlbum of unprocessedAlbums) {
        if (this.musicScanCancelled) {
          result.cancelled = true
          result.durationMs = Date.now() - startTime
          return result
        }

        try {
          const artistName = kodiAlbum.strArtistDisp || 'Various Artists'
          await processAlbum(kodiAlbum, undefined, artistName)

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

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[KodiMySQLProvider ${this.sourceId}] Music scan complete: ${result.itemsScanned} tracks in ${result.durationMs}ms`)

      return result
    } catch (error: unknown) {
      console.error(`[KodiMySQLProvider ${this.sourceId}] Music scan failed:`, error)
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  cancelMusicScan(): void {
    this.musicScanCancelled = true
    console.log(`[KodiMySQLProvider ${this.sourceId}] Music scan cancellation requested`)
  }

  // ============================================================================
  // CONNECTION CONFIG GETTERS
  // ============================================================================

  getConnectionConfig(): any {
    return {
      ...this.mysqlConfig,
      videoDatabaseName: this.videoDatabaseName,
      musicDatabaseName: this.musicDatabaseName,
      videoDatabaseVersion: this.databaseVersion,
    }
  }
}
