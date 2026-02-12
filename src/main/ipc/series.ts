import { ipcMain } from 'electron'
import { z } from 'zod'
import { getSeriesCompletenessService } from '../services/SeriesCompletenessService'
import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from '../services/TMDBService'
import { getWindowFromEvent } from './utils/safeSend'
import { createProgressUpdater } from './utils/progressUpdater'
import { validateInput, NonEmptyStringSchema, OptionalSourceIdSchema, PositiveIntSchema } from '../validation/schemas'

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
  ipcMain.handle('series:analyzeAll', async (event, sourceId?: unknown, libraryId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'series:analyzeAll.sourceId') : undefined
    const validLibraryId = libraryId !== undefined ? validateInput(NonEmptyStringSchema, libraryId, 'series:analyzeAll.libraryId') : undefined
    const win = getWindowFromEvent(event)
    const service = getSeriesCompletenessService()
    const { onProgress, flush } = createProgressUpdater(win, 'series:progress', 'media')

    try {
      const result = await service.analyzeAllSeries((progress) => {
        onProgress(progress)
      }, validSourceId, validLibraryId)

      return result
    } catch (error) {
      console.error('Error analyzing series completeness:', error)
      throw error
    } finally {
      flush()
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
  ipcMain.handle('series:analyze', async (_event, seriesTitle: unknown) => {
    const validSeriesTitle = validateInput(NonEmptyStringSchema, seriesTitle, 'series:analyze.seriesTitle')
    try {
      const service = getSeriesCompletenessService()
      return await service.analyzeSeries(validSeriesTitle)
    } catch (error) {
      console.error(`Error analyzing series "${validSeriesTitle}":`, error)
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
      const db = getDatabase()
      return db.getSeriesCompleteness()
    } catch (error) {
      console.error('Error getting series completeness:', error)
      throw error
    }
  })

  /**
   * Get incomplete series only
   * @param sourceId Optional source ID to filter by
   */
  ipcMain.handle('series:getIncomplete', async (_event, sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'series:getIncomplete.sourceId') : undefined
    try {
      const db = getDatabase()
      return db.getIncompleteSeries(validSourceId)
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
      const db = getDatabase()
      return db.getSeriesCompletenessStats()
    } catch (error) {
      console.error('Error getting series stats:', error)
      throw error
    }
  })

  /**
   * Get episodes for a specific series
   */
  ipcMain.handle('series:getEpisodes', async (_event, seriesTitle: unknown, sourceId?: unknown) => {
    const validSeriesTitle = validateInput(NonEmptyStringSchema, seriesTitle, 'series:getEpisodes.seriesTitle')
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'series:getEpisodes.sourceId') : undefined
    try {
      const db = getDatabase()
      return db.getEpisodesForSeries(validSeriesTitle, validSourceId)
    } catch (error) {
      console.error(`Error getting episodes for "${validSeriesTitle}":`, error)
      throw error
    }
  })

  /**
   * Delete a series completeness record
   */
  ipcMain.handle('series:delete', async (_event, id: unknown) => {
    const validId = validateInput(PositiveIntSchema, id, 'series:delete.id')
    try {
      const db = getDatabase()
      return await db.deleteSeriesCompleteness(validId)
    } catch (error) {
      console.error(`Error deleting series completeness ${validId}:`, error)
      throw error
    }
  })

  // ============================================================================
  // TMDB ARTWORK FETCHING
  // ============================================================================

  /**
   * Get season poster URL from TMDB
   */
  ipcMain.handle('series:getSeasonPoster', async (_event, tmdbId: unknown, seasonNumber: unknown) => {
    const validTmdbId = validateInput(NonEmptyStringSchema, tmdbId, 'series:getSeasonPoster.tmdbId')
    const validSeasonNumber = validateInput(z.number().int().nonnegative(), seasonNumber, 'series:getSeasonPoster.seasonNumber')
    try {
      const tmdb = getTMDBService()
      const seasonDetails = await tmdb.getSeasonDetails(validTmdbId, validSeasonNumber)
      return tmdb.buildImageUrl(seasonDetails.poster_path, 'w500')
    } catch (error) {
      console.error(`Error fetching season poster for ${validTmdbId} S${validSeasonNumber}:`, error)
      return null
    }
  })

  /**
   * Get episode still URL from TMDB
   */
  ipcMain.handle('series:getEpisodeStill', async (_event, tmdbId: unknown, seasonNumber: unknown, episodeNumber: unknown) => {
    const validTmdbId = validateInput(NonEmptyStringSchema, tmdbId, 'series:getEpisodeStill.tmdbId')
    const validSeasonNumber = validateInput(z.number().int().nonnegative(), seasonNumber, 'series:getEpisodeStill.seasonNumber')
    const validEpisodeNumber = validateInput(z.number().int().nonnegative(), episodeNumber, 'series:getEpisodeStill.episodeNumber')
    try {
      const tmdb = getTMDBService()
      const seasonDetails = await tmdb.getSeasonDetails(validTmdbId, validSeasonNumber)
      const episode = seasonDetails.episodes.find(ep => ep.episode_number === validEpisodeNumber)
      if (episode) {
        return tmdb.buildImageUrl(episode.still_path, 'w300')
      }
      return null
    } catch (error) {
      console.error(`Error fetching episode still for ${validTmdbId} S${validSeasonNumber}E${validEpisodeNumber}:`, error)
      return null
    }
  })

  // ============================================================================
  // MATCH FIXING - Fix incorrect TMDB matches for TV series
  // ============================================================================

  /**
   * Search TMDB for TV shows to fix a match
   */
  ipcMain.handle('series:searchTMDB', async (_event, query: unknown) => {
    const validQuery = validateInput(NonEmptyStringSchema, query, 'series:searchTMDB.query')
    try {
      const tmdb = getTMDBService()
      await tmdb.initialize()
      const response = await tmdb.searchTVShow(validQuery)

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
  ipcMain.handle('series:fixMatch', async (_event, seriesTitle: unknown, sourceId: unknown, tmdbId: unknown) => {
    const validSeriesTitle = validateInput(NonEmptyStringSchema, seriesTitle, 'series:fixMatch.seriesTitle')
    const validSourceId = validateInput(NonEmptyStringSchema, sourceId, 'series:fixMatch.sourceId')
    const validTmdbId = validateInput(PositiveIntSchema, tmdbId, 'series:fixMatch.tmdbId')
    try {
      const db = getDatabase()
      const tmdb = getTMDBService()
      const service = getSeriesCompletenessService()

      // Get show details from TMDB for the poster and title
      await tmdb.initialize()
      const showDetails = await tmdb.getTVShowDetails(validTmdbId.toString())
      const posterUrl = tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined
      const newSeriesTitle = showDetails.name

      // Update all episodes with the new TMDB ID and series title
      const updatedCount = await db.updateSeriesMatch(
        validSeriesTitle,
        validSourceId,
        validTmdbId.toString(),
        posterUrl,
        newSeriesTitle
      )

      // Re-analyze the series with the new title
      const completeness = await service.analyzeSeries(newSeriesTitle, validSourceId)

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
