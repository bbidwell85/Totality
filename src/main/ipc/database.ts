import { ipcMain, BrowserWindow, dialog } from 'electron'
import { getDatabaseService } from '../services/DatabaseService'
import { getQualityAnalyzer } from '../services/QualityAnalyzer'
import { getTMDBService } from '../services/TMDBService'
import { invalidateNfsMappingsCache } from '../providers/kodi/KodiDatabaseSchema'
import fs from 'fs/promises'
import type {
  MediaItem,
  QualityScore,
  MediaItemFilters,
} from '../types/database'

/**
 * Register all database-related IPC handlers
 */
export function registerDatabaseHandlers() {
  const db = getDatabaseService()

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  ipcMain.handle('db:getMediaItems', async (_event, filters?: MediaItemFilters) => {
    try {
      const items = db.getMediaItems(filters)
      // Debug logging for movies without year data
      const moviesWithoutYear = items.filter(i => i.type === 'movie' && !i.year)
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

  ipcMain.handle('db:getMediaItemById', async (_event, id: number) => {
    try {
      return db.getMediaItemById(id)
    } catch (error) {
      console.error('Error getting media item:', error)
      throw error
    }
  })

  ipcMain.handle('db:upsertMediaItem', async (_event, item: MediaItem) => {
    try {
      return await db.upsertMediaItem(item)
    } catch (error) {
      console.error('Error upserting media item:', error)
      throw error
    }
  })

  ipcMain.handle('db:deleteMediaItem', async (_event, id: number) => {
    try {
      await db.deleteMediaItem(id)
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

  ipcMain.handle('db:getQualityScoreByMediaId', async (_event, mediaItemId: number) => {
    try {
      return db.getQualityScoreByMediaId(mediaItemId)
    } catch (error) {
      console.error('Error getting quality score:', error)
      throw error
    }
  })

  ipcMain.handle('db:upsertQualityScore', async (_event, score: QualityScore) => {
    try {
      return await db.upsertQualityScore(score)
    } catch (error) {
      console.error('Error upserting quality score:', error)
      throw error
    }
  })

  // ============================================================================
  // SETTINGS
  // ============================================================================

  ipcMain.handle('db:getSetting', async (_event, key: string) => {
    try {
      return db.getSetting(key)
    } catch (error) {
      console.error('Error getting setting:', error)
      throw error
    }
  })

  ipcMain.handle('db:setSetting', async (event, key: string, value: string) => {
    try {
      await db.setSetting(key, value)

      // Invalidate quality analyzer cache when quality settings change
      if (key.startsWith('quality_')) {
        getQualityAnalyzer().invalidateThresholdsCache()
      }

      // Broadcast settings change event to all windows
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        win.webContents.send('settings:changed', { key, hasValue: !!value })
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

  ipcMain.handle('settings:setNfsMappings', async (_event, mappings: Record<string, string>) => {
    try {
      await db.setSetting('nfs_mount_mappings', JSON.stringify(mappings))
      invalidateNfsMappingsCache()
      return true
    } catch (error) {
      console.error('Error setting NFS mappings:', error)
      throw error
    }
  })

  ipcMain.handle('settings:testNfsMapping', async (_event, _nfsPath: string, localPath: string) => {
    try {
      const stats = await fs.stat(localPath)
      if (!stats.isDirectory()) {
        return { success: false, error: `Path is not a directory: ${localPath}` }
      }

      const entries = await fs.readdir(localPath, { withFileTypes: true })
      const folderCount = entries.filter(e => e.isDirectory()).length
      const fileCount = entries.filter(e => e.isFile()).length

      return {
        success: true,
        folderCount,
        fileCount,
        message: `Found ${entries.length} items (${folderCount} folders, ${fileCount} files)`
      }
    } catch (error: any) {
      // Provide user-friendly error messages
      let errorMessage = error.message || `Unable to access: ${localPath}`
      if (error.code === 'ENOENT') {
        errorMessage = `Path does not exist: ${localPath}`
      } else if (error.code === 'EACCES') {
        errorMessage = `Permission denied: ${localPath}`
      } else if (error.code === 'ENOTDIR') {
        errorMessage = `Not a directory: ${localPath}`
      }
      return { success: false, error: errorMessage }
    }
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  ipcMain.handle('db:getLibraryStats', async (_event, sourceId?: string) => {
    try {
      return db.getLibraryStats(sourceId)
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
  ipcMain.handle('movie:searchTMDB', async (_event, query: string, year?: number) => {
    try {
      console.log('[movie:searchTMDB] Searching for:', query, 'year:', year)
      const tmdb = getTMDBService()
      await tmdb.initialize()
      const response = await tmdb.searchMovie(query, year)
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
  ipcMain.handle('movie:fixMatch', async (event, mediaItemId: number, tmdbId: number) => {
    try {
      const tmdb = getTMDBService()
      const win = BrowserWindow.fromWebContents(event.sender)

      // Get movie details from TMDB for the poster, title, and year
      await tmdb.initialize()
      const movieDetails = await tmdb.getMovieDetails(tmdbId.toString())
      const posterUrl = tmdb.buildImageUrl(movieDetails.poster_path, 'w500') || undefined
      const title = movieDetails.title
      const year = movieDetails.release_date
        ? parseInt(movieDetails.release_date.split('-')[0], 10)
        : undefined

      // Update the movie with the new TMDB ID, poster, title, and year
      await db.updateMovieMatch(mediaItemId, tmdbId.toString(), posterUrl, title, year)

      // Send library update for live refresh
      win?.webContents.send('library:updated', { type: 'media' })

      return {
        success: true,
        tmdbId,
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
    } catch (error: any) {
      console.error('Error exporting database:', error)
      throw error
    }
  })

  /**
   * Export working document CSV for tracking upgrades and completions
   */
  ipcMain.handle('db:exportCSV', async (event, options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }) => {
    try {
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
      const csv = db.exportWorkingCSV(options)
      await fs.writeFile(result.filePath, csv, 'utf-8')

      return { success: true, path: result.filePath }
    } catch (error: any) {
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
    } catch (error: any) {
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
    } catch (error: any) {
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
  ipcMain.handle('media:search', async (_event, query: string) => {
    try {
      return db.globalSearch(query)
    } catch (error) {
      console.error('Error in global search:', error)
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }
  })

  console.log('Database IPC handlers registered')
}
