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
    return service.getState()
  })

  /**
   * Manually check for updates
   */
  ipcMain.handle('autoUpdate:checkForUpdates', async () => {
    await service.checkForUpdates()
    return { success: true }
  })

  /**
   * Download the available update
   */
  ipcMain.handle('autoUpdate:downloadUpdate', async () => {
    await service.downloadUpdate()
    return { success: true }
  })

  /**
   * Quit and install the downloaded update
   */
  ipcMain.handle('autoUpdate:installUpdate', async () => {
    await service.installUpdate()
    return { success: true }
  })

  console.log('[IPC] Auto-update handlers registered')
}
