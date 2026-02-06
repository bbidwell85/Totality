/**
 * FFprobe Worker Pool
 *
 * Manages a pool of worker threads for parallel FFprobe analysis.
 * Distributes file analysis tasks across workers for improved performance.
 */

import { Worker } from 'worker_threads'
import * as os from 'os'
import * as path from 'path'
import { app } from 'electron'
import type { FileAnalysisResult } from './MediaFileAnalyzer'

interface WorkerTask {
  taskId: string
  filePath: string
}

interface WorkerResult {
  taskId: string
  result: FileAnalysisResult
}

interface QueuedTask {
  taskId: string
  filePath: string
  resolve: (result: FileAnalysisResult) => void
  reject: (error: Error) => void
}

interface WorkerInfo {
  worker: Worker
  busy: boolean
  currentTask: QueuedTask | null
}

// Singleton instance
let poolInstance: FFprobeWorkerPool | null = null

export function getFFprobeWorkerPool(): FFprobeWorkerPool {
  if (!poolInstance) {
    poolInstance = new FFprobeWorkerPool()
  }
  return poolInstance
}

export class FFprobeWorkerPool {
  private workers: WorkerInfo[] = []
  private taskQueue: QueuedTask[] = []
  private taskIdCounter = 0
  private maxWorkers: number
  private ffprobePath: string | null = null
  private initialized = false
  private workerScriptPath: string
  private isShuttingDown = false

  constructor() {
    // Default to CPU cores - 1, minimum 1, maximum 8
    this.maxWorkers = Math.min(8, Math.max(1, os.cpus().length - 1))

    // Determine worker script path based on environment
    if (app.isPackaged) {
      // Production: worker is in resources/app.asar/dist-electron/main/
      this.workerScriptPath = path.join(__dirname, 'ffprobe-worker.cjs')
    } else {
      // Development: worker is in dist-electron/main/
      this.workerScriptPath = path.join(__dirname, 'ffprobe-worker.cjs')
    }
  }

  /**
   * Initialize the worker pool with FFprobe path
   */
  async initialize(ffprobePath: string): Promise<void> {
    if (this.initialized) {
      return
    }

    this.ffprobePath = ffprobePath
    this.initialized = true
    console.log(`[FFprobeWorkerPool] Initialized with ${this.maxWorkers} workers, FFprobe: ${ffprobePath}`)
  }

  /**
   * Set the maximum number of workers
   */
  setMaxWorkers(count: number): void {
    this.maxWorkers = Math.min(16, Math.max(1, count))
    console.log(`[FFprobeWorkerPool] Max workers set to ${this.maxWorkers}`)
  }

  /**
   * Get current pool statistics
   */
  getStats(): { maxWorkers: number; activeWorkers: number; queuedTasks: number } {
    return {
      maxWorkers: this.maxWorkers,
      activeWorkers: this.workers.filter(w => w.busy).length,
      queuedTasks: this.taskQueue.length,
    }
  }

  /**
   * Analyze multiple files in parallel
   */
  async analyzeFiles(
    filePaths: string[],
    onProgress?: (current: number, total: number, currentFile: string) => void
  ): Promise<Map<string, FileAnalysisResult>> {
    if (!this.initialized || !this.ffprobePath) {
      throw new Error('FFprobeWorkerPool not initialized. Call initialize() first.')
    }

    const results = new Map<string, FileAnalysisResult>()
    const total = filePaths.length

    if (total === 0) {
      return results
    }

    let completed = 0

    // Create promises for all files
    const promises = filePaths.map(async (filePath) => {
      const result = await this.analyzeFile(filePath)
      results.set(filePath, result)
      completed++
      onProgress?.(completed, total, path.basename(filePath))
      return result
    })

    // Wait for all to complete
    await Promise.all(promises)

    return results
  }

  /**
   * Analyze a batch of files with configurable concurrency
   * Useful for checkpoint-based processing
   */
  async analyzeBatch(
    filePaths: string[],
    concurrency?: number
  ): Promise<Map<string, FileAnalysisResult>> {
    const effectiveConcurrency = concurrency || this.maxWorkers
    const results = new Map<string, FileAnalysisResult>()

    // Process in chunks to control memory usage
    for (let i = 0; i < filePaths.length; i += effectiveConcurrency) {
      const batch = filePaths.slice(i, i + effectiveConcurrency)
      const batchPromises = batch.map(fp => this.analyzeFile(fp))
      const batchResults = await Promise.all(batchPromises)

      batch.forEach((fp, idx) => {
        results.set(fp, batchResults[idx])
      })
    }

    return results
  }

  /**
   * Analyze a single file using a worker
   */
  async analyzeFile(filePath: string): Promise<FileAnalysisResult> {
    if (!this.initialized || !this.ffprobePath) {
      return {
        success: false,
        error: 'FFprobeWorkerPool not initialized',
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }

    if (this.isShuttingDown) {
      return {
        success: false,
        error: 'Worker pool is shutting down',
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }

    return new Promise((resolve, reject) => {
      const taskId = `task-${++this.taskIdCounter}`
      const task: QueuedTask = { taskId, filePath, resolve, reject }

      this.taskQueue.push(task)
      this.processQueue()
    })
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0) {
      return
    }

    // Find or create an available worker
    let workerInfo: WorkerInfo | undefined = this.workers.find(w => !w.busy)

    if (!workerInfo && this.workers.length < this.maxWorkers) {
      const newWorker = this.createWorker()
      if (newWorker) {
        this.workers.push(newWorker)
        workerInfo = newWorker
      }
    }

    if (workerInfo && !workerInfo.busy) {
      const task = this.taskQueue.shift()
      if (task) {
        this.assignTask(workerInfo, task)
      }
    }
  }

  /**
   * Create a new worker
   */
  private createWorker(): WorkerInfo | null {
    try {
      const worker = new Worker(this.workerScriptPath, {
        workerData: {
          ffprobePath: this.ffprobePath,
        },
      })

      const workerInfo: WorkerInfo = {
        worker,
        busy: false,
        currentTask: null,
      }

      worker.on('message', (result: WorkerResult) => {
        this.handleWorkerResult(workerInfo, result)
      })

      worker.on('error', (error) => {
        console.error('[FFprobeWorkerPool] Worker error:', error)
        this.handleWorkerError(workerInfo, error)
      })

      worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          console.warn(`[FFprobeWorkerPool] Worker exited with code ${code}`)
        }
        this.removeWorker(workerInfo)
      })

      console.log(`[FFprobeWorkerPool] Created worker (total: ${this.workers.length + 1})`)
      return workerInfo
    } catch (error) {
      console.error('[FFprobeWorkerPool] Failed to create worker:', error)
      return null
    }
  }

  /**
   * Assign a task to a worker
   */
  private assignTask(workerInfo: WorkerInfo, task: QueuedTask): void {
    workerInfo.busy = true
    workerInfo.currentTask = task

    const message: WorkerTask = {
      taskId: task.taskId,
      filePath: task.filePath,
    }

    workerInfo.worker.postMessage(message)
  }

  /**
   * Handle worker result
   */
  private handleWorkerResult(workerInfo: WorkerInfo, result: WorkerResult): void {
    const task = workerInfo.currentTask
    if (task && task.taskId === result.taskId) {
      task.resolve(result.result)
    }

    workerInfo.busy = false
    workerInfo.currentTask = null

    // Process next task in queue
    this.processQueue()
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(workerInfo: WorkerInfo, error: Error): void {
    const task = workerInfo.currentTask
    if (task) {
      task.resolve({
        success: false,
        error: error.message,
        filePath: task.filePath,
        audioTracks: [],
        subtitleTracks: [],
      })
    }

    workerInfo.busy = false
    workerInfo.currentTask = null

    // Try to process next task
    this.processQueue()
  }

  /**
   * Remove a worker from the pool
   */
  private removeWorker(workerInfo: WorkerInfo): void {
    const index = this.workers.indexOf(workerInfo)
    if (index !== -1) {
      this.workers.splice(index, 1)
    }

    // If there are queued tasks and we lost a worker, try to create a new one
    if (this.taskQueue.length > 0 && !this.isShuttingDown) {
      this.processQueue()
    }
  }

  /**
   * Gracefully shut down all workers
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.resolve({
        success: false,
        error: 'Worker pool shutting down',
        filePath: task.filePath,
        audioTracks: [],
        subtitleTracks: [],
      })
    }
    this.taskQueue = []

    // Terminate all workers
    const terminationPromises = this.workers.map(workerInfo => {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          workerInfo.worker.terminate()
          resolve()
        }, 5000)

        workerInfo.worker.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })

        workerInfo.worker.terminate()
      })
    })

    await Promise.all(terminationPromises)
    this.workers = []
    this.initialized = false
    this.isShuttingDown = false

    console.log('[FFprobeWorkerPool] Shutdown complete')
  }

  /**
   * Reset the pool (useful for configuration changes)
   */
  async reset(): Promise<void> {
    await this.shutdown()
    poolInstance = null
  }
}
