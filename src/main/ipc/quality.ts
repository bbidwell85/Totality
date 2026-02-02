import { ipcMain, BrowserWindow } from 'electron'
import { getQualityAnalyzer } from '../services/QualityAnalyzer'
import { getDatabaseService } from '../services/DatabaseService'

/**
 * Register all quality analysis IPC handlers
 */
export function registerQualityHandlers() {
  const analyzer = getQualityAnalyzer()

  // ============================================================================
  // QUALITY ANALYSIS
  // ============================================================================

  ipcMain.handle('quality:analyzeAll', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)

      await analyzer.loadThresholdsFromDatabase()

      let lastUpdateTime = 0
      const UPDATE_INTERVAL = 2000 // Send library:updated every 2 seconds during analysis

      const count = await analyzer.analyzeAllMediaItems((current, total) => {
        // Send progress updates to renderer
        win?.webContents.send('quality:analysisProgress', { current, total })

        // Send periodic library:updated events for live refresh
        const now = Date.now()
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
          win?.webContents.send('library:updated', { type: 'media' })
          lastUpdateTime = now
        }
      })

      // Send final update when analysis completes
      win?.webContents.send('library:updated', { type: 'media' })

      return count
    } catch (error) {
      console.error('Error analyzing all media items:', error)
      throw error
    }
  })

  ipcMain.handle('quality:getDistribution', async () => {
    try {
      return analyzer.getQualityDistribution()
    } catch (error) {
      console.error('Error getting quality distribution:', error)
      throw error
    }
  })

  ipcMain.handle('quality:getRecommendedFormat', async (_event, mediaItemId: number) => {
    try {
      const db = getDatabaseService()
      const mediaItem = db.getMediaItemById(mediaItemId)

      if (!mediaItem) {
        throw new Error('Media item not found')
      }

      const qualityScore = db.getQualityScoreByMediaId(mediaItemId)
      const currentScore = qualityScore?.overall_score || 0

      return analyzer.getRecommendedFormat(mediaItem, currentScore)
    } catch (error) {
      console.error('Error getting recommended format:', error)
      throw error
    }
  })

  console.log('Quality analysis IPC handlers registered')
}
