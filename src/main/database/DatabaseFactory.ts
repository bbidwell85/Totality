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

// Static imports for database services (prevents Vite bundling issues with dynamic require)
import { getBetterSQLiteService } from './BetterSQLiteService'
import { getDatabaseService as getSqlJsService } from '../services/DatabaseService'

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
 * In production: always use better-sqlite3 (migrate if needed)
 * In tests: use SQL.js when USE_SQLJS env var is set
 */
function shouldUseBetterSqlite(): boolean {
  if (useBetterSqlite !== null) {
    return useBetterSqlite
  }

  // Environment variable override for tests
  if (process.env.USE_SQLJS === 'true') {
    useBetterSqlite = false
    console.log('[DatabaseFactory] Using SQL.js (test mode)')
    return false
  }

  // Production always uses better-sqlite3
  // Migration happens automatically in getDatabaseServiceAsync()
  useBetterSqlite = true

  try {
    const userDataPath = app.getPath('userData')
    const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')
    const sqlJsDbPath = path.join(userDataPath, 'totality.db')

    if (fs.existsSync(betterSqliteDbPath)) {
      console.log('[DatabaseFactory] Using better-sqlite3 (database exists)')
    } else if (fs.existsSync(sqlJsDbPath)) {
      console.log('[DatabaseFactory] Using better-sqlite3 (will migrate from SQL.js)')
    } else {
      console.log('[DatabaseFactory] Using better-sqlite3 (fresh install)')
    }
  } catch {
    console.log('[DatabaseFactory] Using better-sqlite3 (default)')
  }

  return true
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
 * Automatically handles migration from SQL.js to better-sqlite3 if needed
 */
export async function getDatabaseServiceAsync(): Promise<DatabaseServiceInterface> {
  // In production, always migrate if there's an old SQL.js database
  if (!process.env.USE_SQLJS && isMigrationAvailable()) {
    const result = await performMigrationIfNeeded()
    if (result.error) {
      console.error('[DatabaseFactory] Migration failed, falling back to SQL.js:', result.error)
      useBetterSqlite = false
    }
  }

  if (shouldUseBetterSqlite()) {
    return getBetterSQLiteService()
  } else {
    return getSqlJsService()
  }
}

/**
 * Get the synchronous database service
 * Note: This should only be called after the app is ready and database is initialized
 * Migration must be performed before calling this
 */
export function getDatabaseServiceSync(): DatabaseServiceInterface {
  if (shouldUseBetterSqlite()) {
    return getBetterSQLiteService()
  } else {
    return getSqlJsService()
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
