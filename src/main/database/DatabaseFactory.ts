/**
 * Database Factory
 *
 * Provides the database service instance using better-sqlite3.
 * SQL.js backend was removed — better-sqlite3 is the sole database backend.
 * (sql.js is still used by KodiLocalProvider and MediaMonkeyProvider
 *  to read external database files, but not for the app's own database.)
 */

import { getBetterSQLiteService } from './BetterSQLiteService'

import type { DatabaseServiceInterface } from './DatabaseInterface'
export type { DatabaseServiceInterface }

/**
 * Get the database service instance (async version)
 */
export async function getDatabaseServiceAsync(): Promise<DatabaseServiceInterface> {
  return getBetterSQLiteService() as unknown as DatabaseServiceInterface
}

/**
 * Get the database service instance (synchronous)
 * Should only be called after app.whenReady() and database initialization
 */
export function getDatabaseServiceSync(): DatabaseServiceInterface {
  return getBetterSQLiteService() as unknown as DatabaseServiceInterface
}

/**
 * Check which backend is currently configured
 */
export function getDatabaseBackend(): 'better-sqlite3' {
  return 'better-sqlite3'
}
