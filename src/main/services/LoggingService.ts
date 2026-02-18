/**
 * LoggingService - Centralized logging with buffer and export
 *
 * Features:
 * - Intercepts console.log/warn/error/info
 * - Stores logs in circular buffer (max 2000 entries)
 * - Emits new logs to renderer via IPC
 * - Exports logs to file
 */

import { BrowserWindow, app } from 'electron'
import { safeSend } from '../ipc/utils/safeSend'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

export interface SourceInfo {
  displayName: string
  sourceType: string
  serverVersion: string | null
}

export interface DiagnosticInfo {
  ffprobe: { available: boolean; version: string | null; bundled: boolean }
  database: { path: string; sizeMB: number }
  libraries: { sourceName: string; sourceType: string; itemCount: number }[]
  monitoring: { enabled: boolean }
}

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: string // e.g., "[SourceManager]", "[Database]"
  message: string
  details?: string // Stringified additional args
}

const MAX_INFO_ENTRIES = 2000
const MAX_IMPORTANT_ENTRIES = 500

class LoggingService {
  private infoLogs: LogEntry[] = [] // Circular buffer for info/debug/verbose
  private importantLogs: LogEntry[] = [] // Protected buffer for warn/error
  private mainWindow: BrowserWindow | null = null
  private sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  private startedAt = new Date()
  private verboseEnabled = false
  private homeDir = os.homedir()
  private originalConsole: {
    log: typeof console.log
    warn: typeof console.warn
    error: typeof console.error
    info: typeof console.info
    debug: typeof console.debug
  }

  // File logging
  private fileLoggingEnabled = false // Starts false until initializeFileLogging()
  private fileLoggingMinLevel: LogLevel = 'info'
  private logRetentionDays = 7
  private logDir = ''
  private writeBuffer: string[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isWriting = false
  private currentLogDate = ''

  private static readonly LEVEL_PRIORITY: Record<LogLevel, number> = {
    verbose: 0, debug: 1, info: 2, warn: 3, error: 4,
  }
  private static readonly FLUSH_INTERVAL_MS = 5000
  private static readonly FLUSH_BUFFER_SIZE = 50

  constructor() {
    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    }
  }

  /** Replace the user's home directory with ~ to avoid leaking OS username */
  private sanitize(text: string): string {
    if (!this.homeDir) return text
    // Replace both forward-slash and backslash variants
    const escaped = this.homeDir.replace(/[\\]/g, '\\\\')
    return text.replace(new RegExp(escaped, 'gi'), '~').replace(new RegExp(this.homeDir.replace(/\\/g, '/'), 'gi'), '~')
  }

  initialize(): void {
    this.interceptConsole()
    this.addEntry('info', '[LoggingService]', 'Logging service initialized')
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  private interceptConsole(): void {
    console.log = (...args: unknown[]) => {
      this.originalConsole.log(...args)
      this.captureLog('info', args)
    }
    console.warn = (...args: unknown[]) => {
      this.originalConsole.warn(...args)
      this.captureLog('warn', args)
    }
    console.error = (...args: unknown[]) => {
      this.originalConsole.error(...args)
      this.captureLog('error', args)
    }
    console.info = (...args: unknown[]) => {
      this.originalConsole.info(...args)
      this.captureLog('info', args)
    }
    console.debug = (...args: unknown[]) => {
      this.originalConsole.debug(...args)
      this.captureLog('debug', args)
    }
  }

  private captureLog(level: LogLevel, args: unknown[]): void {
    const message = String(args[0] || '')

    // Extract source from bracketed prefix like "[SourceManager]"
    const sourceMatch = message.match(/^\[([^\]]+)\]/)
    const source = sourceMatch ? sourceMatch[0] : '[App]'
    const cleanMessage = sourceMatch ? message.slice(sourceMatch[0].length).trim() : message

    // Format additional args, with special handling for Error objects
    const details =
      args.length > 1
        ? args
            .slice(1)
            .map((arg) => {
              // Handle Error objects specially to capture stack trace
              if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}\n${arg.stack || 'No stack trace'}`
              }
              try {
                return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
              } catch {
                return String(arg)
              }
            })
            .join('\n\n')
        : undefined

    this.addEntry(level, source, cleanMessage, details)
  }

  private addEntry(level: LogLevel, source: string, message: string, details?: string): void {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      level,
      source,
      message: this.sanitize(message),
      details: details ? this.sanitize(details) : undefined,
    }

    // Route to appropriate buffer based on level
    if (level === 'warn' || level === 'error') {
      this.importantLogs.push(entry)
      // Cap important logs to prevent unbounded growth
      if (this.importantLogs.length > MAX_IMPORTANT_ENTRIES) {
        this.importantLogs = this.importantLogs.slice(-MAX_IMPORTANT_ENTRIES)
      }
    } else {
      this.infoLogs.push(entry)
      // Circular buffer for info logs
      if (this.infoLogs.length > MAX_INFO_ENTRIES) {
        this.infoLogs = this.infoLogs.slice(-MAX_INFO_ENTRIES)
      }
    }

    // Emit to renderer
    if (this.mainWindow) {
      safeSend(this.mainWindow, 'logs:new', entry)
    }

    // Append to file buffer
    this.appendToFileBuffer(entry)
  }

  // Getter to merge both buffers sorted by timestamp
  private get logs(): LogEntry[] {
    return [...this.infoLogs, ...this.importantLogs].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    )
  }

  getLogs(limit?: number): LogEntry[] {
    if (limit) {
      return this.logs.slice(-limit)
    }
    return [...this.logs]
  }

  clearLogs(): void {
    this.infoLogs = []
    this.importantLogs = []
    this.addEntry('info', '[LoggingService]', 'Logs cleared')
  }

  setVerboseLogging(enabled: boolean): void {
    this.verboseEnabled = enabled
    this.addEntry('info', '[LoggingService]', `Verbose logging ${enabled ? 'enabled' : 'disabled'}`)
  }

  isVerboseEnabled(): boolean {
    return this.verboseEnabled
  }

  verbose(source: string, message: string, details?: string): void {
    if (this.verboseEnabled) {
      this.addEntry('verbose', source, message, details)
    }
  }

  getSessionInfo(): { sessionId: string; startedAt: string; uptimeMs: number } {
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt.toISOString(),
      uptimeMs: Date.now() - this.startedAt.getTime(),
    }
  }

  async exportLogs(filePath: string, sourceInfo?: SourceInfo[], diagnostics?: DiagnosticInfo): Promise<void> {
    const sessionInfo = this.getSessionInfo()

    const exportData = {
      exportedAt: new Date().toISOString(),
      sessionId: sessionInfo.sessionId,
      appStartedAt: sessionInfo.startedAt,
      sessionDurationMs: sessionInfo.uptimeMs,
      appVersion: app.getVersion(),
      platform: process.platform,
      osRelease: os.release(),
      arch: os.arch(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      connectedSources: sourceInfo || [],
      diagnostics: diagnostics || null,
      statistics: {
        totalEntries: this.logs.length,
        infoCount: this.infoLogs.length,
        warnCount: this.importantLogs.filter((l) => l.level === 'warn').length,
        errorCount: this.importantLogs.filter((l) => l.level === 'error').length,
      },
      logs: this.logs,
    }

    await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8')
  }

  // ============================================================================
  // File Logging
  // ============================================================================

  /**
   * Initialize file-based logging. Call after database is ready.
   */
  async initializeFileLogging(): Promise<void> {
    try {
      this.logDir = path.join(app.getPath('userData'), 'logs')
      this.loadFileLoggingSettings()

      if (!this.fileLoggingEnabled) {
        this.originalConsole.log('[LoggingService] File logging disabled')
        return
      }

      await fs.mkdir(this.logDir, { recursive: true })
      this.rotateLogFiles().catch(() => {})
      this.flushTimer = setInterval(() => this.flushBuffer(), LoggingService.FLUSH_INTERVAL_MS)

      this.originalConsole.log(`[LoggingService] File logging initialized: ${this.logDir}`)
    } catch (err) {
      this.originalConsole.error('[LoggingService] Failed to initialize file logging:', err)
      this.fileLoggingEnabled = false
    }
  }

  private loadFileLoggingSettings(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getDatabase } = require('../database/getDatabase')
      const db = getDatabase()
      const enabled = db.getSetting('file_logging_enabled')
      const minLevel = db.getSetting('file_logging_min_level')
      const retention = db.getSetting('log_retention_days')

      if (enabled !== null) this.fileLoggingEnabled = enabled !== 'false'
      if (minLevel && minLevel in LoggingService.LEVEL_PRIORITY) {
        this.fileLoggingMinLevel = minLevel as LogLevel
      }
      if (retention) this.logRetentionDays = parseInt(retention, 10) || 7
    } catch {
      // DB may not be ready; use defaults (file logging stays disabled)
    }
  }

  private appendToFileBuffer(entry: LogEntry): void {
    if (!this.fileLoggingEnabled || !this.logDir) return

    if (LoggingService.LEVEL_PRIORITY[entry.level] < LoggingService.LEVEL_PRIORITY[this.fileLoggingMinLevel]) {
      return
    }

    const level = entry.level.toUpperCase().padEnd(7)
    let line = `${entry.timestamp} [${level}] ${entry.source} ${entry.message}`
    if (entry.details) {
      line += `\n  ${entry.details.replace(/\n/g, '\n  ')}`
    }
    this.writeBuffer.push(line + '\n')

    if (this.writeBuffer.length >= LoggingService.FLUSH_BUFFER_SIZE) {
      this.flushBuffer()
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0 || this.isWriting) return

    this.isWriting = true
    const lines = this.writeBuffer.splice(0)

    try {
      const today = new Date().toISOString().split('T')[0]
      const logFile = path.join(this.logDir, `totality-${today}.log`)

      if (today !== this.currentLogDate) {
        this.currentLogDate = today
        this.rotateLogFiles().catch(() => {})
      }

      await fs.appendFile(logFile, lines.join(''), 'utf-8')
    } catch (err) {
      this.originalConsole.error('[LoggingService] Failed to write log file:', err)
    } finally {
      this.isWriting = false
    }
  }

  private async rotateLogFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.logDir)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - this.logRetentionDays)

      for (const file of files) {
        if (!file.startsWith('totality-') || !file.endsWith('.log')) continue
        const dateStr = file.replace('totality-', '').replace('.log', '')
        const fileDate = new Date(dateStr + 'T00:00:00Z')
        if (isNaN(fileDate.getTime())) continue
        if (fileDate < cutoff) {
          await fs.unlink(path.join(this.logDir, file))
          this.originalConsole.log(`[LoggingService] Deleted old log file: ${file}`)
        }
      }
    } catch (err) {
      this.originalConsole.error('[LoggingService] Failed to rotate log files:', err)
    }
  }

  /**
   * Flush buffer and stop file logging (for shutdown)
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flushBuffer()
  }

  /**
   * Update file logging settings at runtime
   */
  updateFileLoggingSettings(settings: {
    enabled?: boolean
    minLevel?: LogLevel
    retentionDays?: number
  }): void {
    if (settings.enabled !== undefined) this.fileLoggingEnabled = settings.enabled
    if (settings.minLevel !== undefined) this.fileLoggingMinLevel = settings.minLevel
    if (settings.retentionDays !== undefined) this.logRetentionDays = settings.retentionDays
  }

  // For plain text export (more readable)
  async exportLogsAsText(filePath: string, sourceInfo?: SourceInfo[], diagnostics?: DiagnosticInfo): Promise<void> {
    const sessionInfo = this.getSessionInfo()
    const uptimeMinutes = Math.round(sessionInfo.uptimeMs / 60000)

    const sourceLines: string[] = []
    if (sourceInfo && sourceInfo.length > 0) {
      sourceLines.push('Connected Sources:')
      for (const s of sourceInfo) {
        const version = s.serverVersion ? ` v${s.serverVersion}` : ''
        sourceLines.push(`  - ${s.displayName} (${s.sourceType}${version})`)
      }
    } else {
      sourceLines.push('Connected Sources: none')
    }

    const diagnosticLines: string[] = []
    if (diagnostics) {
      const ff = diagnostics.ffprobe
      const ffStatus = ff.available
        ? `available (${ff.version ? `v${ff.version}` : 'unknown version'}, ${ff.bundled ? 'bundled' : 'system'})`
        : 'not available'
      diagnosticLines.push(`FFprobe: ${ffStatus}`)
      const dbFileName = diagnostics.database.path !== 'unknown' ? diagnostics.database.path.split(/[/\\]/).pop() : 'unknown'
      diagnosticLines.push(`Database: ${dbFileName} (${diagnostics.database.sizeMB} MB)`)
      if (diagnostics.libraries.length > 0) {
        const libSummary = diagnostics.libraries.map(l => `${l.sourceName}/${l.sourceType} (${l.itemCount} items)`).join(', ')
        diagnosticLines.push(`Libraries: ${libSummary}`)
      } else {
        diagnosticLines.push('Libraries: none')
      }
      diagnosticLines.push(`Monitoring: ${diagnostics.monitoring.enabled ? 'enabled' : 'disabled'}`)
    }

    const header = [
      `Totality Log Export`,
      `Exported: ${new Date().toISOString()}`,
      `Session ID: ${sessionInfo.sessionId}`,
      `App Started: ${sessionInfo.startedAt}`,
      `Session Duration: ${uptimeMinutes} minutes`,
      `App Version: ${app.getVersion()}`,
      `Platform: ${process.platform} ${os.release()} (${os.arch()})`,
      `Memory: ${Math.round(os.freemem() / 1024 / 1024)} MB free / ${Math.round(os.totalmem() / 1024 / 1024)} MB total`,
      `Entries: ${this.logs.length} (${this.importantLogs.filter((l) => l.level === 'error').length} errors, ${this.importantLogs.filter((l) => l.level === 'warn').length} warnings)`,
      ...sourceLines,
      ...diagnosticLines,
      '─'.repeat(80),
      '',
    ].join('\n')

    const logLines = this.logs
      .map((entry) => {
        const time = entry.timestamp.replace('T', ' ').replace('Z', '')
        const level = entry.level.toUpperCase().padEnd(5)
        const line = `${time} ${level} ${entry.source} ${entry.message}`
        return entry.details ? `${line}\n         ${entry.details}` : line
      })
      .join('\n')

    await fs.writeFile(filePath, header + logLines, 'utf-8')
  }
}

// Singleton
let loggingService: LoggingService | null = null

export function getLoggingService(): LoggingService {
  if (!loggingService) {
    loggingService = new LoggingService()
  }
  return loggingService
}
