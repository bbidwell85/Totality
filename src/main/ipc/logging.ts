/**
 * Logging IPC Handlers
 *
 * Provides IPC communication for log viewing and export functionality.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getLoggingService } from '../services/LoggingService'
import type { SourceInfo, DiagnosticInfo } from '../services/LoggingService'
import { getSourceManager } from '../services/SourceManager'
import { getMediaFileAnalyzer } from '../services/MediaFileAnalyzer'
import { getLiveMonitoringService } from '../services/LiveMonitoringService'
import { getDatabase } from '../database/getDatabase'
import { getErrorMessage } from './utils'
import * as fs from 'fs'
import * as path from 'path'

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

async function getDiagnosticInfo(): Promise<DiagnosticInfo> {
  try {
    const analyzer = getMediaFileAnalyzer()
    const db = getDatabase()
    const monitoring = getLiveMonitoringService()
    const manager = getSourceManager()

    const [ffAvailable, ffVersion, ffBundled] = await Promise.all([
      analyzer.isAvailable(),
      analyzer.getVersion().catch(() => null),
      analyzer.isBundledVersion().catch(() => false),
    ])

    const dbPath = db.getDbPath()
    let dbSizeMB = 0
    try {
      const stats = fs.statSync(dbPath)
      dbSizeMB = Math.round((stats.size / 1024 / 1024) * 10) / 10
    } catch {
      // DB file may not exist yet
    }

    const sources = await manager.getSources()
    const libraries = sources.map((s) => ({
      sourceName: s.display_name,
      sourceType: s.source_type,
      itemCount: db.getMediaItemsCountBySource(s.source_id),
    }))

    return {
      ffprobe: { available: ffAvailable, version: ffVersion, bundled: ffBundled },
      database: { path: path.basename(dbPath), sizeMB: dbSizeMB },
      libraries,
      monitoring: { enabled: monitoring.isMonitoringActive() },
    }
  } catch {
    return {
      ffprobe: { available: false, version: null, bundled: false },
      database: { path: 'unknown', sizeMB: 0 },
      libraries: [],
      monitoring: { enabled: false },
    }
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
      // Gather connected source info and diagnostics
      const [sourceInfo, diagnostics] = await Promise.all([
        getSourceInfo(),
        getDiagnosticInfo(),
      ])

      const isJson = result.filePath.endsWith('.json')
      if (isJson) {
        await getLoggingService().exportLogs(result.filePath, sourceInfo, diagnostics)
      } else {
        await getLoggingService().exportLogsAsText(result.filePath, sourceInfo, diagnostics)
      }
      return { success: true, filePath: result.filePath }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
