import { getErrorMessage } from './utils/errorUtils'
/**
 * TaskQueueService - Manages background task queue for scans and analysis
 *
 * Features:
 * - Sequential task execution
 * - Queue management (add, remove, reorder)
 * - Pause/resume functionality
 * - Task cancellation
 * - Progress tracking
 * - Activity logging
 */

import { BrowserWindow } from 'electron'
import { safeSend } from '../ipc/utils/safeSend'
import { getSourceManager } from './SourceManager'
import { getSeriesCompletenessService } from './SeriesCompletenessService'
import { getMovieCollectionService } from './MovieCollectionService'
import { getMusicBrainzService } from './MusicBrainzService'
import { getDatabase } from '../database/getDatabase'
import { getLiveMonitoringService } from './LiveMonitoringService'
import { PlexProvider } from '../providers/plex/PlexProvider'
import { JellyfinEmbyBase } from '../providers/jellyfin-emby/JellyfinEmbyBase'
import { KodiProvider } from '../providers/kodi/KodiProvider'
import { KodiLocalProvider } from '../providers/kodi/KodiLocalProvider'
import { LocalFolderProvider } from '../providers/local/LocalFolderProvider'
import type { ScanResult } from '../providers/base/MediaProvider'
import { getWishlistCompletionService } from './WishlistCompletionService'

// ============================================================================
// Types
// ============================================================================

export type TaskType =
  | 'library-scan'
  | 'source-scan'
  | 'series-completeness'
  | 'collection-completeness'
  | 'music-completeness'
  | 'music-scan'

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface TaskProgress {
  current: number
  total: number
  percentage: number
  phase: string
  currentItem?: string
}

export interface QueuedTask {
  id: string
  type: TaskType
  label: string
  sourceId?: string
  libraryId?: string
  status: TaskStatus
  progress?: TaskProgress
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  result?: {
    itemsScanned?: number
    itemsAdded?: number
    itemsUpdated?: number
    itemsRemoved?: number
    isFirstScan?: boolean
  }
}

export interface TaskDefinition {
  type: TaskType
  label: string
  sourceId?: string
  libraryId?: string
}

export interface QueueState {
  currentTask: QueuedTask | null
  queue: QueuedTask[]
  isPaused: boolean
  completedTasks: QueuedTask[]
}

export interface ActivityLogEntry {
  id: string
  timestamp: string
  type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'task-interrupted' | 'monitoring'
  message: string
  taskId?: string
  taskType?: TaskType
}

// ============================================================================
// TaskQueueService
// ============================================================================

export class TaskQueueService {
  private queue: QueuedTask[] = []
  private currentTask: QueuedTask | null = null
  private isPaused = false
  private isProcessing = false
  private mainWindow: BrowserWindow | null = null
  private completedTasks: QueuedTask[] = []
  private taskHistory: ActivityLogEntry[] = []
  private monitoringHistory: ActivityLogEntry[] = []
  private cancelRequested = false
  private monitoringWasPausedByUs = false // Track if we paused monitoring
  private progressThrottleTimer: NodeJS.Timeout | null = null
  private progressUpdatePending = false

  private static readonly MAX_COMPLETED_TASKS = 50
  private static readonly MAX_HISTORY_ENTRIES = 100
  private static readonly PROGRESS_THROTTLE_MS = 250 // Max ~4 progress events/second

  /**
   * Set the main window reference for IPC events
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  /**
   * Add a task to the queue
   */
  addTask(definition: TaskDefinition): string {
    const task: QueuedTask = {
      id: this.generateId(),
      type: definition.type,
      label: definition.label,
      sourceId: definition.sourceId,
      libraryId: definition.libraryId,
      status: 'queued',
      createdAt: new Date().toISOString(),
    }

    this.queue.push(task)
    console.log(`[TaskQueue] Added task: ${task.label} (${task.id})`)
    this.emitQueueUpdate()

    // Start processing if not already running
    this.processNext()

    return task.id
  }

  /**
   * Remove a task from the queue (only if not running)
   */
  removeTask(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId)
    if (index === -1) return false

    this.queue.splice(index, 1)
    console.log(`[TaskQueue] Removed task: ${taskId}`)
    this.emitQueueUpdate()
    return true
  }

  /**
   * Reorder the queue
   */
  reorderQueue(taskIds: string[]): void {
    const reordered = taskIds
      .map(id => this.queue.find(t => t.id === id))
      .filter((t): t is QueuedTask => t !== undefined)

    // Only reorder if all IDs matched
    if (reordered.length === this.queue.length) {
      this.queue = reordered
      console.log(`[TaskQueue] Queue reordered`)
      this.emitQueueUpdate()
    }
  }

  /**
   * Clear all queued tasks (not the current running task)
   */
  clearQueue(): void {
    this.queue = []
    console.log(`[TaskQueue] Queue cleared`)
    this.emitQueueUpdate()

    // If no task is currently running, resume monitoring
    if (!this.currentTask && this.monitoringWasPausedByUs) {
      console.log('[TaskQueue] Queue cleared with no running task, resuming live monitoring')
      this.monitoringWasPausedByUs = false
      getLiveMonitoringService().resume()
    }
  }

  /**
   * Pause the queue (current task continues, but no new tasks start)
   */
  pauseQueue(): void {
    this.isPaused = true
    console.log(`[TaskQueue] Queue paused`)
    this.emitQueueUpdate()
  }

  /**
   * Resume the queue
   */
  resumeQueue(): void {
    this.isPaused = false
    console.log(`[TaskQueue] Queue resumed`)
    this.emitQueueUpdate()
    this.processNext()
  }

  /**
   * Cancel the current running task
   */
  cancelCurrentTask(): void {
    if (!this.currentTask) return

    console.log(`[TaskQueue] Cancelling current task: ${this.currentTask.label}`)
    this.cancelRequested = true

    // Also cancel in underlying services
    switch (this.currentTask.type) {
      case 'library-scan':
      case 'source-scan':
      case 'music-scan':
        getSourceManager().stopScan()
        break
      case 'series-completeness':
        getSeriesCompletenessService().cancel()
        break
      case 'collection-completeness':
        getMovieCollectionService().cancel()
        break
    }
  }

  /**
   * Get current queue state
   */
  getQueueState(): QueueState {
    return {
      currentTask: this.currentTask,
      queue: [...this.queue],
      isPaused: this.isPaused,
      completedTasks: [...this.completedTasks],
    }
  }

  /**
   * Get activity history (task completions)
   */
  getTaskHistory(): ActivityLogEntry[] {
    return [...this.taskHistory]
  }

  /**
   * Get monitoring history
   */
  getMonitoringHistory(): ActivityLogEntry[] {
    return [...this.monitoringHistory]
  }

  /**
   * Add monitoring event to history
   */
  addMonitoringEvent(message: string): void {
    const entry: ActivityLogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type: 'monitoring',
      message,
    }

    this.monitoringHistory.unshift(entry)
    if (this.monitoringHistory.length > TaskQueueService.MAX_HISTORY_ENTRIES) {
      this.monitoringHistory = this.monitoringHistory.slice(0, TaskQueueService.MAX_HISTORY_ENTRIES)
    }

    // Persist to database
    try {
      const db = getDatabase()
      db.saveActivityLogEntry({ entryType: 'monitoring', message })
    } catch (err) {
      console.error('[TaskQueue] Failed to persist monitoring event:', getErrorMessage(err))
    }

    this.emitHistoryUpdate()
  }

  /**
   * Clear task history
   */
  clearTaskHistory(): void {
    this.taskHistory = []
    this.completedTasks = []
    try { getDatabase().clearTaskHistory() } catch { /* silent */ }
    this.emitHistoryUpdate()
    this.emitQueueUpdate()
  }

  /**
   * Clear monitoring history
   */
  clearMonitoringHistory(): void {
    this.monitoringHistory = []
    try { getDatabase().clearActivityLog('monitoring') } catch { /* silent */ }
    this.emitHistoryUpdate()
  }

  /**
   * Load persisted task history from database on startup
   */
  loadPersistedHistory(): void {
    try {
      const db = getDatabase()

      const dbTasks = db.getTaskHistory(TaskQueueService.MAX_COMPLETED_TASKS)
      this.completedTasks = dbTasks.map((row: { taskId: string; type: string; label: string; sourceId: string | null; libraryId: string | null; status: string; error: string | null; result: string | null; createdAt: string; startedAt: string | null; completedAt: string | null }) => ({
        id: row.taskId,
        type: row.type as TaskType,
        label: row.label,
        sourceId: row.sourceId || undefined,
        libraryId: row.libraryId || undefined,
        status: row.status as TaskStatus,
        error: row.error || undefined,
        result: row.result ? JSON.parse(row.result) : undefined,
        createdAt: row.createdAt,
        startedAt: row.startedAt || undefined,
        completedAt: row.completedAt || undefined,
      }))

      const taskEntries = db.getActivityLog('task', TaskQueueService.MAX_HISTORY_ENTRIES)
      this.taskHistory = taskEntries.map((row: { id: number; entryType: string; message: string; taskId: string | null; taskType: string | null; createdAt: string }) => ({
        id: `db_${row.id}`,
        timestamp: row.createdAt,
        type: row.entryType as ActivityLogEntry['type'],
        message: row.message,
        taskId: row.taskId || undefined,
        taskType: (row.taskType as TaskType) || undefined,
      }))

      const monEntries = db.getActivityLog('monitoring', TaskQueueService.MAX_HISTORY_ENTRIES)
      this.monitoringHistory = monEntries.map((row: { id: number; entryType: string; message: string; createdAt: string }) => ({
        id: `db_${row.id}`,
        timestamp: row.createdAt,
        type: 'monitoring' as const,
        message: row.message,
      }))

      console.log(`[TaskQueue] Loaded ${this.completedTasks.length} tasks, ${this.taskHistory.length} task events, ${this.monitoringHistory.length} monitoring events from DB`)
    } catch (err) {
      console.error('[TaskQueue] Failed to load persisted history:', getErrorMessage(err))
    }
  }

  /**
   * Persist any in-flight or queued tasks as interrupted on app shutdown
   */
  persistInterruptedTasks(): void {
    const now = new Date().toISOString()
    try {
      const db = getDatabase()

      if (this.currentTask) {
        db.saveTaskHistory({
          taskId: this.currentTask.id, type: this.currentTask.type, label: this.currentTask.label,
          sourceId: this.currentTask.sourceId, libraryId: this.currentTask.libraryId,
          status: 'interrupted', createdAt: this.currentTask.createdAt,
          startedAt: this.currentTask.startedAt, completedAt: now,
        })
        db.saveActivityLogEntry({
          entryType: 'task-interrupted',
          message: `Interrupted (app quit): ${this.currentTask.label}`,
          taskId: this.currentTask.id, taskType: this.currentTask.type,
        })
      }

      for (const task of this.queue) {
        db.saveTaskHistory({
          taskId: task.id, type: task.type, label: task.label,
          sourceId: task.sourceId, libraryId: task.libraryId,
          status: 'interrupted', createdAt: task.createdAt, completedAt: now,
        })
        db.saveActivityLogEntry({
          entryType: 'task-interrupted',
          message: `Interrupted (app quit, was queued): ${task.label}`,
          taskId: task.id, taskType: task.type,
        })
      }
    } catch (err) {
      console.error('[TaskQueue] Failed to persist interrupted tasks:', getErrorMessage(err))
    }
  }

  /**
   * Remove all queued tasks for a specific source
   * Called when a source is deleted
   */
  removeTasksForSource(sourceId: string): void {
    // Cancel current task if it belongs to this source
    if (this.currentTask?.sourceId === sourceId) {
      this.cancelCurrentTask()
    }

    // Remove queued tasks for this source
    this.queue = this.queue.filter(task => task.sourceId !== sourceId)

    // Remove from completed tasks history
    this.completedTasks = this.completedTasks.filter(task => task.sourceId !== sourceId)

    // Notify UI of queue change
    this.emitQueueUpdate()

    console.log(`[TaskQueueService] Removed tasks for source: ${sourceId}`)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Process the next task in the queue
   */
  private async processNext(): Promise<void> {
    // Don't start if paused, already processing, or queue is empty
    if (this.isPaused || this.isProcessing || this.queue.length === 0) {
      // If queue is empty and we paused monitoring, resume it
      if (this.queue.length === 0 && this.monitoringWasPausedByUs) {
        console.log('[TaskQueue] All tasks complete, resuming live monitoring')
        this.monitoringWasPausedByUs = false
        getLiveMonitoringService().resume()
      }
      return
    }

    // Pause monitoring when we start processing (first task)
    if (!this.monitoringWasPausedByUs) {
      const liveMonitoring = getLiveMonitoringService()
      if (liveMonitoring.isActiveAndEnabled()) {
        console.log('[TaskQueue] Pausing live monitoring during task execution')
        liveMonitoring.pause()
        this.monitoringWasPausedByUs = true
      }
    }

    this.isProcessing = true
    const task = this.queue.shift()!
    this.currentTask = task
    this.cancelRequested = false

    task.status = 'running'
    task.startedAt = new Date().toISOString()
    this.emitQueueUpdate()

    console.log(`[TaskQueue] Starting task: ${task.label}`)

    try {
      await this.executeTask(task)

      if (this.cancelRequested) {
        task.status = 'cancelled'
        this.addTaskHistoryEntry(task, 'task-cancelled', `Cancelled: ${task.label}`)
      } else {
        task.status = 'completed'
        this.addTaskHistoryEntry(task, 'task-complete', this.formatCompletionMessage(task))
      }
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error) || 'Unknown error'
      const isCancellation = this.cancelRequested || errorMsg === 'Task cancelled'

      if (isCancellation) {
        task.status = 'cancelled'
        this.addTaskHistoryEntry(task, 'task-cancelled', `Cancelled: ${task.label}`)
        console.log(`[TaskQueue] Task cancelled: ${task.label}`)
      } else {
        task.status = 'failed'
        task.error = errorMsg
        this.addTaskHistoryEntry(task, 'task-failed', `Failed: ${task.label} - ${task.error}`)
        console.error(`[TaskQueue] Task failed: ${task.label}`, error)
      }
    }

    task.completedAt = new Date().toISOString()

    // Persist completed task to database
    try {
      const db = getDatabase()
      db.saveTaskHistory({
        taskId: task.id, type: task.type, label: task.label,
        sourceId: task.sourceId, libraryId: task.libraryId,
        status: task.status, error: task.error,
        result: task.result as Record<string, unknown> | undefined,
        createdAt: task.createdAt, startedAt: task.startedAt,
        completedAt: task.completedAt,
      })
    } catch (err) {
      console.error('[TaskQueue] Failed to persist task history:', getErrorMessage(err))
    }

    // Add to completed tasks
    this.completedTasks.unshift(task)
    if (this.completedTasks.length > TaskQueueService.MAX_COMPLETED_TASKS) {
      const evicted = this.completedTasks.slice(TaskQueueService.MAX_COMPLETED_TASKS)
      this.completedTasks = this.completedTasks.slice(0, TaskQueueService.MAX_COMPLETED_TASKS)
      // Remove history entries for evicted tasks to prevent memory leak
      const evictedIds = new Set(evicted.map(t => t.id))
      this.taskHistory = this.taskHistory.filter(entry => !entry.taskId || !evictedIds.has(entry.taskId))
    }

    this.currentTask = null
    this.isProcessing = false
    this.cancelRequested = false

    this.emitQueueUpdate()
    this.emitTaskComplete(task)

    // Process next task (this will resume monitoring if queue is empty)
    this.processNext()
  }

  /**
   * Execute a task based on its type
   */
  private async executeTask(task: QueuedTask): Promise<void> {
    const progressCallback = (progress: { current?: number; total?: number; percentage?: number; phase?: string; currentItem?: string }) => {
      if (this.cancelRequested) {
        throw new Error('Task cancelled')
      }

      const current = progress.current ?? 0
      const total = progress.total ?? 0
      // Calculate percentage if not provided
      const percentage = progress.percentage ?? (total > 0 ? Math.round((current / total) * 100) : 0)

      task.progress = {
        current,
        total,
        percentage,
        phase: progress.phase ?? 'processing',
        currentItem: progress.currentItem,
      }
      this.emitProgressUpdate()
    }

    switch (task.type) {
      case 'library-scan':
        await this.executeLibraryScan(task, progressCallback)
        break

      case 'source-scan':
        await this.executeSourceScan(task, progressCallback)
        break

      case 'series-completeness':
        await this.executeSeriesCompleteness(task, progressCallback)
        // Trigger UI refresh after completeness analysis
        this.sendLibraryUpdated()
        break

      case 'collection-completeness':
        await this.executeCollectionCompleteness(task, progressCallback)
        // Trigger UI refresh after completeness analysis
        this.sendLibraryUpdated()
        break

      case 'music-completeness':
        await this.executeMusicCompleteness(task, progressCallback)
        // Trigger UI refresh after completeness analysis
        this.sendLibraryUpdated()
        break

      case 'music-scan':
        await this.executeMusicScan(task, progressCallback)
        break

      default:
        throw new Error(`Unknown task type: ${task.type}`)
    }
  }

  private async executeLibraryScan(task: QueuedTask, onProgress: (p: { current?: number; total?: number; percentage?: number; phase?: string; currentItem?: string }) => void): Promise<void> {
    if (!task.sourceId || !task.libraryId) {
      throw new Error('Library scan requires sourceId and libraryId')
    }

    // Check if this is the first scan for this library
    const db = getDatabase()
    const existingScanTime = db.getLibraryScanTime(task.sourceId, task.libraryId)
    const isFirstScan = !existingScanTime

    const manager = getSourceManager()
    const result = await manager.scanLibrary(task.sourceId, task.libraryId, onProgress)

    task.result = {
      itemsScanned: result.itemsScanned,
      itemsAdded: result.itemsAdded,
      itemsUpdated: result.itemsUpdated,
      itemsRemoved: result.itemsRemoved,
      isFirstScan,
    }

    if (!result.success && result.errors?.length > 0) {
      throw new Error(result.errors.join(', '))
    }
  }

  private async executeSourceScan(task: QueuedTask, onProgress: (p: { current?: number; total?: number; percentage?: number; phase?: string; currentItem?: string }) => void): Promise<void> {
    if (!task.sourceId) {
      throw new Error('Source scan requires sourceId')
    }

    const manager = getSourceManager()
    const db = getDatabase()

    // Get all enabled libraries for this source
    type LibraryInfo = { libraryId: string; libraryName: string; libraryType: string; isEnabled: boolean; lastScanAt: string | null; itemsScanned: number }
    const libraries = db.getSourceLibraries(task.sourceId) as LibraryInfo[]
    const enabledLibraries = libraries.filter((lib: LibraryInfo) => lib.isEnabled)

    let totalScanned = 0
    let totalAdded = 0
    let totalUpdated = 0
    let totalRemoved = 0

    for (let i = 0; i < enabledLibraries.length; i++) {
      const lib = enabledLibraries[i]

      // Update progress for overall source scan
      onProgress({
        current: i,
        total: enabledLibraries.length,
        phase: 'processing',
        currentItem: lib.libraryName,
        percentage: (i / enabledLibraries.length) * 100,
      })

      const result = await manager.scanLibrary(task.sourceId, lib.libraryId, (p) => {
        // Emit sub-progress
        onProgress({
          current: i,
          total: enabledLibraries.length,
          phase: p.phase,
          currentItem: p.currentItem,
          percentage: ((i + (p.percentage || 0) / 100) / enabledLibraries.length) * 100,
        })
      })

      totalScanned += result.itemsScanned || 0
      totalAdded += result.itemsAdded || 0
      totalUpdated += result.itemsUpdated || 0
      totalRemoved += result.itemsRemoved || 0
    }

    task.result = {
      itemsScanned: totalScanned,
      itemsAdded: totalAdded,
      itemsUpdated: totalUpdated,
      itemsRemoved: totalRemoved,
    }
  }

  private async executeSeriesCompleteness(task: QueuedTask, onProgress: (p: { current?: number; total?: number; percentage?: number; phase?: string; currentItem?: string }) => void): Promise<void> {
    const service = getSeriesCompletenessService()
    const result = await service.analyzeAllSeries(onProgress, task.sourceId, task.libraryId)

    task.result = {
      itemsScanned: result.analyzed,
    }

    if (!result.completed && !this.cancelRequested) {
      throw new Error('Series analysis did not complete')
    }
  }

  private async executeCollectionCompleteness(task: QueuedTask, onProgress: (p: { current?: number; total?: number; percentage?: number; phase?: string; currentItem?: string }) => void): Promise<void> {
    const service = getMovieCollectionService()
    const result = await service.analyzeAllCollections(onProgress, task.sourceId, task.libraryId)

    task.result = {
      itemsScanned: result.analyzed,
    }

    if (!result.completed && !this.cancelRequested) {
      throw new Error('Collection analysis did not complete')
    }
  }

  private async executeMusicCompleteness(task: QueuedTask, onProgress: (p: { current?: number; total?: number; percentage?: number; phase?: string; currentItem?: string }) => void): Promise<void> {
    const mbService = getMusicBrainzService()
    const result = await mbService.analyzeAllMusic(onProgress, task.sourceId)

    task.result = {
      itemsScanned: (result.artistsAnalyzed || 0) + (result.albumsAnalyzed || 0),
    }

    if (!result.completed && !this.cancelRequested) {
      throw new Error('Music completeness analysis did not complete')
    }
  }

  private async executeMusicScan(task: QueuedTask, onProgress: (p: { current?: number; total?: number; percentage?: number; phase?: string; currentItem?: string }) => void): Promise<void> {
    if (!task.sourceId || !task.libraryId) {
      throw new Error('Music scan requires sourceId and libraryId')
    }

    const manager = getSourceManager()
    const provider = manager.getProvider(task.sourceId)
    if (!provider) {
      throw new Error(`Provider not found for source: ${task.sourceId}`)
    }

    let result: ScanResult

    // Route to provider-specific music scanning method
    if (provider.providerType === 'plex') {
      const plexProvider = provider as PlexProvider
      result = await plexProvider.scanMusicLibrary(task.libraryId, onProgress)
    } else if (provider.providerType === 'jellyfin' || provider.providerType === 'emby') {
      const jellyfinProvider = provider as JellyfinEmbyBase
      result = await jellyfinProvider.scanMusicLibrary(task.libraryId, onProgress)
    } else if (provider.providerType === 'kodi') {
      const kodiProvider = provider as KodiProvider
      result = await kodiProvider.scanMusicLibrary(onProgress)
    } else if (provider.providerType === 'kodi-local') {
      const kodiLocalProvider = provider as KodiLocalProvider
      result = await kodiLocalProvider.scanMusicLibrary(onProgress)
    } else if (provider.providerType === 'local') {
      // Local folder provider routes music through scanLibrary internally
      const localProvider = provider as LocalFolderProvider
      result = await localProvider.scanLibrary(task.libraryId, { onProgress })
    } else {
      throw new Error(`Music scanning not supported for provider type: ${provider.providerType}`)
    }

    task.result = {
      itemsScanned: result.itemsScanned,
      itemsAdded: result.itemsAdded,
      itemsUpdated: result.itemsUpdated,
      itemsRemoved: result.itemsRemoved,
    }

    if (!result.success && result.errors?.length > 0) {
      throw new Error(result.errors.join(', '))
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Send library:updated event to trigger UI refresh
   * Called after completeness tasks complete to refresh MediaBrowser
   */
  private sendLibraryUpdated(): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      safeSend(win, 'library:updated', { type: 'media' })
    }
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private formatCompletionMessage(task: QueuedTask): string {
    const result = task.result
    if (!result) {
      return `Completed: ${task.label}`
    }

    const parts: string[] = []
    if (result.itemsScanned) parts.push(`${result.itemsScanned} scanned`)
    if (result.itemsAdded) parts.push(`${result.itemsAdded} added`)
    if (result.itemsUpdated) parts.push(`${result.itemsUpdated} updated`)
    if (result.itemsRemoved) parts.push(`${result.itemsRemoved} removed`)

    if (parts.length === 0) {
      return `Completed: ${task.label}`
    }

    return `Completed: ${task.label} (${parts.join(', ')})`
  }

  private addTaskHistoryEntry(task: QueuedTask, type: ActivityLogEntry['type'], message: string): void {
    const entry: ActivityLogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type,
      message,
      taskId: task.id,
      taskType: task.type,
    }

    this.taskHistory.unshift(entry)
    if (this.taskHistory.length > TaskQueueService.MAX_HISTORY_ENTRIES) {
      this.taskHistory = this.taskHistory.slice(0, TaskQueueService.MAX_HISTORY_ENTRIES)
    }

    // Persist to database
    try {
      const db = getDatabase()
      db.saveActivityLogEntry({ entryType: type, message, taskId: task.id, taskType: task.type })
    } catch (err) {
      console.error('[TaskQueue] Failed to persist activity log entry:', getErrorMessage(err))
    }

    this.emitHistoryUpdate()
  }

  // ============================================================================
  // IPC Communication
  // ============================================================================

  private emitQueueUpdate(): void {
    this.sendToRenderer('taskQueue:updated', this.getQueueState())
  }

  /**
   * Throttled version of emitQueueUpdate for progress events.
   * Limits IPC sends to avoid flooding the renderer during large scans.
   */
  private emitProgressUpdate(): void {
    if (this.progressThrottleTimer) {
      this.progressUpdatePending = true
      return
    }
    this.emitQueueUpdate()
    this.progressThrottleTimer = setTimeout(() => {
      this.progressThrottleTimer = null
      if (this.progressUpdatePending) {
        this.progressUpdatePending = false
        this.emitQueueUpdate()
      }
    }, TaskQueueService.PROGRESS_THROTTLE_MS)
  }

  private emitTaskComplete(task: QueuedTask): void {
    this.sendToRenderer('taskQueue:taskComplete', task)

    // Emit scan:completed for library/source scans to show toast notification
    if (task.status === 'completed' && (task.type === 'library-scan' || task.type === 'source-scan' || task.type === 'music-scan')) {
      this.sendToRenderer('scan:completed', {
        sourceId: task.sourceId,
        libraryId: task.libraryId,
        libraryName: task.label,
        itemsAdded: task.result?.itemsAdded || 0,
        itemsUpdated: task.result?.itemsUpdated || 0,
        itemsScanned: task.result?.itemsScanned || 0,
        isFirstScan: task.result?.isFirstScan || false,
      })

      // Check wishlist for auto-completion after items were added or updated
      if ((task.result?.itemsAdded || 0) > 0 || (task.result?.itemsUpdated || 0) > 0) {
        getWishlistCompletionService().checkAndComplete().catch((err) => {
          console.error('[TaskQueue] Wishlist completion check failed:', getErrorMessage(err))
        })
      }
    }
  }

  private emitHistoryUpdate(): void {
    this.sendToRenderer('taskQueue:historyUpdated', {
      taskHistory: this.taskHistory,
      monitoringHistory: this.monitoringHistory,
    })
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow) {
      safeSend(this.mainWindow, channel, data)
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let taskQueueService: TaskQueueService | null = null

export function getTaskQueueService(): TaskQueueService {
  if (!taskQueueService) {
    taskQueueService = new TaskQueueService()
  }
  return taskQueueService
}
