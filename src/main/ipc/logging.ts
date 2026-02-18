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
import { validateInput, BooleanSchema } from '../validation/schemas'
import type { LogLevel } from '../services/LoggingService'
import { z } from 'zod'

const FileLoggingSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  minLevel: z.enum(['verbose', 'debug', 'info', 'warn', 'error']).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
})
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
  ipcMain.handle('logs:getAll', async (_event, limit?: unknown) => {
    const validLimit = limit !== undefined ? validateInput(z.number().int().positive().max(100000), limit, 'logs:getAll') : undefined
    return getLoggingService().getLogs(validLimit)
  })

  ipcMain.handle('logs:clear', async () => {
    getLoggingService().clearLogs()
  })

  ipcMain.handle('logs:setVerbose', async (_event, enabled: unknown) => {
    const validEnabled = validateInput(BooleanSchema, enabled, 'logs:setVerbose')
    getLoggingService().setVerboseLogging(validEnabled)
    return { success: true }
  })

  ipcMain.handle('logs:isVerbose', async () => {
    return getLoggingService().isVerboseEnabled()
  })

  ipcMain.handle('logs:getFileLoggingSettings', async () => {
    const db = getDatabase()
    return {
      enabled: db.getSetting('file_logging_enabled') !== 'false',
      minLevel: (db.getSetting('file_logging_min_level') || 'info') as LogLevel,
      retentionDays: parseInt(db.getSetting('log_retention_days') || '7', 10),
    }
  })

  ipcMain.handle('logs:setFileLoggingSettings', async (_event, settings: unknown) => {
    const valid = validateInput(FileLoggingSettingsSchema, settings, 'logs:setFileLoggingSettings')
    const db = getDatabase()
    if (valid.enabled !== undefined) db.saveSetting('file_logging_enabled', String(valid.enabled))
    if (valid.minLevel !== undefined) db.saveSetting('file_logging_min_level', valid.minLevel)
    if (valid.retentionDays !== undefined) db.saveSetting('log_retention_days', String(valid.retentionDays))
    getLoggingService().updateFileLoggingSettings(valid)
    return { success: true }
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
