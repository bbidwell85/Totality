import initSqlJs, { Database } from 'sql.js'
import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import { DATABASE_SCHEMA } from '../database/schema'
import { runMigration as runMultiSourceMigration, MIGRATION_VERSION as MULTI_SOURCE_VERSION } from '../database/migrations/001_multi_source'
import { runMigration as runKodiLocalMigration, MIGRATION_VERSION as KODI_LOCAL_VERSION } from '../database/migrations/002_kodi_local_support'
import { getCredentialEncryptionService } from './CredentialEncryptionService'
import { MusicRepository } from './database/MusicRepository'
import type {
  Notification,
  NotificationRow,
  NotificationType,
  GetNotificationsOptions,
  NotificationCountResult,
} from '../types/monitoring'
import type {
  MediaItem,
  QualityScore,
  MediaItemFilters,
  SeriesCompleteness,
  MovieCollection,
  MediaSource,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicQualityScore,
  ArtistCompleteness,
  AlbumCompleteness,
  MusicFilters,
  WishlistItem,
  WishlistFilters,
} from '../types/database'

export class DatabaseService {
  private db: Database | null = null
  private dbPath: string
  private _isInitialized = false
  private batchMode = false
  private pendingSave = false

  // Write mutex to prevent concurrent saves
  private saveQueue: Promise<void> = Promise.resolve()
  private isSaving = false

  // Repository instances (lazy-initialized)
  private _musicRepo: MusicRepository | null = null

  /** Check if database is initialized */
  get isInitialized(): boolean {
    return this._isInitialized
  }

  /** Get the music repository instance */
  private get musicRepo(): MusicRepository {
    if (!this._musicRepo) {
      this._musicRepo = new MusicRepository(
        () => this.db,
        () => this.save()
      )
    }
    return this._musicRepo
  }

  constructor() {
    // Store database in user data directory
    const userDataPath = app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'totality.db')
  }

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return
    }

    try {
      // Initialize SQL.js
      const SQL = await initSqlJs()

      // Check if database file exists
      let dbBuffer: Buffer | null = null
      try {
        dbBuffer = await fs.readFile(this.dbPath)
      } catch (error) {
        // Database doesn't exist yet
        console.log('Creating new database...')
      }

      // Create or load database
      if (dbBuffer) {
        this.db = new SQL.Database(dbBuffer)
        console.log('Database loaded from:', this.dbPath)

        // Verify database integrity
        if (!await this.verifyIntegrity()) {
          console.warn('[Database] Integrity check failed, attempting restore from backup...')
          await this.restoreFromBackup(SQL)
        }
      } else {
        this.db = new SQL.Database()
        console.log('New database created')
      }

      // Run schema migrations
      await this.runMigrations()

      this._isInitialized = true
      console.log('Database initialized successfully')
    } catch (error) {
      console.error('Failed to initialize database:', error)
      throw error
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    try {
      // Check if quality_scores table exists and has the UNIQUE constraint
      const tableInfo = this.db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_scores'`)

      if (tableInfo.length > 0 && tableInfo[0].values.length > 0) {
        const createTableSQL = tableInfo[0].values[0][0] as string

        // If UNIQUE constraint is missing, we need to recreate the table
        if (!createTableSQL.includes('UNIQUE')) {
          console.log('Migrating quality_scores table to add UNIQUE constraint...')

          // Backup existing data
          this.db.run('CREATE TABLE quality_scores_backup AS SELECT * FROM quality_scores')

          // Drop old table
          this.db.run('DROP TABLE quality_scores')

          // Create new table with UNIQUE constraint (from schema)
          // Schema will be executed below

          // Note: data will be lost, but this is acceptable for dev
          console.log('quality_scores table recreated with UNIQUE constraint')
        } else {
          // Try to add new tier columns if they don't exist
          const alterTableStatements = [
            'ALTER TABLE quality_scores ADD COLUMN quality_tier TEXT NOT NULL DEFAULT \'SD\'',
            'ALTER TABLE quality_scores ADD COLUMN tier_quality TEXT NOT NULL DEFAULT \'MEDIUM\'',
            'ALTER TABLE quality_scores ADD COLUMN tier_score INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE quality_scores ADD COLUMN bitrate_tier_score INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE quality_scores ADD COLUMN audio_tier_score INTEGER NOT NULL DEFAULT 0'
          ]

          for (const statement of alterTableStatements) {
            try {
              this.db.run(statement)
              console.log(`Added column: ${statement}`)
            } catch (error: any) {
              // Ignore "duplicate column" errors - column already exists
              if (!error.message?.includes('duplicate column name')) {
                console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
              }
            }
          }
        }
      }

      // Migration: movie_collections - ensure we have tmdb_collection_id column
      // MUST run BEFORE schema execution since schema creates indexes on the column
      const movieCollectionsInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='movie_collections'`
      )
      if (movieCollectionsInfo.length > 0 && movieCollectionsInfo[0].values.length > 0) {
        const createTableSQL = movieCollectionsInfo[0].values[0][0] as string
        // If table has plex_collection_id (old schema), drop and recreate with tmdb_collection_id
        if (createTableSQL && createTableSQL.includes('plex_collection_id')) {
          console.log('Migrating movie_collections: plex_collection_id → tmdb_collection_id')
          this.db.run('DROP TABLE IF EXISTS movie_collections')
          this.db.run('DROP TABLE IF EXISTS media_item_collections')
          console.log('movie_collections table dropped for migration (will be recreated)')
        }
      }

      // Pre-migration: Add source_id and source_type columns to media_items if they don't exist
      // MUST run BEFORE schema execution since schema creates indexes on these columns
      const mediaItemsInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='media_items'`
      )
      if (mediaItemsInfo.length > 0 && mediaItemsInfo[0].values.length > 0) {
        const createTableSQL = mediaItemsInfo[0].values[0][0] as string
        // If table exists but doesn't have source_id column, add it
        if (createTableSQL && !createTableSQL.includes('source_id')) {
          console.log('Pre-migration: Adding source_id column to media_items...')
          try {
            this.db.run(`ALTER TABLE media_items ADD COLUMN source_id TEXT NOT NULL DEFAULT 'legacy'`)
          } catch (e: any) {
            if (!e.message?.includes('duplicate column')) {
              console.log('Could not add source_id column:', e.message)
            }
          }
        }
        if (createTableSQL && !createTableSQL.includes('source_type')) {
          console.log('Pre-migration: Adding source_type column to media_items...')
          try {
            this.db.run(`ALTER TABLE media_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'plex'`)
          } catch (e: any) {
            if (!e.message?.includes('duplicate column')) {
              console.log('Could not add source_type column:', e.message)
            }
          }
        }
        // Add library_id column BEFORE schema execution (schema creates indexes on it)
        if (createTableSQL && !createTableSQL.includes('library_id')) {
          console.log('Pre-migration: Adding library_id column to media_items...')
          try {
            this.db.run(`ALTER TABLE media_items ADD COLUMN library_id TEXT`)
          } catch (e: any) {
            if (!e.message?.includes('duplicate column')) {
              console.log('Could not add library_id column:', e.message)
            }
          }
        }
      }

      // Pre-migration: Add library_id to music tables if they exist
      const musicTables = ['music_artists', 'music_albums', 'music_tracks']
      for (const tableName of musicTables) {
        const tableInfo = this.db.exec(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`
        )
        if (tableInfo.length > 0 && tableInfo[0].values.length > 0) {
          const createTableSQL = tableInfo[0].values[0][0] as string
          if (createTableSQL && !createTableSQL.includes('library_id')) {
            console.log(`Pre-migration: Adding library_id column to ${tableName}...`)
            try {
              this.db.run(`ALTER TABLE ${tableName} ADD COLUMN library_id TEXT`)
            } catch (e: any) {
              if (!e.message?.includes('duplicate column')) {
                console.log(`Could not add library_id column to ${tableName}:`, e.message)
              }
            }
          }
        }
      }

      // Pre-migration: Add source_id/library_id to series_completeness if it exists
      const seriesInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='series_completeness'`
      )
      if (seriesInfo.length > 0 && seriesInfo[0].values.length > 0) {
        const createTableSQL = seriesInfo[0].values[0][0] as string
        if (createTableSQL && !createTableSQL.includes('source_id')) {
          console.log('Pre-migration: Adding source_id column to series_completeness...')
          try {
            this.db.run(`ALTER TABLE series_completeness ADD COLUMN source_id TEXT`)
          } catch (e: any) {
            if (!e.message?.includes('duplicate column')) {
              console.log('Could not add source_id column:', e.message)
            }
          }
        }
        if (createTableSQL && !createTableSQL.includes('library_id')) {
          console.log('Pre-migration: Adding library_id column to series_completeness...')
          try {
            this.db.run(`ALTER TABLE series_completeness ADD COLUMN library_id TEXT`)
          } catch (e: any) {
            if (!e.message?.includes('duplicate column')) {
              console.log('Could not add library_id column:', e.message)
            }
          }
        }
      }

      // Pre-migration: Add source_id/library_id to movie_collections if it exists
      const collectionsInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='movie_collections'`
      )
      if (collectionsInfo.length > 0 && collectionsInfo[0].values.length > 0) {
        const createTableSQL = collectionsInfo[0].values[0][0] as string
        if (createTableSQL && !createTableSQL.includes('source_id')) {
          console.log('Pre-migration: Adding source_id column to movie_collections...')
          try {
            this.db.run(`ALTER TABLE movie_collections ADD COLUMN source_id TEXT`)
          } catch (e: any) {
            if (!e.message?.includes('duplicate column')) {
              console.log('Could not add source_id column:', e.message)
            }
          }
        }
        if (createTableSQL && !createTableSQL.includes('library_id')) {
          console.log('Pre-migration: Adding library_id column to movie_collections...')
          try {
            this.db.run(`ALTER TABLE movie_collections ADD COLUMN library_id TEXT`)
          } catch (e: any) {
            if (!e.message?.includes('duplicate column')) {
              console.log('Could not add library_id column:', e.message)
            }
          }
        }
      }

      // Pre-migration: Add wishlist_items upgrade feature columns (must run BEFORE schema for indexes)
      const wishlistInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='wishlist_items'`
      )
      if (wishlistInfo.length > 0 && wishlistInfo[0].values.length > 0) {
        const createTableSQL = wishlistInfo[0].values[0][0] as string
        if (createTableSQL && !createTableSQL.includes('reason')) {
          console.log('Pre-migration: Adding upgrade columns to wishlist_items...')
          const wishlistAlterStatements = [
            "ALTER TABLE wishlist_items ADD COLUMN reason TEXT DEFAULT 'missing'",
            'ALTER TABLE wishlist_items ADD COLUMN current_quality_tier TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_quality_level TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_resolution TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_video_codec TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_audio_codec TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN media_item_id INTEGER'
          ]
          for (const statement of wishlistAlterStatements) {
            try {
              this.db.run(statement)
              console.log(`Added wishlist column: ${statement}`)
            } catch (e: any) {
              if (!e.message?.includes('duplicate column')) {
                console.log(`Could not add wishlist column:`, e.message)
              }
            }
          }
        }
      }

      // Add status tracking columns to wishlist_items
      const wishlistStatusAlterStatements = [
        "ALTER TABLE wishlist_items ADD COLUMN status TEXT DEFAULT 'active'",
        'ALTER TABLE wishlist_items ADD COLUMN completed_at TEXT'
      ]
      for (const statement of wishlistStatusAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`Added wishlist column: ${statement}`)
        } catch (e: any) {
          if (!e.message?.includes('duplicate column')) {
            console.log(`Could not add wishlist column:`, e.message)
          }
        }
      }

      // Execute main schema (CREATE TABLE IF NOT EXISTS)
      this.db.run(DATABASE_SCHEMA)

      // Add new artwork columns to media_items if they don't exist
      const mediaItemsAlterStatements = [
        'ALTER TABLE media_items ADD COLUMN episode_thumb_url TEXT',
        'ALTER TABLE media_items ADD COLUMN season_poster_url TEXT'
      ]

      for (const statement of mediaItemsAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`Added column: ${statement}`)
        } catch (error: any) {
          // Ignore "duplicate column" errors - column already exists
          if (!error.message?.includes('duplicate column name')) {
            console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
          }
        }
      }

      // Add enhanced quality metadata columns to media_items
      const enhancedQualityAlterStatements = [
        'ALTER TABLE media_items ADD COLUMN video_frame_rate REAL',
        'ALTER TABLE media_items ADD COLUMN color_bit_depth INTEGER',
        'ALTER TABLE media_items ADD COLUMN hdr_format TEXT',
        'ALTER TABLE media_items ADD COLUMN color_space TEXT',
        'ALTER TABLE media_items ADD COLUMN video_profile TEXT',
        'ALTER TABLE media_items ADD COLUMN video_level INTEGER',
        'ALTER TABLE media_items ADD COLUMN audio_profile TEXT',
        'ALTER TABLE media_items ADD COLUMN audio_sample_rate INTEGER',
        'ALTER TABLE media_items ADD COLUMN has_object_audio INTEGER DEFAULT 0',
        'ALTER TABLE media_items ADD COLUMN container TEXT'
      ]

      for (const statement of enhancedQualityAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`[Database] Added enhanced quality column: ${statement}`)
        } catch (error: any) {
          // Ignore "duplicate column" errors - column already exists
          if (!error.message?.includes('duplicate column name')) {
            console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
          }
        }
      }

      // Add series_completeness metadata columns if they don't exist
      const seriesCompletenessAlterStatements = [
        'ALTER TABLE series_completeness ADD COLUMN tmdb_id TEXT',
        'ALTER TABLE series_completeness ADD COLUMN poster_url TEXT',
        'ALTER TABLE series_completeness ADD COLUMN backdrop_url TEXT',
        'ALTER TABLE series_completeness ADD COLUMN status TEXT'
      ]

      for (const statement of seriesCompletenessAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`[Database] Added series_completeness column: ${statement}`)
        } catch (error: any) {
          // Ignore "duplicate column" errors - column already exists
          if (!error.message?.includes('duplicate column name')) {
            console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
          }
        }
      }

      // Add series_tmdb_id column to media_items for storing show-level TMDB ID
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN series_tmdb_id TEXT')
        console.log('[Database] Added series_tmdb_id column to media_items')
      } catch (error: any) {
        // Ignore "duplicate column" errors - column already exists
        if (!error.message?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
        }
      }

      // Add user_fixed_match column to media_items for preserving user-selected matches during rescans
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN user_fixed_match INTEGER DEFAULT 0')
        console.log('[Database] Added user_fixed_match column to media_items')
      } catch (error: any) {
        // Ignore "duplicate column" errors - column already exists
        if (!error.message?.includes('duplicate column name')) {
          console.log(`ALTER TABLE error (may be expected): ${error.message}`)
        }
      }

      // Add user_fixed_match column to music_artists for preserving user-selected matches during rescans
      try {
        this.db.run('ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0')
        console.log('[Database] Added user_fixed_match column to music_artists')
      } catch (error: any) {
        // Ignore "duplicate column" errors - column already exists
        if (!error.message?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
        }
      }

      // Add user_fixed_match column to music_albums for preserving user-selected matches during rescans
      try {
        this.db.run('ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0')
        console.log('[Database] Added user_fixed_match column to music_albums')
      } catch (error: any) {
        // Ignore "duplicate column" errors - column already exists
        if (!error.message?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
        }
      }

      // Add audio_tracks column to media_items for storing all audio track info
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN audio_tracks TEXT')
        console.log('[Database] Added audio_tracks column to media_items')
      } catch (error: any) {
        // Ignore "duplicate column" errors - column already exists
        if (!error.message?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
        }
      }

      // Add file_mtime column to media_items for skip-unchanged-files optimization
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN file_mtime INTEGER')
      } catch (error: any) {
        // Ignore "duplicate column" errors - column already exists
        if (!error.message?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
        }
      }

      // Run multi-source migration if needed
      let currentMigrationVersion = this.db.exec(`SELECT value FROM settings WHERE key = 'migration_version'`)
      let currentVersion = parseInt(currentMigrationVersion[0]?.values[0]?.[0] as string || '0', 10)

      if (currentVersion < MULTI_SOURCE_VERSION) {
        console.log(`Running multi-source migration (current: ${currentVersion}, target: ${MULTI_SOURCE_VERSION})...`)
        await runMultiSourceMigration(this.db)
      } else {
        console.log(`Multi-source migration already applied (version: ${currentVersion})`)
      }

      // Run kodi-local migration if needed
      currentMigrationVersion = this.db.exec(`SELECT value FROM settings WHERE key = 'migration_version'`)
      currentVersion = parseInt(currentMigrationVersion[0]?.values[0]?.[0] as string || '0', 10)

      if (currentVersion < KODI_LOCAL_VERSION) {
        console.log(`Running kodi-local migration (current: ${currentVersion}, target: ${KODI_LOCAL_VERSION})...`)
        await runKodiLocalMigration(this.db)
      } else {
        console.log(`Kodi-local migration already applied (version: ${currentVersion})`)
      }

      // Add is_enabled column to library_scans for library selection feature
      try {
        this.db.run('ALTER TABLE library_scans ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1')
        console.log('[Database] Added is_enabled column to library_scans')
      } catch (error: any) {
        // Ignore "duplicate column" errors - column already exists
        if (!error.message?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${error.message}`)
        }
      }

      // Migration: Add UNIQUE constraints to wishlist_items to prevent duplicates
      const wishlistUniqueCheck = this.db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_wishlist_items_unique_tmdb'"
      )
      if (!wishlistUniqueCheck.length || !wishlistUniqueCheck[0].values.length) {
        console.log('Adding unique constraints to wishlist_items...')

        // First, remove any existing duplicates (keep the oldest entry by lowest id)
        try {
          this.db.run(`
            DELETE FROM wishlist_items
            WHERE id NOT IN (
              SELECT MIN(id) FROM wishlist_items
              GROUP BY
                COALESCE(tmdb_id, ''),
                COALESCE(musicbrainz_id, ''),
                COALESCE(media_item_id, 0),
                media_type,
                COALESCE(series_title, ''),
                COALESCE(season_number, -1),
                COALESCE(reason, 'missing')
            )
          `)
          console.log('Removed duplicate wishlist items')
        } catch (e: any) {
          console.log('Could not remove duplicates:', e.message)
        }

        // Create unique indexes to prevent future duplicates
        const wishlistUniqueIndexes = [
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_tmdb
           ON wishlist_items(tmdb_id, reason)
           WHERE tmdb_id IS NOT NULL`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_musicbrainz
           ON wishlist_items(musicbrainz_id, reason)
           WHERE musicbrainz_id IS NOT NULL`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_media_item
           ON wishlist_items(media_item_id)
           WHERE media_item_id IS NOT NULL AND reason = 'upgrade'`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_season
           ON wishlist_items(series_title, season_number, reason)
           WHERE media_type = 'season' AND tmdb_id IS NULL AND series_title IS NOT NULL`
        ]

        for (const indexSql of wishlistUniqueIndexes) {
          try {
            this.db.run(indexSql)
            console.log('Created wishlist unique index')
          } catch (e: any) {
            console.log('Could not create wishlist unique index:', e.message)
          }
        }
      }

      // Migrate existing plain-text credentials to encrypted format
      await this.migrateCredentialsToEncrypted()

      console.log('Database migrations completed')
    } catch (error) {
      console.error('Failed to run migrations:', error)
      throw error
    }
  }

  /**
   * Save database to disk
   * In batch mode, saves are deferred until endBatch() is called
   * Uses a mutex to prevent concurrent writes
   */
  async save(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // In batch mode, mark as pending but don't actually save yet
    if (this.batchMode) {
      this.pendingSave = true
      return
    }

    // Queue this save operation to prevent concurrent writes
    this.saveQueue = this.saveQueue.then(() => this.performSave())
    await this.saveQueue
  }

  /**
   * Start batch mode - defers disk writes for better performance
   * Call endBatch() when done to persist all changes
   */
  startBatch(): void {
    this.batchMode = true
    this.pendingSave = false
    console.log('Database batch mode started')
  }

  /**
   * End batch mode and save all pending changes
   */
  async endBatch(): Promise<void> {
    this.batchMode = false

    if (this.pendingSave) {
      console.log('Database batch mode ended, saving pending changes...')
      await this.forceSave()
    } else {
      console.log('Database batch mode ended, no pending changes')
    }
  }

  /**
   * Force save to disk, bypassing batch mode
   * Useful for periodic checkpoints during long operations
   * Uses a mutex to prevent concurrent writes
   */
  async forceSave(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // Queue this save operation to prevent concurrent writes
    this.saveQueue = this.saveQueue.then(() => this.performSave())
    await this.saveQueue
  }

  /**
   * Internal method to perform the actual save with atomic writes
   * Uses temp file + rename pattern for safer writes
   */
  private async performSave(): Promise<void> {
    if (this.isSaving || !this.db) return

    this.isSaving = true
    const tempPath = `${this.dbPath}.tmp`
    const backupPath = `${this.dbPath}.bak`

    try {
      const data = this.db.export()

      // Write to temp file first
      await fs.writeFile(tempPath, data)

      // Backup existing database (if it exists)
      if (await this.fileExists(this.dbPath)) {
        try {
          await fs.rename(this.dbPath, backupPath)
        } catch (backupError) {
          // If backup fails, try to copy instead (cross-device moves fail)
          await fs.copyFile(this.dbPath, backupPath)
          await fs.unlink(this.dbPath)
        }
      }

      // Atomic rename temp to actual
      await fs.rename(tempPath, this.dbPath)

      this.pendingSave = false
    } catch (error) {
      console.error('Failed to save database:', error)
      // Try to clean up temp file
      try {
        await fs.unlink(tempPath)
      } catch {
        // Ignore cleanup errors
      }
      throw error
    } finally {
      this.isSaving = false
    }
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Verify database integrity using PRAGMA integrity_check
   */
  private async verifyIntegrity(): Promise<boolean> {
    if (!this.db) return false

    try {
      const result = this.db.exec('PRAGMA integrity_check')
      const status = result[0]?.values[0]?.[0]
      if (status === 'ok') {
        console.log('[Database] Integrity check passed')
        return true
      }
      console.error('[Database] Integrity check failed:', status)
      return false
    } catch (error) {
      console.error('[Database] Integrity check error:', error)
      return false
    }
  }

  /**
   * Restore database from backup file
   */
  private async restoreFromBackup(SQL: Awaited<ReturnType<typeof initSqlJs>>): Promise<void> {
    const backupPath = `${this.dbPath}.bak`

    if (await this.fileExists(backupPath)) {
      try {
        const backupData = await fs.readFile(backupPath)
        this.db = new SQL.Database(backupData)
        console.log('[Database] Restored from backup')

        // Verify restored database
        if (!await this.verifyIntegrity()) {
          throw new Error('Backup database is also corrupted')
        }
        return
      } catch (error) {
        console.error('[Database] Failed to restore from backup:', error)
      }
    }

    // No backup or backup is also corrupted - create fresh database
    this.db = new SQL.Database()
    console.log('[Database] Created fresh database (no valid backup available)')
  }

  /**
   * Check if in batch mode
   */
  isInBatchMode(): boolean {
    return this.batchMode
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.save()
      this.db.close()
      this.db = null
      this._isInitialized = false
    }
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.dbPath
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
        version: '1.0',
        tables: tables,
      }]
    }

    for (const table of tables) {
      try {
        const result = this.db.exec(`SELECT * FROM ${table}`)
        if (result.length > 0) {
          const columns = result[0].columns
          const rows = result[0].values.map(row => {
            const obj: Record<string, unknown> = {}
            columns.forEach((col, i) => {
              obj[col] = row[i]
            })
            return obj
          })
          exportedData[table] = rows
        } else {
          exportedData[table] = []
        }
      } catch (error) {
        console.log(`Table ${table} not found or error, skipping`)
        exportedData[table] = []
      }
    }

    return exportedData
  }

  /**
   * Export working document CSV for tracking upgrades and completions
   */
  exportWorkingCSV(options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }): string {
    if (!this.db) throw new Error('Database not initialized')

    const sections: string[] = []

    if (options.includeUpgrades) {
      sections.push(this.buildUpgradeCandidatesSection())
    }
    if (options.includeMissingMovies) {
      sections.push(this.buildMissingMoviesSection())
    }
    if (options.includeMissingEpisodes) {
      sections.push(this.buildMissingEpisodesSection())
    }
    if (options.includeMissingAlbums) {
      sections.push(this.buildMissingAlbumsSection())
    }

    return sections.filter(s => s.length > 0).join('\n\n')
  }

  /**
   * Build the Upgrade Candidates section of the CSV
   */
  private buildUpgradeCandidatesSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        mi.title,
        mi.year,
        mi.type,
        mi.series_title,
        mi.season_number,
        mi.episode_number,
        qs.quality_tier,
        mi.resolution,
        mi.video_bitrate,
        mi.audio_channels,
        mi.video_codec,
        mi.tmdb_id,
        mi.imdb_id,
        mi.file_path
      FROM media_items mi
      JOIN quality_scores qs ON qs.media_item_id = mi.id
      WHERE qs.needs_upgrade = 1
      ORDER BY qs.quality_tier, mi.type, mi.title
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== UPGRADE CANDIDATES ===\nNo items need upgrading.'
    }

    const header = '=== UPGRADE CANDIDATES ==='
    const columnHeader = 'Title,Year,Type,Series,Season,Episode,Current Tier,Target Tier,Resolution,Video Bitrate,Audio Channels,Codec,TMDB ID,IMDB ID,File Path'

    const rows = result[0].values.map(row => {
      const [title, year, type, seriesTitle, seasonNum, episodeNum, qualityTier, resolution, videoBitrate, audioChannels, videoCodec, tmdbId, imdbId, filePath] = row

      // Determine target tier (next level up)
      const tierOrder = ['SD', '720p', '1080p', '4K']
      const currentIndex = tierOrder.indexOf(qualityTier as string)
      const targetTier = currentIndex < tierOrder.length - 1 ? tierOrder[currentIndex + 1] : qualityTier

      return [
        this.escapeCSV(title as string || ''),
        year || '',
        type || '',
        this.escapeCSV(seriesTitle as string || ''),
        seasonNum || '',
        episodeNum || '',
        qualityTier || '',
        targetTier,
        resolution || '',
        videoBitrate || '',
        audioChannels || '',
        videoCodec || '',
        tmdbId || '',
        imdbId || '',
        this.escapeCSV(filePath as string || '')
      ].join(',')
    })

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Build the Missing Movies section of the CSV
   */
  private buildMissingMoviesSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        mc.collection_name,
        mc.missing_movies
      FROM movie_collections mc
      WHERE mc.missing_movies IS NOT NULL
        AND mc.missing_movies != '[]'
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== MISSING MOVIES (Collections) ===\nNo missing movies found.'
    }

    const header = '=== MISSING MOVIES (Collections) ==='
    const columnHeader = 'Collection Name,Movie Title,Year,TMDB ID'

    const rows: string[] = []

    for (const row of result[0].values) {
      const [collectionName, missingMoviesJson] = row

      try {
        const missingMovies = JSON.parse(missingMoviesJson as string || '[]') as Array<{
          title: string
          year?: number
          tmdb_id: string
        }>

        for (const movie of missingMovies) {
          rows.push([
            this.escapeCSV(collectionName as string || ''),
            this.escapeCSV(movie.title || ''),
            movie.year || '',
            movie.tmdb_id || ''
          ].join(','))
        }
      } catch (e) {
        console.log('Error parsing missing movies JSON:', e)
      }
    }

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Build the Missing Episodes section of the CSV
   */
  private buildMissingEpisodesSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        sc.series_title,
        sc.missing_episodes,
        sc.tmdb_id
      FROM series_completeness sc
      WHERE sc.missing_episodes IS NOT NULL
        AND sc.missing_episodes != '[]'
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== MISSING TV EPISODES ===\nNo missing episodes found.'
    }

    const header = '=== MISSING TV EPISODES ==='
    const columnHeader = 'Series Title,Season,Episode,Episode Title,Air Date,TMDB ID'

    const rows: string[] = []

    for (const row of result[0].values) {
      const [seriesTitle, missingEpisodesJson, tmdbId] = row

      try {
        const missingEpisodes = JSON.parse(missingEpisodesJson as string || '[]') as Array<{
          season_number: number
          episode_number: number
          title?: string
          air_date?: string
        }>

        for (const episode of missingEpisodes) {
          rows.push([
            this.escapeCSV(seriesTitle as string || ''),
            episode.season_number || '',
            episode.episode_number || '',
            this.escapeCSV(episode.title || ''),
            episode.air_date || '',
            tmdbId || ''
          ].join(','))
        }
      } catch (e) {
        console.log('Error parsing missing episodes JSON:', e)
      }
    }

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Build the Missing Albums section of the CSV
   */
  private buildMissingAlbumsSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        ac.artist_name,
        ac.missing_albums,
        ac.missing_singles,
        ac.missing_eps
      FROM artist_completeness ac
      WHERE (ac.missing_albums IS NOT NULL AND ac.missing_albums != '[]')
         OR (ac.missing_singles IS NOT NULL AND ac.missing_singles != '[]')
         OR (ac.missing_eps IS NOT NULL AND ac.missing_eps != '[]')
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== MISSING ALBUMS ===\nNo missing albums found.'
    }

    const header = '=== MISSING ALBUMS ==='
    const columnHeader = 'Artist Name,Album Title,Year,Album Type,MusicBrainz ID'

    const rows: string[] = []

    for (const row of result[0].values) {
      const [artistName, missingAlbumsJson, missingSinglesJson, missingEpsJson] = row

      // Process albums
      try {
        const albums = JSON.parse(missingAlbumsJson as string || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const album of albums) {
          rows.push([
            this.escapeCSV(artistName as string || ''),
            this.escapeCSV(album.title || ''),
            album.year || '',
            'Album',
            album.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }

      // Process singles
      try {
        const singles = JSON.parse(missingSinglesJson as string || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const single of singles) {
          rows.push([
            this.escapeCSV(artistName as string || ''),
            this.escapeCSV(single.title || ''),
            single.year || '',
            'Single',
            single.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }

      // Process EPs
      try {
        const eps = JSON.parse(missingEpsJson as string || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const ep of eps) {
          rows.push([
            this.escapeCSV(artistName as string || ''),
            this.escapeCSV(ep.title || ''),
            ep.year || '',
            'EP',
            ep.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }
    }

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Escape a value for CSV (handle commas, quotes, newlines)
   */
  private escapeCSV(value: string): string {
    if (!value) return ''
    // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"'
    }
    return value
  }

  /**
   * Import data from JSON export
   */
  async importData(data: Record<string, unknown[]>): Promise<{ imported: number; errors: string[] }> {
    if (!this.db) throw new Error('Database not initialized')

    const errors: string[] = []
    let imported = 0

    // Tables to import in order (respecting foreign keys)
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

    this.startBatch()

    try {
      for (const table of importOrder) {
        if (!data[table] || !Array.isArray(data[table]) || data[table].length === 0) {
          continue
        }

        const rows = data[table] as Record<string, unknown>[]

        for (const row of rows) {
          try {
            const columns = Object.keys(row).filter(k => row[k] !== undefined)
            const values = columns.map(k => row[k]) as (string | number | null | Uint8Array)[]
            const placeholders = columns.map(() => '?').join(', ')

            // Use INSERT OR REPLACE to handle existing data
            const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
            this.db.run(sql, values)
            imported++
          } catch (error: any) {
            errors.push(`${table}: ${error.message}`)
          }
        }
      }

      await this.endBatch()
    } catch (error: any) {
      this.batchMode = false
      errors.push(`Import failed: ${error.message}`)
    }

    return { imported, errors }
  }

  /**
   * Reset the database (delete all data)
   */
  async resetDatabase(): Promise<void> {
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
      'settings',
    ]

    for (const table of tables) {
      try {
        this.db.run(`DELETE FROM ${table}`)
      } catch (error) {
        console.log(`Could not clear table ${table}`)
      }
    }

    await this.save()
  }

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  /**
   * Insert or update a media item
   */
  async upsertMediaItem(item: MediaItem): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    // Default source for backwards compatibility
    const sourceId = item.source_id || 'legacy'
    const sourceType = item.source_type || 'plex'

    // Check if record already exists to get correct ID for updates
    const existingResult = this.db.exec(
      'SELECT id FROM media_items WHERE source_id = ? AND plex_id = ?',
      [sourceId, item.plex_id]
    )
    const existingId = existingResult.length > 0 && existingResult[0].values.length > 0
      ? existingResult[0].values[0][0] as number
      : null

    const sql = `
      INSERT INTO media_items (
        source_id, source_type, library_id,
        plex_id, title, year, type, series_title, season_number, episode_number,
        file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate,
        video_frame_rate, color_bit_depth, hdr_format, color_space, video_profile, video_level,
        audio_profile, audio_sample_rate, has_object_audio, audio_tracks,
        container,
        imdb_id, tmdb_id, series_tmdb_id, poster_url, episode_thumb_url, season_poster_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, plex_id) DO UPDATE SET
        source_type = excluded.source_type,
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
        imdb_id = excluded.imdb_id,
        tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.tmdb_id ELSE COALESCE(excluded.tmdb_id, media_items.tmdb_id) END,
        series_tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.series_tmdb_id ELSE COALESCE(excluded.series_tmdb_id, media_items.series_tmdb_id) END,
        poster_url = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.poster_url ELSE COALESCE(excluded.poster_url, media_items.poster_url) END,
        episode_thumb_url = COALESCE(excluded.episode_thumb_url, media_items.episode_thumb_url),
        season_poster_url = COALESCE(excluded.season_poster_url, media_items.season_poster_url)
    `

    // Debug logging for year field
    if (item.type === 'movie') {
      console.log(`[Database] Saving movie "${item.title}" with year: ${item.year || 'NULL'}`)
    }

    this.db.run(sql, [
      sourceId,
      sourceType,
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
      item.imdb_id || null,
      item.tmdb_id || null,
      item.series_tmdb_id || null,
      item.poster_url || null,
      item.episode_thumb_url || null,
      item.season_poster_url || null,
    ])

    // Get the ID of the inserted/updated row
    // For updates, use the existing ID; for inserts, use last_insert_rowid()
    let id: number
    if (existingId !== null) {
      // Updated existing record - use the ID we found earlier
      id = existingId
    } else {
      // Inserted new record - use last_insert_rowid()
      const result = this.db.exec('SELECT last_insert_rowid() as id')
      id = result[0].values[0][0] as number
    }

    await this.save()
    return id
  }

  /**
   * Get media items with optional filters
   * By default, only returns items from enabled libraries
   */
  getMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): MediaItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `
      SELECT m.*,
             q.overall_score, q.needs_upgrade,
             q.quality_tier, q.tier_quality, q.tier_score, q.issues
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE 1=1
    `

    const params: (string | number)[] = []

    // Filter out items from disabled libraries (unless explicitly requested)
    if (!filters?.includeDisabledLibraries) {
      // Include items where library is enabled OR has no entry in library_scans (default to enabled)
      sql += ' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)'
    }

    if (filters?.type) {
      sql += ' AND m.type = ?'
      params.push(filters.type)
    }

    if (filters?.minQualityScore !== undefined) {
      sql += ' AND q.overall_score >= ?'
      params.push(filters.minQualityScore)
    }

    if (filters?.maxQualityScore !== undefined) {
      sql += ' AND q.overall_score <= ?'
      params.push(filters.maxQualityScore)
    }

    if (filters?.needsUpgrade !== undefined) {
      sql += ' AND q.needs_upgrade = ?'
      params.push(filters.needsUpgrade ? 1 : 0)
    }

    if (filters?.searchQuery) {
      sql += ' AND (m.title LIKE ? OR m.series_title LIKE ?)'
      const searchTerm = `%${filters.searchQuery}%`
      params.push(searchTerm, searchTerm)
    }

    // Multi-source filters
    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.sourceType) {
      sql += ' AND m.source_type = ?'
      params.push(filters.sourceType)
    }

    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }

    sql += ' ORDER BY m.title ASC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<MediaItem>(result[0])
  }

  /**
   * Get a single media item by ID
   */
  getMediaItemById(id: number): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT * FROM media_items WHERE id = ?', [id])
    if (!result.length) return null

    const items = this.rowsToObjects<MediaItem>(result[0])
    return items[0] || null
  }

  /**
   * Get a media item by file path
   */
  getMediaItemByPath(filePath: string): MediaItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT * FROM media_items WHERE file_path = ?', [filePath])
    if (!result.length) return null

    const items = this.rowsToObjects<MediaItem>(result[0])
    return items[0] || null
  }

  /**
   * Delete a media item
   */
  async deleteMediaItem(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM media_items WHERE id = ?', [id])
    await this.save()
  }

  /**
   * Update artwork URLs for a media item
   * Used to populate artwork from TMDB for local drive sources
   */
  async updateMediaItemArtwork(
    sourceId: string,
    plexId: string,
    artwork: {
      posterUrl?: string
      episodeThumbUrl?: string
      seasonPosterUrl?: string
    }
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const updates: string[] = []
    const params: (string | null)[] = []

    if (artwork.posterUrl !== undefined) {
      updates.push('poster_url = ?')
      params.push(artwork.posterUrl || null)
    }
    if (artwork.episodeThumbUrl !== undefined) {
      updates.push('episode_thumb_url = ?')
      params.push(artwork.episodeThumbUrl || null)
    }
    if (artwork.seasonPosterUrl !== undefined) {
      updates.push('season_poster_url = ?')
      params.push(artwork.seasonPosterUrl || null)
    }

    if (updates.length === 0) return

    params.push(sourceId, plexId)

    const sql = `UPDATE media_items SET ${updates.join(', ')} WHERE source_id = ? AND plex_id = ?`
    this.db.run(sql, params)
    await this.save()
  }

  /**
   * Update TMDB match for all episodes of a TV series
   * Used to fix incorrect automatic matches for local drive sources
   * Sets user_fixed_match = 1 to preserve this match during rescans
   */
  async updateSeriesMatch(
    seriesTitle: string,
    sourceId: string,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string
  ): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    // Update all episodes of this series with the new TMDB ID and mark as user-fixed
    const params: (string | number | null)[] = [tmdbId, 1] // 1 = user_fixed_match
    let sql = 'UPDATE media_items SET series_tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }

    if (newSeriesTitle) {
      sql += ', series_title = ?'
      params.push(newSeriesTitle)
    }

    sql += ' WHERE series_title = ? AND source_id = ? AND type = ?'
    params.push(seriesTitle, sourceId, 'episode')

    this.db.run(sql, params)

    // Also update series_completeness table if the title changed
    if (newSeriesTitle && newSeriesTitle !== seriesTitle) {
      this.db.run(
        'UPDATE series_completeness SET series_title = ? WHERE series_title = ? AND source_id = ?',
        [newSeriesTitle, seriesTitle, sourceId]
      )
    }

    await this.save()

    // Return count of updated episodes (use new title if provided)
    const titleToQuery = newSeriesTitle || seriesTitle
    const result = this.db.exec(
      'SELECT COUNT(*) FROM media_items WHERE series_title = ? AND source_id = ? AND type = ?',
      [titleToQuery, sourceId, 'episode']
    )

    return result[0]?.values[0]?.[0] as number || 0
  }

  /**
   * Update TMDB match for a movie
   * Used to fix incorrect automatic matches for local drive sources
   * Sets user_fixed_match = 1 to preserve this match during rescans
   */
  async updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const params: (string | number | null)[] = [tmdbId, 1] // 1 = user_fixed_match
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

    sql += ' WHERE id = ? AND type = ?'
    params.push(mediaItemId, 'movie')

    this.db.run(sql, params)
    await this.save()
  }

  /**
   * Update MusicBrainz match for an artist
   * Used to fix incorrect automatic matches for local drive sources
   * Sets user_fixed_match = 1 to preserve this match during rescans
   */
  async updateArtistMatch(
    artistId: number,
    musicbrainzId: string
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      'UPDATE music_artists SET musicbrainz_id = ?, user_fixed_match = 1 WHERE id = ?',
      [musicbrainzId, artistId]
    )
    await this.save()
  }

  /**
   * Update MusicBrainz match for an album
   * Used to fix incorrect automatic matches for local drive sources
   * Sets user_fixed_match = 1 to preserve this match during rescans
   */
  async updateAlbumMatch(
    albumId: number,
    musicbrainzId: string
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      'UPDATE music_albums SET musicbrainz_id = ?, user_fixed_match = 1 WHERE id = ?',
      [musicbrainzId, albumId]
    )
    await this.save()
  }

  /**
   * Update a movie's TMDB ID (for automatic lookup, not user-initiated fix)
   * This does NOT set user_fixed_match, so it can be overwritten in future scans
   * Used during collection analysis to fill in missing TMDB IDs for local sources
   */
  async updateMovieWithTMDBId(
    mediaItemId: number,
    tmdbId: string
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      'UPDATE media_items SET tmdb_id = ? WHERE id = ? AND type = ?',
      [tmdbId, mediaItemId, 'movie']
    )
    await this.save()
  }

  /**
   * Remove media items that are no longer in Plex library
   * @param validPlexIds Set of plex_ids that still exist in Plex
   * @param type The type of media to clean up ('movie' or 'episode')
   * @returns Number of items removed
   */
  async removeStaleMediaItems(validPlexIds: Set<string>, type: 'movie' | 'episode'): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    // Get all plex_ids of the specified type currently in the database
    const result = this.db.exec(
      'SELECT id, plex_id, title FROM media_items WHERE type = ?',
      [type]
    )

    if (!result[0]?.values) return 0

    const itemsToDelete: Array<{ id: number; plex_id: string; title: string }> = []

    for (const row of result[0].values) {
      const id = row[0] as number
      const plexId = row[1] as string
      const title = row[2] as string

      if (plexId && !validPlexIds.has(plexId)) {
        itemsToDelete.push({ id, plex_id: plexId, title })
      }
    }

    if (itemsToDelete.length === 0) return 0

    console.log(`Removing ${itemsToDelete.length} stale ${type}(s) from database...`)

    // Delete stale items and their associated quality scores
    for (const item of itemsToDelete) {
      console.log(`  Removing: ${item.title} (plex_id: ${item.plex_id})`)
      this.db.run('DELETE FROM quality_scores WHERE media_item_id = ?', [item.id])
      this.db.run('DELETE FROM media_items WHERE id = ?', [item.id])
    }

    await this.save()
    return itemsToDelete.length
  }

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  /**
   * Insert or update a quality score
   */
  async upsertQualityScore(score: QualityScore): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    const sql = `
      INSERT INTO quality_scores (
        media_item_id,
        quality_tier, tier_quality, tier_score, bitrate_tier_score, audio_tier_score,
        overall_score, resolution_score, bitrate_score, audio_score,
        is_low_quality, needs_upgrade, issues
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        issues = excluded.issues
    `

    this.db.run(sql, [
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
      score.issues,
    ])

    const result = this.db.exec('SELECT last_insert_rowid() as id')
    const id = result[0].values[0][0] as number

    await this.save()
    return id
  }

  /**
   * Get quality scores
   */
  getQualityScores(): QualityScore[] {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT * FROM quality_scores ORDER BY overall_score ASC')
    if (!result.length) return []

    return this.rowsToObjects<QualityScore>(result[0])
  }

  /**
   * Get quality score for a media item
   */
  getQualityScoreByMediaId(mediaItemId: number): QualityScore | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT * FROM quality_scores WHERE media_item_id = ?', [
      mediaItemId,
    ])
    if (!result.length) return null

    const scores = this.rowsToObjects<QualityScore>(result[0])
    return scores[0] || null
  }

  // ============================================================================
  // SETTINGS
  // ============================================================================

  /**
   * Get a setting by key
   * Sensitive settings are automatically decrypted
   */
  getSetting(key: string): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT value FROM settings WHERE key = ?', [key])
    if (!result.length) return null

    const value = (result[0].values[0]?.[0] as string) || null
    if (!value) return null

    // Decrypt sensitive settings
    const encryption = getCredentialEncryptionService()
    return encryption.decryptSetting(key, value)
  }

  /**
   * Set a setting
   * Sensitive settings are automatically encrypted
   */
  async setSetting(key: string, value: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Encrypt sensitive settings
    const encryption = getCredentialEncryptionService()
    const valueToStore = encryption.encryptSetting(key, value)

    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, valueToStore]
    )

    await this.save()
  }

  /**
   * Get all settings
   * Sensitive settings are automatically decrypted
   */
  getAllSettings(): Record<string, string> {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT key, value FROM settings')
    if (!result.length) return {}

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    result[0].values.forEach((row) => {
      const key = row[0] as string
      const value = row[1] as string
      // Decrypt sensitive settings
      settings[key] = encryption.decryptSetting(key, value)
    })

    return settings
  }

  /**
   * Get settings by prefix (batch retrieval for efficiency)
   * e.g., getSettingsByPrefix('quality_') returns all quality-related settings
   */
  getSettingsByPrefix(prefix: string): Record<string, string> {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT key, value FROM settings WHERE key LIKE ?',
      [prefix + '%']
    )
    if (!result.length) return {}

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    result[0].values.forEach((row) => {
      const key = row[0] as string
      const value = row[1] as string
      // Decrypt sensitive settings
      settings[key] = encryption.decryptSetting(key, value)
    })

    return settings
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get library statistics (optimized single query)
   */
  getLibraryStats(sourceId?: string): {
    totalItems: number
    totalMovies: number
    totalEpisodes: number
    totalShows: number
    lowQualityCount: number
    needsUpgradeCount: number
    averageQualityScore: number
    // Movie-specific stats
    movieNeedsUpgradeCount: number
    movieAverageQualityScore: number
    // TV-specific stats
    tvNeedsUpgradeCount: number
    tvAverageQualityScore: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    // Single combined query for all stats including per-type breakdowns
    // Optionally filter by source_id
    const whereClause = sourceId ? ' WHERE m.source_id = ?' : ''
    const params = sourceId ? [sourceId] : []

    const result = this.db.exec(`
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
    `, params)

    if (!result.length || !result[0].values.length) {
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

    const row = result[0].values[0]
    return {
      totalItems: (row[0] as number) || 0,
      totalMovies: (row[1] as number) || 0,
      totalEpisodes: (row[2] as number) || 0,
      totalShows: (row[3] as number) || 0,
      lowQualityCount: (row[4] as number) || 0,
      needsUpgradeCount: (row[5] as number) || 0,
      averageQualityScore: Math.round((row[6] as number) || 0),
      movieNeedsUpgradeCount: (row[7] as number) || 0,
      movieAverageQualityScore: Math.round((row[8] as number) || 0),
      tvNeedsUpgradeCount: (row[9] as number) || 0,
      tvAverageQualityScore: Math.round((row[10] as number) || 0),
    }
  }

  // ============================================================================
  // MEDIA SOURCES
  // ============================================================================

  /**
   * Insert or update a media source
   * Connection config is automatically encrypted before storage
   */
  async upsertMediaSource(source: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized')

    // Encrypt sensitive fields in connection config
    const encryption = getCredentialEncryptionService()
    let connectionConfigToStore = source.connection_config

    try {
      const config = JSON.parse(source.connection_config)
      const encryptedConfig = encryption.encryptConnectionConfig(config)
      connectionConfigToStore = JSON.stringify(encryptedConfig)
    } catch {
      // If parsing fails, store as-is (shouldn't happen with valid JSON)
      console.warn('[DatabaseService] Failed to parse connection_config for encryption')
    }

    const sql = `
      INSERT INTO media_sources (
        source_id, source_type, display_name, connection_config, is_enabled,
        last_connected_at, last_scan_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_type = excluded.source_type,
        display_name = excluded.display_name,
        connection_config = excluded.connection_config,
        is_enabled = excluded.is_enabled,
        last_connected_at = excluded.last_connected_at,
        last_scan_at = excluded.last_scan_at
    `

    this.db.run(sql, [
      source.source_id,
      source.source_type,
      source.display_name,
      connectionConfigToStore,
      source.is_enabled ? 1 : 0,
      source.last_connected_at || null,
      source.last_scan_at || null,
    ])

    await this.save()
    return source.source_id
  }

  /**
   * Get all media sources
   * Connection config is automatically decrypted after retrieval
   */
  getMediaSources(type?: string): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM media_sources'
    const params: string[] = []

    if (type) {
      sql += ' WHERE source_type = ?'
      params.push(type)
    }

    sql += ' ORDER BY display_name ASC'

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    const encryption = getCredentialEncryptionService()

    return this.rowsToObjects<MediaSource>(result[0]).map(source => {
      // Decrypt sensitive fields in connection config
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if parsing fails
      }

      return {
        ...source,
        connection_config: decryptedConfig,
        is_enabled: Boolean(source.is_enabled),
      }
    })
  }

  /**
   * Get enabled media sources
   * Connection config is automatically decrypted after retrieval
   */
  getEnabledMediaSources(): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT * FROM media_sources WHERE is_enabled = 1 ORDER BY display_name ASC'
    )
    if (!result.length) return []

    const encryption = getCredentialEncryptionService()

    return this.rowsToObjects<MediaSource>(result[0]).map(source => {
      // Decrypt sensitive fields in connection config
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if parsing fails
      }

      return {
        ...source,
        connection_config: decryptedConfig,
        is_enabled: true,
      }
    })
  }

  /**
   * Get a media source by ID
   * Connection config is automatically decrypted after retrieval
   */
  getMediaSourceById(sourceId: string): MediaSource | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT * FROM media_sources WHERE source_id = ?',
      [sourceId]
    )
    if (!result.length) return null

    const sources = this.rowsToObjects<MediaSource>(result[0])
    if (!sources[0]) return null

    // Decrypt sensitive fields in connection config
    const encryption = getCredentialEncryptionService()
    let decryptedConfig = sources[0].connection_config
    try {
      const config = JSON.parse(sources[0].connection_config)
      const decrypted = encryption.decryptConnectionConfig(config)
      decryptedConfig = JSON.stringify(decrypted)
    } catch {
      // Keep original if parsing fails
    }

    return {
      ...sources[0],
      connection_config: decryptedConfig,
      is_enabled: Boolean(sources[0].is_enabled),
    }
  }

  /**
   * Update media source connection timestamp
   */
  async updateSourceConnectionTime(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `UPDATE media_sources SET last_connected_at = datetime('now') WHERE source_id = ?`,
      [sourceId]
    )
    await this.save()
  }

  /**
   * Update media source scan timestamp
   */
  async updateSourceScanTime(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `UPDATE media_sources SET last_scan_at = datetime('now') WHERE source_id = ?`,
      [sourceId]
    )
    await this.save()
  }

  // ============================================================================
  // LIBRARY SCAN TIMESTAMPS
  // ============================================================================

  /**
   * Update library scan timestamp
   */
  async updateLibraryScanTime(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    itemsScanned: number = 0
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
       VALUES (?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(source_id, library_id) DO UPDATE SET
         library_name = excluded.library_name,
         library_type = excluded.library_type,
         last_scan_at = datetime('now'),
         items_scanned = excluded.items_scanned`,
      [sourceId, libraryId, libraryName, libraryType, itemsScanned]
    )
    await this.save()
  }

  /**
   * Get library scan timestamp
   */
  getLibraryScanTime(sourceId: string, libraryId: string): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?',
      [sourceId, libraryId]
    )

    return result[0]?.values[0]?.[0] as string | null
  }

  /**
   * Get all library scan times for a source
   */
  getLibraryScanTimes(sourceId: string): Map<string, { lastScanAt: string; itemsScanned: number }> {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT library_id, last_scan_at, items_scanned FROM library_scans WHERE source_id = ?',
      [sourceId]
    )

    const map = new Map<string, { lastScanAt: string; itemsScanned: number }>()
    if (result.length > 0) {
      for (const row of result[0].values) {
        map.set(row[0] as string, {
          lastScanAt: row[1] as string,
          itemsScanned: (row[2] as number) || 0,
        })
      }
    }

    return map
  }

  /**
   * Delete library scan records for a source (called when source is deleted)
   */
  async deleteLibraryScanTimes(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM library_scans WHERE source_id = ?', [sourceId])
    await this.save()
  }

  /**
   * Check if a library is enabled
   */
  isLibraryEnabled(sourceId: string, libraryId: string): boolean {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT is_enabled FROM library_scans WHERE source_id = ? AND library_id = ?',
      [sourceId, libraryId]
    )

    // If no record exists, library is enabled by default
    if (!result[0]?.values[0]) return true
    return (result[0].values[0][0] as number) === 1
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

    const result = this.db.exec(
      `SELECT library_id, library_name, library_type, is_enabled, last_scan_at, items_scanned
       FROM library_scans WHERE source_id = ?`,
      [sourceId]
    )

    if (!result[0]) return []

    return result[0].values.map(row => ({
      libraryId: row[0] as string,
      libraryName: row[1] as string,
      libraryType: row[2] as string,
      isEnabled: (row[3] as number) === 1,
      lastScanAt: row[4] as string | null,
      itemsScanned: (row[5] as number) || 0,
    }))
  }

  /**
   * Get enabled library IDs for a source
   */
  getEnabledLibraryIds(sourceId: string): string[] {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT library_id FROM library_scans WHERE source_id = ? AND is_enabled = 1',
      [sourceId]
    )

    if (!result[0]) return []
    return result[0].values.map(row => row[0] as string)
  }

  /**
   * Toggle a library's enabled status
   */
  async toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Check if record exists
    const existing = this.db.exec(
      'SELECT id FROM library_scans WHERE source_id = ? AND library_id = ?',
      [sourceId, libraryId]
    )

    if (existing[0]?.values[0]) {
      // Update existing record
      this.db.run(
        'UPDATE library_scans SET is_enabled = ? WHERE source_id = ? AND library_id = ?',
        [enabled ? 1 : 0, sourceId, libraryId]
      )
    } else {
      // Insert new record (library hasn't been scanned yet)
      this.db.run(
        `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
         VALUES (?, ?, '', 'unknown', datetime('now'), 0, ?)`,
        [sourceId, libraryId, enabled ? 1 : 0]
      )
    }
    await this.save()
  }

  /**
   * Set library enabled status with metadata (used during initial setup)
   */
  async setLibraryEnabled(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    enabled: boolean
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
       VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
       ON CONFLICT(source_id, library_id) DO UPDATE SET
         library_name = excluded.library_name,
         library_type = excluded.library_type,
         is_enabled = excluded.is_enabled`,
      [sourceId, libraryId, libraryName, libraryType, enabled ? 1 : 0]
    )
    await this.save()
  }

  /**
   * Set multiple libraries' enabled status at once (batch operation)
   */
  async setLibrariesEnabled(
    sourceId: string,
    libraries: Array<{ id: string; name: string; type: string; enabled: boolean }>
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.startBatch()
    for (const lib of libraries) {
      this.db.run(
        `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
         VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
         ON CONFLICT(source_id, library_id) DO UPDATE SET
           library_name = excluded.library_name,
           library_type = excluded.library_type,
           is_enabled = excluded.is_enabled`,
        [sourceId, lib.id, lib.name, lib.type, lib.enabled ? 1 : 0]
      )
    }
    await this.endBatch()
  }

  /**
   * Toggle media source enabled status
   */
  async toggleMediaSource(sourceId: string, enabled: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      'UPDATE media_sources SET is_enabled = ? WHERE source_id = ?',
      [enabled ? 1 : 0, sourceId]
    )
    await this.save()
  }

  /**
   * Delete a media source and ALL its associated data
   */
  async deleteMediaSource(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    console.log(`[Database] Deleting source ${sourceId} and all associated data...`)

    // Delete quality scores for media items from this source
    this.db.run(
      `DELETE FROM quality_scores WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete wishlist items that reference media items being deleted (upgrade items)
    // Must be before media_items deletion since it references media_items
    this.db.run(
      `DELETE FROM wishlist_items WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete media items
    this.db.run('DELETE FROM media_items WHERE source_id = ?', [sourceId])

    // Delete music quality scores for albums from this source
    this.db.run(
      `DELETE FROM music_quality_scores WHERE album_id IN (
        SELECT id FROM music_albums WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete album completeness data for albums from this source
    this.db.run(
      `DELETE FROM album_completeness WHERE album_id IN (
        SELECT id FROM music_albums WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete artist completeness data for artists from this source
    this.db.run(
      `DELETE FROM artist_completeness WHERE artist_name IN (
        SELECT name FROM music_artists WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete music tracks
    this.db.run('DELETE FROM music_tracks WHERE source_id = ?', [sourceId])

    // Delete music albums
    this.db.run('DELETE FROM music_albums WHERE source_id = ?', [sourceId])

    // Delete music artists
    this.db.run('DELETE FROM music_artists WHERE source_id = ?', [sourceId])

    // Delete series completeness data for this source
    this.db.run('DELETE FROM series_completeness WHERE source_id = ?', [sourceId])

    // Delete movie collections data for this source
    this.db.run('DELETE FROM movie_collections WHERE source_id = ?', [sourceId])

    // Delete library scan timestamps
    this.db.run('DELETE FROM library_scans WHERE source_id = ?', [sourceId])

    // Delete notifications for this source
    this.db.run('DELETE FROM notifications WHERE source_id = ?', [sourceId])

    // Delete the source itself
    this.db.run('DELETE FROM media_sources WHERE source_id = ?', [sourceId])

    await this.save()
    console.log(`[Database] Deleted media source and all data: ${sourceId}`)
  }

  /**
   * Get media items count by source
   */
  getMediaItemsCountBySource(sourceId: string): number {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT COUNT(*) FROM media_items WHERE source_id = ?',
      [sourceId]
    )

    return (result[0]?.values[0]?.[0] as number) || 0
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

    const stats = {
      totalSources: 0,
      enabledSources: 0,
      totalItems: 0,
      bySource: [] as Array<{
        sourceId: string
        displayName: string
        sourceType: string
        itemCount: number
        lastScanAt?: string
      }>,
    }

    // Total sources
    let result = this.db.exec('SELECT COUNT(*) FROM media_sources')
    stats.totalSources = (result[0]?.values[0]?.[0] as number) || 0

    // Enabled sources
    result = this.db.exec('SELECT COUNT(*) FROM media_sources WHERE is_enabled = 1')
    stats.enabledSources = (result[0]?.values[0]?.[0] as number) || 0

    // Total items
    result = this.db.exec('SELECT COUNT(*) FROM media_items')
    stats.totalItems = (result[0]?.values[0]?.[0] as number) || 0

    // Items by source
    result = this.db.exec(`
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

    if (result.length && result[0].values) {
      stats.bySource = result[0].values.map(row => ({
        sourceId: row[0] as string,
        displayName: row[1] as string,
        sourceType: row[2] as string,
        itemCount: (row[3] as number) || 0,
        lastScanAt: row[4] as string | undefined,
      }))
    }

    return stats
  }

  // ============================================================================
  // SERIES COMPLETENESS
  // ============================================================================

  /**
   * Insert or update series completeness data
   */
  async upsertSeriesCompleteness(
    data: Omit<SeriesCompleteness, 'id' | 'created_at' | 'updated_at'>
  ): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    const sourceId = data.source_id || null
    const libraryId = data.library_id || null

    // Check if record exists - handle NULL values properly
    const checkSql = sourceId === null && libraryId === null
      ? `SELECT id FROM series_completeness WHERE series_title = ? AND source_id IS NULL AND library_id IS NULL`
      : sourceId === null
      ? `SELECT id FROM series_completeness WHERE series_title = ? AND source_id IS NULL AND library_id = ?`
      : libraryId === null
      ? `SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id IS NULL`
      : `SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?`

    const checkParams = sourceId === null && libraryId === null
      ? [data.series_title]
      : sourceId === null
      ? [data.series_title, libraryId]
      : libraryId === null
      ? [data.series_title, sourceId]
      : [data.series_title, sourceId, libraryId]

    const existing = this.db.exec(checkSql, checkParams)
    const existingId = existing.length > 0 && existing[0].values.length > 0
      ? existing[0].values[0][0] as number
      : null

    if (existingId !== null) {
      // Update existing record
      const updateSql = `
        UPDATE series_completeness SET
          total_seasons = ?,
          total_episodes = ?,
          owned_seasons = ?,
          owned_episodes = ?,
          missing_seasons = ?,
          missing_episodes = ?,
          completeness_percentage = ?,
          tmdb_id = ?,
          poster_url = ?,
          backdrop_url = ?,
          status = ?
        WHERE id = ?
      `
      this.db.run(updateSql, [
        data.total_seasons,
        data.total_episodes,
        data.owned_seasons,
        data.owned_episodes,
        data.missing_seasons,
        data.missing_episodes,
        data.completeness_percentage,
        data.tmdb_id || null,
        data.poster_url || null,
        data.backdrop_url || null,
        data.status || null,
        existingId,
      ])
      await this.save()
      return existingId
    } else {
      // Insert new record
      const insertSql = `
        INSERT INTO series_completeness (
          series_title, source_id, library_id, total_seasons, total_episodes, owned_seasons, owned_episodes,
          missing_seasons, missing_episodes, completeness_percentage,
          tmdb_id, poster_url, backdrop_url, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      this.db.run(insertSql, [
        data.series_title,
        sourceId,
        libraryId,
        data.total_seasons,
        data.total_episodes,
        data.owned_seasons,
        data.owned_episodes,
        data.missing_seasons,
        data.missing_episodes,
        data.completeness_percentage,
        data.tmdb_id || null,
        data.poster_url || null,
        data.backdrop_url || null,
        data.status || null,
      ])

      const result = this.db.exec('SELECT last_insert_rowid() as id')
      const id = result[0].values[0][0] as number

      await this.save()
      return id
    }
  }

  /**
   * Get all series completeness records (deduplicated by series_title)
   * Returns the entry with the best completeness for each unique series
   */
  getSeriesCompleteness(): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    // Get deduplicated series - for each series_title, return the entry with highest completeness
    const result = this.db.exec(`
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
    if (!result.length) return []

    return this.rowsToObjects<SeriesCompleteness>(result[0])
  }

  /**
   * Get all series completeness records (for skip-recently-analyzed checks)
   * @param sourceId Optional source ID to filter by
   * @param libraryId Optional library ID to filter by
   */
  getAllSeriesCompleteness(sourceId?: string, libraryId?: string): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM series_completeness WHERE 1=1'
    const params: (string | null)[] = []

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<SeriesCompleteness>(result[0])
  }

  /**
   * Get series completeness by title
   * @param seriesTitle The series title to find
   * @param sourceId Optional source ID to filter by
   * @param libraryId Optional library ID to filter by
   */
  getSeriesCompletenessByTitle(seriesTitle: string, sourceId?: string, libraryId?: string): SeriesCompleteness | null {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM series_completeness WHERE series_title = ?'
    const params: (string | null)[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return null

    const items = this.rowsToObjects<SeriesCompleteness>(result[0])
    return items[0] || null
  }

  /**
   * Get incomplete series (completeness < 100%, deduplicated by series_title)
   * Only includes series with TMDB matches since we can't determine completeness without them
   */
  getIncompleteSeries(): SeriesCompleteness[] {
    if (!this.db) throw new Error('Database not initialized')

    // Get deduplicated incomplete series with TMDB matches
    const result = this.db.exec(`
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
    if (!result.length) return []

    return this.rowsToObjects<SeriesCompleteness>(result[0])
  }

  /**
   * Delete series completeness record
   */
  async deleteSeriesCompleteness(id: number): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM series_completeness WHERE id = ?', [id])

    await this.save()
    return true
  }

  /**
   * Get all episodes for a specific series
   * @param seriesTitle The series title to find episodes for
   * @param sourceId Optional source ID to filter by
   * @param libraryId Optional library ID to filter by
   */
  getEpisodesForSeries(seriesTitle: string, sourceId?: string, libraryId?: string): MediaItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = `SELECT * FROM media_items WHERE type = 'episode' AND series_title = ?`
    const params: (string | null)[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    sql += ' ORDER BY season_number ASC, episode_number ASC'

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<MediaItem>(result[0])
  }

  /**
   * Get series completeness statistics
   *
   * Note: Same series can exist in multiple sources. We deduplicate by series_title
   * and use the best (highest) completeness percentage for each unique series.
   * Series without TMDB matches (tmdb_id IS NULL) are excluded from incomplete count
   * since we can't determine their actual completeness.
   */
  getSeriesCompletenessStats(): {
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  } {
    if (!this.db) throw new Error('Database not initialized')

    const stats = {
      totalSeries: 0,
      completeSeries: 0,
      incompleteSeries: 0,
      totalMissingEpisodes: 0,
      averageCompleteness: 0,
    }

    // Get unique series with their best completeness (highest percentage)
    // This handles duplicates across multiple sources
    let result = this.db.exec(`
      SELECT
        series_title,
        MAX(completeness_percentage) as best_completeness,
        tmdb_id
      FROM series_completeness
      GROUP BY series_title
    `)

    if (!result.length || !result[0].values) return stats

    const uniqueSeries = result[0].values

    // Count total unique series (only those with TMDB matches)
    const seriesWithTmdb = uniqueSeries.filter(row => row[2] !== null)
    stats.totalSeries = seriesWithTmdb.length

    // Complete series (100% with TMDB match)
    stats.completeSeries = seriesWithTmdb.filter(row => (row[1] as number) === 100).length

    // Incomplete series (< 100% with TMDB match)
    stats.incompleteSeries = seriesWithTmdb.filter(row => (row[1] as number) < 100).length

    // Average completeness (only series with TMDB matches)
    if (seriesWithTmdb.length > 0) {
      const totalCompleteness = seriesWithTmdb.reduce((sum, row) => sum + (row[1] as number), 0)
      stats.averageCompleteness = Math.round(totalCompleteness / seriesWithTmdb.length)
    }

    // Calculate total missing episodes
    // For each unique series, use the entry with the best completeness to get missing episodes
    // This avoids counting missing episodes from duplicate entries
    result = this.db.exec(`
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

    if (result.length && result[0].values) {
      result[0].values.forEach((row) => {
        try {
          const missing = JSON.parse(row[0] as string)
          stats.totalMissingEpisodes += Array.isArray(missing) ? missing.length : 0
        } catch {
          // Ignore parse errors
        }
      })
    }

    return stats
  }

  // ============================================================================
  // MOVIE COLLECTIONS
  // ============================================================================

  /**
   * Insert or update movie collection data
   */
  async upsertMovieCollection(
    data: Omit<MovieCollection, 'id' | 'created_at' | 'updated_at'>
  ): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    const sourceId = data.source_id || null
    const libraryId = data.library_id || null

    // Check if record exists - handle NULL values properly
    const checkSql = sourceId === null && libraryId === null
      ? `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id IS NULL AND library_id IS NULL`
      : sourceId === null
      ? `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id IS NULL AND library_id = ?`
      : libraryId === null
      ? `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id IS NULL`
      : `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id = ?`

    const checkParams = sourceId === null && libraryId === null
      ? [data.tmdb_collection_id]
      : sourceId === null
      ? [data.tmdb_collection_id, libraryId]
      : libraryId === null
      ? [data.tmdb_collection_id, sourceId]
      : [data.tmdb_collection_id, sourceId, libraryId]

    const existing = this.db.exec(checkSql, checkParams)
    const existingId = existing.length > 0 && existing[0].values.length > 0
      ? existing[0].values[0][0] as number
      : null

    if (existingId !== null) {
      // Update existing record
      const updateSql = `
        UPDATE movie_collections SET
          collection_name = ?,
          total_movies = ?,
          owned_movies = ?,
          missing_movies = ?,
          owned_movie_ids = ?,
          completeness_percentage = ?,
          poster_url = ?,
          backdrop_url = ?
        WHERE id = ?
      `
      this.db.run(updateSql, [
        data.collection_name,
        data.total_movies,
        data.owned_movies,
        data.missing_movies,
        data.owned_movie_ids,
        data.completeness_percentage,
        data.poster_url || null,
        data.backdrop_url || null,
        existingId,
      ])
      await this.save()
      return existingId
    } else {
      // Insert new record
      const insertSql = `
        INSERT INTO movie_collections (
          tmdb_collection_id, collection_name, source_id, library_id, total_movies, owned_movies,
          missing_movies, owned_movie_ids, completeness_percentage,
          poster_url, backdrop_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      this.db.run(insertSql, [
        data.tmdb_collection_id,
        data.collection_name,
        sourceId,
        libraryId,
        data.total_movies,
        data.owned_movies,
        data.missing_movies,
        data.owned_movie_ids,
        data.completeness_percentage,
        data.poster_url || null,
        data.backdrop_url || null,
      ])

      const result = this.db.exec('SELECT last_insert_rowid() as id')
      const id = result[0].values[0][0] as number

      await this.save()
      return id
    }
  }

  /**
   * Get all movie collections
   */
  getMovieCollections(): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT * FROM movie_collections ORDER BY collection_name ASC'
    )
    if (!result.length) return []

    return this.rowsToObjects<MovieCollection>(result[0])
  }

  /**
   * Get movie collection by TMDB collection ID
   */
  getMovieCollectionByTmdbId(tmdbCollectionId: string): MovieCollection | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT * FROM movie_collections WHERE tmdb_collection_id = ?',
      [tmdbCollectionId]
    )
    if (!result.length) return null

    const items = this.rowsToObjects<MovieCollection>(result[0])
    return items[0] || null
  }

  /**
   * Get incomplete movie collections (completeness < 100%)
   */
  getIncompleteMovieCollections(): MovieCollection[] {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT * FROM movie_collections WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    if (!result.length) return []

    return this.rowsToObjects<MovieCollection>(result[0])
  }

  /**
   * Delete movie collection record
   */
  async deleteMovieCollection(id: number): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM movie_collections WHERE id = ?', [id])

    await this.save()
    return true
  }

  /**
   * Clear all movie collections (for re-sync with Plex)
   */
  async clearMovieCollections(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM movie_collections')
    await this.save()
    console.log('Cleared all movie collections')
  }

  /**
   * Delete movie collections with only 1 movie (not real collections)
   */
  async deleteSingleMovieCollections(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    // Get count before deletion
    const result = this.db.exec('SELECT COUNT(*) FROM movie_collections WHERE total_movies <= 1')
    const count = (result[0]?.values[0]?.[0] as number) || 0

    if (count > 0) {
      this.db.run('DELETE FROM movie_collections WHERE total_movies <= 1')
      await this.save()
      console.log(`Deleted ${count} single-movie collections`)
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

    const stats = {
      total: 0,
      complete: 0,
      incomplete: 0,
      totalMissing: 0,
      avgCompleteness: 0,
    }

    // Total collections
    let result = this.db.exec('SELECT COUNT(*) FROM movie_collections')
    stats.total = (result[0]?.values[0]?.[0] as number) || 0

    // Complete collections
    result = this.db.exec(
      'SELECT COUNT(*) FROM movie_collections WHERE completeness_percentage = 100'
    )
    stats.complete = (result[0]?.values[0]?.[0] as number) || 0

    // Incomplete collections
    result = this.db.exec(
      'SELECT COUNT(*) FROM movie_collections WHERE completeness_percentage < 100'
    )
    stats.incomplete = (result[0]?.values[0]?.[0] as number) || 0

    // Total missing movies across all collections
    result = this.db.exec(
      'SELECT SUM(json_array_length(missing_movies)) FROM movie_collections WHERE missing_movies IS NOT NULL'
    )
    stats.totalMissing = (result[0]?.values[0]?.[0] as number) || 0

    // Average completeness
    result = this.db.exec(
      'SELECT AVG(completeness_percentage) FROM movie_collections'
    )
    stats.avgCompleteness = Math.round(
      (result[0]?.values[0]?.[0] as number) || 0
    )

    return stats
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Migrate existing plain-text credentials to encrypted format
   * This runs during database initialization to encrypt any unencrypted credentials
   */
  private async migrateCredentialsToEncrypted(): Promise<void> {
    const encryption = getCredentialEncryptionService()

    if (!encryption.isEncryptionAvailable()) {
      console.log('[DatabaseService] Skipping credential encryption migration - not available on this platform')
      return
    }

    // Check if migration was already done
    const migrationDone = this.db!.exec(`SELECT value FROM settings WHERE key = 'credentials_encrypted'`)
    if (migrationDone.length > 0 && migrationDone[0].values[0]?.[0] === '1') {
      return
    }

    console.log('[DatabaseService] Migrating existing credentials to encrypted format...')

    let sourcesEncrypted = 0
    let settingsEncrypted = 0

    // Migrate media source credentials (read raw from DB, don't go through decryption)
    const sourcesResult = this.db!.exec('SELECT source_id, connection_config FROM media_sources')
    if (sourcesResult.length > 0) {
      for (const row of sourcesResult[0].values) {
        const sourceId = row[0] as string
        const connectionConfig = row[1] as string

        try {
          const config = JSON.parse(connectionConfig)
          let needsUpdate = false

          // Check if any sensitive field is unencrypted
          const sensitiveFields = ['token', 'accessToken', 'apiKey', 'password', 'secret']
          for (const field of sensitiveFields) {
            if (typeof config[field] === 'string' && config[field] && !encryption.isEncrypted(config[field])) {
              needsUpdate = true
              break
            }
          }

          if (needsUpdate) {
            const encryptedConfig = encryption.encryptConnectionConfig(config)
            this.db!.run(
              'UPDATE media_sources SET connection_config = ? WHERE source_id = ?',
              [JSON.stringify(encryptedConfig), sourceId]
            )
            sourcesEncrypted++
          }
        } catch (error) {
          console.error(`[DatabaseService] Failed to migrate source ${sourceId}:`, error)
        }
      }
    }

    // Migrate sensitive settings (read raw from DB)
    const sensitiveSettingsKeys = ['plex_token', 'tmdb_api_key', 'musicbrainz_api_token']
    for (const key of sensitiveSettingsKeys) {
      const result = this.db!.exec('SELECT value FROM settings WHERE key = ?', [key])
      if (result.length > 0) {
        const value = result[0].values[0]?.[0] as string
        if (value && !encryption.isEncrypted(value)) {
          const encryptedValue = encryption.encrypt(value)
          this.db!.run(
            'UPDATE settings SET value = ? WHERE key = ?',
            [encryptedValue, key]
          )
          settingsEncrypted++
        }
      }
    }

    // Mark migration as complete
    this.db!.run(
      `INSERT INTO settings (key, value) VALUES ('credentials_encrypted', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`
    )

    if (sourcesEncrypted > 0 || settingsEncrypted > 0) {
      await this.forceSave()
      console.log(`[DatabaseService] Credential migration complete: ${sourcesEncrypted} sources, ${settingsEncrypted} settings encrypted`)
    } else {
      console.log('[DatabaseService] No credentials needed migration')
    }
  }

  /**
   * Convert SQL.js result rows to objects
   */
  private rowsToObjects<T>(result: { columns: string[]; values: unknown[][] }): T[] {
    const { columns, values } = result
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col, index) => {
        obj[col] = row[index]
      })
      return obj as T
    })
  }

  // ============================================================================
  // MUSIC OPERATIONS (Delegated to MusicRepository)
  // ============================================================================

  /** Insert or update a music artist */
  async upsertMusicArtist(artist: MusicArtist): Promise<number> {
    return this.musicRepo.upsertArtist(artist)
  }

  /** Insert or update a music album */
  async upsertMusicAlbum(album: MusicAlbum): Promise<number> {
    return this.musicRepo.upsertAlbum(album)
  }

  /** Update artwork URLs for a music album */
  async updateMusicAlbumArtwork(
    sourceIdOrAlbumId: string | number,
    providerIdOrThumbUrl?: string,
    artwork?: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    return this.musicRepo.updateAlbumArtwork(sourceIdOrAlbumId, providerIdOrThumbUrl, artwork)
  }

  /** Update artwork URL for a music artist */
  async updateMusicArtistArtwork(
    sourceId: string,
    providerId: string,
    artwork: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    return this.musicRepo.updateArtistArtwork(sourceId, providerId, artwork)
  }

  /** Insert or update a music track */
  async upsertMusicTrack(track: MusicTrack): Promise<number> {
    return this.musicRepo.upsertTrack(track)
  }

  /** Update artist album and track counts */
  async updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): Promise<void> {
    return this.musicRepo.updateArtistCounts(artistId, albumCount, trackCount)
  }

  /** Update artist MusicBrainz ID */
  async updateMusicArtistMbid(artistId: number, musicbrainzId: string): Promise<void> {
    return this.musicRepo.updateArtistMbid(artistId, musicbrainzId)
  }

  /** Update album MusicBrainz ID */
  async updateMusicAlbumMbid(albumId: number, musicbrainzId: string): Promise<void> {
    return this.musicRepo.updateAlbumMbid(albumId, musicbrainzId)
  }

  /** Get all music artists */
  getMusicArtists(filters?: MusicFilters): MusicArtist[] {
    return this.musicRepo.getArtists(filters)
  }

  /** Get a music artist by ID */
  getMusicArtistById(id: number): MusicArtist | null {
    return this.musicRepo.getArtistById(id)
  }

  /** Get a music artist by name and source */
  getMusicArtistByName(name: string, sourceId: string): MusicArtist | null {
    return this.musicRepo.getArtistByName(name, sourceId)
  }

  /** Get all music albums */
  getMusicAlbums(filters?: MusicFilters): MusicAlbum[] {
    return this.musicRepo.getAlbums(filters)
  }

  /** Get a music album by title and artist ID */
  getMusicAlbumByName(title: string, artistId: number): MusicAlbum | null {
    return this.musicRepo.getAlbumByName(title, artistId)
  }

  /** Get music albums by artist name */
  getMusicAlbumsByArtistName(artistName: string): MusicAlbum[] {
    return this.musicRepo.getAlbumsByArtistName(artistName)
  }

  /** Get a music album by ID */
  getMusicAlbumById(id: number): MusicAlbum | null {
    return this.musicRepo.getAlbumById(id)
  }

  /** Get all music tracks */
  getMusicTracks(filters?: MusicFilters): MusicTrack[] {
    return this.musicRepo.getTracks(filters)
  }

  /** Get a music track by ID */
  getMusicTrackById(id: number): MusicTrack | null {
    return this.musicRepo.getTrackById(id)
  }

  /** Get a music track by file path */
  getMusicTrackByPath(filePath: string): MusicTrack | null {
    return this.musicRepo.getTrackByPath(filePath)
  }

  /** Delete a music track by ID */
  async deleteMusicTrack(id: number): Promise<void> {
    return this.musicRepo.deleteTrack(id)
  }

  /** Get music library stats */
  getMusicStats(sourceId?: string): {
    totalArtists: number
    totalAlbums: number
    totalTracks: number
    losslessAlbums: number
    hiResAlbums: number
    avgBitrate: number
  } {
    return this.musicRepo.getStats(sourceId)
  }

  /** Insert or update music quality score for an album */
  async upsertMusicQualityScore(score: MusicQualityScore): Promise<void> {
    return this.musicRepo.upsertQualityScore(score)
  }

  /** Get music quality score for an album */
  getMusicQualityScore(albumId: number): MusicQualityScore | null {
    return this.musicRepo.getQualityScore(albumId)
  }

  /** Insert or update artist completeness data */
  async upsertArtistCompleteness(data: ArtistCompleteness): Promise<void> {
    return this.musicRepo.upsertArtistCompleteness(data)
  }

  /** Get artist completeness by name */
  getArtistCompleteness(artistName: string): ArtistCompleteness | null {
    return this.musicRepo.getArtistCompleteness(artistName)
  }

  /** Get all artist completeness records */
  getAllArtistCompleteness(): ArtistCompleteness[] {
    return this.musicRepo.getAllArtistCompleteness()
  }

  /** Upsert album completeness data */
  async upsertAlbumCompleteness(data: AlbumCompleteness): Promise<void> {
    return this.musicRepo.upsertAlbumCompleteness(data)
  }

  /** Get album completeness by album ID */
  getAlbumCompleteness(albumId: number): AlbumCompleteness | null {
    return this.musicRepo.getAlbumCompleteness(albumId)
  }

  /** Get all album completeness records */
  getAllAlbumCompleteness(): AlbumCompleteness[] {
    return this.musicRepo.getAllAlbumCompleteness()
  }

  /** Get album completeness records for a specific artist */
  getAlbumCompletenessByArtist(artistName: string): AlbumCompleteness[] {
    return this.musicRepo.getAlbumCompletenessByArtist(artistName)
  }

  /** Get incomplete albums (albums with missing tracks) */
  getIncompleteAlbums(): AlbumCompleteness[] {
    return this.musicRepo.getIncompleteAlbums()
  }

  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  /**
   * Add an item to the wishlist
   */
  async addWishlistItem(item: Partial<WishlistItem>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    // Use INSERT OR IGNORE to silently skip duplicates (unique constraints handle detection)
    const sql = `
      INSERT OR IGNORE INTO wishlist_items (
        media_type, title, subtitle, year, reason,
        tmdb_id, imdb_id, musicbrainz_id,
        series_title, season_number, episode_number, collection_name,
        artist_name, album_title,
        poster_url, priority, notes,
        current_quality_tier, current_quality_level, current_resolution,
        current_video_codec, current_audio_codec, media_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    this.db.run(sql, [
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
      item.current_quality_tier || null,
      item.current_quality_level || null,
      item.current_resolution || null,
      item.current_video_codec || null,
      item.current_audio_codec || null,
      item.media_item_id || null,
    ])

    // Check if a row was actually inserted (0 = duplicate was ignored)
    const changes = this.db.getRowsModified()
    if (changes === 0) {
      // Item already exists - find and return the existing ID
      const existing = this.findExistingWishlistItem(item)
      if (existing) return existing
      // If we can't find it, something went wrong
      throw new Error('Item was not inserted and could not find existing item')
    }

    await this.save()

    // Get the inserted ID
    const result = this.db.exec('SELECT last_insert_rowid() as id')
    return result[0]?.values[0]?.[0] as number
  }

  /**
   * Find an existing wishlist item by its unique identifiers
   */
  private findExistingWishlistItem(item: Partial<WishlistItem>): number | null {
    if (!this.db) return null

    // Try to find by tmdb_id + reason
    if (item.tmdb_id && item.reason) {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE tmdb_id = ? AND reason = ? LIMIT 1',
        [item.tmdb_id, item.reason]
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    // Try to find by musicbrainz_id + reason
    if (item.musicbrainz_id && item.reason) {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE musicbrainz_id = ? AND reason = ? LIMIT 1',
        [item.musicbrainz_id, item.reason]
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    // Try to find by media_item_id (for upgrades)
    if (item.media_item_id && item.reason === 'upgrade') {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE media_item_id = ? AND reason = ? LIMIT 1',
        [item.media_item_id, 'upgrade']
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    // Try to find by series_title + season_number (for seasons without tmdb_id)
    if (item.media_type === 'season' && item.series_title && item.season_number !== undefined && item.reason) {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE series_title = ? AND season_number = ? AND reason = ? AND media_type = ? LIMIT 1',
        [item.series_title, item.season_number, item.reason, 'season']
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    return null
  }

  /**
   * Update a wishlist item
   */
  async updateWishlistItem(id: number, updates: Partial<WishlistItem>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const fields: string[] = []
    const values: (string | number | null)[] = []

    if (updates.priority !== undefined) {
      fields.push('priority = ?')
      values.push(updates.priority)
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?')
      values.push(updates.notes)
    }
    if (updates.poster_url !== undefined) {
      fields.push('poster_url = ?')
      values.push(updates.poster_url)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
      // Auto-set completed_at when marking as completed
      if (updates.status === 'completed') {
        fields.push('completed_at = ?')
        values.push(new Date().toISOString())
      } else if (updates.status === 'active') {
        // Clear completed_at when reverting to active
        fields.push('completed_at = ?')
        values.push(null)
      }
    }

    if (fields.length === 0) return

    values.push(id)
    const sql = `UPDATE wishlist_items SET ${fields.join(', ')} WHERE id = ?`
    this.db.run(sql, values)
    await this.save()
  }

  /**
   * Remove an item from the wishlist
   */
  async removeWishlistItem(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM wishlist_items WHERE id = ?', [id])
    await this.save()
  }

  /**
   * Get all wishlist items with optional filters
   */
  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM wishlist_items WHERE 1=1'
    const params: (string | number)[] = []

    if (filters?.media_type) {
      // Handle combined media types for TV (episode + season)
      if (filters.media_type === 'episode') {
        sql += ' AND media_type IN (?, ?)'
        params.push('episode', 'season')
      } else {
        sql += ' AND media_type = ?'
        params.push(filters.media_type)
      }
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
      const searchTerm = `%${filters.searchQuery}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }
    if (filters?.series_title) {
      sql += ' AND series_title = ?'
      params.push(filters.series_title)
    }
    if (filters?.artist_name) {
      sql += ' AND artist_name = ?'
      params.push(filters.artist_name)
    }

    // Sorting
    const sortBy = filters?.sortBy || 'priority'
    const sortOrder = filters?.sortOrder || (sortBy === 'priority' ? 'desc' : 'asc')
    sql += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`

    // Add secondary sort by added_at for consistency
    if (sortBy !== 'added_at') {
      sql += ', added_at DESC'
    }

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters?.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<WishlistItem>(result[0])
  }

  /**
   * Get a single wishlist item by ID
   */
  getWishlistItemById(id: number): WishlistItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT * FROM wishlist_items WHERE id = ?', [id])
    if (!result.length || !result[0].values.length) return null

    return this.rowsToObjects<WishlistItem>(result[0])[0]
  }

  /**
   * Get the total count of wishlist items
   */
  getWishlistCount(): number {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec('SELECT COUNT(*) as count FROM wishlist_items')
    return (result[0]?.values[0]?.[0] as number) || 0
  }

  /**
   * Check if an item already exists in the wishlist
   */
  wishlistItemExists(tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): boolean {
    if (!this.db) throw new Error('Database not initialized')

    if (tmdbId) {
      const result = this.db.exec('SELECT 1 FROM wishlist_items WHERE tmdb_id = ? LIMIT 1', [tmdbId])
      if (result.length && result[0].values.length) return true
    }

    if (musicbrainzId) {
      const result = this.db.exec('SELECT 1 FROM wishlist_items WHERE musicbrainz_id = ? LIMIT 1', [musicbrainzId])
      if (result.length && result[0].values.length) return true
    }

    if (mediaItemId) {
      const result = this.db.exec('SELECT 1 FROM wishlist_items WHERE media_item_id = ? LIMIT 1', [mediaItemId])
      if (result.length && result[0].values.length) return true
    }

    return false
  }

  /**
   * Get wishlist counts by reason
   */
  getWishlistCountsByReason(): { missing: number; upgrade: number; active: number; completed: number; total: number } {
    if (!this.db) throw new Error('Database not initialized')

    // Get counts by reason
    const reasonResult = this.db.exec(`
      SELECT reason, COUNT(*) as count FROM wishlist_items GROUP BY reason
    `)

    let missing = 0
    let upgrade = 0

    if (reasonResult.length && reasonResult[0].values.length) {
      for (const row of reasonResult[0].values) {
        if (row[0] === 'missing') missing = row[1] as number
        if (row[0] === 'upgrade') upgrade = row[1] as number
      }
    }

    // Get counts by status
    const statusResult = this.db.exec(`
      SELECT COALESCE(status, 'active') as status, COUNT(*) as count FROM wishlist_items GROUP BY status
    `)

    let active = 0
    let completed = 0

    if (statusResult.length && statusResult[0].values.length) {
      for (const row of statusResult[0].values) {
        if (row[0] === 'active' || row[0] === null) active += row[1] as number
        if (row[0] === 'completed') completed = row[1] as number
      }
    }

    return { missing, upgrade, active, completed, total: missing + upgrade }
  }

  /**
   * Add multiple items to the wishlist (bulk operation)
   */
  async addWishlistItemsBulk(items: Partial<WishlistItem>[]): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')
    if (items.length === 0) return 0

    this.startBatch()
    let added = 0

    for (const item of items) {
      // Skip if already exists
      if (item.tmdb_id && this.wishlistItemExists(item.tmdb_id)) continue
      if (item.musicbrainz_id && this.wishlistItemExists(undefined, item.musicbrainz_id)) continue

      const sql = `
        INSERT INTO wishlist_items (
          media_type, title, subtitle, year,
          tmdb_id, imdb_id, musicbrainz_id,
          series_title, season_number, episode_number, collection_name,
          artist_name, album_title,
          poster_url, priority, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `

      this.db.run(sql, [
        item.media_type || 'movie',
        item.title || '',
        item.subtitle || null,
        item.year || null,
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
      ])
      added++
    }

    await this.endBatch()
    return added
  }

  /**
   * Execute a raw SQL query (for advanced use)
   */
  async executeRaw(sql: string, params: (string | number | null)[] = []): Promise<unknown[][]> {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(sql, params)
    await this.save()

    return result.length ? result[0].values : []
  }

  // =====================================================================
  // NOTIFICATION METHODS
  // =====================================================================

  /**
   * Create a new notification
   */
  async createNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        notification.type,
        notification.title,
        notification.message,
        notification.sourceId || null,
        notification.sourceName || null,
        notification.itemCount || 0,
        notification.metadata ? JSON.stringify(notification.metadata) : '{}',
      ]
    )

    // Get the last inserted ID
    const result = this.db.exec('SELECT last_insert_rowid()')
    const id = result[0]?.values[0]?.[0] as number

    await this.save()
    return id
  }

  /**
   * Create multiple notifications in batch
   */
  async createNotifications(notifications: Array<Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>>): Promise<number[]> {
    if (!this.db) throw new Error('Database not initialized')

    const ids: number[] = []
    this.startBatch()

    for (const notification of notifications) {
      this.db.run(
        `INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          notification.type,
          notification.title,
          notification.message,
          notification.sourceId || null,
          notification.sourceName || null,
          notification.itemCount || 0,
          notification.metadata ? JSON.stringify(notification.metadata) : '{}',
        ]
      )

      const result = this.db.exec('SELECT last_insert_rowid()')
      ids.push(result[0]?.values[0]?.[0] as number)
    }

    await this.endBatch()
    return ids
  }

  /**
   * Get notifications with optional filtering
   */
  getNotifications(options: GetNotificationsOptions = {}): Notification[] {
    if (!this.db) throw new Error('Database not initialized')

    const { limit = 100, offset = 0, type, unreadOnly = false } = options

    let sql = 'SELECT * FROM notifications WHERE 1=1'
    const params: (string | number)[] = []

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    if (unreadOnly) {
      sql += ' AND is_read = 0'
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = this.db.exec(sql, params)
    if (!result[0]) return []

    return result[0].values.map(row => this.rowToNotification(row, result[0].columns))
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

    const totalResult = this.db.exec('SELECT COUNT(*) FROM notifications')
    const unreadResult = this.db.exec('SELECT COUNT(*) FROM notifications WHERE is_read = 0')

    return {
      total: (totalResult[0]?.values[0]?.[0] as number) || 0,
      unread: (unreadResult[0]?.values[0]?.[0] as number) || 0,
    }
  }

  /**
   * Mark notification(s) as read
   */
  async markNotificationsRead(ids: number[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.run(
      `UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`,
      ids
    )

    await this.save()
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('UPDATE notifications SET is_read = 1 WHERE is_read = 0')
    await this.save()
  }

  /**
   * Delete notification(s)
   */
  async deleteNotifications(ids: number[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.run(
      `DELETE FROM notifications WHERE id IN (${placeholders})`,
      ids
    )

    await this.save()
  }

  /**
   * Clear all notifications
   */
  async clearAllNotifications(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM notifications')
    await this.save()
  }

  /**
   * Prune old notifications to keep only the most recent N
   */
  async pruneNotifications(maxCount: number): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    // Get count of notifications to delete
    const countResult = this.db.exec('SELECT COUNT(*) FROM notifications')
    const totalCount = (countResult[0]?.values[0]?.[0] as number) || 0

    if (totalCount <= maxCount) return 0

    const deleteCount = totalCount - maxCount

    // Delete oldest notifications
    this.db.run(
      `DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications ORDER BY created_at ASC LIMIT ?
      )`,
      [deleteCount]
    )

    await this.save()
    return deleteCount
  }

  /**
   * Convert database row to Notification object
   */
  private rowToNotification(row: unknown[], columns: string[]): Notification {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })

    const dbRow = obj as unknown as NotificationRow

    return {
      id: dbRow.id,
      type: dbRow.type as NotificationType,
      title: dbRow.title,
      message: dbRow.message,
      sourceId: dbRow.source_id || undefined,
      sourceName: dbRow.source_name || undefined,
      itemCount: dbRow.item_count,
      metadata: dbRow.metadata ? JSON.parse(dbRow.metadata) : undefined,
      isRead: dbRow.is_read === 1,
      createdAt: dbRow.created_at,
      readAt: dbRow.read_at || undefined,
    }
  }
}

// Export singleton instance
let dbInstance: DatabaseService | null = null

export function getDatabaseService(): DatabaseService {
  if (!dbInstance) {
    dbInstance = new DatabaseService()
  }
  return dbInstance
}
