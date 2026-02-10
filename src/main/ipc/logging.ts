/**
 * Logging IPC Handlers
 *
 * Provides IPC communication for log viewing and export functionality.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getLoggingService } from '../services/LoggingService'
import type { SourceInfo } from '../services/LoggingService'
import { getSourceManager } from '../services/SourceManager'
import { getErrorMessage } from './utils'

async function getSourceInfo(): Promise<SourceInfo[]> {
  try {
    const manager = getSourceManager()
    const sources = await manager.getSources()

    const results = await Promise.all(
      sources.map(async (source) => {
        let serverVersion: string | null = null
        const provider = manager.getProvider(source.source_id)
        if (provider) {
          try {
            const test = await Promise.race([
              provider.testConnection(),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
            ])
            if (test && test.success) {
              serverVersion = test.serverVersion || null
            }
          } catch {
            // Source unreachable — leave version as null
          }
        }
        return {
          displayName: source.display_name,
          sourceType: source.source_type,
          serverVersion,
        }
      })
    )

    return results
  } catch {
    return []
  }
}

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
      // Gather connected source info with server versions
      const sourceInfo = await getSourceInfo()

      const isJson = result.filePath.endsWith('.json')
      if (isJson) {
        await getLoggingService().exportLogs(result.filePath, sourceInfo)
      } else {
        await getLoggingService().exportLogsAsText(result.filePath, sourceInfo)
      }
      return { success: true, filePath: result.filePath }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
