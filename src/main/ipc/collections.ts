import { ipcMain } from 'electron'
import { getMovieCollectionService } from '../services/MovieCollectionService'
import { getWindowFromEvent } from './utils/safeSend'
import { createProgressUpdater } from './utils/progressUpdater'

export function registerCollectionHandlers() {
  const service = getMovieCollectionService()

  // Analyze all movies for collection completeness
  // @param sourceId Optional source ID to scope analysis
  // @param libraryId Optional library ID to scope analysis
  ipcMain.handle('collections:analyzeAll', async (event, sourceId?: string, libraryId?: string) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'collections:progress', 'media')

    try {
      const result = await service.analyzeAllCollections((progress) => {
        onProgress(progress)
      }, sourceId, libraryId)

      // Send final update when analysis completes
      flush()

      return { success: true, ...result }
    } catch (error) {
      console.error('Error analyzing collections:', error)
      throw error
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
  ipcMain.handle('collections:getIncomplete', async (_event, sourceId?: string) => {
    try {
      return service.getIncompleteCollections(sourceId)
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
  ipcMain.handle('collections:delete', async (_event, id: number) => {
    try {
      return service.deleteCollection(id)
    } catch (error) {
      console.error('Error deleting collection:', error)
      throw error
    }
  })

  console.log('Movie collection IPC handlers registered')
}
