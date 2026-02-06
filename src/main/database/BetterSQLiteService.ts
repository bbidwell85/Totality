/**
 * BetterSQLiteService
 *
 * High-performance SQLite database service using better-sqlite3.
 * This replaces SQL.js with native SQLite for improved performance:
 * - Direct file access (no in-memory + export overhead)
 * - Synchronous API (no unnecessary async wrappers)
 * - WAL mode for concurrent reads during writes
 * - Direct object results (no rowsToObjects conversion)
 *
 * Feature flag: Set 'use_better_sqlite3' to 'true' in settings to enable.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { DATABASE_SCHEMA } from './schema'
import { getCredentialEncryptionService } from '../services/CredentialEncryptionService'
import { getErrorMessage } from '../services/utils/errorUtils'
import type {
  MediaItem,
  QualityScore,
  MediaItemFilters,
  MediaSource,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  SeriesCompleteness,
  MovieCollection,
  MusicQualityScore,
  ArtistCompleteness,
  AlbumCompleteness,
  MusicFilters,
  WishlistItem,
  WishlistFilters,
} from '../types/database'
import type {
  Notification,
  NotificationType,
  NotificationCountResult,
  GetNotificationsOptions,
} from '../types/monitoring'

// Singleton instance
let serviceInstance: BetterSQLiteService | null = null

export function getBetterSQLiteService(): BetterSQLiteService {
  if (!serviceInstance) {
    serviceInstance = new BetterSQLiteService()
  }
  return serviceInstance
}

export class BetterSQLiteService {
  private db: Database.Database | null = null
  private dbPath: string
  private _isInitialized = false

  /** Check if database is initialized */
  get isInitialized(): boolean {
    return this._isInitialized
  }

  constructor() {
    const userDataPath = app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'totality-v2.db')
  }

  /**
   * Initialize the database
   */
  initialize(): void {
    if (this._isInitialized) {
      return
    }

    try {
      // Create or open database
      const dbExists = fs.existsSync(this.dbPath)

      this.db = new Database(this.dbPath)

      // Configure for performance
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = -64000') // 64MB cache
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('temp_store = MEMORY')

      if (dbExists) {
        console.log('[BetterSQLite] Database loaded from:', this.dbPath)

        // Verify integrity
        const result = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>
        if (result[0]?.integrity_check !== 'ok') {
          console.error('[BetterSQLite] Integrity check failed:', result)
          throw new Error('Database integrity check failed')
        }
      } else {
        console.log('[BetterSQLite] New database created')
      }

      // Run schema and migrations
      this.runMigrations()

      this._isInitialized = true
      console.log('[BetterSQLite] Database initialized successfully')
    } catch (error) {
      console.error('[BetterSQLite] Failed to initialize database:', error)
      throw error
    }
  }

  /**
   * Run database migrations
   */
  private runMigrations(): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // Execute main schema (CREATE TABLE IF NOT EXISTS)
    this.db.exec(DATABASE_SCHEMA)

    // Run ALTER TABLE migrations for new columns
    const alterStatements = [
      // Quality scores tier columns
      "ALTER TABLE quality_scores ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'SD'",
      "ALTER TABLE quality_scores ADD COLUMN tier_quality TEXT NOT NULL DEFAULT 'MEDIUM'",
      'ALTER TABLE quality_scores ADD COLUMN tier_score INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE quality_scores ADD COLUMN bitrate_tier_score INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE quality_scores ADD COLUMN audio_tier_score INTEGER NOT NULL DEFAULT 0',

      // Media items enhancements
      'ALTER TABLE media_items ADD COLUMN episode_thumb_url TEXT',
      'ALTER TABLE media_items ADD COLUMN season_poster_url TEXT',
      'ALTER TABLE media_items ADD COLUMN video_frame_rate REAL',
      'ALTER TABLE media_items ADD COLUMN color_bit_depth INTEGER',
      'ALTER TABLE media_items ADD COLUMN hdr_format TEXT',
      'ALTER TABLE media_items ADD COLUMN color_space TEXT',
      'ALTER TABLE media_items ADD COLUMN video_profile TEXT',
      'ALTER TABLE media_items ADD COLUMN video_level INTEGER',
      'ALTER TABLE media_items ADD COLUMN audio_profile TEXT',
      'ALTER TABLE media_items ADD COLUMN audio_sample_rate INTEGER',
      'ALTER TABLE media_items ADD COLUMN has_object_audio INTEGER DEFAULT 0',
      'ALTER TABLE media_items ADD COLUMN container TEXT',
      'ALTER TABLE media_items ADD COLUMN series_tmdb_id TEXT',
      'ALTER TABLE media_items ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
      'ALTER TABLE media_items ADD COLUMN audio_tracks TEXT',
      'ALTER TABLE media_items ADD COLUMN file_mtime INTEGER',
      'ALTER TABLE media_items ADD COLUMN source_id TEXT',
      'ALTER TABLE media_items ADD COLUMN source_type TEXT',
      'ALTER TABLE media_items ADD COLUMN library_id TEXT',

      // Series completeness
      'ALTER TABLE series_completeness ADD COLUMN tmdb_id TEXT',
      'ALTER TABLE series_completeness ADD COLUMN poster_url TEXT',
      'ALTER TABLE series_completeness ADD COLUMN backdrop_url TEXT',
      'ALTER TABLE series_completeness ADD COLUMN status TEXT',
      'ALTER TABLE series_completeness ADD COLUMN source_id TEXT',
      'ALTER TABLE series_completeness ADD COLUMN library_id TEXT',

      // Movie collections
      'ALTER TABLE movie_collections ADD COLUMN source_id TEXT',
      'ALTER TABLE movie_collections ADD COLUMN library_id TEXT',

      // Music tables
      'ALTER TABLE music_artists ADD COLUMN library_id TEXT',
      'ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
      'ALTER TABLE music_albums ADD COLUMN library_id TEXT',
      'ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0',
      'ALTER TABLE music_tracks ADD COLUMN library_id TEXT',
      'ALTER TABLE music_tracks ADD COLUMN file_mtime INTEGER',

      // Wishlist
      "ALTER TABLE wishlist_items ADD COLUMN reason TEXT DEFAULT 'missing'",
      'ALTER TABLE wishlist_items ADD COLUMN current_quality_tier TEXT',
      'ALTER TABLE wishlist_items ADD COLUMN current_quality_level TEXT',
      'ALTER TABLE wishlist_items ADD COLUMN current_resolution TEXT',
      'ALTER TABLE wishlist_items ADD COLUMN current_video_codec TEXT',
      'ALTER TABLE wishlist_items ADD COLUMN current_audio_codec TEXT',
      'ALTER TABLE wishlist_items ADD COLUMN media_item_id INTEGER',
      "ALTER TABLE wishlist_items ADD COLUMN status TEXT DEFAULT 'active'",
      'ALTER TABLE wishlist_items ADD COLUMN completed_at TEXT',

      // Library scans
      'ALTER TABLE library_scans ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1',
    ]

    for (const statement of alterStatements) {
      try {
        this.db.exec(statement)
      } catch (error: unknown) {
        // Ignore "duplicate column" errors
        const msg = getErrorMessage(error)
        if (!msg?.includes('duplicate column name')) {
          console.log(`[BetterSQLite] Migration note: ${msg}`)
        }
      }
    }

    console.log('[BetterSQLite] Migrations completed')
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      // Optimize database before closing
      this.db.pragma('optimize')
      this.db.close()
      this.db = null
      this._isInitialized = false
      console.log('[BetterSQLite] Database closed')
    }
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.dbPath
  }

  /**
   * Batch mode is a no-op for better-sqlite3 (changes are auto-persisted)
   * Kept for API compatibility
   */
  startBatch(): void {
    // No-op: better-sqlite3 uses WAL mode which handles this automatically
  }

  /**
   * End batch mode (no-op for better-sqlite3)
   */
  endBatch(): void {
    // No-op: better-sqlite3 auto-persists
  }

  /**
   * Force save (no-op for better-sqlite3 - changes are auto-persisted)
   */
  forceSave(): void {
    // No-op: better-sqlite3 auto-persists with WAL mode
    // Optionally checkpoint the WAL file
    if (this.db) {
      this.db.pragma('wal_checkpoint(PASSIVE)')
    }
  }

  /**
   * Check if in batch mode (always false for better-sqlite3)
   */
  isInBatchMode(): boolean {
    return false
  }

  // ============================================================================
  // SETTINGS
  // ============================================================================

  /**
   * Get a setting value
   */
  getSetting(key: string): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get(key) as { value: string } | undefined

    if (!row) return null

    // Decrypt sensitive settings
    const sensitiveKeys = ['plex_token', 'tmdb_api_key', 'musicbrainz_api_token']
    if (sensitiveKeys.includes(key)) {
      const encryption = getCredentialEncryptionService()
      return encryption.decryptSetting(key, row.value)
    }

    return row.value
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Encrypt sensitive settings
    const sensitiveKeys = ['plex_token', 'tmdb_api_key', 'musicbrainz_api_token']
    let storedValue = value
    if (sensitiveKeys.includes(key)) {
      const encryption = getCredentialEncryptionService()
      storedValue = encryption.encryptSetting(key, value)
    }

    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    stmt.run(key, storedValue)
  }

  /**
   * Delete a setting
   */
  deleteSetting(key: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?')
    stmt.run(key)
  }

  /**
   * Get all settings
   */
  getAllSettings(): Record<string, string> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT key, value FROM settings')
    const rows = stmt.all() as Array<{ key: string; value: string }>

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }

    return settings
  }

  /**
   * Get settings by prefix
   */
  getSettingsByPrefix(prefix: string): Record<string, string> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT key, value FROM settings WHERE key LIKE ?')
    const rows = stmt.all(prefix + '%') as Array<{ key: string; value: string }>

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }

    return settings
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get library statistics
   */
  getLibraryStats(sourceId?: string): {
    totalItems: number
    totalMovies: number
    totalEpisodes: number
    totalShows: number
    lowQualityCount: number
    needsUpgradeCount: number
    averageQualityScore: number
    movieNeedsUpgradeCount: number
    movieAverageQualityScore: number
    tvNeedsUpgradeCount: number
    tvAverageQualityScore: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const whereClause = sourceId ? ' WHERE m.source_id = ?' : ''
    const params = sourceId ? [sourceId] : []

    const sql = `
      SELECT
        COUNT(*) as totalItems,
        SUM(CASE WHEN m.type = 'movie' THEN 1 ELSE 0 END) as totalMovies,
        SUM(CASE WHEN m.type = 'episode' THEN 1 ELSE 0 END) as totalEpisodes,
        COUNT(DISTINCT CASE WHEN m.type = 'episode' THEN m.series_title END) as totalShows,
        SUM(CASE WHEN q.is_low_quality = 1 THEN 1 ELSE 0 END) as lowQualityCount,
        SUM(CASE WHEN q.needs_upgrade = 1 THEN 1 ELSE 0 END) as needsUpgradeCount,
        COALESCE(AVG(q.overall_score), 0) as averageQualityScore,
        SUM(CASE WHEN m.type = 'movie' AND q.needs_upgrade = 1 THEN 1 ELSE 0 END) as movieNeedsUpgradeCount,
        COALESCE(AVG(CASE WHEN m.type = 'movie' THEN q.overall_score END), 0) as movieAverageQualityScore,
        SUM(CASE WHEN m.type = 'episode' AND q.needs_upgrade = 1 THEN 1 ELSE 0 END) as tvNeedsUpgradeCount,
        COALESCE(AVG(CASE WHEN m.type = 'episode' THEN q.overall_score END), 0) as tvAverageQualityScore
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      ${whereClause}
    `

    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as Record<string, number> | undefined

    if (!row) {
      return {
        totalItems: 0,
        totalMovies: 0,
        totalEpisodes: 0,
        totalShows: 0,
        lowQualityCount: 0,
        needsUpgradeCount: 0,
        averageQualityScore: 0,
        movieNeedsUpgradeCount: 0,
        movieAverageQualityScore: 0,
        tvNeedsUpgradeCount: 0,
        tvAverageQualityScore: 0,
      }
    }

    return {
      totalItems: row.totalItems || 0,
      totalMovies: row.totalMovies || 0,
      totalEpisodes: row.totalEpisodes || 0,
      totalShows: row.totalShows || 0,
      lowQualityCount: row.lowQualityCount || 0,
      needsUpgradeCount: row.needsUpgradeCount || 0,
      averageQualityScore: Math.round(row.averageQualityScore || 0),
      movieNeedsUpgradeCount: row.movieNeedsUpgradeCount || 0,
      movieAverageQualityScore: Math.round(row.movieAverageQualityScore || 0),
      tvNeedsUpgradeCount: row.tvNeedsUpgradeCount || 0,
      tvAverageQualityScore: Math.round(row.tvAverageQualityScore || 0),
    }
  }

  /**
   * Get media items count by source
   */
  getMediaItemsCountBySource(sourceId: string): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE source_id = ?')
    const result = stmt.get(sourceId) as { count: number }
    return result.count
  }

  /**
   * Get aggregated stats across all sources
   */
  getAggregatedSourceStats(): {
    totalSources: number
    enabledSources: number
    totalItems: number
    bySource: Array<{
      sourceId: string
      displayName: string
      sourceType: string
      itemCount: number
      lastScanAt?: string
    }>
  } {
    if (!this.db) throw new Error('Database not initialized')

    const totalSourcesStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_sources')
    const totalSources = (totalSourcesStmt.get() as { count: number }).count

    const enabledSourcesStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_sources WHERE is_enabled = 1')
    const enabledSources = (enabledSourcesStmt.get() as { count: number }).count

    const totalItemsStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items')
    const totalItems = (totalItemsStmt.get() as { count: number }).count

    const bySourceStmt = this.db.prepare(`
      SELECT
        s.source_id,
        s.display_name,
        s.source_type,
        COUNT(m.id) as item_count,
        s.last_scan_at
      FROM media_sources s
      LEFT JOIN media_items m ON s.source_id = m.source_id
      GROUP BY s.source_id
      ORDER BY s.display_name ASC
    `)
    const bySourceRows = bySourceStmt.all() as Array<{
      source_id: string
      display_name: string
      source_type: string
      item_count: number
      last_scan_at: string | null
    }>

    return {
      totalSources,
      enabledSources,
      totalItems,
      bySource: bySourceRows.map(row => ({
        sourceId: row.source_id,
        displayName: row.display_name,
        sourceType: row.source_type,
        itemCount: row.item_count || 0,
        lastScanAt: row.last_scan_at || undefined,
      })),
    }
  }

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  /**
   * Get media items with filters
   */
  getMediaItems(filters?: MediaItemFilters): MediaItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM media_items WHERE 1=1'
    const params: unknown[] = []

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.sourceType) {
      sql += ' AND source_type = ?'
      params.push(filters.sourceType)
    }
    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR series_title LIKE ?)'
      const search = `%${filters.searchQuery}%`
      params.push(search, search)
    }
    if (filters?.needsUpgrade !== undefined) {
      sql += ` AND id IN (SELECT media_item_id FROM quality_scores WHERE needs_upgrade = ?)`
      params.push(filters.needsUpgrade ? 1 : 0)
    }

    // Sorting
    const sortColumn = filters?.sortBy || 'title'
    const sortOrder = filters?.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    sql += ` ORDER BY ${sortColumn} ${sortOrder}`

    // Pagination
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MediaItem[]
  }

  /**
   * Get media item by ID
   */
  getMediaItem(id: number): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_items WHERE id = ?')
    return (stmt.get(id) as MediaItem) || null
  }

  /**
   * Get media item by file path
   */
  getMediaItemByPath(filePath: string): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_items WHERE file_path = ?')
    return (stmt.get(filePath) as MediaItem) || null
  }

  /**
   * Get media item by provider ID
   */
  getMediaItemByProviderId(providerId: string, sourceId?: string): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM media_items WHERE plex_id = ?'
    const params: unknown[] = [providerId]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }

    const stmt = this.db.prepare(sql)
    return (stmt.get(...params) as MediaItem) || null
  }

  /**
   * Count media items matching filters
   */
  countMediaItems(filters?: MediaItemFilters): number {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT COUNT(*) as count FROM media_items WHERE 1=1'
    const params: unknown[] = []

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.sourceType) {
      sql += ' AND source_type = ?'
      params.push(filters.sourceType)
    }
    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR series_title LIKE ?)'
      const search = `%${filters.searchQuery}%`
      params.push(search, search)
    }
    if (filters?.needsUpgrade !== undefined) {
      sql += ` AND id IN (SELECT media_item_id FROM quality_scores WHERE needs_upgrade = ?)`
      params.push(filters.needsUpgrade ? 1 : 0)
    }

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result.count
  }

  /**
   * Upsert media item
   */
  upsertMediaItem(item: MediaItem): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO media_items (
        source_id, source_type, library_id, plex_id, title, year, type,
        series_title, season_number, episode_number, file_path, file_size,
        duration, resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate, video_frame_rate,
        color_bit_depth, hdr_format, color_space, video_profile, video_level,
        audio_profile, audio_sample_rate, has_object_audio, audio_tracks,
        container, file_mtime, imdb_id, tmdb_id, series_tmdb_id, poster_url,
        episode_thumb_url, season_poster_url, user_fixed_match,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
      )
      ON CONFLICT(source_id, plex_id) DO UPDATE SET
        library_id = excluded.library_id,
        title = excluded.title,
        year = excluded.year,
        type = excluded.type,
        series_title = excluded.series_title,
        season_number = excluded.season_number,
        episode_number = excluded.episode_number,
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        duration = excluded.duration,
        resolution = excluded.resolution,
        width = excluded.width,
        height = excluded.height,
        video_codec = excluded.video_codec,
        video_bitrate = excluded.video_bitrate,
        audio_codec = excluded.audio_codec,
        audio_channels = excluded.audio_channels,
        audio_bitrate = excluded.audio_bitrate,
        video_frame_rate = excluded.video_frame_rate,
        color_bit_depth = excluded.color_bit_depth,
        hdr_format = excluded.hdr_format,
        color_space = excluded.color_space,
        video_profile = excluded.video_profile,
        video_level = excluded.video_level,
        audio_profile = excluded.audio_profile,
        audio_sample_rate = excluded.audio_sample_rate,
        has_object_audio = excluded.has_object_audio,
        audio_tracks = excluded.audio_tracks,
        container = excluded.container,
        file_mtime = excluded.file_mtime,
        imdb_id = COALESCE(excluded.imdb_id, media_items.imdb_id),
        tmdb_id = COALESCE(excluded.tmdb_id, media_items.tmdb_id),
        series_tmdb_id = COALESCE(excluded.series_tmdb_id, media_items.series_tmdb_id),
        poster_url = COALESCE(excluded.poster_url, media_items.poster_url),
        episode_thumb_url = COALESCE(excluded.episode_thumb_url, media_items.episode_thumb_url),
        season_poster_url = COALESCE(excluded.season_poster_url, media_items.season_poster_url),
        user_fixed_match = CASE WHEN media_items.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        updated_at = datetime('now')
    `)

    const result = stmt.run(
      item.source_id || 'legacy',
      item.source_type || 'plex',
      item.library_id || null,
      item.plex_id,
      item.title,
      item.year || null,
      item.type,
      item.series_title || null,
      item.season_number || null,
      item.episode_number || null,
      item.file_path,
      item.file_size,
      item.duration,
      item.resolution,
      item.width,
      item.height,
      item.video_codec,
      item.video_bitrate,
      item.audio_codec,
      item.audio_channels,
      item.audio_bitrate,
      item.video_frame_rate || null,
      item.color_bit_depth || null,
      item.hdr_format || null,
      item.color_space || null,
      item.video_profile || null,
      item.video_level || null,
      item.audio_profile || null,
      item.audio_sample_rate || null,
      item.has_object_audio ? 1 : 0,
      item.audio_tracks || null,
      item.container || null,
      item.file_mtime || null,
      item.imdb_id || null,
      item.tmdb_id || null,
      item.series_tmdb_id || null,
      item.poster_url || null,
      item.episode_thumb_url || null,
      item.season_poster_url || null,
      item.user_fixed_match ? 1 : 0
    )

    // Return the ID (either new or existing)
    if (result.changes > 0 && result.lastInsertRowid) {
      return Number(result.lastInsertRowid)
    }

    // If it was an update, get the existing ID
    const existing = this.getMediaItemByProviderId(item.plex_id, item.source_id)
    return existing?.id || 0
  }

  /**
   * Delete media item
   */
  deleteMediaItem(id: number): void {
    if (!this.db) throw new Error('Database not initialized')

    // Delete associated quality score first
    this.db.prepare('DELETE FROM quality_scores WHERE media_item_id = ?').run(id)
    this.db.prepare('DELETE FROM media_items WHERE id = ?').run(id)
  }

  /**
   * Delete all media items for a source
   */
  deleteMediaItemsForSource(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Delete quality scores first
    this.db.prepare(`
      DELETE FROM quality_scores WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )
    `).run(sourceId)

    this.db.prepare('DELETE FROM media_items WHERE source_id = ?').run(sourceId)
  }

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  /**
   * Upsert quality score
   */
  upsertQualityScore(score: QualityScore): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO quality_scores (
        media_item_id, quality_tier, tier_quality, tier_score,
        bitrate_tier_score, audio_tier_score, overall_score,
        resolution_score, bitrate_score, audio_score,
        is_low_quality, needs_upgrade, issues,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(media_item_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        bitrate_tier_score = excluded.bitrate_tier_score,
        audio_tier_score = excluded.audio_tier_score,
        overall_score = excluded.overall_score,
        resolution_score = excluded.resolution_score,
        bitrate_score = excluded.bitrate_score,
        audio_score = excluded.audio_score,
        is_low_quality = excluded.is_low_quality,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues,
        updated_at = datetime('now')
    `)

    stmt.run(
      score.media_item_id,
      score.quality_tier,
      score.tier_quality,
      score.tier_score,
      score.bitrate_tier_score,
      score.audio_tier_score,
      score.overall_score,
      score.resolution_score,
      score.bitrate_score,
      score.audio_score,
      score.is_low_quality ? 1 : 0,
      score.needs_upgrade ? 1 : 0,
      score.issues
    )
  }

  /**
   * Get quality score for media item
   */
  getQualityScore(mediaItemId: number): QualityScore | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM quality_scores WHERE media_item_id = ?')
    return (stmt.get(mediaItemId) as QualityScore) || null
  }

  // ============================================================================
  // MEDIA SOURCES
  // ============================================================================

  /**
   * Get all media sources
   */
  getMediaSources(): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources ORDER BY display_name')
    const sources = stmt.all() as MediaSource[]
    const encryption = getCredentialEncryptionService()

    return sources.map(source => {
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if decryption fails
      }
      return { ...source, connection_config: decryptedConfig }
    })
  }

  /**
   * Get enabled media sources
   */
  getEnabledMediaSources(): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE is_enabled = 1 ORDER BY display_name')
    const sources = stmt.all() as MediaSource[]
    const encryption = getCredentialEncryptionService()

    return sources.map(source => {
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if decryption fails
      }
      return { ...source, connection_config: decryptedConfig }
    })
  }

  /**
   * Get media source by ID
   */
  getMediaSource(sourceId: string): MediaSource | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE source_id = ?')
    const source = stmt.get(sourceId) as MediaSource | undefined
    if (!source) return null

    // Decrypt connection config
    const encryption = getCredentialEncryptionService()
    let decryptedConfig = source.connection_config
    try {
      const config = JSON.parse(source.connection_config)
      const decrypted = encryption.decryptConnectionConfig(config)
      decryptedConfig = JSON.stringify(decrypted)
    } catch {
      // Keep original if decryption fails
    }

    return { ...source, connection_config: decryptedConfig }
  }

  /**
   * Get media source by ID (alias for getMediaSource for compatibility)
   */
  getMediaSourceById(sourceId: string): MediaSource | null {
    return this.getMediaSource(sourceId)
  }

  /**
   * Add or update media source
   */
  upsertMediaSource(source: MediaSource): void {
    if (!this.db) throw new Error('Database not initialized')

    // Encrypt connection config
    const encryption = getCredentialEncryptionService()
    let encryptedConfig = source.connection_config
    try {
      const config = JSON.parse(source.connection_config)
      const encrypted = encryption.encryptConnectionConfig(config)
      encryptedConfig = JSON.stringify(encrypted)
    } catch {
      // Keep original if encryption fails
    }

    const stmt = this.db.prepare(`
      INSERT INTO media_sources (
        source_id, source_type, display_name, connection_config,
        is_enabled, last_connected_at, last_scan_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id) DO UPDATE SET
        source_type = excluded.source_type,
        display_name = excluded.display_name,
        connection_config = excluded.connection_config,
        is_enabled = excluded.is_enabled,
        last_connected_at = excluded.last_connected_at,
        last_scan_at = excluded.last_scan_at,
        updated_at = datetime('now')
    `)

    stmt.run(
      source.source_id,
      source.source_type,
      source.display_name,
      encryptedConfig,
      source.is_enabled ? 1 : 0,
      source.last_connected_at || null,
      source.last_scan_at || null
    )
  }

  /**
   * Delete media source
   */
  deleteMediaSource(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Delete all associated data
    this.deleteMediaItemsForSource(sourceId)
    this.db.prepare('DELETE FROM series_completeness WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM library_scans WHERE source_id = ?').run(sourceId)
    this.db.prepare('DELETE FROM media_sources WHERE source_id = ?').run(sourceId)
  }

  /**
   * Update source connection time
   */
  updateSourceConnectionTime(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE media_sources SET last_connected_at = datetime('now'), updated_at = datetime('now')
      WHERE source_id = ?
    `)
    stmt.run(sourceId)
  }

  /**
   * Update source scan time
   */
  updateSourceScanTime(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE media_sources SET last_scan_at = datetime('now'), updated_at = datetime('now')
      WHERE source_id = ?
    `)
    stmt.run(sourceId)
  }

  /**
   * Toggle source enabled state
   */
  toggleMediaSource(sourceId: string, enabled: boolean): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE media_sources SET is_enabled = ?, updated_at = datetime('now')
      WHERE source_id = ?
    `)
    stmt.run(enabled ? 1 : 0, sourceId)
  }

  // ============================================================================
  // LIBRARY SCANS
  // ============================================================================

  /**
   * Update library scan timestamp
   */
  updateLibraryScanTime(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    itemsScanned: number = 0
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
      VALUES (?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(source_id, library_id) DO UPDATE SET
        library_name = excluded.library_name,
        library_type = excluded.library_type,
        last_scan_at = datetime('now'),
        items_scanned = excluded.items_scanned
    `)
    stmt.run(sourceId, libraryId, libraryName, libraryType, itemsScanned)
  }

  /**
   * Get library scan timestamp
   */
  getLibraryScanTime(sourceId: string, libraryId: string): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?'
    )
    const row = stmt.get(sourceId, libraryId) as { last_scan_at: string } | undefined
    return row?.last_scan_at || null
  }

  /**
   * Get all library scan times for a source
   */
  getLibraryScanTimes(sourceId: string): Map<string, { lastScanAt: string; itemsScanned: number }> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT library_id, last_scan_at, items_scanned FROM library_scans WHERE source_id = ?'
    )
    const rows = stmt.all(sourceId) as Array<{
      library_id: string
      last_scan_at: string
      items_scanned: number
    }>

    const map = new Map<string, { lastScanAt: string; itemsScanned: number }>()
    for (const row of rows) {
      map.set(row.library_id, {
        lastScanAt: row.last_scan_at,
        itemsScanned: row.items_scanned || 0,
      })
    }

    return map
  }

  /**
   * Delete library scan records for a source
   */
  deleteLibraryScanTimes(sourceId: string): void {
    if (!this.db) throw new Error('Database not initialized')

    this.db.prepare('DELETE FROM library_scans WHERE source_id = ?').run(sourceId)
  }

  /**
   * Check if a library is enabled
   */
  isLibraryEnabled(sourceId: string, libraryId: string): boolean {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT is_enabled FROM library_scans WHERE source_id = ? AND library_id = ?'
    )
    const row = stmt.get(sourceId, libraryId) as { is_enabled: number } | undefined

    // If no record exists, library is enabled by default
    if (!row) return true
    return row.is_enabled === 1
  }

  /**
   * Get all libraries for a source with their enabled status
   */
  getSourceLibraries(sourceId: string): Array<{
    libraryId: string
    libraryName: string
    libraryType: string
    isEnabled: boolean
    lastScanAt: string | null
    itemsScanned: number
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      SELECT library_id, library_name, library_type, is_enabled, last_scan_at, items_scanned
      FROM library_scans WHERE source_id = ?
    `)
    const rows = stmt.all(sourceId) as Array<{
      library_id: string
      library_name: string
      library_type: string
      is_enabled: number
      last_scan_at: string | null
      items_scanned: number
    }>

    return rows.map(row => ({
      libraryId: row.library_id,
      libraryName: row.library_name,
      libraryType: row.library_type,
      isEnabled: row.is_enabled === 1,
      lastScanAt: row.last_scan_at,
      itemsScanned: row.items_scanned || 0,
    }))
  }

  /**
   * Get enabled library IDs for a source
   */
  getEnabledLibraryIds(sourceId: string): string[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'SELECT library_id FROM library_scans WHERE source_id = ? AND is_enabled = 1'
    )
    const rows = stmt.all(sourceId) as Array<{ library_id: string }>
    return rows.map(row => row.library_id)
  }

  /**
   * Toggle a library's enabled status
   */
  toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): void {
    if (!this.db) throw new Error('Database not initialized')

    // Check if record exists
    const existingStmt = this.db.prepare(
      'SELECT id FROM library_scans WHERE source_id = ? AND library_id = ?'
    )
    const existing = existingStmt.get(sourceId, libraryId) as { id: number } | undefined

    if (existing) {
      this.db.prepare(
        'UPDATE library_scans SET is_enabled = ? WHERE source_id = ? AND library_id = ?'
      ).run(enabled ? 1 : 0, sourceId, libraryId)
    } else {
      this.db.prepare(`
        INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
        VALUES (?, ?, '', 'unknown', datetime('now'), 0, ?)
      `).run(sourceId, libraryId, enabled ? 1 : 0)
    }
  }

  /**
   * Set library enabled status with metadata
   */
  setLibraryEnabled(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    enabled: boolean
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
      VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
      ON CONFLICT(source_id, library_id) DO UPDATE SET
        library_name = excluded.library_name,
        library_type = excluded.library_type,
        is_enabled = excluded.is_enabled
    `)
    stmt.run(sourceId, libraryId, libraryName, libraryType, enabled ? 1 : 0)
  }

  /**
   * Set multiple libraries' enabled status at once
   */
  setLibrariesEnabled(
    sourceId: string,
    libraries: Array<{ id: string; name: string; type: string; enabled: boolean }>
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
      VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
      ON CONFLICT(source_id, library_id) DO UPDATE SET
        library_name = excluded.library_name,
        library_type = excluded.library_type,
        is_enabled = excluded.is_enabled
    `)

    const transaction = this.db.transaction(() => {
      for (const lib of libraries) {
        stmt.run(sourceId, lib.id, lib.name, lib.type, lib.enabled ? 1 : 0)
      }
    })
    transaction()
  }

  // ============================================================================
  // MUSIC TRACKS
  // ============================================================================

  /**
   * Get music track by file path
   */
  getMusicTrackByPath(filePath: string): MusicTrack | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE file_path = ?')
    return (stmt.get(filePath) as MusicTrack) || null
  }

  /**
   * Upsert music track
   */
  upsertMusicTrack(track: MusicTrack): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_tracks (
        source_id, source_type, library_id, provider_id, album_id, artist_id,
        album_name, artist_name, title, track_number, disc_number, duration,
        file_path, file_size, container, file_mtime, audio_codec, audio_bitrate,
        sample_rate, bit_depth, channels, is_lossless, is_hi_res,
        musicbrainz_id, genres, added_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        album_id = excluded.album_id,
        artist_id = excluded.artist_id,
        album_name = excluded.album_name,
        artist_name = excluded.artist_name,
        title = excluded.title,
        track_number = excluded.track_number,
        disc_number = excluded.disc_number,
        duration = excluded.duration,
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        container = excluded.container,
        file_mtime = excluded.file_mtime,
        audio_codec = excluded.audio_codec,
        audio_bitrate = excluded.audio_bitrate,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        channels = excluded.channels,
        is_lossless = excluded.is_lossless,
        is_hi_res = excluded.is_hi_res,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id),
        genres = excluded.genres,
        updated_at = datetime('now')
    `)

    const result = stmt.run(
      track.source_id,
      track.source_type,
      track.library_id || null,
      track.provider_id,
      track.album_id || null,
      track.artist_id || null,
      track.album_name || null,
      track.artist_name,
      track.title,
      track.track_number || null,
      track.disc_number || null,
      track.duration || null,
      track.file_path || null,
      track.file_size || null,
      track.container || null,
      track.file_mtime || null,
      track.audio_codec,
      track.audio_bitrate || null,
      track.sample_rate || null,
      track.bit_depth || null,
      track.channels || null,
      track.is_lossless ? 1 : 0,
      track.is_hi_res ? 1 : 0,
      track.musicbrainz_id || null,
      track.genres || null,
      track.added_at || null
    )

    if (result.changes > 0 && result.lastInsertRowid) {
      return Number(result.lastInsertRowid)
    }

    // Get existing ID
    const existing = this.db.prepare(
      'SELECT id FROM music_tracks WHERE source_id = ? AND provider_id = ?'
    ).get(track.source_id, track.provider_id) as { id: number } | undefined
    return existing?.id || 0
  }

  /**
   * Upsert music artist
   */
  upsertMusicArtist(artist: MusicArtist): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_artists (
        source_id, source_type, library_id, provider_id, name, sort_name,
        musicbrainz_id, genres, country, biography, thumb_url, art_url,
        album_count, track_count, user_fixed_match, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        name = excluded.name,
        sort_name = excluded.sort_name,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_artists.musicbrainz_id),
        genres = excluded.genres,
        country = excluded.country,
        biography = excluded.biography,
        thumb_url = COALESCE(excluded.thumb_url, music_artists.thumb_url),
        art_url = COALESCE(excluded.art_url, music_artists.art_url),
        album_count = excluded.album_count,
        track_count = excluded.track_count,
        user_fixed_match = CASE WHEN music_artists.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        updated_at = datetime('now')
    `)

    const result = stmt.run(
      artist.source_id,
      artist.source_type,
      artist.library_id || null,
      artist.provider_id,
      artist.name,
      artist.sort_name || null,
      artist.musicbrainz_id || null,
      artist.genres || null,
      artist.country || null,
      artist.biography || null,
      artist.thumb_url || null,
      artist.art_url || null,
      artist.album_count || null,
      artist.track_count || null,
      artist.user_fixed_match ? 1 : 0
    )

    if (result.changes > 0 && result.lastInsertRowid) {
      return Number(result.lastInsertRowid)
    }

    const existing = this.db.prepare(
      'SELECT id FROM music_artists WHERE source_id = ? AND provider_id = ?'
    ).get(artist.source_id, artist.provider_id) as { id: number } | undefined
    return existing?.id || 0
  }

  /**
   * Upsert music album
   */
  upsertMusicAlbum(album: MusicAlbum): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_albums (
        source_id, source_type, library_id, provider_id, artist_id, artist_name,
        title, sort_title, year, musicbrainz_id, musicbrainz_release_group_id,
        genres, studio, album_type, track_count, total_duration, total_size,
        best_audio_codec, best_audio_bitrate, best_sample_rate, best_bit_depth,
        avg_audio_bitrate, thumb_url, art_url, release_date, added_at,
        user_fixed_match, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        artist_id = excluded.artist_id,
        artist_name = excluded.artist_name,
        title = excluded.title,
        sort_title = excluded.sort_title,
        year = excluded.year,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_albums.musicbrainz_id),
        musicbrainz_release_group_id = COALESCE(excluded.musicbrainz_release_group_id, music_albums.musicbrainz_release_group_id),
        genres = excluded.genres,
        studio = excluded.studio,
        album_type = excluded.album_type,
        track_count = excluded.track_count,
        total_duration = excluded.total_duration,
        total_size = excluded.total_size,
        best_audio_codec = excluded.best_audio_codec,
        best_audio_bitrate = excluded.best_audio_bitrate,
        best_sample_rate = excluded.best_sample_rate,
        best_bit_depth = excluded.best_bit_depth,
        avg_audio_bitrate = excluded.avg_audio_bitrate,
        thumb_url = COALESCE(excluded.thumb_url, music_albums.thumb_url),
        art_url = COALESCE(excluded.art_url, music_albums.art_url),
        release_date = excluded.release_date,
        user_fixed_match = CASE WHEN music_albums.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        updated_at = datetime('now')
    `)

    const result = stmt.run(
      album.source_id,
      album.source_type,
      album.library_id || null,
      album.provider_id,
      album.artist_id || null,
      album.artist_name,
      album.title,
      album.sort_title || null,
      album.year || null,
      album.musicbrainz_id || null,
      album.musicbrainz_release_group_id || null,
      album.genres || null,
      album.studio || null,
      album.album_type || null,
      album.track_count || null,
      album.total_duration || null,
      album.total_size || null,
      album.best_audio_codec || null,
      album.best_audio_bitrate || null,
      album.best_sample_rate || null,
      album.best_bit_depth || null,
      album.avg_audio_bitrate || null,
      album.thumb_url || null,
      album.art_url || null,
      album.release_date || null,
      album.added_at || null,
      album.user_fixed_match ? 1 : 0
    )

    if (result.changes > 0 && result.lastInsertRowid) {
      return Number(result.lastInsertRowid)
    }

    const existing = this.db.prepare(
      'SELECT id FROM music_albums WHERE source_id = ? AND provider_id = ?'
    ).get(album.source_id, album.provider_id) as { id: number } | undefined
    return existing?.id || 0
  }

  /**
   * Update music album artwork
   */
  updateMusicAlbumArtwork(albumId: number, artworkUrl: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      UPDATE music_albums SET thumb_url = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    stmt.run(artworkUrl, albumId)
  }

  /**
   * Get music artists with filters
   */
  getMusicArtists(filters?: MusicFilters): MusicArtist[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM music_artists WHERE 1=1'
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.searchQuery) {
      sql += ' AND name LIKE ?'
      params.push(`%${filters.searchQuery}%`)
    }
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicArtist[]
  }

  /**
   * Get music artist by ID
   */
  getMusicArtistById(id: number): MusicArtist | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_artists WHERE id = ?')
    return (stmt.get(id) as MusicArtist) || null
  }

  /**
   * Get music artist by name and source
   */
  getMusicArtistByName(name: string, sourceId: string): MusicArtist | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_artists WHERE name = ? AND source_id = ?')
    return (stmt.get(name, sourceId) as MusicArtist) || null
  }

  /**
   * Get music albums with filters
   */
  getMusicAlbums(filters?: MusicFilters): MusicAlbum[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM music_albums WHERE 1=1'
    const params: unknown[] = []

    if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR artist_name LIKE ?)'
      params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`)
    }
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicAlbum[]
  }

  /**
   * Get music album by ID
   */
  getMusicAlbumById(id: number): MusicAlbum | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE id = ?')
    return (stmt.get(id) as MusicAlbum) || null
  }

  /**
   * Get music album by name and artist
   */
  getMusicAlbumByName(title: string, artistId: number): MusicAlbum | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE title = ? AND artist_id = ?')
    return (stmt.get(title, artistId) as MusicAlbum) || null
  }

  /**
   * Get music albums by artist name
   */
  getMusicAlbumsByArtistName(artistName: string): MusicAlbum[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE artist_name = ?')
    return stmt.all(artistName) as MusicAlbum[]
  }

  /**
   * Get music tracks with filters
   */
  getMusicTracks(filters?: MusicFilters): MusicTrack[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM music_tracks WHERE 1=1'
    const params: unknown[] = []

    if (filters?.albumId) {
      sql += ' AND album_id = ?'
      params.push(filters.albumId)
    }
    if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicTrack[]
  }

  /**
   * Get music track by ID
   */
  getMusicTrackById(id: number): MusicTrack | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE id = ?')
    return (stmt.get(id) as MusicTrack) || null
  }

  /**
   * Delete music track
   */
  deleteMusicTrack(id: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM music_tracks WHERE id = ?').run(id)
  }

  /**
   * Get music library stats
   */
  getMusicStats(sourceId?: string): {
    totalArtists: number
    totalAlbums: number
    totalTracks: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const whereClause = sourceId ? ' WHERE source_id = ?' : ''
    const params = sourceId ? [sourceId] : []

    const artistsStmt = this.db.prepare(`SELECT COUNT(*) as count FROM music_artists${whereClause}`)
    const albumsStmt = this.db.prepare(`SELECT COUNT(*) as count FROM music_albums${whereClause}`)
    const tracksStmt = this.db.prepare(`SELECT COUNT(*) as count FROM music_tracks${whereClause}`)

    return {
      totalArtists: ((artistsStmt.get(...params) as { count: number }) || { count: 0 }).count,
      totalAlbums: ((albumsStmt.get(...params) as { count: number }) || { count: 0 }).count,
      totalTracks: ((tracksStmt.get(...params) as { count: number }) || { count: 0 }).count,
    }
  }

  /**
   * Update music artist counts
   */
  updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      UPDATE music_artists SET album_count = ?, track_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(albumCount, trackCount, artistId)
  }

  /**
   * Update music artist MusicBrainz ID
   */
  updateMusicArtistMbid(artistId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      UPDATE music_artists SET musicbrainz_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(musicbrainzId, artistId)
  }

  /**
   * Update music album MusicBrainz ID
   */
  updateMusicAlbumMbid(albumId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(`
      UPDATE music_albums SET musicbrainz_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(musicbrainzId, albumId)
  }

  // ============================================================================
  // SERIES COMPLETENESS
  // ============================================================================

  /**
   * Upsert series completeness data
   */
  upsertSeriesCompleteness(
    data: Omit<SeriesCompleteness, 'id' | 'created_at' | 'updated_at'>
  ): number {
    if (!this.db) throw new Error('Database not initialized')

    const sourceId = data.source_id || null
    const libraryId = data.library_id || null

    // Check if record exists
    let existingId: number | null = null
    if (sourceId === null && libraryId === null) {
      const stmt = this.db.prepare(
        'SELECT id FROM series_completeness WHERE series_title = ? AND source_id IS NULL AND library_id IS NULL'
      )
      const row = stmt.get(data.series_title) as { id: number } | undefined
      existingId = row?.id || null
    } else if (sourceId === null) {
      const stmt = this.db.prepare(
        'SELECT id FROM series_completeness WHERE series_title = ? AND source_id IS NULL AND library_id = ?'
      )
      const row = stmt.get(data.series_title, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    } else if (libraryId === null) {
      const stmt = this.db.prepare(
        'SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id IS NULL'
      )
      const row = stmt.get(data.series_title, sourceId) as { id: number } | undefined
      existingId = row?.id || null
    } else {
      const stmt = this.db.prepare(
        'SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?'
      )
      const row = stmt.get(data.series_title, sourceId, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    }

    if (existingId !== null) {
      this.db.prepare(`
        UPDATE series_completeness SET
          total_seasons = ?, total_episodes = ?, owned_seasons = ?, owned_episodes = ?,
          missing_seasons = ?, missing_episodes = ?, completeness_percentage = ?,
          tmdb_id = ?, poster_url = ?, backdrop_url = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.total_seasons, data.total_episodes, data.owned_seasons, data.owned_episodes,
        data.missing_seasons, data.missing_episodes, data.completeness_percentage,
        data.tmdb_id || null, data.poster_url || null, data.backdrop_url || null,
        data.status || null, existingId
      )
      return existingId
    }

    const result = this.db.prepare(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, poster_url, backdrop_url, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      data.series_title, sourceId, libraryId, data.total_seasons, data.total_episodes,
      data.owned_seasons, data.owned_episodes, data.missing_seasons, data.missing_episodes,
      data.completeness_percentage, data.tmdb_id || null, data.poster_url || null,
      data.backdrop_url || null, data.status || null
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Get series completeness (deduplicated by series_title)
   */
  getSeriesCompleteness(): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        GROUP BY series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      GROUP BY sc.series_title
      ORDER BY sc.series_title ASC
    `)
    return stmt.all() as SeriesCompleteness[]
  }

  /**
   * Get all series completeness records
   */
  getAllSeriesCompleteness(sourceId?: string, libraryId?: string): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM series_completeness WHERE 1=1'
    const params: unknown[] = []

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as SeriesCompleteness[]
  }

  /**
   * Get series completeness by title
   */
  getSeriesCompletenessByTitle(
    seriesTitle: string,
    sourceId?: string,
    libraryId?: string
  ): SeriesCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM series_completeness WHERE series_title = ?'
    const params: unknown[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const stmt = this.db.prepare(sql)
    return (stmt.get(...params) as SeriesCompleteness) || null
  }

  /**
   * Get incomplete series (completeness < 100%)
   */
  getIncompleteSeries(): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE tmdb_id IS NOT NULL
        GROUP BY series_title
        HAVING max_pct < 100
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL
      GROUP BY sc.series_title
      ORDER BY sc.completeness_percentage ASC
    `)
    return stmt.all() as SeriesCompleteness[]
  }

  /**
   * Delete series completeness record
   */
  deleteSeriesCompleteness(id: number): boolean {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM series_completeness WHERE id = ?').run(id)
    return true
  }

  /**
   * Get episodes for a series
   */
  getEpisodesForSeries(
    seriesTitle: string,
    sourceId?: string,
    libraryId?: string
  ): MediaItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = "SELECT * FROM media_items WHERE type = 'episode' AND series_title = ?"
    const params: unknown[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    sql += ' ORDER BY season_number ASC, episode_number ASC'

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MediaItem[]
  }

  /**
   * Get series completeness statistics
   */
  getSeriesCompletenessStats(): {
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    // Get unique series with their best completeness
    const stmt = this.db.prepare(`
      SELECT series_title, MAX(completeness_percentage) as best_completeness, tmdb_id
      FROM series_completeness
      GROUP BY series_title
    `)
    const rows = stmt.all() as Array<{
      series_title: string
      best_completeness: number
      tmdb_id: string | null
    }>

    const seriesWithTmdb = rows.filter(r => r.tmdb_id !== null)
    const totalSeries = seriesWithTmdb.length
    const completeSeries = seriesWithTmdb.filter(r => r.best_completeness === 100).length
    const incompleteSeries = seriesWithTmdb.filter(r => r.best_completeness < 100).length

    let averageCompleteness = 0
    if (seriesWithTmdb.length > 0) {
      const total = seriesWithTmdb.reduce((sum, r) => sum + r.best_completeness, 0)
      averageCompleteness = Math.round(total / seriesWithTmdb.length)
    }

    // Count missing episodes
    const missingStmt = this.db.prepare(`
      SELECT sc.missing_episodes
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE tmdb_id IS NOT NULL
        GROUP BY series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL
      GROUP BY sc.series_title
    `)
    const missingRows = missingStmt.all() as Array<{ missing_episodes: string }>

    let totalMissingEpisodes = 0
    for (const row of missingRows) {
      try {
        const missing = JSON.parse(row.missing_episodes || '[]')
        totalMissingEpisodes += Array.isArray(missing) ? missing.length : 0
      } catch {
        // Ignore parse errors
      }
    }

    return {
      totalSeries,
      completeSeries,
      incompleteSeries,
      totalMissingEpisodes,
      averageCompleteness,
    }
  }

  // ============================================================================
  // MOVIE COLLECTIONS
  // ============================================================================

  /**
   * Upsert movie collection data
   */
  upsertMovieCollection(
    data: Omit<MovieCollection, 'id' | 'created_at' | 'updated_at'>
  ): number {
    if (!this.db) throw new Error('Database not initialized')

    const sourceId = data.source_id || null
    const libraryId = data.library_id || null

    // Check if record exists
    let existingId: number | null = null
    if (sourceId === null && libraryId === null) {
      const stmt = this.db.prepare(
        'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id IS NULL AND library_id IS NULL'
      )
      const row = stmt.get(data.tmdb_collection_id) as { id: number } | undefined
      existingId = row?.id || null
    } else if (sourceId === null) {
      const stmt = this.db.prepare(
        'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id IS NULL AND library_id = ?'
      )
      const row = stmt.get(data.tmdb_collection_id, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    } else if (libraryId === null) {
      const stmt = this.db.prepare(
        'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id IS NULL'
      )
      const row = stmt.get(data.tmdb_collection_id, sourceId) as { id: number } | undefined
      existingId = row?.id || null
    } else {
      const stmt = this.db.prepare(
        'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id = ?'
      )
      const row = stmt.get(data.tmdb_collection_id, sourceId, libraryId) as { id: number } | undefined
      existingId = row?.id || null
    }

    if (existingId !== null) {
      this.db.prepare(`
        UPDATE movie_collections SET
          collection_name = ?, total_movies = ?, owned_movies = ?,
          missing_movies = ?, owned_movie_ids = ?, completeness_percentage = ?,
          poster_url = ?, backdrop_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.collection_name, data.total_movies, data.owned_movies,
        data.missing_movies, data.owned_movie_ids, data.completeness_percentage,
        data.poster_url || null, data.backdrop_url || null, existingId
      )
      return existingId
    }

    const result = this.db.prepare(`
      INSERT INTO movie_collections (
        tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, owned_movie_ids,
        completeness_percentage, poster_url, backdrop_url,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      data.tmdb_collection_id, data.collection_name, sourceId, libraryId,
      data.total_movies, data.owned_movies, data.missing_movies, data.owned_movie_ids,
      data.completeness_percentage, data.poster_url || null, data.backdrop_url || null
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Get all movie collections
   */
  getMovieCollections(): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM movie_collections ORDER BY collection_name ASC')
    return stmt.all() as MovieCollection[]
  }

  /**
   * Get movie collection by TMDB ID
   */
  getMovieCollectionByTmdbId(tmdbCollectionId: string): MovieCollection | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM movie_collections WHERE tmdb_collection_id = ?')
    return (stmt.get(tmdbCollectionId) as MovieCollection) || null
  }

  /**
   * Get incomplete movie collections
   */
  getIncompleteMovieCollections(): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      'SELECT * FROM movie_collections WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    return stmt.all() as MovieCollection[]
  }

  /**
   * Delete movie collection
   */
  deleteMovieCollection(id: number): boolean {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM movie_collections WHERE id = ?').run(id)
    return true
  }

  /**
   * Clear all movie collections
   */
  clearMovieCollections(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM movie_collections').run()
    console.log('[BetterSQLite] Cleared all movie collections')
  }

  /**
   * Delete single-movie collections
   */
  deleteSingleMovieCollections(): number {
    if (!this.db) throw new Error('Database not initialized')

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM movie_collections WHERE total_movies <= 1')
    const count = (countStmt.get() as { count: number }).count

    if (count > 0) {
      this.db.prepare('DELETE FROM movie_collections WHERE total_movies <= 1').run()
      console.log(`[BetterSQLite] Deleted ${count} single-movie collections`)
    }

    return count
  }

  /**
   * Get movie collection statistics
   */
  getMovieCollectionStats(): {
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM movie_collections')
    const total = (totalStmt.get() as { count: number }).count

    const completeStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM movie_collections WHERE completeness_percentage = 100'
    )
    const complete = (completeStmt.get() as { count: number }).count

    const incompleteStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM movie_collections WHERE completeness_percentage < 100'
    )
    const incomplete = (incompleteStmt.get() as { count: number }).count

    const missingStmt = this.db.prepare(
      'SELECT SUM(json_array_length(missing_movies)) as count FROM movie_collections WHERE missing_movies IS NOT NULL'
    )
    const totalMissing = (missingStmt.get() as { count: number | null }).count || 0

    const avgStmt = this.db.prepare('SELECT AVG(completeness_percentage) as avg FROM movie_collections')
    const avgCompleteness = Math.round((avgStmt.get() as { avg: number | null }).avg || 0)

    return { total, complete, incomplete, totalMissing, avgCompleteness }
  }

  // ============================================================================
  // MUSIC QUALITY SCORES
  // ============================================================================

  /**
   * Upsert music quality score
   */
  upsertMusicQualityScore(score: MusicQualityScore): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO music_quality_scores (
        album_id, quality_tier, tier_quality, tier_score,
        codec_score, bitrate_score, needs_upgrade, issues,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(album_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        codec_score = excluded.codec_score,
        bitrate_score = excluded.bitrate_score,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues,
        updated_at = datetime('now')
    `)
    stmt.run(
      score.album_id, score.quality_tier, score.tier_quality, score.tier_score,
      score.codec_score, score.bitrate_score, score.needs_upgrade ? 1 : 0, score.issues
    )
  }

  /**
   * Get music quality score for album
   */
  getMusicQualityScore(albumId: number): MusicQualityScore | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM music_quality_scores WHERE album_id = ?')
    return (stmt.get(albumId) as MusicQualityScore) || null
  }

  /**
   * Get albums needing upgrade
   */
  getAlbumsNeedingUpgrade(limit?: number): MusicAlbum[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `
      SELECT a.* FROM music_albums a
      INNER JOIN music_quality_scores q ON a.id = q.album_id
      WHERE q.needs_upgrade = 1
      ORDER BY q.tier_score ASC
    `
    if (limit) {
      sql += ` LIMIT ${limit}`
    }

    const stmt = this.db.prepare(sql)
    return stmt.all() as MusicAlbum[]
  }

  // ============================================================================
  // ARTIST/ALBUM COMPLETENESS
  // ============================================================================

  /**
   * Upsert artist completeness
   */
  upsertArtistCompleteness(data: ArtistCompleteness): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO artist_completeness (
        artist_name, musicbrainz_id, total_albums, owned_albums,
        total_singles, owned_singles, total_eps, owned_eps,
        missing_albums, missing_singles, missing_eps,
        completeness_percentage, country, active_years, artist_type,
        thumb_url, last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(artist_name) DO UPDATE SET
        musicbrainz_id = excluded.musicbrainz_id,
        total_albums = excluded.total_albums,
        owned_albums = excluded.owned_albums,
        total_singles = excluded.total_singles,
        owned_singles = excluded.owned_singles,
        total_eps = excluded.total_eps,
        owned_eps = excluded.owned_eps,
        missing_albums = excluded.missing_albums,
        missing_singles = excluded.missing_singles,
        missing_eps = excluded.missing_eps,
        completeness_percentage = excluded.completeness_percentage,
        country = excluded.country,
        active_years = excluded.active_years,
        artist_type = excluded.artist_type,
        thumb_url = excluded.thumb_url,
        last_sync_at = excluded.last_sync_at,
        updated_at = datetime('now')
    `)
    stmt.run(
      data.artist_name, data.musicbrainz_id || null, data.total_albums, data.owned_albums,
      data.total_singles, data.owned_singles, data.total_eps, data.owned_eps,
      data.missing_albums, data.missing_singles, data.missing_eps,
      data.completeness_percentage, data.country || null, data.active_years || null,
      data.artist_type || null, data.thumb_url || null, data.last_sync_at || null
    )
  }

  /**
   * Get artist completeness by name
   */
  getArtistCompleteness(artistName: string): ArtistCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM artist_completeness WHERE artist_name = ?')
    return (stmt.get(artistName) as ArtistCompleteness) || null
  }

  /**
   * Get all artist completeness records
   */
  getAllArtistCompleteness(): ArtistCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM artist_completeness ORDER BY artist_name ASC')
    return stmt.all() as ArtistCompleteness[]
  }

  /**
   * Upsert album completeness
   */
  upsertAlbumCompleteness(data: AlbumCompleteness): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO album_completeness (
        album_id, artist_name, album_title,
        musicbrainz_release_id, musicbrainz_release_group_id,
        total_tracks, owned_tracks, missing_tracks,
        completeness_percentage, last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(album_id) DO UPDATE SET
        artist_name = excluded.artist_name,
        album_title = excluded.album_title,
        musicbrainz_release_id = excluded.musicbrainz_release_id,
        musicbrainz_release_group_id = excluded.musicbrainz_release_group_id,
        total_tracks = excluded.total_tracks,
        owned_tracks = excluded.owned_tracks,
        missing_tracks = excluded.missing_tracks,
        completeness_percentage = excluded.completeness_percentage,
        last_sync_at = excluded.last_sync_at,
        updated_at = datetime('now')
    `)
    stmt.run(
      data.album_id, data.artist_name, data.album_title,
      data.musicbrainz_release_id || null, data.musicbrainz_release_group_id || null,
      data.total_tracks, data.owned_tracks, data.missing_tracks,
      data.completeness_percentage, data.last_sync_at || null
    )
  }

  /**
   * Get album completeness by album ID
   */
  getAlbumCompleteness(albumId: number): AlbumCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM album_completeness WHERE album_id = ?')
    return (stmt.get(albumId) as AlbumCompleteness) || null
  }

  /**
   * Get all album completeness records
   */
  getAllAlbumCompleteness(): AlbumCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM album_completeness ORDER BY artist_name, album_title')
    return stmt.all() as AlbumCompleteness[]
  }

  /**
   * Get album completeness by artist name
   */
  getAlbumCompletenessByArtist(artistName: string): AlbumCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM album_completeness WHERE artist_name = ?')
    return stmt.all(artistName) as AlbumCompleteness[]
  }

  /**
   * Get incomplete albums
   */
  getIncompleteAlbums(): AlbumCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      'SELECT * FROM album_completeness WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    return stmt.all() as AlbumCompleteness[]
  }

  // ============================================================================
  // WISHLIST
  // ============================================================================

  /**
   * Add wishlist item
   */
  addWishlistItem(item: Partial<WishlistItem>): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO wishlist_items (
        media_type, title, subtitle, year, reason,
        tmdb_id, imdb_id, musicbrainz_id, series_title,
        season_number, episode_number, collection_name,
        artist_name, album_title, poster_url, priority, notes,
        status, current_quality_tier, current_quality_level,
        current_resolution, current_video_codec, current_audio_codec,
        media_item_id, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)

    const result = stmt.run(
      item.media_type || 'movie',
      item.title || '',
      item.subtitle || null,
      item.year || null,
      item.reason || 'missing',
      item.tmdb_id || null,
      item.imdb_id || null,
      item.musicbrainz_id || null,
      item.series_title || null,
      item.season_number || null,
      item.episode_number || null,
      item.collection_name || null,
      item.artist_name || null,
      item.album_title || null,
      item.poster_url || null,
      item.priority || 3,
      item.notes || null,
      item.status || 'active',
      item.current_quality_tier || null,
      item.current_quality_level || null,
      item.current_resolution || null,
      item.current_video_codec || null,
      item.current_audio_codec || null,
      item.media_item_id || null
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Add multiple wishlist items in bulk
   */
  addWishlistItemsBulk(items: Partial<WishlistItem>[]): number {
    if (!this.db) throw new Error('Database not initialized')
    if (items.length === 0) return 0

    let added = 0

    const insertStmt = this.db.prepare(`
      INSERT INTO wishlist_items (
        media_type, title, subtitle, year, reason,
        tmdb_id, imdb_id, musicbrainz_id, series_title,
        season_number, episode_number, collection_name,
        artist_name, album_title, poster_url, priority, notes,
        status, current_quality_tier, current_quality_level,
        current_resolution, current_video_codec, current_audio_codec,
        media_item_id, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)

    const insertMany = this.db.transaction((items: Partial<WishlistItem>[]) => {
      for (const item of items) {
        // Skip if already exists
        if (item.tmdb_id && this.wishlistItemExists(item.tmdb_id)) continue
        if (item.musicbrainz_id && this.wishlistItemExists(undefined, item.musicbrainz_id)) continue

        insertStmt.run(
          item.media_type || 'movie',
          item.title || '',
          item.subtitle || null,
          item.year || null,
          item.reason || 'missing',
          item.tmdb_id || null,
          item.imdb_id || null,
          item.musicbrainz_id || null,
          item.series_title || null,
          item.season_number || null,
          item.episode_number || null,
          item.collection_name || null,
          item.artist_name || null,
          item.album_title || null,
          item.poster_url || null,
          item.priority || 3,
          item.notes || null,
          item.status || 'active',
          item.current_quality_tier || null,
          item.current_quality_level || null,
          item.current_resolution || null,
          item.current_video_codec || null,
          item.current_audio_codec || null,
          item.media_item_id || null
        )
        added++
      }
    })

    insertMany(items)
    return added
  }

  /**
   * Update wishlist item
   */
  updateWishlistItem(id: number, updates: Partial<WishlistItem>): void {
    if (!this.db) throw new Error('Database not initialized')

    const fields: string[] = []
    const params: unknown[] = []

    if (updates.priority !== undefined) {
      fields.push('priority = ?')
      params.push(updates.priority)
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?')
      params.push(updates.notes)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      params.push(updates.status)
      if (updates.status === 'completed') {
        fields.push("completed_at = datetime('now')")
      }
    }
    if (updates.poster_url !== undefined) {
      fields.push('poster_url = ?')
      params.push(updates.poster_url)
    }

    if (fields.length === 0) return

    fields.push("updated_at = datetime('now')")
    params.push(id)

    const sql = `UPDATE wishlist_items SET ${fields.join(', ')} WHERE id = ?`
    this.db.prepare(sql).run(...params)
  }

  /**
   * Remove wishlist item
   */
  removeWishlistItem(id: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id)
  }

  /**
   * Get wishlist items with filters
   */
  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM wishlist_items WHERE 1=1'
    const params: unknown[] = []

    if (filters?.media_type) {
      sql += ' AND media_type = ?'
      params.push(filters.media_type)
    }
    if (filters?.priority) {
      sql += ' AND priority = ?'
      params.push(filters.priority)
    }
    if (filters?.reason) {
      sql += ' AND reason = ?'
      params.push(filters.reason)
    }
    if (filters?.status) {
      sql += ' AND status = ?'
      params.push(filters.status)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR series_title LIKE ? OR artist_name LIKE ?)'
      const search = `%${filters.searchQuery}%`
      params.push(search, search, search)
    }

    // Sorting
    const sortColumn = filters?.sortBy || 'added_at'
    const sortOrder = filters?.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
    sql += ` ORDER BY ${sortColumn} ${sortOrder}`

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as WishlistItem[]
  }

  /**
   * Get wishlist item by ID
   */
  getWishlistItemById(id: number): WishlistItem | null {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM wishlist_items WHERE id = ?')
    return (stmt.get(id) as WishlistItem) || null
  }

  /**
   * Get wishlist count
   */
  getWishlistCount(): number {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM wishlist_items')
    return (stmt.get() as { count: number }).count
  }

  /**
   * Check if wishlist item exists
   */
  wishlistItemExists(tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): boolean {
    if (!this.db) throw new Error('Database not initialized')

    if (mediaItemId) {
      const stmt = this.db.prepare('SELECT 1 FROM wishlist_items WHERE media_item_id = ?')
      return !!stmt.get(mediaItemId)
    }
    if (tmdbId) {
      const stmt = this.db.prepare('SELECT 1 FROM wishlist_items WHERE tmdb_id = ?')
      return !!stmt.get(tmdbId)
    }
    if (musicbrainzId) {
      const stmt = this.db.prepare('SELECT 1 FROM wishlist_items WHERE musicbrainz_id = ?')
      return !!stmt.get(musicbrainzId)
    }

    return false
  }

  /**
   * Get wishlist counts by reason
   */
  getWishlistCountsByReason(): {
    missing: number
    upgrade: number
    active: number
    completed: number
    total: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const missingStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE reason = 'missing'")
    const upgradeStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE reason = 'upgrade'")
    const activeStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE status = 'active'")
    const completedStmt = this.db.prepare("SELECT COUNT(*) as count FROM wishlist_items WHERE status = 'completed'")
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM wishlist_items')

    return {
      missing: (missingStmt.get() as { count: number }).count,
      upgrade: (upgradeStmt.get() as { count: number }).count,
      active: (activeStmt.get() as { count: number }).count,
      completed: (completedStmt.get() as { count: number }).count,
      total: (totalStmt.get() as { count: number }).count,
    }
  }

  // ============================================================================
  // QUALITY SCORES (extended)
  // ============================================================================

  /**
   * Get all quality scores
   */
  getQualityScores(): QualityScore[] {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM quality_scores')
    return stmt.all() as QualityScore[]
  }

  /**
   * Get quality score by media item ID (alias)
   */
  getQualityScoreByMediaId(mediaItemId: number): QualityScore | null {
    return this.getQualityScore(mediaItemId)
  }

  // ============================================================================
  // MEDIA ITEMS (extended)
  // ============================================================================

  /**
   * Get media item by ID (alias for getMediaItem)
   */
  getMediaItemById(id: number): MediaItem | null {
    return this.getMediaItem(id)
  }

  /**
   * Update series match (TMDB ID) for all episodes of a series
   */
  updateSeriesMatch(
    seriesTitle: string,
    sourceId: string,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string
  ): number {
    if (!this.db) throw new Error('Database not initialized')

    const params: unknown[] = [tmdbId, 1]
    let sql = 'UPDATE media_items SET series_tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }
    if (newSeriesTitle) {
      sql += ', series_title = ?'
      params.push(newSeriesTitle)
    }

    sql += " WHERE series_title = ? AND source_id = ? AND type = 'episode'"
    params.push(seriesTitle, sourceId)

    this.db.prepare(sql).run(...params)

    // Update series_completeness if title changed
    if (newSeriesTitle && newSeriesTitle !== seriesTitle) {
      this.db.prepare(
        'UPDATE series_completeness SET series_title = ? WHERE series_title = ? AND source_id = ?'
      ).run(newSeriesTitle, seriesTitle, sourceId)
    }

    // Return count of updated episodes
    const titleToQuery = newSeriesTitle || seriesTitle
    const countStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE series_title = ? AND source_id = ? AND type = 'episode'"
    )
    return (countStmt.get(titleToQuery, sourceId) as { count: number }).count
  }

  /**
   * Update movie match (TMDB ID, poster, etc.)
   */
  updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const params: unknown[] = [tmdbId, 1]
    let sql = 'UPDATE media_items SET tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }
    if (title) {
      sql += ', title = ?'
      params.push(title)
    }
    if (year !== undefined) {
      sql += ', year = ?'
      params.push(year)
    }

    sql += " WHERE id = ? AND type = 'movie'"
    params.push(mediaItemId)

    this.db.prepare(sql).run(...params)
  }

  /**
   * Update artist match (MusicBrainz ID)
   */
  updateArtistMatch(artistId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      'UPDATE music_artists SET musicbrainz_id = ?, user_fixed_match = 1 WHERE id = ?'
    ).run(musicbrainzId, artistId)
  }

  /**
   * Update album match (MusicBrainz ID)
   */
  updateAlbumMatch(albumId: number, musicbrainzId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      'UPDATE music_albums SET musicbrainz_id = ?, user_fixed_match = 1 WHERE id = ?'
    ).run(musicbrainzId, albumId)
  }

  /**
   * Update movie TMDB ID (automatic lookup, not user-initiated)
   */
  updateMovieWithTMDBId(mediaItemId: number, tmdbId: string): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare(
      "UPDATE media_items SET tmdb_id = ? WHERE id = ? AND type = 'movie'"
    ).run(tmdbId, mediaItemId)
  }

  /**
   * Remove stale media items
   */
  removeStaleMediaItems(validPlexIds: Set<string>, type: 'movie' | 'episode'): number {
    if (!this.db) throw new Error('Database not initialized')

    // Get all items of the specified type
    const stmt = this.db.prepare('SELECT id, plex_id FROM media_items WHERE type = ?')
    const items = stmt.all(type) as Array<{ id: number; plex_id: string }>

    let removedCount = 0
    const deleteStmt = this.db.prepare('DELETE FROM media_items WHERE id = ?')
    const deleteScoreStmt = this.db.prepare('DELETE FROM quality_scores WHERE media_item_id = ?')

    const transaction = this.db.transaction(() => {
      for (const item of items) {
        if (!validPlexIds.has(item.plex_id)) {
          deleteScoreStmt.run(item.id)
          deleteStmt.run(item.id)
          removedCount++
        }
      }
    })
    transaction()

    return removedCount
  }

  /**
   * Update media item artwork
   */
  updateMediaItemArtwork(
    id: number,
    artwork: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): void {
    if (!this.db) throw new Error('Database not initialized')

    const updates: string[] = []
    const params: unknown[] = []

    if (artwork.posterUrl !== undefined) {
      updates.push('poster_url = ?')
      params.push(artwork.posterUrl)
    }
    if (artwork.episodeThumbUrl !== undefined) {
      updates.push('episode_thumb_url = ?')
      params.push(artwork.episodeThumbUrl)
    }
    if (artwork.seasonPosterUrl !== undefined) {
      updates.push('season_poster_url = ?')
      params.push(artwork.seasonPosterUrl)
    }

    if (updates.length === 0) return

    updates.push("updated_at = datetime('now')")
    params.push(id)

    const sql = `UPDATE media_items SET ${updates.join(', ')} WHERE id = ?`
    this.db.prepare(sql).run(...params)
  }

  // ============================================================================
  // TRANSACTION SUPPORT
  // ============================================================================

  /**
   * Run a function in a transaction
   */
  transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized')
    return this.db.transaction(fn)()
  }

  /**
   * Export all database data to JSON
   */
  exportData(): Record<string, unknown[]> {
    if (!this.db) throw new Error('Database not initialized')

    const tables = [
      'media_sources',
      'media_items',
      'quality_scores',
      'settings',
      'series_completeness',
      'movie_collections',
      'music_artists',
      'music_albums',
      'music_tracks',
      'music_quality_scores',
      'artist_completeness',
      'album_completeness',
    ]

    const exportedData: Record<string, unknown[]> = {
      _meta: [{
        exportedAt: new Date().toISOString(),
        version: '2.0',
        engine: 'better-sqlite3',
        tables: tables,
      }]
    }

    for (const table of tables) {
      try {
        const stmt = this.db.prepare(`SELECT * FROM ${table}`)
        exportedData[table] = stmt.all()
      } catch {
        exportedData[table] = []
      }
    }

    return exportedData
  }

  /**
   * Import data from exported JSON
   */
  importData(data: Record<string, unknown[]>): { imported: number; errors: string[] } {
    if (!this.db) throw new Error('Database not initialized')

    const errors: string[] = []
    let imported = 0

    const importOrder = [
      'settings',
      'media_sources',
      'media_items',
      'quality_scores',
      'series_completeness',
      'movie_collections',
      'music_artists',
      'music_albums',
      'music_tracks',
      'music_quality_scores',
      'artist_completeness',
      'album_completeness',
    ]

    const transaction = this.db.transaction(() => {
      for (const table of importOrder) {
        if (!data[table] || !Array.isArray(data[table]) || data[table].length === 0) {
          continue
        }

        const rows = data[table] as Record<string, unknown>[]

        for (const row of rows) {
          try {
            const columns = Object.keys(row).filter(k => row[k] !== undefined)
            const values = columns.map(k => row[k])
            const placeholders = columns.map(() => '?').join(', ')

            const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
            this.db!.prepare(sql).run(...values)
            imported++
          } catch (error: unknown) {
            errors.push(`${table}: ${getErrorMessage(error)}`)
          }
        }
      }
    })

    try {
      transaction()
    } catch (error: unknown) {
      errors.push(`Import failed: ${getErrorMessage(error)}`)
    }

    return { imported, errors }
  }

  /**
   * Reset the database (delete all data)
   */
  resetDatabase(): void {
    if (!this.db) throw new Error('Database not initialized')

    const tables = [
      'album_completeness',
      'artist_completeness',
      'music_quality_scores',
      'music_tracks',
      'music_albums',
      'music_artists',
      'movie_collections',
      'series_completeness',
      'quality_scores',
      'media_items',
      'media_sources',
      'library_scans',
      'wishlist_items',
      'notifications',
      'settings',
    ]

    const transaction = this.db.transaction(() => {
      for (const table of tables) {
        try {
          this.db!.prepare(`DELETE FROM ${table}`).run()
        } catch {
          console.log(`[BetterSQLite] Could not clear table ${table}`)
        }
      }
    })
    transaction()
  }

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  /**
   * Create a notification
   */
  createNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    const result = stmt.run(
      notification.type,
      notification.title,
      notification.message,
      notification.sourceId || null,
      notification.sourceName || null,
      notification.itemCount || 0,
      notification.metadata ? JSON.stringify(notification.metadata) : '{}'
    )

    return Number(result.lastInsertRowid)
  }

  /**
   * Create multiple notifications
   */
  createNotifications(notifications: Array<Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>>): number[] {
    if (!this.db) throw new Error('Database not initialized')

    const ids: number[] = []
    const stmt = this.db.prepare(`
      INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    const transaction = this.db.transaction(() => {
      for (const notification of notifications) {
        const result = stmt.run(
          notification.type,
          notification.title,
          notification.message,
          notification.sourceId || null,
          notification.sourceName || null,
          notification.itemCount || 0,
          notification.metadata ? JSON.stringify(notification.metadata) : '{}'
        )
        ids.push(Number(result.lastInsertRowid))
      }
    })
    transaction()

    return ids
  }

  /**
   * Get notifications with optional filtering
   */
  getNotifications(options: GetNotificationsOptions = {}): Notification[] {
    if (!this.db) throw new Error('Database not initialized')

    const { limit = 100, offset = 0, type, unreadOnly = false } = options

    let sql = 'SELECT * FROM notifications WHERE 1=1'
    const params: unknown[] = []

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }
    if (unreadOnly) {
      sql += ' AND is_read = 0'
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as Array<{
      id: number
      type: string
      title: string
      message: string
      source_id: string | null
      source_name: string | null
      item_count: number
      metadata: string
      is_read: number
      created_at: string
      read_at: string | null
    }>

    return rows.map(row => ({
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      message: row.message,
      sourceId: row.source_id || undefined,
      sourceName: row.source_name || undefined,
      itemCount: row.item_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      isRead: row.is_read === 1,
      createdAt: row.created_at,
      readAt: row.read_at || undefined,
    }))
  }

  /**
   * Get unread notifications
   */
  getUnreadNotifications(): Notification[] {
    return this.getNotifications({ unreadOnly: true })
  }

  /**
   * Get notification count
   */
  getNotificationCount(): NotificationCountResult {
    if (!this.db) throw new Error('Database not initialized')

    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications')
    const unreadStmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0')

    return {
      total: (totalStmt.get() as { count: number }).count,
      unread: (unreadStmt.get() as { count: number }).count,
    }
  }

  /**
   * Mark notifications as read
   */
  markNotificationsRead(ids: number[]): void {
    if (!this.db) throw new Error('Database not initialized')
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids)
  }

  /**
   * Mark all notifications as read
   */
  markAllNotificationsRead(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare("UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE is_read = 0").run()
  }

  /**
   * Delete notifications
   */
  deleteNotifications(ids: number[]): void {
    if (!this.db) throw new Error('Database not initialized')
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...ids)
  }

  /**
   * Clear all notifications
   */
  clearAllNotifications(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.prepare('DELETE FROM notifications').run()
  }

  /**
   * Prune old notifications
   */
  pruneNotifications(maxCount: number): number {
    if (!this.db) throw new Error('Database not initialized')

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications')
    const totalCount = (countStmt.get() as { count: number }).count

    if (totalCount <= maxCount) return 0

    const deleteCount = totalCount - maxCount

    this.db.prepare(`
      DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications ORDER BY created_at ASC LIMIT ?
      )
    `).run(deleteCount)

    return deleteCount
  }

  // ============================================================================
  // GLOBAL SEARCH
  // ============================================================================

  /**
   * Global search across all media types
   */
  globalSearch(query: string, maxResults = 5): {
    movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
    artists: Array<{ id: number; name: string; thumb_url?: string }>
    albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
    tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string }>
  } {
    if (!this.db || !query || query.length < 2) {
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }

    const searchQuery = `%${query.toLowerCase()}%`

    // Search movies
    const moviesStmt = this.db.prepare(`
      SELECT id, title, year, poster_url
      FROM media_items
      WHERE type = 'movie' AND LOWER(title) LIKE ?
      ORDER BY title
      LIMIT ?
    `)
    const movies = moviesStmt.all(searchQuery, maxResults) as Array<{
      id: number; title: string; year?: number; poster_url?: string
    }>

    // Search TV shows (unique series titles)
    const tvShowsStmt = this.db.prepare(`
      SELECT MIN(id) as id, series_title as title, MIN(poster_url) as poster_url
      FROM media_items
      WHERE type = 'episode' AND series_title IS NOT NULL AND LOWER(series_title) LIKE ?
      GROUP BY series_title
      ORDER BY series_title
      LIMIT ?
    `)
    const tvShows = tvShowsStmt.all(searchQuery, maxResults) as Array<{
      id: number; title: string; poster_url?: string
    }>

    // Search episodes
    const episodesStmt = this.db.prepare(`
      SELECT id, title, series_title, season_number, episode_number, episode_thumb_url as poster_url
      FROM media_items
      WHERE type = 'episode' AND (LOWER(title) LIKE ? OR LOWER(series_title) LIKE ?)
      ORDER BY series_title, season_number, episode_number
      LIMIT ?
    `)
    const episodes = episodesStmt.all(searchQuery, searchQuery, maxResults) as Array<{
      id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string
    }>

    // Search artists
    const artistsStmt = this.db.prepare(`
      SELECT id, name, thumb_url
      FROM music_artists
      WHERE LOWER(name) LIKE ?
      ORDER BY name
      LIMIT ?
    `)
    const artists = artistsStmt.all(searchQuery, maxResults) as Array<{
      id: number; name: string; thumb_url?: string
    }>

    // Search albums
    const albumsStmt = this.db.prepare(`
      SELECT id, title, artist_name, year, thumb_url
      FROM music_albums
      WHERE LOWER(title) LIKE ? OR LOWER(artist_name) LIKE ?
      ORDER BY title
      LIMIT ?
    `)
    const albums = albumsStmt.all(searchQuery, searchQuery, maxResults) as Array<{
      id: number; title: string; artist_name: string; year?: number; thumb_url?: string
    }>

    // Search tracks with album info
    const tracksStmt = this.db.prepare(`
      SELECT t.id, t.title, t.album_id, a.title as album_title, t.artist_name, a.thumb_url as album_thumb_url
      FROM music_tracks t
      LEFT JOIN music_albums a ON t.album_id = a.id
      WHERE LOWER(t.title) LIKE ? OR LOWER(t.artist_name) LIKE ?
      ORDER BY t.title
      LIMIT ?
    `)
    const tracks = tracksStmt.all(searchQuery, searchQuery, maxResults) as Array<{
      id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string
    }>

    return { movies, tvShows, episodes, artists, albums, tracks }
  }
}
