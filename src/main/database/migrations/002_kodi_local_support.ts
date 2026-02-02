/**
 * Migration 002: Kodi Local Support
 *
 * This migration updates CHECK constraints on tables to include 'kodi-local' as a valid source_type.
 * SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the tables.
 */

import type { Database } from 'sql.js'

export const MIGRATION_VERSION = 2
export const MIGRATION_NAME = 'kodi_local_support'

/**
 * Check if a table exists
 */
function tableExists(db: Database, table: string): boolean {
  const result = db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
  )
  return result.length > 0 && result[0].values.length > 0
}

/**
 * Check if the table needs migration (has old CHECK constraint)
 */
function needsConstraintUpdate(db: Database, table: string): boolean {
  const result = db.exec(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`
  )
  if (result.length === 0 || result[0].values.length === 0) return false

  const createSQL = result[0].values[0][0] as string
  // If it has the old constraint without kodi-local, it needs update
  return createSQL.includes("'plex', 'jellyfin', 'emby', 'kodi')") &&
         !createSQL.includes("'kodi-local'")
}

/**
 * Run the migration
 */
export async function runMigration(db: Database): Promise<void> {
  console.log('[Migration 002] Starting kodi-local support migration...')

  // 1. Update media_sources table
  if (tableExists(db, 'media_sources') && needsConstraintUpdate(db, 'media_sources')) {
    console.log('[Migration 002] Recreating media_sources table with updated CHECK constraint...')

    // Create temp table with new constraint
    db.run(`
      CREATE TABLE media_sources_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local')),
        display_name TEXT NOT NULL,
        connection_config TEXT NOT NULL DEFAULT '{}',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        last_connected_at TEXT,
        last_scan_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    // Copy data
    db.run(`
      INSERT INTO media_sources_new (id, source_id, source_type, display_name, connection_config, is_enabled, last_connected_at, last_scan_at, created_at, updated_at)
      SELECT id, source_id, source_type, display_name, connection_config, is_enabled, last_connected_at, last_scan_at, created_at, updated_at
      FROM media_sources
    `)

    // Drop old table and rename new one
    db.run(`DROP TABLE media_sources`)
    db.run(`ALTER TABLE media_sources_new RENAME TO media_sources`)

    // Recreate indexes
    db.run(`CREATE INDEX IF NOT EXISTS idx_media_sources_type ON media_sources(source_type)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_media_sources_enabled ON media_sources(is_enabled)`)

    // Recreate trigger
    db.run(`
      CREATE TRIGGER IF NOT EXISTS update_media_sources_timestamp
      AFTER UPDATE ON media_sources
      BEGIN
        UPDATE media_sources SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)

    console.log('[Migration 002] media_sources table updated')
  }

  // 2. Update media_items table
  if (tableExists(db, 'media_items') && needsConstraintUpdate(db, 'media_items')) {
    console.log('[Migration 002] Recreating media_items table with updated CHECK constraint...')

    // Get current table schema to preserve all columns
    const schemaResult = db.exec(`PRAGMA table_info(media_items)`)
    if (schemaResult.length > 0) {
      const columns = schemaResult[0].values.map(row => row[1] as string)
      const columnList = columns.join(', ')

      // Create temp table
      db.run(`
        CREATE TABLE media_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL DEFAULT 'legacy',
          source_type TEXT NOT NULL DEFAULT 'plex' CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local')),
          library_id TEXT,
          plex_id TEXT NOT NULL,
          title TEXT NOT NULL,
          year INTEGER,
          type TEXT NOT NULL CHECK(type IN ('movie', 'episode')),
          series_title TEXT,
          season_number INTEGER,
          episode_number INTEGER,
          file_path TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          duration INTEGER NOT NULL,
          resolution TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          video_codec TEXT NOT NULL,
          video_bitrate INTEGER NOT NULL,
          audio_codec TEXT NOT NULL,
          audio_channels INTEGER NOT NULL,
          audio_bitrate INTEGER NOT NULL,
          video_frame_rate REAL,
          color_bit_depth INTEGER,
          hdr_format TEXT,
          color_space TEXT,
          video_profile TEXT,
          video_level INTEGER,
          audio_profile TEXT,
          audio_sample_rate INTEGER,
          has_object_audio INTEGER DEFAULT 0,
          audio_tracks TEXT,
          container TEXT,
          imdb_id TEXT,
          tmdb_id TEXT,
          series_tmdb_id TEXT,
          poster_url TEXT,
          episode_thumb_url TEXT,
          season_poster_url TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)

      // Copy data (only columns that exist)
      db.run(`
        INSERT INTO media_items_new (${columnList})
        SELECT ${columnList} FROM media_items
      `)

      // Drop old table and rename
      db.run(`DROP TABLE media_items`)
      db.run(`ALTER TABLE media_items_new RENAME TO media_items`)

      // Recreate indexes
      db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type)`)
      db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source_id)`)
      db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_source_type ON media_items(source_type)`)
      db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_library ON media_items(source_id, library_id)`)
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_source_provider_id ON media_items(source_id, plex_id)`)
      db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_series ON media_items(series_title) WHERE type = 'episode'`)
      db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_type_series ON media_items(type, series_title) WHERE type = 'episode'`)

      // Recreate trigger
      db.run(`
        CREATE TRIGGER IF NOT EXISTS update_media_items_timestamp
        AFTER UPDATE ON media_items
        BEGIN
          UPDATE media_items SET updated_at = datetime('now') WHERE id = NEW.id;
        END
      `)

      console.log('[Migration 002] media_items table updated')
    }
  }

  // 3. Update music tables (music_artists, music_albums, music_tracks)
  const musicTables = [
    { name: 'music_artists', idColumn: 'id', fkConstraint: '' },
    { name: 'music_albums', idColumn: 'id', fkConstraint: 'FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE SET NULL' },
    { name: 'music_tracks', idColumn: 'id', fkConstraint: 'FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL, FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE SET NULL' },
  ]

  for (const table of musicTables) {
    if (tableExists(db, table.name) && needsConstraintUpdate(db, table.name)) {
      console.log(`[Migration 002] Updating ${table.name} table...`)

      // Get all columns
      const schemaResult = db.exec(`PRAGMA table_info(${table.name})`)
      if (schemaResult.length > 0) {
        const columns = schemaResult[0].values.map(row => row[1] as string)
        const columnList = columns.join(', ')

        // Get the original CREATE TABLE statement
        const createResult = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table.name}'`)
        if (createResult.length > 0) {
          let createSQL = createResult[0].values[0][0] as string

          // Update the CHECK constraint
          createSQL = createSQL.replace(
            /CHECK\(source_type IN \('plex', 'jellyfin', 'emby', 'kodi'\)\)/g,
            "CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local'))"
          )

          // Rename to _new
          createSQL = createSQL.replace(`CREATE TABLE ${table.name}`, `CREATE TABLE ${table.name}_new`)

          // Create new table
          db.run(createSQL)

          // Copy data
          db.run(`INSERT INTO ${table.name}_new (${columnList}) SELECT ${columnList} FROM ${table.name}`)

          // Drop old and rename
          db.run(`DROP TABLE ${table.name}`)
          db.run(`ALTER TABLE ${table.name}_new RENAME TO ${table.name}`)

          console.log(`[Migration 002] ${table.name} table updated`)
        }
      }
    }
  }

  // 4. Store migration version in settings
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_version', '${MIGRATION_VERSION}')`)

  console.log('[Migration 002] Kodi local support migration completed successfully')
}

/**
 * Rollback the migration (not easily possible for constraint changes)
 */
export async function rollbackMigration(db: Database): Promise<void> {
  console.log('[Migration 002] Rollback not supported for this migration')
  void db // Suppress unused warning
}
