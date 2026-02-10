/**
 * Database Migration Utility
 *
 * Handles migration from SQL.js to better-sqlite3.
 * This module provides functions to:
 * 1. Export data from SQL.js database
 * 2. Import data into better-sqlite3 database
 * 3. Verify migration integrity
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

interface MigrationResult {
  success: boolean
  tablesExported: number
  rowsExported: number
  rowsImported: number
  errors: string[]
  backupPath?: string
}

/**
 * Check if migration from SQL.js to better-sqlite3 is needed
 */
export function needsMigration(): boolean {
  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')

  // Migration needed if SQL.js db exists but better-sqlite3 doesn't
  const sqlJsExists = fs.existsSync(sqlJsDbPath)
  const betterSqliteExists = fs.existsSync(betterSqliteDbPath)

  return sqlJsExists && !betterSqliteExists
}

/**
 * Check if we should use better-sqlite3 (either migrated or fresh install)
 */
export function shouldUseBetterSqlite(): boolean {
  // Check environment variable first
  if (process.env.USE_BETTER_SQLITE3 === 'true') {
    return true
  }

  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')

  // Use better-sqlite3 if:
  // 1. Its database already exists (already migrated or fresh install with v2)
  // 2. No SQL.js database exists (fresh install)
  const sqlJsExists = fs.existsSync(sqlJsDbPath)
  const betterSqliteExists = fs.existsSync(betterSqliteDbPath)

  if (betterSqliteExists) {
    return true
  }

  if (!sqlJsExists) {
    // Fresh install - use better-sqlite3
    return true
  }

  // SQL.js exists but better-sqlite3 doesn't - need migration first
  return false
}

/**
 * Migrate data from SQL.js to better-sqlite3
 */
export async function migrateDatabase(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    tablesExported: 0,
    rowsExported: 0,
    rowsImported: 0,
    errors: [],
  }

  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')
  const backupPath = path.join(userDataPath, 'totality.db.backup')

  try {
    console.log('[Migration] Starting database migration from SQL.js to better-sqlite3...')

    // Step 1: Load SQL.js database and export data
    console.log('[Migration] Loading SQL.js database...')
    const { getDatabaseService } = await import('../services/DatabaseService')
    const sqlJsDb = getDatabaseService()
    await sqlJsDb.initialize()

    // Export all data
    console.log('[Migration] Exporting data from SQL.js...')
    const exportedData = sqlJsDb.exportData()

    // Count exported rows
    for (const [table, rows] of Object.entries(exportedData)) {
      if (table !== '_meta' && Array.isArray(rows)) {
        result.tablesExported++
        result.rowsExported += rows.length
      }
    }
    console.log(`[Migration] Exported ${result.rowsExported} rows from ${result.tablesExported} tables`)

    // Close SQL.js database
    await sqlJsDb.close()

    // Step 2: Initialize better-sqlite3 database
    console.log('[Migration] Initializing better-sqlite3 database...')
    const { getBetterSQLiteService } = await import('./BetterSQLiteService')
    const betterDb = getBetterSQLiteService()
    betterDb.initialize()

    // Step 3: Import data into better-sqlite3
    console.log('[Migration] Importing data into better-sqlite3...')
    const importResult = betterDb.importData(exportedData)
    result.rowsImported = importResult.imported
    result.errors.push(...importResult.errors)

    console.log(`[Migration] Imported ${result.rowsImported} rows`)

    if (importResult.errors.length > 0) {
      console.warn('[Migration] Import errors:', importResult.errors)
    }

    // Step 4: Verify migration
    console.log('[Migration] Verifying migration...')
    const verification = verifyMigration(exportedData, betterDb)
    if (!verification.success) {
      result.errors.push(...verification.errors)
      throw new Error('Migration verification failed')
    }

    // Step 5: Create backup of SQL.js database
    console.log('[Migration] Creating backup of SQL.js database...')
    fs.copyFileSync(sqlJsDbPath, backupPath)
    result.backupPath = backupPath
    console.log(`[Migration] Backup created at: ${path.basename(backupPath)}`)

    result.success = true
    console.log('[Migration] Database migration completed successfully!')

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(`Migration failed: ${message}`)
    console.error('[Migration] Migration failed:', error)

    // Clean up failed migration
    if (fs.existsSync(betterSqliteDbPath)) {
      try {
        fs.unlinkSync(betterSqliteDbPath)
        console.log('[Migration] Cleaned up partial migration')
      } catch {
        console.error('[Migration] Failed to clean up partial migration')
      }
    }
  }

  return result
}

/**
 * Verify that migration was successful by comparing row counts
 */
function verifyMigration(
  exportedData: Record<string, unknown[]>,
  betterDb: { getMediaItems: () => unknown[]; getMediaSources: () => unknown[]; getAllSettings: () => Record<string, string> }
): { success: boolean; errors: string[] } {
  const errors: string[] = []

  try {
    // Check media items count
    const exportedItems = (exportedData['media_items'] as unknown[])?.length || 0
    const importedItems = betterDb.getMediaItems().length

    if (exportedItems !== importedItems) {
      errors.push(`Media items mismatch: exported ${exportedItems}, imported ${importedItems}`)
    }

    // Check media sources count
    const exportedSources = (exportedData['media_sources'] as unknown[])?.length || 0
    const importedSources = betterDb.getMediaSources().length

    if (exportedSources !== importedSources) {
      errors.push(`Media sources mismatch: exported ${exportedSources}, imported ${importedSources}`)
    }

    // Check settings count
    const exportedSettings = (exportedData['settings'] as unknown[])?.length || 0
    const importedSettings = Object.keys(betterDb.getAllSettings()).length

    if (exportedSettings !== importedSettings) {
      errors.push(`Settings mismatch: exported ${exportedSettings}, imported ${importedSettings}`)
    }

  } catch (error) {
    errors.push(`Verification error: ${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    success: errors.length === 0,
    errors,
  }
}

/**
 * Rollback migration by restoring SQL.js database from backup
 */
export function rollbackMigration(): boolean {
  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')
  const backupPath = path.join(userDataPath, 'totality.db.backup')

  try {
    // Remove better-sqlite3 database
    if (fs.existsSync(betterSqliteDbPath)) {
      fs.unlinkSync(betterSqliteDbPath)
      console.log('[Migration] Removed better-sqlite3 database')
    }

    // Restore SQL.js database from backup if needed
    if (fs.existsSync(backupPath) && !fs.existsSync(sqlJsDbPath)) {
      fs.copyFileSync(backupPath, sqlJsDbPath)
      console.log('[Migration] Restored SQL.js database from backup')
    }

    console.log('[Migration] Rollback completed')
    return true
  } catch (error) {
    console.error('[Migration] Rollback failed:', error)
    return false
  }
}
