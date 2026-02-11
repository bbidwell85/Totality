/**
 * AutoUpdateService - Handles automatic application updates via electron-updater
 *
 * Uses GitHub Releases as the update source. Checks for updates on a schedule
 * and emits state changes to the renderer process.
 */

import { app, BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { safeSend } from '../ipc/utils/safeSend'
import { getDatabaseServiceSync } from '../database/DatabaseFactory'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  releaseNotes?: string
  downloadProgress?: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }
  error?: string
  lastChecked?: string
}

const CHECK_DELAY_MS = 30_000       // 30 seconds after startup
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

export class AutoUpdateService {
  private mainWindow: BrowserWindow | null = null
  private state: UpdateState = { status: 'idle' }
  private checkTimer: NodeJS.Timeout | null = null
  private initialized = false

  initialize(): void {
    if (this.initialized) return

    // Skip auto-update in development
    if (!app.isPackaged) {
      console.log('[AutoUpdate] Skipping — app is not packaged')
      this.initialized = true
      return
    }

    this.initialized = true

    // Configure autoUpdater
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = null // We handle logging ourselves

    // Wire up events
    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({
        status: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : undefined,
      })
    })

    autoUpdater.on('update-not-available', (_info: UpdateInfo) => {
      this.setState({
        status: 'not-available',
        lastChecked: new Date().toISOString(),
      })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setState({
        status: 'downloading',
        downloadProgress: {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState({
        status: 'downloaded',
        version: info.version,
        lastChecked: new Date().toISOString(),
      })
    })

    autoUpdater.on('error', (err: Error) => {
      console.error('[AutoUpdate] Error:', err.message)
      this.setState({
        status: 'error',
        error: err.message,
      })
    })

    // Schedule first check
    setTimeout(() => {
      this.autoCheckIfEnabled()
    }, CHECK_DELAY_MS)

    // Schedule recurring checks
    this.checkTimer = setInterval(() => {
      this.autoCheckIfEnabled()
    }, CHECK_INTERVAL_MS)

    console.log('[AutoUpdate] Initialized')
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  /**
   * Check for updates (manual trigger from UI)
   */
  async checkForUpdates(): Promise<void> {
    if (!app.isPackaged) {
      this.setState({ status: 'not-available', lastChecked: new Date().toISOString() })
      return
    }

    try {
      await autoUpdater.checkForUpdates()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[AutoUpdate] Check failed:', msg)
      this.setState({ status: 'error', error: msg })
    }
  }

  /**
   * Download the available update
   */
  async downloadUpdate(): Promise<void> {
    if (!app.isPackaged) return

    try {
      await autoUpdater.downloadUpdate()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[AutoUpdate] Download failed:', msg)
      this.setState({ status: 'error', error: msg })
    }
  }

  /**
   * Quit and install the downloaded update
   */
  async installUpdate(): Promise<void> {
    if (!app.isPackaged) return

    // Save database before quitting
    try {
      const db = getDatabaseServiceSync()
      await db.close()
    } catch (err) {
      console.error('[AutoUpdate] Failed to close database before update:', err)
    }

    // isSilent=false shows install progress, isForceRunAfter=true relaunches app
    autoUpdater.quitAndInstall(false, true)
  }

  cleanup(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  private async autoCheckIfEnabled(): Promise<void> {
    // Read setting from database
    try {
      const db = getDatabaseServiceSync()
      const setting = db.getSetting('auto_update_enabled')
      // Default to enabled if setting not present
      if (setting === 'false') {
        return
      }
    } catch {
      // If DB read fails, still check for updates
    }

    await this.checkForUpdates()
  }

  private setState(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial }
    this.emitState()
  }

  private emitState(): void {
    safeSend(this.mainWindow, 'autoUpdate:stateChanged', this.state)
  }
}

// Singleton
let instance: AutoUpdateService | null = null

export function getAutoUpdateService(): AutoUpdateService {
  if (!instance) {
    instance = new AutoUpdateService()
  }
  return instance
}
