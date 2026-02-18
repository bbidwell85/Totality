import { getErrorMessage } from './utils/errorUtils'
/**
 * LiveMonitoringService - Background service for detecting media library changes
 *
 * Features:
 * - File watching for local sources using chokidar
 * - Polling for remote sources (Plex, Jellyfin, Emby, Kodi)
 * - Pauses during manual scans to avoid conflicts
 * - Respects user_fixed_match during scans
 * - Configurable polling intervals per provider type
 * - Notifications for both added AND updated items
 */

import { BrowserWindow } from 'electron'
import * as chokidar from 'chokidar'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { getDatabase } from '../database/getDatabase'
import { getSourceManager } from './SourceManager'
import { safeSend } from '../ipc/utils/safeSend'
import {
  MonitoringConfig,
  DEFAULT_MONITORING_CONFIG,
  ProviderType,
  SourceChangeEvent,
  ChangedItem,
} from '../types/monitoring'

// Media file extensions to watch
const MEDIA_EXTENSIONS = new Set([
  // Video
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m2ts',
  // Audio
  '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.alac', '.aiff', '.opus',
])

/**
 * Cache of Windows network drive letters, detected once at startup via wmic.
 * DriveType 4 = "Network Drive" in Win32_LogicalDisk.
 */
let networkDriveLetters: Set<string> | null = null

function detectWindowsNetworkDrives(): Set<string> {
  if (networkDriveLetters) return networkDriveLetters
  networkDriveLetters = new Set()
  if (process.platform !== 'win32') return networkDriveLetters
  try {
    const output = execSync('wmic logicaldisk get DeviceID,DriveType', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    })
    // Output looks like:
    // DeviceID  DriveType
    // C:        3
    // Z:        4
    for (const line of output.split('\n')) {
      const match = line.match(/^([A-Z]):?\s+(\d+)/)
      if (match && match[2] === '4') {
        networkDriveLetters.add(match[1])
      }
    }
  } catch {
    // wmic unavailable or timed out — fall back to empty set (treat all drives as local)
  }
  return networkDriveLetters
}

/**
 * Detect if a path is likely a network/NAS path where native watchers are unreliable.
 * On Windows, uses wmic to detect actual mapped network drives instead of guessing by letter.
 */
function isNetworkPath(filePath: string): boolean {
  // Windows UNC paths: \\server\share
  if (filePath.startsWith('\\\\')) return true

  // Windows mapped drives — check actual drive type via wmic
  if (process.platform === 'win32') {
    const driveLetter = filePath.match(/^([A-Za-z]):/)?.[1]?.toUpperCase()
    if (driveLetter && detectWindowsNetworkDrives().has(driveLetter)) {
      return true
    }
  }

  // Linux/Mac network mounts
  if (filePath.startsWith('/mnt/') || filePath.startsWith('/Volumes/') ||
      filePath.includes('/smb/') || filePath.includes('/nfs/')) {
    return true
  }

  return false
}

export class LiveMonitoringService {
  private config: MonitoringConfig = { ...DEFAULT_MONITORING_CONFIG }
  private isActive = false
  private isPausedByTaskQueue = false // Track if paused by task queue (vs user manually stopping)
  private mainWindow: BrowserWindow | null = null

  // Polling state (for remote sources)
  private pollingTimers: Map<string, NodeJS.Timeout> = new Map()
  private lastCheckTimes: Map<string, Date> = new Map()

  // File watching state (for local sources)
  private fileWatchers: Map<string, chokidar.FSWatcher> = new Map()
  private fileChangeDebounce: Map<string, NodeJS.Timeout> = new Map()
  private pendingFileChanges: Map<string, Set<string>> = new Map()

  // Timing constants
  private static readonly MIN_POLL_INTERVAL_MS = 30000 // Minimum 30s between polls
  private static readonly FILE_CHANGE_DEBOUNCE_MS = 2000 // Wait 2s after last file change
  private static readonly STARTUP_DELAY_MS = 5000 // Delay before starting monitoring on app launch
  private static readonly FIRST_POLL_DELAY_MS = 5000 // Delay before first poll after starting
  private static readonly NETWORK_POLL_INTERVAL_MS = 10000 // 10s polling interval for network paths
  private static readonly WRITE_STABILITY_THRESHOLD_MS = 2000 // Wait for file writes to stabilize
  private static readonly CHOKIDAR_POLL_INTERVAL_MS = 500 // Poll interval for chokidar awaitWriteFinish
  private static readonly MAX_REASONABLE_CHANGES = 50 // Max file changes to process at once
  private static readonly POLL_TIMEOUT_MS = 120000 // 2-minute timeout for polling a source

  /**
   * Initialize the monitoring service
   */
  async initialize(): Promise<void> {
    const db = getDatabase()

    // Load config from database settings
    const enabled = db.getSetting('monitoring_enabled')
    this.config.enabled = enabled === 'true'

    const startOnLaunch = db.getSetting('monitoring_start_on_launch')
    this.config.startOnLaunch = startOnLaunch !== 'false' // Default true

    const pauseDuringManualScan = db.getSetting('monitoring_pause_during_scan')
    this.config.pauseDuringManualScan = pauseDuringManualScan !== 'false' // Default true

    // Load per-provider intervals
    const providerTypes: ProviderType[] = ['plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'local']
    for (const provider of providerTypes) {
      const interval = db.getSetting(`monitoring_interval_${provider}`)
      if (interval) {
        const parsed = parseInt(interval, 10)
        if (!Number.isNaN(parsed)) {
          this.config.pollingIntervals[provider] = Math.max(
            parsed,
            LiveMonitoringService.MIN_POLL_INTERVAL_MS
          )
        }
      }
    }

    // Auto-start if enabled
    if (this.config.enabled && this.config.startOnLaunch) {
      // Delay start to allow app initialization
      setTimeout(() => this.start(), LiveMonitoringService.STARTUP_DELAY_MS)
    }
  }

  /**
   * Set the main window reference for IPC events
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  /**
   * Get current configuration
   */
  getConfig(): MonitoringConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  async setConfig(config: Partial<MonitoringConfig>): Promise<void> {
    const wasActive = this.isActive
    const wasEnabled = this.config.enabled

    // Update config
    this.config = { ...this.config, ...config }

    // Persist to database
    const db = getDatabase()
    if (config.enabled !== undefined) {
      await db.setSetting('monitoring_enabled', config.enabled.toString())
    }
    if (config.startOnLaunch !== undefined) {
      await db.setSetting('monitoring_start_on_launch', config.startOnLaunch.toString())
    }
    if (config.pauseDuringManualScan !== undefined) {
      await db.setSetting('monitoring_pause_during_scan', config.pauseDuringManualScan.toString())
    }
    if (config.pollingIntervals) {
      for (const [provider, interval] of Object.entries(config.pollingIntervals)) {
        await db.setSetting(`monitoring_interval_${provider}`, interval.toString())
      }
    }

    // Handle enable/disable
    if (wasEnabled && !this.config.enabled && wasActive) {
      this.stop()
    } else if (!wasEnabled && this.config.enabled) {
      this.start()
    } else if (wasActive && config.pollingIntervals) {
      // Restart with new intervals
      this.stop()
      this.start()
    }
  }

  /**
   * Check if monitoring is currently active
   */
  isMonitoringActive(): boolean {
    return this.isActive
  }

  /**
   * Start monitoring all enabled sources
   */
  start(): void {
    if (this.isActive) {
      console.log('[LiveMonitoring] Already active')
      return
    }

    if (!this.config.enabled) {
      console.log('[LiveMonitoring] Monitoring is disabled')
      return
    }

    console.log('[LiveMonitoring] Starting...')
    this.isActive = true

    // Get all enabled sources
    const db = getDatabase()
    const sources = db.getEnabledMediaSources()

    for (const source of sources) {
      this.startMonitoringSource(source.source_id, source.source_type as ProviderType, source.connection_config)
    }

    this.sendStatusUpdate()
  }

  /**
   * Stop all monitoring
   */
  stop(): void {
    if (!this.isActive) {
      console.log('[LiveMonitoring] Already stopped')
      return
    }

    console.log('[LiveMonitoring] Stopping...')

    // Clear all polling timers
    for (const [sourceId, timer] of this.pollingTimers) {
      clearTimeout(timer)
      console.log(`[LiveMonitoring] Stopped polling for ${sourceId}`)
    }
    this.pollingTimers.clear()

    // Close all file watchers (fire-and-forget, but log errors)
    for (const [sourceId, watcher] of this.fileWatchers) {
      watcher.close().catch((err) => {
        console.error(`[LiveMonitoring] Error closing watcher for ${sourceId}:`, err)
      })
      console.log(`[LiveMonitoring] Stopped watching ${sourceId}`)
    }
    this.fileWatchers.clear()

    // Clear debounce timers
    for (const timer of this.fileChangeDebounce.values()) {
      clearTimeout(timer)
    }
    this.fileChangeDebounce.clear()
    this.pendingFileChanges.clear()
    this.lastCheckTimes.clear()

    this.isActive = false
    this.sendStatusUpdate()
  }

  /**
   * Pause monitoring (called by TaskQueueService during scans)
   * Unlike stop(), this remembers we were active and can be resumed
   */
  pause(): void {
    if (!this.isActive) {
      return
    }

    console.log('[LiveMonitoring] Pausing for task queue - stopping all timers')
    this.emitDebugEvent('info', 'Monitoring paused for scan')

    // Clear all polling timers
    for (const [, timer] of this.pollingTimers) {
      clearTimeout(timer)
    }
    this.pollingTimers.clear()

    // Clear debounce timers for file changes
    for (const timer of this.fileChangeDebounce.values()) {
      clearTimeout(timer)
    }
    this.fileChangeDebounce.clear()

    // Clear pending file changes to avoid processing stale data on resume
    this.pendingFileChanges.clear()

    // Keep file watchers running but they won't trigger scans while paused
    // New changes will accumulate in pendingFileChanges but get cleared on resume

    this.isPausedByTaskQueue = true
    this.isActive = false
    this.sendStatusUpdate()
  }

  /**
   * Resume monitoring after task queue completes
   * Only resumes if we were paused by the task queue (not manually stopped)
   */
  resume(): void {
    if (!this.isPausedByTaskQueue) {
      return
    }

    console.log('[LiveMonitoring] Resuming after task queue - restarting timers')
    this.emitDebugEvent('info', 'Monitoring resumed after scan')

    // Clear any accumulated file changes to avoid flooding
    this.pendingFileChanges.clear()

    this.isPausedByTaskQueue = false

    // Restart monitoring
    this.start()
  }

  /**
   * Check if monitoring is currently active (for TaskQueueService to check before pausing)
   */
  isActiveAndEnabled(): boolean {
    return this.isActive && this.config.enabled
  }

  /**
   * Start monitoring a specific source
   */
  private startMonitoringSource(sourceId: string, sourceType: ProviderType, connectionConfig: string): void {
    const isLocalSource = sourceType === 'local' || sourceType === 'kodi-local'

    if (isLocalSource) {
      this.startFileWatcher(sourceId, sourceType, connectionConfig)
    } else {
      this.startPolling(sourceId, sourceType)
    }
  }

  /**
   * Start file system watching for a local source using chokidar
   * Uses polling for network paths to ensure reliability
   */
  private startFileWatcher(sourceId: string, sourceType: ProviderType, connectionConfig: string): void {
    try {
      const config = JSON.parse(connectionConfig)
      let watchPath: string | undefined

      if (sourceType === 'local') {
        watchPath = config.folderPath
      } else if (sourceType === 'kodi-local') {
        // For kodi-local, we watch the database file for changes
        watchPath = config.databasePath
      }

      if (!watchPath) {
        console.log(`[LiveMonitoring] No path to watch for ${sourceId}`)
        return
      }

      // Get source display name for debug output
      const db = getDatabase()
      const source = db.getMediaSourceById(sourceId)
      const sourceName = source?.display_name || config.name || sourceId

      // Determine if we should use polling (for network paths)
      const usePolling = isNetworkPath(watchPath)

      console.log(`[LiveMonitoring] Starting file watcher for ${sourceName} (usePolling: ${usePolling})`)
      this.emitDebugEvent('info', `Starting file watcher: ${sourceName} (${usePolling ? 'polling' : 'native'})`)

      const watcher = chokidar.watch(watchPath, {
        ignored: /(^|[/\\])\./, // Ignore hidden files (starting with dot)
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: LiveMonitoringService.WRITE_STABILITY_THRESHOLD_MS,
          pollInterval: LiveMonitoringService.CHOKIDAR_POLL_INTERVAL_MS,
        },
        usePolling,
        interval: usePolling ? LiveMonitoringService.NETWORK_POLL_INTERVAL_MS : undefined,
        binaryInterval: usePolling ? LiveMonitoringService.NETWORK_POLL_INTERVAL_MS : undefined,
      })

      watcher.on('add', (filePath) => {
        try {
          if (this.isMediaFile(filePath)) {
            this.handleFileChange(sourceId, 'add', filePath)
          }
        } catch (error) {
          console.error(`[LiveMonitoring] Error handling file add for ${sourceName}:`, error)
        }
      })

      watcher.on('change', (filePath) => {
        try {
          if (this.isMediaFile(filePath)) {
            this.handleFileChange(sourceId, 'change', filePath)
          }
        } catch (error) {
          console.error(`[LiveMonitoring] Error handling file change for ${sourceName}:`, error)
        }
      })

      watcher.on('unlink', (filePath) => {
        try {
          if (this.isMediaFile(filePath)) {
            this.handleFileChange(sourceId, 'unlink', filePath)
          }
        } catch (error) {
          console.error(`[LiveMonitoring] Error handling file unlink for ${sourceName}:`, error)
        }
      })

      watcher.on('error', (error) => {
        console.error(`[LiveMonitoring] Watcher error for ${sourceName}:`, error)
        this.emitDebugEvent('error', `[${sourceName}] Watcher error: ${getErrorMessage(error) || error}`)
        try {
          this.handleWatcherError(sourceId, sourceType, watchPath!)
        } catch (handlerError) {
          console.error(`[LiveMonitoring] Error in watcher error handler for ${sourceName}:`, handlerError)
        }
      })

      watcher.on('ready', () => {
        console.log(`[LiveMonitoring] Watcher ready for ${sourceName}`)
        this.emitDebugEvent('info', `[${sourceName}] File watcher ready`)
      })

      this.fileWatchers.set(sourceId, watcher)
    } catch (error) {
      console.error(`[LiveMonitoring] Failed to start watcher for ${sourceId}:`, error)
    }
  }

  /**
   * Check if a file is a media file based on extension
   */
  private isMediaFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return MEDIA_EXTENSIONS.has(ext)
  }

  /**
   * Handle watcher error by falling back to polling
   */
  private handleWatcherError(sourceId: string, sourceType: ProviderType, _watchPath: string): void {
    // Close the failed watcher (fire-and-forget with error logging)
    const watcher = this.fileWatchers.get(sourceId)
    if (watcher) {
      this.fileWatchers.delete(sourceId) // Remove from map first to prevent double-close
      watcher.close().catch((err) => {
        console.error(`[LiveMonitoring] Error closing failed watcher for ${sourceId}:`, err)
      })
    }

    // Clear any pending debounce timer for this source
    const debounceTimer = this.fileChangeDebounce.get(sourceId)
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      this.fileChangeDebounce.delete(sourceId)
    }
    this.pendingFileChanges.delete(sourceId)

    console.log(`[LiveMonitoring] Watcher failed for ${sourceId}, falling back to polling`)

    // Fall back to polling for this source
    this.startPolling(sourceId, sourceType)
  }

  /**
   * Handle a file system change event
   */
  private handleFileChange(sourceId: string, event: 'add' | 'change' | 'unlink', filePath: string): void {
    // Skip all file changes during manual scan to avoid interference
    if (this.shouldPause()) {
      return
    }

    // Get source name for debug output
    const db = getDatabase()
    const source = db.getMediaSourceById(sourceId)
    const sourceName = source?.display_name || sourceId

    console.log(`[LiveMonitoring] File ${event}: ${path.basename(filePath)}`)
    const fileName = path.basename(filePath)
    this.emitDebugEvent(event === 'unlink' ? 'removed' : 'info', `[${sourceName}] File ${event}: ${fileName}`)

    // Track pending changes
    if (!this.pendingFileChanges.has(sourceId)) {
      this.pendingFileChanges.set(sourceId, new Set())
    }
    this.pendingFileChanges.get(sourceId)!.add(filePath)

    // Debounce - wait for changes to settle
    if (this.fileChangeDebounce.has(sourceId)) {
      clearTimeout(this.fileChangeDebounce.get(sourceId)!)
    }

    this.fileChangeDebounce.set(
      sourceId,
      setTimeout(() => this.processFileChanges(sourceId), LiveMonitoringService.FILE_CHANGE_DEBOUNCE_MS)
    )
  }

  /**
   * Process accumulated file changes for a source
   */
  private async processFileChanges(sourceId: string): Promise<void> {
    const changes = this.pendingFileChanges.get(sourceId)
    if (!changes || changes.size === 0) return

    // Clear pending changes immediately to prevent re-processing
    const changedFiles = Array.from(changes)
    this.pendingFileChanges.delete(sourceId)
    this.fileChangeDebounce.delete(sourceId)

    try {
      // Check if manual scan is in progress
      if (this.shouldPause()) {
        console.log(`[LiveMonitoring] Manual scan in progress, discarding ${changedFiles.length} file changes for ${sourceId}`)
        return
      }

      // Safety check: if too many files changed at once, it's probably from scan interference
      // Normal user operations would be adding/removing a few files at a time
      if (changedFiles.length > LiveMonitoringService.MAX_REASONABLE_CHANGES) {
        console.log(`[LiveMonitoring] Too many file changes (${changedFiles.length}), likely scan interference - skipping`)
        return
      }

      console.log(`[LiveMonitoring] Processing ${changedFiles.length} file changes for ${sourceId}`)

      // Use targeted file scanning (much faster than full scan)
      await this.checkSourceWithTargetedFiles(sourceId, changedFiles)
    } catch (error) {
      console.error(`[LiveMonitoring] Error processing file changes for ${sourceId}:`, error)
    }
  }

  /**
   * Check a source using targeted file scanning (for file watcher changes)
   */
  private async checkSourceWithTargetedFiles(sourceId: string, filePaths: string[]): Promise<SourceChangeEvent[]> {
    const sourceManager = getSourceManager()
    const db = getDatabase()

    // Get source info
    const source = db.getMediaSourceById(sourceId)
    if (!source) {
      console.log(`[LiveMonitoring] Source ${sourceId} not found`)
      return []
    }

    // Get libraries for this source
    type LibraryInfo = { libraryId: string; libraryName: string; libraryType: string; isEnabled: boolean; lastScanAt: string | null; itemsScanned: number }
    const libraries = db.getSourceLibraries(sourceId) as LibraryInfo[]
    const enabledLibraries = libraries.filter((lib: LibraryInfo) => lib.isEnabled)

    const events: SourceChangeEvent[] = []

    // Determine which library the files belong to (for local sources, usually just one library)
    for (const library of enabledLibraries) {
      try {
        // Run targeted scan with specific files
        const result = await sourceManager.scanTargetedFiles(
          sourceId,
          library.libraryId,
          filePaths,
          () => {} // Silent progress
        )

        console.log(`[LiveMonitoring] Scan result for ${library.libraryId}: success=${result.success}, added=${result.itemsAdded}, updated=${result.itemsUpdated}, removed=${result.itemsRemoved}`)

        // Check for changes
        if (result.success && (result.itemsAdded > 0 || result.itemsUpdated > 0 || result.itemsRemoved > 0)) {
          // Build list of changed items
          const changedItems: ChangedItem[] = []

          // Look up the actual items that were changed by their file paths
          if (result.itemsAdded > 0 || result.itemsUpdated > 0) {
            // Determine if this is a music library
            const libraryType = library.libraryId.split(':')[0]
            const isMusic = libraryType === 'music'

            // Only look up files that still exist (added/updated, not deleted)
            const existingFiles = filePaths.filter(fp => {
              try {
                return fs.existsSync(fp)
              } catch {
                return false
              }
            })

            if (isMusic) {
              // Look up each track by its file path
              for (const filePath of existingFiles) {
                const track = db.getMusicTrackByPath(filePath)
                if (track) {
                  // Get album artwork if available
                  let posterUrl: string | undefined
                  if (track.album_id) {
                    const album = db.getMusicAlbumById(track.album_id)
                    posterUrl = album?.thumb_url || undefined
                  }

                  changedItems.push({
                    id: track.id?.toString() || '',
                    title: track.title,
                    type: 'track',
                    artistName: track.artist_name || undefined,
                    posterUrl,
                  })
                }
              }
            } else {
              // Look up each video item by its file path
              for (const filePath of existingFiles) {
                const item = db.getMediaItemByPath(filePath)
                if (item) {
                  changedItems.push({
                    id: item.id?.toString() || '',
                    title: item.title,
                    type: item.type as 'movie' | 'episode',
                    year: item.year || undefined,
                    posterUrl: item.poster_url || undefined,
                    seriesTitle: item.series_title || undefined,
                  })
                }
              }
            }
          }

          // Determine change type
          let changeType: 'added' | 'updated' | 'removed' | 'mixed' = 'added'
          if (result.itemsRemoved > 0 && result.itemsAdded === 0 && result.itemsUpdated === 0) {
            changeType = 'removed'
          } else if (result.itemsAdded > 0 && result.itemsUpdated > 0) {
            changeType = 'mixed'
          } else if (result.itemsUpdated > 0) {
            changeType = 'updated'
          }

          const totalChanges = result.itemsAdded + result.itemsUpdated + result.itemsRemoved

          const event: SourceChangeEvent = {
            sourceId,
            sourceName: source.display_name,
            sourceType: source.source_type as ProviderType,
            libraryId: library.libraryId,
            libraryName: library.libraryName,
            changeType,
            itemCount: totalChanges,
            items: changedItems,
            detectedAt: new Date().toISOString(),
          }

          events.push(event)

          // Build notification message
          const parts: string[] = []
          if (result.itemsAdded > 0) {
            parts.push(`${result.itemsAdded} new`)
          }
          if (result.itemsUpdated > 0) {
            parts.push(`${result.itemsUpdated} updated`)
          }
          if (result.itemsRemoved > 0) {
            parts.push(`${result.itemsRemoved} removed`)
          }
          const changeDescription = parts.join(', ')

          // Emit debug events for detected changes
          if (result.itemsAdded > 0) {
            for (const item of changedItems.slice(0, result.itemsAdded)) {
              this.emitDebugEvent('added', `[${source.display_name}] Added: ${item.title}`)
            }
          }
          if (result.itemsUpdated > 0) {
            this.emitDebugEvent('info', `[${source.display_name}] ${result.itemsUpdated} item(s) updated in ${library.libraryName}`)
          }
          if (result.itemsRemoved > 0) {
            this.emitDebugEvent('removed', `[${source.display_name}] ${result.itemsRemoved} item(s) removed from ${library.libraryName}`)
          }

          console.log(`[LiveMonitoring] Targeted scan complete for ${library.libraryName}: ${changeDescription}`)
        }
      } catch (error) {
        console.error(`[LiveMonitoring] Error in targeted scan for library ${library.libraryId}:`, error)
      }
    }

    // Notify renderer
    this.sendToRenderer('monitoring:sourceChecked', {
      sourceId,
      hasChanges: events.length > 0,
    })

    // Check wishlist for auto-completion after items were added or updated
    if (events.some((e) => e.changeType === 'added' || e.changeType === 'updated' || e.changeType === 'mixed')) {
      import('./WishlistCompletionService').then(({ getWishlistCompletionService }) => {
        getWishlistCompletionService().checkAndComplete().catch((err) => {
          console.error('[LiveMonitoring] Wishlist completion check failed:', getErrorMessage(err))
        })
      })
    }

    return events
  }

  /**
   * Start polling for a remote source
   */
  private startPolling(sourceId: string, sourceType: ProviderType): void {
    const interval = this.config.pollingIntervals[sourceType] || DEFAULT_MONITORING_CONFIG.pollingIntervals[sourceType]

    console.log(`[LiveMonitoring] Starting polling for ${sourceId} (${sourceType}) every ${interval / 1000}s`)

    // Schedule first check after a short delay
    const timer = setTimeout(() => this.pollSource(sourceId, sourceType), LiveMonitoringService.FIRST_POLL_DELAY_MS)
    this.pollingTimers.set(sourceId, timer)
  }

  /**
   * Poll a source for changes
   */
  private async pollSource(sourceId: string, sourceType: ProviderType): Promise<void> {
    try {
      // Check if we should pause
      if (this.shouldPause()) {
        console.log(`[LiveMonitoring] Manual scan in progress, skipping poll for ${sourceId}`)
        this.scheduleNextPoll(sourceId, sourceType)
        return
      }

      if (!this.isActive) return

      // Get source name for debug output
      const db = getDatabase()
      const source = db.getMediaSourceById(sourceId)
      const sourceName = source?.display_name || sourceId

      console.log(`[LiveMonitoring] Polling ${sourceName}...`)
      this.emitDebugEvent('poll', `Polling: ${sourceName}`)
      this.lastCheckTimes.set(sourceId, new Date())

      await Promise.race([
        this.checkSource(sourceId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Poll timed out for ${sourceName}`)), LiveMonitoringService.POLL_TIMEOUT_MS)
        ),
      ])
    } catch (error) {
      console.error(`[LiveMonitoring] Error polling ${sourceId}:`, error)
      this.emitDebugEvent('error', `Polling error: ${sourceId}`)
    } finally {
      // Always schedule next poll, even if this one failed
      if (this.isActive) {
        this.scheduleNextPoll(sourceId, sourceType)
      }
    }
  }

  /**
   * Schedule the next poll for a source
   */
  private scheduleNextPoll(sourceId: string, sourceType: ProviderType): void {
    if (!this.isActive) return

    // Clear any existing timer to prevent accumulation
    const existingTimer = this.pollingTimers.get(sourceId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const interval = this.config.pollingIntervals[sourceType] || DEFAULT_MONITORING_CONFIG.pollingIntervals[sourceType]
    const timer = setTimeout(() => this.pollSource(sourceId, sourceType), interval)
    this.pollingTimers.set(sourceId, timer)
  }

  /**
   * Check a source for changes using incremental scan
   */
  private async checkSource(sourceId: string): Promise<SourceChangeEvent[]> {
    const sourceManager = getSourceManager()
    const db = getDatabase()

    // Get source info
    const source = db.getMediaSourceById(sourceId)
    if (!source) {
      console.log(`[LiveMonitoring] Source ${sourceId} not found`)
      return []
    }

    // Get libraries for this source
    type LibraryInfo = { libraryId: string; libraryName: string; libraryType: string; isEnabled: boolean; lastScanAt: string | null; itemsScanned: number }
    const libraries = db.getSourceLibraries(sourceId) as LibraryInfo[]
    const enabledLibraries = libraries.filter((lib: LibraryInfo) => lib.isEnabled)

    const events: SourceChangeEvent[] = []

    for (const library of enabledLibraries) {
      try {
        // Run incremental scan
        const result = await sourceManager.scanLibraryIncremental(
          sourceId,
          library.libraryId,
          () => {} // Silent progress
        )

        // Check for both added AND updated items
        if (result.success && (result.itemsAdded > 0 || result.itemsUpdated > 0)) {
          // Get recently changed items from THIS library (sorted by updated_at)
          const recentItems = db.getMediaItems({
            sourceId,
            libraryId: library.libraryId,
            sortBy: 'updated_at',
            sortOrder: 'desc',
            limit: result.itemsAdded + result.itemsUpdated,
          }) as Array<{ id?: number; title: string; type: string; year?: number; poster_url?: string; series_title?: string }>

          const changedItems: ChangedItem[] = recentItems.map((item: typeof recentItems[0]) => ({
            id: item.id?.toString() || '',
            title: item.title,
            type: item.type as 'movie' | 'episode',
            year: item.year || undefined,
            posterUrl: item.poster_url || undefined,
            seriesTitle: item.series_title || undefined,
          }))

          // Determine change type
          let changeType: 'added' | 'updated' | 'mixed' = 'added'
          if (result.itemsAdded > 0 && result.itemsUpdated > 0) {
            changeType = 'mixed'
          } else if (result.itemsUpdated > 0) {
            changeType = 'updated'
          }

          const event: SourceChangeEvent = {
            sourceId,
            sourceName: source.display_name,
            sourceType: source.source_type as ProviderType,
            libraryId: library.libraryId,
            libraryName: library.libraryName,
            changeType,
            itemCount: result.itemsAdded + result.itemsUpdated,
            items: changedItems,
            detectedAt: new Date().toISOString(),
          }

          events.push(event)

          // Emit debug events for detected changes
          if (result.itemsAdded > 0) {
            for (const item of changedItems.slice(0, result.itemsAdded)) {
              this.emitDebugEvent('added', `[${source.display_name}] Added: ${item.title}${item.seriesTitle ? ` (${item.seriesTitle})` : ''}`)
            }
          }
          if (result.itemsUpdated > 0) {
            this.emitDebugEvent('info', `[${source.display_name}] ${result.itemsUpdated} item(s) updated in ${library.libraryName}`)
          }

          const changeDescription = result.itemsAdded > 0 && result.itemsUpdated > 0
            ? `${result.itemsAdded} new, ${result.itemsUpdated} updated`
            : result.itemsAdded > 0 ? `${result.itemsAdded} new` : `${result.itemsUpdated} updated`

          console.log(`[LiveMonitoring] Detected changes in ${library.libraryName}: ${changeDescription}`)
        }

        // Handle removed items
        if (result.success && result.itemsRemoved > 0) {
          const event: SourceChangeEvent = {
            sourceId,
            sourceName: source.display_name,
            sourceType: source.source_type as ProviderType,
            libraryId: library.libraryId,
            libraryName: library.libraryName,
            changeType: 'removed',
            itemCount: result.itemsRemoved,
            items: [],
            detectedAt: new Date().toISOString(),
          }
          events.push(event)

          // Emit debug event for removals
          this.emitDebugEvent('removed', `[${source.display_name}] ${result.itemsRemoved} item(s) removed from ${library.libraryName}`)

          console.log(`[LiveMonitoring] Detected ${result.itemsRemoved} removed items in ${library.libraryName}`)
        }
      } catch (error) {
        console.error(`[LiveMonitoring] Error checking library ${library.libraryId}:`, error)
      }
    }

    // Notify renderer of source check completion
    this.sendToRenderer('monitoring:sourceChecked', {
      sourceId,
      hasChanges: events.length > 0,
    })

    // Check wishlist for auto-completion after items were added or updated
    if (events.some((e) => e.changeType === 'added' || e.changeType === 'updated' || e.changeType === 'mixed')) {
      import('./WishlistCompletionService').then(({ getWishlistCompletionService }) => {
        getWishlistCompletionService().checkAndComplete().catch((err) => {
          console.error('[LiveMonitoring] Wishlist completion check failed:', getErrorMessage(err))
        })
      })
    }

    return events
  }

  /**
   * Check if monitoring should pause (during manual scan)
   */
  private shouldPause(): boolean {
    if (!this.config.pauseDuringManualScan) return false

    const sourceManager = getSourceManager()
    return sourceManager.isManualScanInProgress()
  }

  /**
   * Send status update to renderer
   */
  private sendStatusUpdate(): void {
    this.sendToRenderer('monitoring:statusChanged', {
      isActive: this.isActive,
      lastCheck: this.lastCheckTimes.size > 0
        ? Array.from(this.lastCheckTimes.values()).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString()
        : undefined,
    })
    // Also send to the debug panel's expected channel
    this.sendToRenderer('monitoring:status', { isActive: this.isActive })
    // Emit info event about status change
    this.emitDebugEvent('info', this.isActive ? 'Monitoring started' : 'Monitoring stopped')
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow) {
      safeSend(this.mainWindow, channel, data)
    }
  }

  /**
   * Emit a debug event to the monitoring panel
   */
  private emitDebugEvent(type: 'poll' | 'added' | 'removed' | 'error' | 'info', message: string): void {
    this.sendToRenderer('monitoring:event', { type, message })
  }

  /**
   * Get current monitoring status
   */
  getStatus(): { isActive: boolean } {
    return { isActive: this.isActive }
  }

  /**
   * Force check a specific source immediately
   */
  async forceCheck(sourceId: string): Promise<SourceChangeEvent[]> {
    if (this.shouldPause()) {
      console.log(`[LiveMonitoring] Manual scan in progress, cannot force check`)
      return []
    }

    console.log(`[LiveMonitoring] Force checking ${sourceId}...`)
    return this.checkSource(sourceId)
  }

  /**
   * Add a new source to monitoring (when source is added)
   */
  addSource(sourceId: string, sourceType: ProviderType, connectionConfig: string): void {
    if (!this.isActive) return

    this.startMonitoringSource(sourceId, sourceType, connectionConfig)
  }

  /**
   * Remove a source from monitoring (when source is removed)
   */
  removeSource(sourceId: string): void {
    console.log(`[LiveMonitoring] Removing source ${sourceId} from monitoring`)

    // Stop polling timer
    const timer = this.pollingTimers.get(sourceId)
    if (timer) {
      clearTimeout(timer)
      this.pollingTimers.delete(sourceId)
    }

    // Stop file watcher (fire-and-forget with error logging)
    const watcher = this.fileWatchers.get(sourceId)
    if (watcher) {
      this.fileWatchers.delete(sourceId) // Remove from map first to prevent double-close
      watcher.close().catch((err) => {
        console.error(`[LiveMonitoring] Error closing watcher for removed source ${sourceId}:`, err)
      })
    }

    // Clear debounce timer
    const debounce = this.fileChangeDebounce.get(sourceId)
    if (debounce) {
      clearTimeout(debounce)
      this.fileChangeDebounce.delete(sourceId)
    }

    // Clear pending changes and check times
    this.pendingFileChanges.delete(sourceId)
    this.lastCheckTimes.delete(sourceId)
  }
}

// ==========================================================================
// Singleton Export
// ==========================================================================

let liveMonitoringService: LiveMonitoringService | null = null

export function getLiveMonitoringService(): LiveMonitoringService {
  if (!liveMonitoringService) {
    liveMonitoringService = new LiveMonitoringService()
  }
  return liveMonitoringService
}
