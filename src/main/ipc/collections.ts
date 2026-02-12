import { ipcMain } from 'electron'
import { getMovieCollectionService } from '../services/MovieCollectionService'
import { getWindowFromEvent } from './utils/safeSend'
import { createProgressUpdater } from './utils/progressUpdater'
import { validateInput, OptionalSourceIdSchema, PositiveIntSchema, NonEmptyStringSchema } from '../validation/schemas'

export function registerCollectionHandlers() {
  const service = getMovieCollectionService()

  // Analyze all movies for collection completeness
  // @param sourceId Optional source ID to scope analysis
  // @param libraryId Optional library ID to scope analysis
  ipcMain.handle('collections:analyzeAll', async (event, sourceId?: unknown, libraryId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'collections:analyzeAll.sourceId') : undefined
    const validLibraryId = libraryId !== undefined ? validateInput(NonEmptyStringSchema, libraryId, 'collections:analyzeAll.libraryId') : undefined
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'collections:progress', 'media')

    try {
      const result = await service.analyzeAllCollections((progress) => {
        onProgress(progress)
      }, validSourceId, validLibraryId)

      return { success: true, ...result }
    } catch (error) {
      console.error('Error analyzing collections:', error)
      throw error
    } finally {
      flush()
    }
  })

  // Cancel collections analysis
  ipcMain.handle('collections:cancelAnalysis', async () => {
    try {
      service.cancel()
      return { success: true }
    } catch (error) {
      console.error('Error cancelling collection analysis:', error)
      throw error
    }
  })

  // Get all collections
  ipcMain.handle('collections:getAll', async () => {
    try {
      return service.getCollections()
    } catch (error) {
      console.error('Error getting collections:', error)
      throw error
    }
  })

  // Get incomplete collections only
  // @param sourceId Optional source ID to filter by
  ipcMain.handle('collections:getIncomplete', async (_event, sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'collections:getIncomplete.sourceId') : undefined
    try {
      return service.getIncompleteCollections(validSourceId)
    } catch (error) {
      console.error('Error getting incomplete collections:', error)
      throw error
    }
  })

  // Get collection stats
  ipcMain.handle('collections:getStats', async () => {
    try {
      return service.getStats()
    } catch (error) {
      console.error('Error getting collection stats:', error)
      throw error
    }
  })

  // Delete a collection
  ipcMain.handle('collections:delete', async (_event, id: unknown) => {
    const validId = validateInput(PositiveIntSchema, id, 'collections:delete.id')
    try {
      return service.deleteCollection(validId)
    } catch (error) {
      console.error('Error deleting collection:', error)
      throw error
    }
  })

  console.log('Movie collection IPC handlers registered')
}
