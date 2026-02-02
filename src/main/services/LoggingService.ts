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
import * as os from 'os'

export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

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
  private originalConsole: {
    log: typeof console.log
    warn: typeof console.warn
    error: typeof console.error
    info: typeof console.info
    debug: typeof console.debug
  }

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
      message,
      details,
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

  async exportLogs(filePath: string): Promise<void> {
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

  // For plain text export (more readable)
  async exportLogsAsText(filePath: string): Promise<void> {
    const sessionInfo = this.getSessionInfo()
    const uptimeMinutes = Math.round(sessionInfo.uptimeMs / 60000)

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
