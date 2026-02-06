/**
 * Centralized database getter
 *
 * This module provides a single entry point for getting the database service.
 * It delegates to the DatabaseFactory which handles backend selection and migration.
 *
 * Usage:
 *   import { getDatabase } from '../database/getDatabase'
 *   const db = getDatabase()
 */

import { getDatabaseServiceSync } from './DatabaseFactory'

/**
 * Get the database service instance (synchronous)
 * This should only be called after app.whenReady() and database initialization
 */
export function getDatabase() {
  return getDatabaseServiceSync()
}

/**
 * Alias for getDatabase() - for compatibility with existing code
 */
export const getDatabaseService = getDatabase
