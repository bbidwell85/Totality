/**
 * IPC Handlers for Auto Update System
 */

import { ipcMain } from 'electron'
import { getAutoUpdateService } from '../services/AutoUpdateService'

export function registerAutoUpdateHandlers(): void {
  const service = getAutoUpdateService()

  /**
   * Get current update state
   */
  ipcMain.handle('autoUpdate:getState', () => {
    try {
      return service.getState()
    } catch (error) {
      console.error('[IPC autoUpdate:getState] Error:', error)
      throw error
    }
  })

  /**
   * Manually check for updates
   */
  ipcMain.handle('autoUpdate:checkForUpdates', async () => {
    try {
      console.log('[IPC autoUpdate:checkForUpdates] Checking for updates')
      await service.checkForUpdates()
      return { success: true }
    } catch (error) {
      console.error('[IPC autoUpdate:checkForUpdates] Error:', error)
      throw error
    }
  })

  /**
   * Download the available update
   */
  ipcMain.handle('autoUpdate:downloadUpdate', async () => {
    try {
      console.log('[IPC autoUpdate:downloadUpdate] Downloading update')
      await service.downloadUpdate()
      return { success: true }
    } catch (error) {
      console.error('[IPC autoUpdate:downloadUpdate] Error:', error)
      throw error
    }
  })

  /**
   * Quit and install the downloaded update
   */
  ipcMain.handle('autoUpdate:installUpdate', async () => {
    try {
      console.log('[IPC autoUpdate:installUpdate] Installing update and restarting')
      await service.installUpdate()
      return { success: true }
    } catch (error) {
      console.error('[IPC autoUpdate:installUpdate] Error:', error)
      throw error
    }
  })

  console.log('[IPC] Auto-update handlers registered')
}
