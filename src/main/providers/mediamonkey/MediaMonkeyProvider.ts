/**
 * MediaMonkeyProvider
 *
 * Implements the MediaProvider interface for MediaMonkey by reading its local SQLite database.
 * Supports both MM4 (MM.DB) and MM5 (MM5.DB).
 *
 * Key differences from KodiLocalProvider:
 * - Custom IUNICODE collation must be registered
 * - Mood data comes from both Songs.Mood column and Lists/ListsSongs junction table
 * - Music-only provider (no video library support)
 * - Artists derived from Songs.AlbumArtist (no separate artist table in MM4)
 */

import { getErrorMessage } from '../../services/utils/errorUtils'
import type { Database } from 'sql.js'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getDatabase } from '../../database/getDatabase'
import { getMediaFileAnalyzer } from '../../services/MediaFileAnalyzer'
import { getMediaMonkeyDiscoveryService } from '../../services/MediaMonkeyDiscoveryService'
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
import type { MusicArtist, MusicAlbum, MusicTrack, AlbumType } from '../../types/database'
import {
  QUERY_MM_ARTISTS,
  QUERY_MM_ALBUMS_BY_ARTIST,
  QUERY_MM_SONGS_BY_ALBUM,
  QUERY_MM_SONG_COUNT,
  QUERY_MM_ALL_MOODS,
  QUERY_MM_ALBUM_COVERS,
  QUERY_MM_UPDATE_SONG_MOOD,
  QUERY_MM_DELETE_SONG_MOODS,
  QUERY_MM_FIND_MOOD,
  QUERY_MM_INSERT_MOOD,
  QUERY_MM_INSERT_SONG_MOOD,
  type MMDbSong,
  type MMDbAlbum,
  type MMDbMoodEntry,
  type MMDbCover,
  guessCodecFromPath,
} from './MediaMonkeyDatabaseSchema'
import {
  isLosslessCodec,
  isHiRes,
  calculateAlbumStats,
} from '../base/MusicScannerUtils'

export class MediaMonkeyProvider implements MediaProvider {
  readonly providerType: ProviderType = 'mediamonkey'
  readonly sourceId: string

  private db: Database | null = null
  private databasePath: string = ''
  private mmVersion: 4 | 5 = 4
  private musicScanCancelled = false

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || `mediamonkey_${Date.now()}`
    if (config.connectionConfig?.mediamonkeyDatabasePath) {
      this.databasePath = config.connectionConfig.mediamonkeyDatabasePath
    }
    if (config.connectionConfig?.mediamonkeyVersion) {
      this.mmVersion = config.connectionConfig.mediamonkeyVersion
    }
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      const dbPath = credentials.mediamonkeyDatabasePath
      if (!dbPath) {
        return { success: false, error: 'Database path is required' }
      }

      const discovery = getMediaMonkeyDiscoveryService()
      const validation = discovery.validateDatabasePath(dbPath)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      this.databasePath = dbPath
      if (credentials.mediamonkeyVersion) {
        this.mmVersion = credentials.mediamonkeyVersion
      }

      // Try opening the database to verify it's valid
      await this.openDatabase()
      this.closeDatabase()

      return {
        success: true,
        serverName: `MediaMonkey ${this.mmVersion}`,
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.databasePath && fs.existsSync(this.databasePath)
  }

  async disconnect(): Promise<void> {
    this.closeDatabase()
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.openDatabase()
      const count = this.query<{ count: number }>(QUERY_MM_SONG_COUNT)
      this.closeDatabase()

      return {
        success: true,
        serverName: `MediaMonkey ${this.mmVersion} — ${count[0]?.count || 0} tracks`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to connect: ${getErrorMessage(error)}`,
      }
    }
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    return [{
      id: 'music',
      name: 'Music',
      type: 'music',
    }]
  }

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    if (libraryId === 'music') {
      return this.scanMusicLibrary(options?.onProgress as ((progress: { current: number; total: number; phase: string; currentItem?: string; percentage: number }) => void) | undefined)
    }
    return {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [`Unknown library: ${libraryId}`],
      durationMs: 0,
    }
  }

  async getItemMetadata(_itemId: string): Promise<MediaMetadata> {
    throw new Error('getItemMetadata not supported for MediaMonkey music provider')
  }

  // Cancel ongoing scan
  cancelScan(): void {
    this.musicScanCancelled = true
  }

  // ============================================================================
  // PRIVATE: Database Operations
  // ============================================================================

  private async openDatabase(): Promise<void> {
    if (this.db) return

    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs()

    const buffer = fs.readFileSync(this.databasePath)
    this.db = new SQL.Database(buffer)

    // MediaMonkey columns are defined with COLLATE IUNICODE which sql.js doesn't support.
    // Replace all IUNICODE references with NOCASE, then export and reimport to force
    // sql.js to reparse the modified schema (in-memory modification alone isn't enough).
    this.db.run('PRAGMA writable_schema = ON')
    this.db.run(
      "UPDATE sqlite_master SET sql = replace(sql, 'IUNICODE', 'NOCASE') WHERE sql LIKE '%IUNICODE%'"
    )
    this.db.run('PRAGMA writable_schema = OFF')
    const fixedBuffer = this.db.export()
    this.db.close()
    this.db = new SQL.Database(fixedBuffer)
  }

  private closeDatabase(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  private query<T>(sql: string, params?: (string | number | null)[]): T[] {
    if (!this.db) throw new Error('Database not open')

    const stmt = this.db.prepare(sql)
    if (params) {
      stmt.bind(params)
    }

    const results: T[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T)
    }
    stmt.free()
    return results
  }

  // ============================================================================
  // PRIVATE: Music Scanning
  // ============================================================================

  private async scanMusicLibrary(
    onProgress?: (progress: { current: number; total: number; phase: string; currentItem?: string; percentage: number }) => void
  ): Promise<ScanResult> {
    this.musicScanCancelled = false
    const startTime = Date.now()
    const result: ScanResult = {
      success: true,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    try {
      await this.openDatabase()
      const db = getDatabase()

      // Get total count for progress
      const countResult = this.query<{ count: number }>(QUERY_MM_SONG_COUNT)
      const totalTracks = countResult[0]?.count || 0

      onProgress?.({ current: 0, total: totalTracks, phase: 'Loading metadata...', percentage: 0 })

      // Batch-load all mood data from junction table
      const moodMap = this.loadAllMoods()

      // Batch-load album cover art paths (external file covers)
      const coverMap = this.loadAlbumCovers()

      // Get all artists
      const artists = this.query<{ Artist: string }>(QUERY_MM_ARTISTS)

      onProgress?.({ current: 0, total: totalTracks, phase: `Scanning ${artists.length} artists...`, percentage: 0 })

      let processedTracks = 0

      db.startBatch()

      for (const artistRow of artists) {
        if (this.musicScanCancelled) {
          result.cancelled = true
          break
        }

        const artistName = artistRow.Artist

        // Upsert artist
        const artistData: MusicArtist = {
          source_id: this.sourceId,
          source_type: 'mediamonkey',
          provider_id: `artist:${artistName}`,
          name: artistName,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        const artistId = await db.upsertMusicArtist(artistData)

        // Get albums for this artist
        const albums = this.query<MMDbAlbum>(QUERY_MM_ALBUMS_BY_ARTIST, [artistName])

        for (const album of albums) {
          if (this.musicScanCancelled) break

          // Get tracks for this album
          const songs = this.query<MMDbSong>(QUERY_MM_SONGS_BY_ALBUM, [album.ID])

          // Resolve album cover from the first song's external cover file
          let albumThumbUrl: string | undefined
          if (songs.length > 0) {
            const firstSong = songs[0]
            const coverPath = coverMap.get(firstSong.ID)
            if (coverPath && firstSong.SongPath) {
              const songDir = path.dirname(firstSong.SongPath)
              const fullCoverPath = path.join(songDir, coverPath)
              if (fs.existsSync(fullCoverPath)) {
                albumThumbUrl = `local-artwork://file?path=${encodeURIComponent(fullCoverPath)}`
              }
            }
          }

          // Upsert album
          const albumType: AlbumType = 'album'
          const albumData: MusicAlbum = {
            source_id: this.sourceId,
            source_type: 'mediamonkey',
            provider_id: `album:${album.ID}`,
            artist_id: artistId,
            artist_name: artistName,
            title: album.Album,
            year: album.Year || undefined,
            album_type: albumType,
            thumb_url: albumThumbUrl,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          const albumId = await db.upsertMusicAlbum(albumData)
          const trackDataList: MusicTrack[] = []

          for (const song of songs) {
            if (this.musicScanCancelled) break

            const trackData = this.convertToMusicTrack(song, albumId, artistId, moodMap)
            await db.upsertMusicTrack(trackData)
            trackDataList.push(trackData)
            result.itemsScanned++
            processedTracks++

            if (processedTracks % 50 === 0) {
              onProgress?.({
                current: processedTracks,
                total: totalTracks,
                phase: `Scanning: ${artistName} - ${album.Album}`,
                currentItem: song.SongTitle,
                percentage: Math.round((processedTracks / totalTracks) * 100),
              })
            }
          }

          // Update album stats
          if (trackDataList.length > 0) {
            const stats = calculateAlbumStats(trackDataList)
            albumData.track_count = stats.trackCount
            albumData.total_duration = stats.totalDuration
            albumData.id = albumId
            await db.upsertMusicAlbum(albumData)
          }
        }
      }

      await db.endBatch()

      this.closeDatabase()

      // Phase 2: Extract album artwork (after DB batch to avoid locking)
      try {
        await this.resolveAlbumArtwork(db, onProgress, processedTracks, totalTracks)
      } catch (artworkError) {
        console.error('[MediaMonkeyProvider] Artwork resolution failed:', getErrorMessage(artworkError))
      }

      result.durationMs = Date.now() - startTime
      console.log(`[MediaMonkeyProvider] Scan complete: ${result.itemsScanned} tracks in ${result.durationMs}ms`)
    } catch (error) {
      result.success = false
      result.errors.push(getErrorMessage(error))
      this.closeDatabase()
    }

    result.durationMs = Date.now() - startTime
    return result
  }

  /**
   * Batch-load all mood entries from the Lists/ListsSongs junction table.
   * Returns a Map<songId, string[]> for efficient lookup during scan.
   */
  private loadAllMoods(): Map<number, string[]> {
    const moodMap = new Map<number, string[]>()

    try {
      const moods = this.query<MMDbMoodEntry>(QUERY_MM_ALL_MOODS)
      for (const entry of moods) {
        const existing = moodMap.get(entry.IDSong) || []
        existing.push(entry.MoodName)
        moodMap.set(entry.IDSong, existing)
      }
    } catch (e) {
      // Lists/ListsSongs tables may not exist in all MM versions — fall back to Songs.Mood column
      console.warn('[MediaMonkeyProvider] Could not load mood junction table, falling back to Songs.Mood column:', getErrorMessage(e))
    }

    return moodMap
  }

  /**
   * Batch-load album cover art paths (external file covers only).
   * Returns a Map<songId, coverFileName> for resolving full paths during scan.
   */
  private loadAlbumCovers(): Map<number, string> {
    const coverMap = new Map<number, string>()

    try {
      const covers = this.query<MMDbCover>(QUERY_MM_ALBUM_COVERS)
      for (const entry of covers) {
        // Only keep first cover per song (CoverOrder=0 in query)
        if (!coverMap.has(entry.IDSong)) {
          coverMap.set(entry.IDSong, entry.CoverPath)
        }
      }
    } catch {
      console.warn('[MediaMonkeyProvider] Could not load album covers')
    }

    return coverMap
  }

  /**
   * Convert a MediaMonkey song record to a MusicTrack
   */
  private convertToMusicTrack(
    song: MMDbSong,
    albumId: number,
    artistId: number,
    moodMap: Map<number, string[]>
  ): MusicTrack {
    const audioCodec = guessCodecFromPath(song.SongPath)
    const lossless = isLosslessCodec(audioCodec)
    const hiRes = isHiRes(song.SamplingFrequency, song.BPS, lossless)

    // Merge mood from junction table and Songs.Mood column
    // MediaMonkey stores comma-separated moods as single entries (e.g., "Dreamy, Ethereal, Cinematic")
    // Split on commas to get individual mood tags for Plex compatibility
    const junctionMoods = (moodMap.get(song.ID) || []).flatMap(m => m.split(',').map(v => v.trim()).filter(Boolean))
    const columnMood = song.Mood ? song.Mood.split(/[;,]/).map(m => m.trim()).filter(Boolean) : []
    const allMoods = [...new Set([...junctionMoods, ...columnMood])]

    return {
      source_id: this.sourceId,
      source_type: 'mediamonkey',
      library_id: 'music',
      provider_id: String(song.ID),
      album_id: albumId,
      artist_id: artistId,
      album_name: song.Album || undefined,
      artist_name: song.AlbumArtist || song.Artist || 'Unknown Artist',
      title: song.SongTitle,
      track_number: parseInt(String(song.TrackNumber)) || undefined,
      disc_number: parseInt(String(song.DiscNumber)) || 1,
      duration: song.SongLength || undefined,
      file_path: song.SongPath || undefined,
      file_size: song.FileLength || undefined,
      audio_codec: audioCodec,
      audio_bitrate: song.Bitrate || undefined,
      sample_rate: song.SamplingFrequency || undefined,
      bit_depth: song.BPS || undefined,
      channels: song.Stereo || undefined,
      is_lossless: lossless,
      is_hi_res: hiRes,
      genres: song.Genre ? JSON.stringify(song.Genre.split(';').map(g => g.trim()).filter(Boolean)) : undefined,
      mood: allMoods.length > 0 ? JSON.stringify(allMoods) : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  // ============================================================================
  // PRIVATE: Artwork Resolution
  // ============================================================================

  /**
   * Resolve album artwork for all albums from this source.
   * Priority: external cover file → folder artwork → embedded extraction via FFprobe
   */
  private async resolveAlbumArtwork(
    db: ReturnType<typeof getDatabase>,
    onProgress?: (progress: { current: number; total: number; phase: string; currentItem?: string; percentage: number }) => void,
    _processedTracks?: number,
    _totalTracks?: number,
  ): Promise<void> {
    const fileAnalyzer = getMediaFileAnalyzer()
    await fileAnalyzer.isAvailable() // Ensure FFprobe path is resolved
    const ffmpegAvailable = fileAnalyzer.isFFmpegAvailable()

    const albums = db.getMusicAlbums({ sourceId: this.sourceId })
    if (!albums || albums.length === 0) return

    console.log(`[MediaMonkeyProvider] Resolving artwork for ${albums.length} albums (FFmpeg: ${ffmpegAvailable ? 'available' : 'not found — embedded extraction disabled'})...`)
    let resolved = 0

    for (let i = 0; i < albums.length; i++) {
      const album = albums[i]
      if (album.thumb_url) continue // Already has artwork

      onProgress?.({
        current: i,
        total: albums.length,
        phase: `Resolving artwork: ${album.title}`,
        percentage: Math.round((i / albums.length) * 100),
      })

      // Get a track from this album to find the file path
      const tracks = db.getMusicTracks({ albumId: album.id, limit: 1 })
      if (!tracks || tracks.length === 0 || !tracks[0].file_path) continue

      const trackFilePath = tracks[0].file_path
      const songDir = path.dirname(trackFilePath)
      let artworkUrl: string | null = null

      // Priority 1: Folder artwork (cover.jpg, folder.jpg, etc.)
      if (!artworkUrl) {
        const folderArt = this.findFolderArtwork(songDir)
        if (folderArt) {
          artworkUrl = `local-artwork://file?path=${encodeURIComponent(folderArt)}`
        }
      }

      // Priority 2: Extract embedded artwork via FFmpeg (if available)
      if (!artworkUrl && album.id && ffmpegAvailable) {
        artworkUrl = await this.extractAlbumArtwork(trackFilePath, album.id, fileAnalyzer)
      }

      if (artworkUrl) {
        await db.updateMusicAlbumArtwork(album.id!, artworkUrl)
        resolved++
      }
    }

    console.log(`[MediaMonkeyProvider] Resolved artwork for ${resolved}/${albums.length} albums`)
  }

  /**
   * Find folder artwork (cover.jpg, folder.jpg, etc.) in an album directory
   */
  private findFolderArtwork(folderPath: string): string | null {
    const artworkFilenames = [
      'cover.jpg', 'cover.jpeg', 'cover.png',
      'folder.jpg', 'folder.jpeg', 'folder.png',
      'front.jpg', 'front.jpeg', 'front.png',
      'album.jpg', 'album.jpeg', 'album.png',
      'albumart.jpg', 'albumart.jpeg', 'albumart.png',
      'artwork.jpg', 'artwork.jpeg', 'artwork.png',
    ]

    try {
      const files = fs.readdirSync(folderPath)
      const lowerFiles = files.map(f => f.toLowerCase())

      for (const artworkName of artworkFilenames) {
        const index = lowerFiles.indexOf(artworkName)
        if (index !== -1) {
          return path.join(folderPath, files[index])
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Extract embedded artwork from an audio file via FFmpeg
   */
  private async extractAlbumArtwork(
    audioFilePath: string,
    albumId: number,
    fileAnalyzer: ReturnType<typeof getMediaFileAnalyzer>
  ): Promise<string | null> {
    try {
      const userDataPath = app.getPath('userData')
      const artworkDir = path.join(userDataPath, 'artwork', 'albums')

      if (!fs.existsSync(artworkDir)) {
        fs.mkdirSync(artworkDir, { recursive: true })
      }

      const outputPath = path.join(artworkDir, `${albumId}.jpg`)
      const artworkUrl = `local-artwork://albums/${albumId}.jpg`

      // Skip if already extracted
      if (fs.existsSync(outputPath)) {
        return artworkUrl
      }

      const success = await fileAnalyzer.extractArtwork(audioFilePath, outputPath)
      if (success) {
        return artworkUrl
      }

      return null
    } catch {
      return null
    }
  }

  // ============================================================================
  // WRITE: Mood Sync to MediaMonkey Database
  // ============================================================================

  /**
   * Write moods to the MediaMonkey database for a batch of tracks.
   * Safety requirements:
   * - MediaMonkey must NOT be running (concurrent writes corrupt the DB)
   * - A backup of the database is created before writing
   *
   * Updates three locations:
   * 1. Songs.Mood column (semicolon-separated text)
   * 2. ListsSongs junction table (links songs to mood entries)
   * 3. Lists table (creates new mood entries if needed)
   */
  async writeMoods(
    trackUpdates: Array<{ songId: number; moods: string[] }>,
    onProgress?: (current: number, total: number, trackName: string) => void
  ): Promise<{ written: number; failed: number; errors: string[] }> {
    const result = { written: 0, failed: 0, errors: [] as string[] }

    // Safety check: MediaMonkey must not be running
    const discovery = getMediaMonkeyDiscoveryService()
    const isRunning = await discovery.isMediaMonkeyRunning()
    if (isRunning) {
      return {
        ...result,
        errors: ['MediaMonkey is currently running. Close MediaMonkey before syncing moods to its database.'],
      }
    }

    // Validate database path
    if (!this.databasePath || !fs.existsSync(this.databasePath)) {
      return { ...result, errors: ['MediaMonkey database file not found'] }
    }

    // Create backup before writing
    const backupPath = this.databasePath + '.backup'
    try {
      fs.copyFileSync(this.databasePath, backupPath)
      console.warn(`[MediaMonkeyProvider] Backup created: ${backupPath}`)
    } catch (backupError) {
      return { ...result, errors: [`Failed to create backup: ${getErrorMessage(backupError)}`] }
    }

    try {
      // Open database for writing via sql.js
      console.warn('[MediaMonkeyProvider] Opening database for write...')
      const initSqlJs = (await import('sql.js')).default
      const SQL = await initSqlJs()
      const buffer = fs.readFileSync(this.databasePath)
      const writeDb = new SQL.Database(buffer)
      console.warn('[MediaMonkeyProvider] Applying IUNICODE fix...')

      // Fix schema so sql.js can open: replace IUNICODE collation, disable FTS 'mm' tokenizer
      writeDb.run('PRAGMA writable_schema = ON')
      // Save original schema SQL for all tables we'll modify
      const originalSchemas = writeDb.exec(
        "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL"
      )
      // Replace IUNICODE with NOCASE (built-in)
      writeDb.run("UPDATE sqlite_master SET sql = replace(sql, 'IUNICODE', 'NOCASE') WHERE sql LIKE '%IUNICODE%'")
      // Neutralize FTS tables with custom tokenizers AND ALL related objects
      // (tables, indexes, triggers — anything referencing SongsText or custom tokenizers)
      writeDb.run("DELETE FROM sqlite_master WHERE name LIKE '%SongsText%'")
      writeDb.run("DELETE FROM sqlite_master WHERE sql LIKE '%SongsText%'")
      writeDb.run("DELETE FROM sqlite_master WHERE sql LIKE '%tokenize%mm%'")
      writeDb.run('PRAGMA writable_schema = OFF')
      const fixedBuffer = writeDb.export()
      writeDb.close()
      const db = new SQL.Database(fixedBuffer)
      console.warn('[MediaMonkeyProvider] Database ready for writing')

      // Prepare statements for performance (reuse across all tracks)
      const stmtUpdateMood = db.prepare(QUERY_MM_UPDATE_SONG_MOOD)
      const stmtDeleteLinks = db.prepare(QUERY_MM_DELETE_SONG_MOODS)
      const stmtFindMood = db.prepare(QUERY_MM_FIND_MOOD)
      const stmtInsertMood = db.prepare(QUERY_MM_INSERT_MOOD)
      const stmtInsertLink = db.prepare(QUERY_MM_INSERT_SONG_MOOD)

      // Cache mood name → Lists.ID to avoid repeated lookups
      const moodIdCache = new Map<string, number>()

      db.run('BEGIN TRANSACTION')

      try {
        for (let i = 0; i < trackUpdates.length; i++) {
          const { songId, moods } = trackUpdates[i]

          onProgress?.(i, trackUpdates.length, `Song ID ${songId}`)

          // 1. Update Songs.Mood column (semicolon-separated, matching MM format)
          const moodStr = moods.join('; ')
          stmtUpdateMood.bind([moodStr, songId])
          stmtUpdateMood.step()
          stmtUpdateMood.reset()

          // 2. Clear existing mood links for this song
          stmtDeleteLinks.bind([songId])
          stmtDeleteLinks.step()
          stmtDeleteLinks.reset()

          // 3. For each mood, find or create the Lists entry and link it
          for (const mood of moods) {
            const trimmed = mood.trim()
            if (!trimmed) continue

            let moodListId = moodIdCache.get(trimmed.toLowerCase())

            if (moodListId === undefined) {
              // Find existing mood in Lists table
              stmtFindMood.bind([trimmed])
              if (stmtFindMood.step()) {
                moodListId = stmtFindMood.get()[0] as number
              }
              stmtFindMood.reset()

              if (moodListId === undefined) {
                // Create new mood entry
                stmtInsertMood.bind([trimmed])
                stmtInsertMood.step()
                stmtInsertMood.reset()
                const newId = db.exec('SELECT last_insert_rowid()')
                moodListId = newId[0].values[0][0] as number
              }

              moodIdCache.set(trimmed.toLowerCase(), moodListId)
            }

            // Link song to mood
            stmtInsertLink.bind([songId, moodListId])
            stmtInsertLink.step()
            stmtInsertLink.reset()
          }

          result.written++
        }

        // Free prepared statements before commit
        stmtUpdateMood.free()
        stmtDeleteLinks.free()
        stmtFindMood.free()
        stmtInsertMood.free()
        stmtInsertLink.free()

        db.run('COMMIT')
        console.warn(`[MediaMonkeyProvider] Transaction committed: ${result.written} tracks`)

        // Restore ALL original schema SQL (FTS tables, IUNICODE collation, everything)
        db.run('PRAGMA writable_schema = ON')
        if (originalSchemas.length > 0) {
          const restoreStmt = db.prepare("UPDATE sqlite_master SET sql = ? WHERE name = ?")
          for (const row of originalSchemas[0].values) {
            const [name, sql] = row as [string, string]
            if (sql) {
              restoreStmt.bind([sql, name])
              restoreStmt.step()
              restoreStmt.reset()
            }
          }
          restoreStmt.free()
        }
        db.run('PRAGMA writable_schema = OFF')

        const finalBuffer = db.export()
        console.warn('[MediaMonkeyProvider] Writing database to disk...')
        fs.writeFileSync(this.databasePath, Buffer.from(finalBuffer))
        console.warn(`[MediaMonkeyProvider] Wrote ${result.written} mood updates to ${path.basename(this.databasePath)}`)

      } catch (txError) {
        console.warn(`[MediaMonkeyProvider] Transaction error: ${getErrorMessage(txError)}`)
        try { db.run('ROLLBACK') } catch { /* ignore rollback error */ }
        throw txError
      } finally {
        db.close()
      }

      // Clean up backup on success
      try { fs.unlinkSync(backupPath) } catch { /* keep backup if delete fails */ }

    } catch (error) {
      console.warn(`[MediaMonkeyProvider] Write failed: ${getErrorMessage(error)}`)
      result.errors.push(`Database write failed: ${getErrorMessage(error)}. Backup available at ${backupPath}`)
      // Restore from backup on failure
      try {
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, this.databasePath)
          console.warn('[MediaMonkeyProvider] Restored database from backup after write failure')
        }
      } catch { /* backup restore failed */ }
    }

    return result
  }
}
