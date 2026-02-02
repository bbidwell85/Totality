/**
 * Logging IPC Handlers
 *
 * Provides IPC communication for log viewing and export functionality.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getLoggingService } from '../services/LoggingService'

export function registerLoggingHandlers(): void {
  ipcMain.handle('logs:getAll', async (_event, limit?: number) => {
    return getLoggingService().getLogs(limit)
  })

  ipcMain.handle('logs:clear', async () => {
    getLoggingService().clearLogs()
  })

  ipcMain.handle('logs:setVerbose', async (_event, enabled: boolean) => {
    getLoggingService().setVerboseLogging(enabled)
    return { success: true }
  })

  ipcMain.handle('logs:isVerbose', async () => {
    return getLoggingService().isVerboseEnabled()
  })

  ipcMain.handle('logs:export', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { success: false, error: 'No window' }

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Logs',
      defaultPath: `totality-logs-${new Date().toISOString().split('T')[0]}.txt`,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'JSON Files', extensions: ['json'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    try {
      const isJson = result.filePath.endsWith('.json')
      if (isJson) {
        await getLoggingService().exportLogs(result.filePath)
      } else {
        await getLoggingService().exportLogsAsText(result.filePath)
      }
      return { success: true, filePath: result.filePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
