import { ipcMain } from 'electron'
import { getSeriesCompletenessService } from '../services/SeriesCompletenessService'
import { getDatabaseService } from '../services/DatabaseService'
import { getTMDBService } from '../services/TMDBService'
import { getWindowFromEvent } from './utils/safeSend'
import { createProgressUpdater } from './utils/progressUpdater'

/**
 * Register all series completeness IPC handlers
 */
export function registerSeriesHandlers() {
  // ============================================================================
  // SERIES COMPLETENESS ANALYSIS
  // ============================================================================

  /**
   * Analyze all series in the library for completeness
   * @param sourceId Optional source ID to scope analysis
   * @param libraryId Optional library ID to scope analysis
   */
  ipcMain.handle('series:analyzeAll', async (event, sourceId?: string, libraryId?: string) => {
    try {
      const win = getWindowFromEvent(event)
      const service = getSeriesCompletenessService()
      const { onProgress, flush } = createProgressUpdater(win, 'series:progress', 'media')

      const result = await service.analyzeAllSeries((progress) => {
        onProgress(progress)
      }, sourceId, libraryId)

      // Send final update when analysis completes
      flush()

      return result
    } catch (error) {
      console.error('Error analyzing series completeness:', error)
      throw error
    }
  })

  /**
   * Cancel series analysis
   */
  ipcMain.handle('series:cancelAnalysis', async () => {
    try {
      const service = getSeriesCompletenessService()
      service.cancel()
      return { success: true }
    } catch (error) {
      console.error('Error cancelling series analysis:', error)
      throw error
    }
  })

  /**
   * Analyze a single series by title
   */
  ipcMain.handle('series:analyze', async (_event, seriesTitle: string) => {
    try {
      const service = getSeriesCompletenessService()
      return await service.analyzeSeries(seriesTitle)
    } catch (error) {
      console.error(`Error analyzing series "${seriesTitle}":`, error)
      throw error
    }
  })

  // ============================================================================
  // SERIES COMPLETENESS DATA
  // ============================================================================

  /**
   * Get all series completeness records
   */
  ipcMain.handle('series:getAll', async () => {
    try {
      const db = getDatabaseService()
      return db.getSeriesCompleteness()
    } catch (error) {
      console.error('Error getting series completeness:', error)
      throw error
    }
  })

  /**
   * Get incomplete series only
   */
  ipcMain.handle('series:getIncomplete', async () => {
    try {
      const db = getDatabaseService()
      return db.getIncompleteSeries()
    } catch (error) {
      console.error('Error getting incomplete series:', error)
      throw error
    }
  })

  /**
   * Get series completeness statistics
   */
  ipcMain.handle('series:getStats', async () => {
    try {
      const db = getDatabaseService()
      return db.getSeriesCompletenessStats()
    } catch (error) {
      console.error('Error getting series stats:', error)
      throw error
    }
  })

  /**
   * Get episodes for a specific series
   */
  ipcMain.handle('series:getEpisodes', async (_event, seriesTitle: string) => {
    try {
      const db = getDatabaseService()
      return db.getEpisodesForSeries(seriesTitle)
    } catch (error) {
      console.error(`Error getting episodes for "${seriesTitle}":`, error)
      throw error
    }
  })

  /**
   * Delete a series completeness record
   */
  ipcMain.handle('series:delete', async (_event, id: number) => {
    try {
      const db = getDatabaseService()
      return await db.deleteSeriesCompleteness(id)
    } catch (error) {
      console.error(`Error deleting series completeness ${id}:`, error)
      throw error
    }
  })

  // ============================================================================
  // TMDB ARTWORK FETCHING
  // ============================================================================

  /**
   * Get season poster URL from TMDB
   */
  ipcMain.handle('series:getSeasonPoster', async (_event, tmdbId: string, seasonNumber: number) => {
    try {
      const tmdb = getTMDBService()
      const seasonDetails = await tmdb.getSeasonDetails(tmdbId, seasonNumber)
      return tmdb.buildImageUrl(seasonDetails.poster_path, 'w500')
    } catch (error) {
      console.error(`Error fetching season poster for ${tmdbId} S${seasonNumber}:`, error)
      return null
    }
  })

  /**
   * Get episode still URL from TMDB
   */
  ipcMain.handle('series:getEpisodeStill', async (_event, tmdbId: string, seasonNumber: number, episodeNumber: number) => {
    try {
      const tmdb = getTMDBService()
      const seasonDetails = await tmdb.getSeasonDetails(tmdbId, seasonNumber)
      const episode = seasonDetails.episodes.find(ep => ep.episode_number === episodeNumber)
      if (episode) {
        return tmdb.buildImageUrl(episode.still_path, 'w300')
      }
      return null
    } catch (error) {
      console.error(`Error fetching episode still for ${tmdbId} S${seasonNumber}E${episodeNumber}:`, error)
      return null
    }
  })

  // ============================================================================
  // MATCH FIXING - Fix incorrect TMDB matches for TV series
  // ============================================================================

  /**
   * Search TMDB for TV shows to fix a match
   */
  ipcMain.handle('series:searchTMDB', async (_event, query: string) => {
    try {
      const tmdb = getTMDBService()
      await tmdb.initialize()
      const response = await tmdb.searchTVShow(query)

      // Transform results to include poster URLs
      return response.results.map(show => ({
        id: show.id,
        name: show.name,
        first_air_date: show.first_air_date,
        overview: show.overview,
        poster_url: tmdb.buildImageUrl(show.poster_path, 'w500'),
        vote_average: show.vote_average,
      }))
    } catch (error) {
      console.error('Error searching TMDB for TV shows:', error)
      throw error
    }
  })

  /**
   * Fix the TMDB match for a TV series
   * Updates all episodes of the series with the new TMDB ID and title
   */
  ipcMain.handle('series:fixMatch', async (_event, seriesTitle: string, sourceId: string, tmdbId: number) => {
    try {
      const db = getDatabaseService()
      const tmdb = getTMDBService()
      const service = getSeriesCompletenessService()

      // Get show details from TMDB for the poster and title
      await tmdb.initialize()
      const showDetails = await tmdb.getTVShowDetails(tmdbId.toString())
      const posterUrl = tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined
      const newSeriesTitle = showDetails.name

      // Update all episodes with the new TMDB ID and series title
      const updatedCount = await db.updateSeriesMatch(
        seriesTitle,
        sourceId,
        tmdbId.toString(),
        posterUrl,
        newSeriesTitle
      )

      // Re-analyze the series with the new title
      const completeness = await service.analyzeSeries(newSeriesTitle, sourceId)

      return {
        success: true,
        updatedEpisodes: updatedCount,
        completeness,
        newTitle: newSeriesTitle,
      }
    } catch (error) {
      console.error('Error fixing series match:', error)
      throw error
    }
  })

  console.log('Series completeness IPC handlers registered')
}
