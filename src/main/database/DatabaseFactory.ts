/**
 * Database Factory
 *
 * Provides a factory function to get the appropriate database service
 * based on the configured backend. Supports automatic migration from
 * SQL.js to better-sqlite3.
 *
 * Migration strategy:
 * 1. If better-sqlite3 database exists, use it
 * 2. If SQL.js database exists and no better-sqlite3, migrate automatically
 * 3. For fresh installs (no database), use better-sqlite3
 *
 * Environment variable: Set USE_BETTER_SQLITE3=true to force better-sqlite3
 * Environment variable: Set USE_SQLJS=true to force SQL.js (for testing)
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// The database backend to use (cached after first check)
let useBetterSqlite: boolean | null = null
let migrationPerformed = false

// Database service interfaces for type compatibility
interface DatabaseServiceInterface {
  isInitialized: boolean
  initialize(): Promise<void> | void
  close(): Promise<void> | void
  forceSave(): Promise<void> | void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * Check if better-sqlite3 backend should be used
 */
function shouldUseBetterSqlite(): boolean {
  if (useBetterSqlite !== null) {
    return useBetterSqlite
  }

  // Environment variable overrides
  if (process.env.USE_SQLJS === 'true') {
    useBetterSqlite = false
    console.log('[DatabaseFactory] Using SQL.js (forced by env var)')
    return false
  }

  if (process.env.USE_BETTER_SQLITE3 === 'true') {
    useBetterSqlite = true
    console.log('[DatabaseFactory] Using better-sqlite3 (forced by env var)')
    return true
  }

  try {
    const userDataPath = app.getPath('userData')
    const sqlJsDbPath = path.join(userDataPath, 'totality.db')
    const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')

    const sqlJsExists = fs.existsSync(sqlJsDbPath)
    const betterSqliteExists = fs.existsSync(betterSqliteDbPath)

    if (betterSqliteExists) {
      // Already using better-sqlite3
      useBetterSqlite = true
      console.log('[DatabaseFactory] Using better-sqlite3 (database exists)')
    } else if (!sqlJsExists) {
      // Fresh install - use better-sqlite3
      useBetterSqlite = true
      console.log('[DatabaseFactory] Using better-sqlite3 (fresh install)')
    } else {
      // SQL.js exists, need migration - but use SQL.js for now until migration is triggered
      useBetterSqlite = false
      console.log('[DatabaseFactory] SQL.js database found, migration available')
    }
  } catch (error) {
    console.warn('[DatabaseFactory] Error checking database backend:', error)
    useBetterSqlite = false
  }

  return useBetterSqlite
}

/**
 * Check if migration from SQL.js to better-sqlite3 is available
 */
export function isMigrationAvailable(): boolean {
  try {
    const userDataPath = app.getPath('userData')
    const sqlJsDbPath = path.join(userDataPath, 'totality.db')
    const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')

    return fs.existsSync(sqlJsDbPath) && !fs.existsSync(betterSqliteDbPath)
  } catch {
    return false
  }
}

/**
 * Perform migration from SQL.js to better-sqlite3
 * Returns true if migration was successful or not needed
 */
export async function performMigrationIfNeeded(): Promise<{ migrated: boolean; error?: string }> {
  if (migrationPerformed) {
    return { migrated: false }
  }

  if (!isMigrationAvailable()) {
    return { migrated: false }
  }

  console.log('[DatabaseFactory] Starting automatic migration to better-sqlite3...')

  try {
    const { migrateDatabase } = await import('./DatabaseMigration')
    const result = await migrateDatabase()

    if (result.success) {
      migrationPerformed = true
      useBetterSqlite = true
      console.log('[DatabaseFactory] Migration completed successfully')
      return { migrated: true }
    } else {
      const errorMsg = result.errors.join('; ')
      console.error('[DatabaseFactory] Migration failed:', errorMsg)
      return { migrated: false, error: errorMsg }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[DatabaseFactory] Migration error:', errorMsg)
    return { migrated: false, error: errorMsg }
  }
}

/**
 * Get the database service instance (async version)
 * Automatically handles migration if needed
 */
export async function getDatabaseServiceAsync(): Promise<DatabaseServiceInterface> {
  // Try migration if available
  if (isMigrationAvailable()) {
    await performMigrationIfNeeded()
  }

  if (shouldUseBetterSqlite()) {
    const { getBetterSQLiteService } = await import('./BetterSQLiteService')
    return getBetterSQLiteService()
  } else {
    const { getDatabaseService } = await import('../services/DatabaseService')
    return getDatabaseService()
  }
}

/**
 * Get the synchronous database service
 * Note: This should only be called after the app is ready and database is initialized
 * Migration must be performed before calling this
 */
export function getDatabaseServiceSync(): DatabaseServiceInterface {
  if (shouldUseBetterSqlite()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBetterSQLiteService } = require('./BetterSQLiteService')
    return getBetterSQLiteService()
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDatabaseService } = require('../services/DatabaseService')
    return getDatabaseService()
  }
}

/**
 * Check which backend is currently configured
 */
export function getDatabaseBackend(): 'sql.js' | 'better-sqlite3' {
  return shouldUseBetterSqlite() ? 'better-sqlite3' : 'sql.js'
}

/**
 * Force a specific backend (for testing)
 */
export function setDatabaseBackend(backend: 'sql.js' | 'better-sqlite3'): void {
  useBetterSqlite = backend === 'better-sqlite3'
  console.log(`[DatabaseFactory] Backend forced to ${backend}`)
}

/**
 * Reset factory state (for testing)
 */
export function resetFactoryState(): void {
  useBetterSqlite = null
  migrationPerformed = false
}
