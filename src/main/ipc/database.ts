import { ipcMain, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from '../services/QualityAnalyzer'
import { getTMDBService } from '../services/TMDBService'
import { invalidateNfsMappingsCache } from '../providers/kodi/KodiDatabaseSchema'
import { getErrorMessage, isNodeError } from './utils'
import fs from 'fs/promises'
import type { MediaItem } from '../types/database'
import { validateInput, PositiveIntSchema, NonEmptyStringSchema, SettingKeySchema, SettingValueSchema, MediaItemFiltersSchema, TVShowFiltersSchema, MediaItemSchema, QualityScoreSchema, NfsMappingsSchema, ExportCSVOptionsSchema, AddExclusionSchema, OptionalSourceIdSchema } from '../validation/schemas'

/**
 * Register all database-related IPC handlers
 */
export function registerDatabaseHandlers() {
  const db = getDatabase()

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  ipcMain.handle('db:getMediaItems', async (_event, filters?: unknown) => {
    try {
      const validFilters = filters !== undefined ? validateInput(MediaItemFiltersSchema, filters, 'db:getMediaItems') : undefined
      const items = db.getMediaItems(validFilters) as MediaItem[]
      // Debug logging for movies without year data
      const moviesWithoutYear = items.filter((i: MediaItem) => i.type === 'movie' && !i.year)
      if (moviesWithoutYear.length > 0) {
        console.log(`[IPC] Warning: ${moviesWithoutYear.length} movies without year data`)
        // Log first few for debugging
        moviesWithoutYear.slice(0, 5).forEach(m => {
          console.log(`[IPC]   - "${m.title}" (id: ${m.id})`)
        })
      }
      return items
    } catch (error) {
      console.error('Error getting media items:', error)
      throw error
    }
  })

  ipcMain.handle('db:countMediaItems', async (_event, filters?: unknown) => {
    try {
      const validFilters = filters !== undefined ? validateInput(MediaItemFiltersSchema, filters, 'db:countMediaItems') : undefined
      return db.countMediaItems(validFilters)
    } catch (error) {
      console.error('Error counting media items:', error)
      throw error
    }
  })

  // ============================================================================
  // TV SHOWS (grouped by series_title)
  // ============================================================================

  ipcMain.handle('db:getTVShows', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(TVShowFiltersSchema, filters, 'db:getTVShows')
      return db.getTVShows(validFilters)
    } catch (error) {
      console.error('Error getting TV shows:', error)
      throw error
    }
  })

  ipcMain.handle('db:countTVShows', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(TVShowFiltersSchema, filters, 'db:countTVShows')
      return db.countTVShows(validFilters)
    } catch (error) {
      console.error('Error counting TV shows:', error)
      throw error
    }
  })

  ipcMain.handle('db:getMediaItemById', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:getMediaItemById')
      return db.getMediaItemById(validId)
    } catch (error) {
      console.error('Error getting media item:', error)
      throw error
    }
  })

  ipcMain.handle('db:upsertMediaItem', async (_event, item: unknown) => {
    try {
      const validItem = validateInput(MediaItemSchema, item, 'db:upsertMediaItem')
      return await db.upsertMediaItem(validItem)
    } catch (error) {
      console.error('Error upserting media item:', error)
      throw error
    }
  })

  ipcMain.handle('db:deleteMediaItem', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:deleteMediaItem')
      await db.deleteMediaItem(validId)
      return true
    } catch (error) {
      console.error('Error deleting media item:', error)
      throw error
    }
  })

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  ipcMain.handle('db:getQualityScores', async () => {
    try {
      return db.getQualityScores()
    } catch (error) {
      console.error('Error getting quality scores:', error)
      throw error
    }
  })

  ipcMain.handle('db:getQualityScoreByMediaId', async (_event, mediaItemId: unknown) => {
    try {
      const validMediaItemId = validateInput(PositiveIntSchema, mediaItemId, 'db:getQualityScoreByMediaId')
      return db.getQualityScoreByMediaId(validMediaItemId)
    } catch (error) {
      console.error('Error getting quality score:', error)
      throw error
    }
  })

  ipcMain.handle('db:upsertQualityScore', async (_event, score: unknown) => {
    try {
      const validScore = validateInput(QualityScoreSchema, score, 'db:upsertQualityScore')
      return await db.upsertQualityScore(validScore)
    } catch (error) {
      console.error('Error upserting quality score:', error)
      throw error
    }
  })

  // ============================================================================
  // SETTINGS
  // ============================================================================

  ipcMain.handle('db:getSetting', async (_event, key: unknown) => {
    try {
      const validKey = validateInput(SettingKeySchema, key, 'db:getSetting')
      return db.getSetting(validKey)
    } catch (error) {
      console.error('Error getting setting:', error)
      throw error
    }
  })

  ipcMain.handle('db:setSetting', async (event, key: unknown, value: unknown) => {
    try {
      const validKey = validateInput(SettingKeySchema, key, 'db:setSetting')
      const validValue = validateInput(SettingValueSchema, value, 'db:setSetting')
      await db.setSetting(validKey, validValue)

      // Invalidate quality analyzer cache when quality settings change
      if (validKey.startsWith('quality_')) {
        getQualityAnalyzer().invalidateThresholdsCache()
      }

      // Broadcast settings change event to all windows
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        win.webContents.send('settings:changed', { key: validKey, hasValue: !!validValue })
      }

      return true
    } catch (error) {
      console.error('Error setting setting:', error)
      throw error
    }
  })

  ipcMain.handle('db:getAllSettings', async () => {
    try {
      return db.getAllSettings()
    } catch (error) {
      console.error('Error getting all settings:', error)
      throw error
    }
  })

  // NFS Mount Mappings (for Kodi NFS path conversion)
  ipcMain.handle('settings:getNfsMappings', async () => {
    try {
      const json = db.getSetting('nfs_mount_mappings')
      return json ? JSON.parse(json) : {}
    } catch (error) {
      console.error('Error getting NFS mappings:', error)
      return {}
    }
  })

  ipcMain.handle('settings:setNfsMappings', async (_event, mappings: unknown) => {
    try {
      const validMappings = validateInput(NfsMappingsSchema, mappings, 'settings:setNfsMappings')
      await db.setSetting('nfs_mount_mappings', JSON.stringify(validMappings))
      invalidateNfsMappingsCache()
      return true
    } catch (error) {
      console.error('Error setting NFS mappings:', error)
      throw error
    }
  })

  ipcMain.handle('settings:testNfsMapping', async (_event, _nfsPath: unknown, localPath: unknown) => {
    const validLocalPath = validateInput(NonEmptyStringSchema, localPath, 'settings:testNfsMapping')
    try {
      const stats = await fs.stat(validLocalPath)
      if (!stats.isDirectory()) {
        return { success: false, error: `Path is not a directory: ${validLocalPath}` }
      }

      const entries = await fs.readdir(validLocalPath, { withFileTypes: true })
      const folderCount = entries.filter(e => e.isDirectory()).length
      const fileCount = entries.filter(e => e.isFile()).length

      return {
        success: true,
        folderCount,
        fileCount,
        message: `Found ${entries.length} items (${folderCount} folders, ${fileCount} files)`
      }
    } catch (error: unknown) {
      // Provide user-friendly error messages
      let errorMessage = getErrorMessage(error) || `Unable to access: ${validLocalPath}`
      if (isNodeError(error)) {
        if (error.code === 'ENOENT') {
          errorMessage = `Path does not exist: ${validLocalPath}`
        } else if (error.code === 'EACCES') {
          errorMessage = `Permission denied: ${validLocalPath}`
        } else if (error.code === 'ENOTDIR') {
          errorMessage = `Not a directory: ${validLocalPath}`
        }
      }
      return { success: false, error: errorMessage }
    }
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  ipcMain.handle('db:getLibraryStats', async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'db:getLibraryStats')
      return db.getLibraryStats(validSourceId)
    } catch (error) {
      console.error('Error getting library stats:', error)
      throw error
    }
  })

  // ============================================================================
  // MATCH FIXING - Fix incorrect TMDB matches for movies
  // ============================================================================

  /**
   * Search TMDB for movies to fix a match
   */
  const OptionalYearSchema = z.number().int().min(1800).max(2100).optional()

  ipcMain.handle('movie:searchTMDB', async (_event, query: unknown, year?: unknown) => {
    try {
      const validQuery = validateInput(NonEmptyStringSchema, query, 'movie:searchTMDB')
      const validYear = validateInput(OptionalYearSchema, year, 'movie:searchTMDB')
      console.log('[movie:searchTMDB] Searching for:', validQuery, 'year:', validYear)
      const tmdb = getTMDBService()
      await tmdb.initialize()
      const response = await tmdb.searchMovie(validQuery, validYear)
      console.log('[movie:searchTMDB] Got response:', JSON.stringify(response).substring(0, 500))

      // Handle null/undefined results
      if (!response || !response.results) {
        console.log('[movie:searchTMDB] No results in response')
        return []
      }

      console.log('[movie:searchTMDB] Got', response.results.length, 'results')

      // Transform results to include poster URLs
      const results = response.results.map(movie => ({
        id: movie.id,
        title: movie.title,
        release_date: movie.release_date,
        overview: movie.overview,
        poster_url: tmdb.buildImageUrl(movie.poster_path, 'w500'),
        vote_average: movie.vote_average,
      }))
      console.log('[movie:searchTMDB] Returning', results.length, 'transformed results')
      return results
    } catch (error) {
      console.error('Error searching TMDB for movies:', error)
      throw error
    }
  })

  /**
   * Fix the TMDB match for a movie
   */
  ipcMain.handle('movie:fixMatch', async (event, mediaItemId: unknown, tmdbId: unknown) => {
    try {
      const validMediaItemId = validateInput(PositiveIntSchema, mediaItemId, 'movie:fixMatch')
      const validTmdbId = validateInput(PositiveIntSchema, tmdbId, 'movie:fixMatch')
      const tmdb = getTMDBService()
      const win = BrowserWindow.fromWebContents(event.sender)

      // Get movie details from TMDB for the poster, title, and year
      await tmdb.initialize()
      const movieDetails = await tmdb.getMovieDetails(validTmdbId.toString())
      const posterUrl = tmdb.buildImageUrl(movieDetails.poster_path, 'w500') || undefined
      const title = movieDetails.title
      const year = movieDetails.release_date
        ? parseInt(movieDetails.release_date.split('-')[0], 10)
        : undefined

      // Update the movie with the new TMDB ID, poster, title, and year
      await db.updateMovieMatch(validMediaItemId, validTmdbId.toString(), posterUrl, title, year)

      // Send library update for live refresh
      win?.webContents.send('library:updated', { type: 'media' })

      return {
        success: true,
        tmdbId: validTmdbId,
        posterUrl,
        title,
        year,
      }
    } catch (error) {
      console.error('Error fixing movie match:', error)
      throw error
    }
  })

  // ============================================================================
  // DATA MANAGEMENT - Export/Import/Reset
  // ============================================================================

  /**
   * Get the database file path
   */
  ipcMain.handle('db:getPath', async () => {
    try {
      return db.getDbPath()
    } catch (error) {
      console.error('Error getting database path:', error)
      throw error
    }
  })

  /**
   * Export database to JSON file
   */
  ipcMain.handle('db:export', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      // Show save dialog
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Database',
        defaultPath: `totality-backup-${new Date().toISOString().split('T')[0]}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true }
      }

      // Export data
      const data = db.exportData()
      await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8')

      return { success: true, path: result.filePath }
    } catch (error: unknown) {
      console.error('Error exporting database:', error)
      throw error
    }
  })

  /**
   * Export working document CSV for tracking upgrades and completions
   */
  ipcMain.handle('db:exportCSV', async (event, options: unknown) => {
    try {
      const validOptions = validateInput(ExportCSVOptionsSchema, options, 'db:exportCSV')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      // Show save dialog
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Working Document',
        defaultPath: `totality-working-${new Date().toISOString().split('T')[0]}.csv`,
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true }
      }

      // Export data as CSV
      const csv = db.exportWorkingCSV(validOptions)
      await fs.writeFile(result.filePath, csv, 'utf-8')

      return { success: true, path: result.filePath }
    } catch (error: unknown) {
      console.error('Error exporting CSV:', error)
      throw error
    }
  })

  /**
   * Import database from JSON file
   */
  ipcMain.handle('db:import', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      // Show open dialog
      const result = await dialog.showOpenDialog(win, {
        title: 'Import Database',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true }
      }

      // Read and parse file
      const content = await fs.readFile(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content)

      // Validate it looks like our export format
      if (!data._meta || !Array.isArray(data._meta)) {
        throw new Error('Invalid export file format')
      }

      // Import data
      const importResult = await db.importData(data)

      return {
        success: true,
        imported: importResult.imported,
        errors: importResult.errors,
      }
    } catch (error: unknown) {
      console.error('Error importing database:', error)
      throw error
    }
  })

  /**
   * Reset the database (delete all data)
   */
  ipcMain.handle('db:reset', async () => {
    try {
      await db.resetDatabase()
      return { success: true }
    } catch (error: unknown) {
      console.error('Error resetting database:', error)
      throw error
    }
  })

  // ============================================================================
  // GLOBAL SEARCH
  // ============================================================================

  /**
   * Search across all media types for global search bar
   */
  ipcMain.handle('media:search', async (_event, query: unknown) => {
    try {
      const validQuery = validateInput(NonEmptyStringSchema, query, 'media:search')
      return db.globalSearch(validQuery)
    } catch (error) {
      console.error('Error in global search:', error)
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }
  })

  // ============================================================================
  // EXCLUSIONS
  // ============================================================================

  ipcMain.handle('db:addExclusion', async (_event, exclusionType: unknown, referenceId?: unknown, referenceKey?: unknown, parentKey?: unknown, title?: unknown) => {
    try {
      const validArgs = validateInput(AddExclusionSchema, { exclusionType, referenceId, referenceKey, parentKey, title }, 'db:addExclusion')
      return db.addExclusion(validArgs.exclusionType, validArgs.referenceId, validArgs.referenceKey, validArgs.parentKey, validArgs.title)
    } catch (error) {
      console.error('Error adding exclusion:', error)
      throw error
    }
  })

  ipcMain.handle('db:removeExclusion', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:removeExclusion')
      db.removeExclusion(validId)
    } catch (error) {
      console.error('Error removing exclusion:', error)
      throw error
    }
  })

  const OptionalStringSchema = z.string().max(500).optional()

  ipcMain.handle('db:getExclusions', async (_event, exclusionType?: unknown, parentKey?: unknown) => {
    try {
      const validExclusionType = validateInput(OptionalStringSchema, exclusionType, 'db:getExclusions')
      const validParentKey = validateInput(OptionalStringSchema, parentKey, 'db:getExclusions')
      return db.getExclusions(validExclusionType, validParentKey)
    } catch (error) {
      console.error('Error getting exclusions:', error)
      return []
    }
  })

  console.log('Database IPC handlers registered')
}
