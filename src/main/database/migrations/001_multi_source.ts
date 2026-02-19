/**
 * Migration 001: Multi-Source Support
 *
 * This migration:
 * 1. Creates the media_sources table if it doesn't exist
 * 2. Adds source_id and source_type columns to media_items (if not present)
 * 3. Creates a legacy source from existing Plex settings
 * 4. Updates existing media items to reference the legacy source
 * 5. Creates new composite unique index
 */

import type { Database } from 'sql.js'

export const MIGRATION_VERSION = 1
export const MIGRATION_NAME = 'multi_source'

/**
 * Check if a column exists in a table
 */
function columnExists(db: Database, table: string, column: string): boolean {
  const result = db.exec(`PRAGMA table_info(${table})`)
  if (result.length === 0) return false

  const columns = result[0].values
  return columns.some((row) => row[1] === column)
}

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
 * Run the migration
 */
export async function runMigration(db: Database): Promise<void> {
  console.log('[Migration 001] Starting multi-source migration...')

  // 1. Create media_sources table if not exists
  if (!tableExists(db, 'media_sources')) {
    console.log('[Migration 001] Creating media_sources table...')
    db.run(`
      CREATE TABLE media_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'kodi-mysql', 'local')),
        display_name TEXT NOT NULL,
        connection_config TEXT NOT NULL DEFAULT '{}',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        last_connected_at TEXT,
        last_scan_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_media_sources_type ON media_sources(source_type)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_media_sources_enabled ON media_sources(is_enabled)`)

    db.run(`
      CREATE TRIGGER IF NOT EXISTS update_media_sources_timestamp
      AFTER UPDATE ON media_sources
      BEGIN
        UPDATE media_sources SET updated_at = datetime('now') WHERE id = NEW.id;
      END
    `)
  }

  // 2. Add source_id column to media_items if not exists
  if (!columnExists(db, 'media_items', 'source_id')) {
    console.log('[Migration 001] Adding source_id column to media_items...')
    db.run(`ALTER TABLE media_items ADD COLUMN source_id TEXT NOT NULL DEFAULT 'legacy'`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source_id)`)
  }

  // 3. Add source_type column to media_items if not exists
  if (!columnExists(db, 'media_items', 'source_type')) {
    console.log('[Migration 001] Adding source_type column to media_items...')
    db.run(`ALTER TABLE media_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'plex'`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_source_type ON media_items(source_type)`)
  }

  // 4. Create composite unique index (drop old one first if exists)
  console.log('[Migration 001] Creating composite unique index...')
  try {
    db.run(`DROP INDEX IF EXISTS idx_media_items_plex_id`)
  } catch {
    // Index may not exist, ignore
  }
  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_source_provider_id ON media_items(source_id, plex_id)`)
  } catch (error) {
    // Index may already exist or have conflicts
    console.warn('[Migration 001] Could not create composite index:', error)
  }

  // 5. Create legacy source from existing Plex settings if there's data
  const existingItems = db.exec(`SELECT COUNT(*) FROM media_items`)
  const itemCount = existingItems[0]?.values[0]?.[0] as number || 0

  if (itemCount > 0) {
    // Check if legacy source already exists
    const legacyExists = db.exec(`SELECT COUNT(*) FROM media_sources WHERE source_id = 'legacy'`)
    const legacyCount = legacyExists[0]?.values[0]?.[0] as number || 0

    if (legacyCount === 0) {
      console.log('[Migration 001] Creating legacy source for existing data...')

      // Get existing Plex settings
      const tokenResult = db.exec(`SELECT value FROM settings WHERE key = 'plex_token'`)
      const serverUrlResult = db.exec(`SELECT value FROM settings WHERE key = 'plex_server_url'`)
      const serverIdResult = db.exec(`SELECT value FROM settings WHERE key = 'plex_server_id'`)

      const token = tokenResult[0]?.values[0]?.[0] as string || ''
      const serverUrl = serverUrlResult[0]?.values[0]?.[0] as string || ''
      const serverId = serverIdResult[0]?.values[0]?.[0] as string || ''

      // Build connection config JSON
      const connectionConfig = JSON.stringify({
        token,
        serverUrl,
        serverId,
      })

      // Get last scan time for last_scan_at
      const lastScanResult = db.exec(`SELECT value FROM settings WHERE key = 'last_scan_time'`)
      const lastScanTime = lastScanResult[0]?.values[0]?.[0] as string || null

      // Insert legacy source
      const stmt = db.prepare(`
        INSERT INTO media_sources (source_id, source_type, display_name, connection_config, is_enabled, last_scan_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      stmt.run(['legacy', 'plex', 'Legacy Plex Server', connectionConfig, 1, lastScanTime])
      stmt.free()

      console.log(`[Migration 001] Created legacy source for ${itemCount} existing items`)
    }

    // Update all existing items to use legacy source (in case they have empty source_id)
    db.run(`UPDATE media_items SET source_id = 'legacy', source_type = 'plex' WHERE source_id = '' OR source_id IS NULL`)
  }

  // 6. Store migration version in settings
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_version', '${MIGRATION_VERSION}')`)

  console.log('[Migration 001] Multi-source migration completed successfully')
}

/**
 * Rollback the migration (for development/testing)
 */
export async function rollbackMigration(db: Database): Promise<void> {
  console.log('[Migration 001] Rolling back multi-source migration...')

  // Note: SQLite doesn't support DROP COLUMN, so we can only:
  // 1. Drop the indexes
  // 2. Drop the media_sources table
  // The columns will remain but with default values

  try {
    db.run(`DROP INDEX IF EXISTS idx_media_items_source`)
    db.run(`DROP INDEX IF EXISTS idx_media_items_source_type`)
    db.run(`DROP INDEX IF EXISTS idx_media_items_source_provider_id`)
    db.run(`DROP TABLE IF EXISTS media_sources`)
    db.run(`DELETE FROM settings WHERE key = 'migration_version'`)
  } catch (error) {
    console.error('[Migration 001] Rollback error:', error)
  }

  console.log('[Migration 001] Rollback completed')
}
