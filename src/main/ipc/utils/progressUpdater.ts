/**
 * Progress Update Utilities
 *
 * Provides throttled progress update functionality for IPC handlers.
 * Ensures library:updated events are sent at a consistent rate to avoid
 * overwhelming the renderer with updates.
 */

import { BrowserWindow } from 'electron'
import { safeSend } from './safeSend'

/** Default interval between library:updated events (milliseconds) */
export const DEFAULT_UPDATE_INTERVAL = 2000

/** Interval between progress events to avoid flooding renderer (milliseconds) */
const PROGRESS_THROTTLE_MS = 250

/**
 * Creates a throttled progress callback that:
 * 1. Forwards progress events at most 4x per second (250ms throttle)
 * 2. Sends library:updated events at most once per UPDATE_INTERVAL
 *
 * @param win The target BrowserWindow
 * @param progressChannel Channel for progress events (e.g., 'sources:scanProgress')
 * @param updateType Type to include in library:updated event (e.g., 'media', 'music')
 * @param interval Throttle interval in ms (default: 2000)
 * @returns A progress callback function and a flush function for final update
 *
 * @example
 * const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
 * await manager.scanLibrary(sourceId, libraryId, onProgress)
 * flush() // Send final library:updated
 */
export function createProgressUpdater(
  win: BrowserWindow | null,
  progressChannel: string,
  updateType: string,
  interval: number = DEFAULT_UPDATE_INTERVAL
): {
  onProgress: (progress: unknown, extraData?: Record<string, unknown>) => void
  flush: () => void
} {
  let lastUpdateTime = 0
  let lastProgressTime = 0
  let lastProgress: unknown = null

  const onProgress = (progress: unknown, extraData?: Record<string, unknown>) => {
    const now = Date.now()

    // Store latest progress for flush
    lastProgress = extraData ? { ...extraData, ...(progress as Record<string, unknown>) } : progress

    // Throttle progress events to avoid flooding renderer (4 updates/sec max)
    if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
      lastProgressTime = now
      safeSend(win, progressChannel, lastProgress)
    }

    // Throttle library:updated events
    if (now - lastUpdateTime >= interval) {
      safeSend(win, 'library:updated', { type: updateType })
      lastUpdateTime = now
    }
  }

  const flush = () => {
    // Send final progress and update when operation completes
    if (lastProgress) {
      safeSend(win, progressChannel, lastProgress)
    }
    safeSend(win, 'library:updated', { type: updateType })
  }

  return { onProgress, flush }
}

/**
 * Creates a simple throttled updater that only sends library:updated events.
 * Use this when you don't need to forward progress events to a specific channel.
 *
 * @param win The target BrowserWindow
 * @param updateType Type to include in library:updated event
 * @param interval Throttle interval in ms (default: 2000)
 * @returns A throttled update function and a flush function
 */
export function createThrottledUpdater(
  win: BrowserWindow | null,
  updateType: string,
  interval: number = DEFAULT_UPDATE_INTERVAL
): {
  update: () => void
  flush: () => void
} {
  let lastUpdateTime = 0

  const update = () => {
    const now = Date.now()
    if (now - lastUpdateTime >= interval) {
      safeSend(win, 'library:updated', { type: updateType })
      lastUpdateTime = now
    }
  }

  const flush = () => {
    safeSend(win, 'library:updated', { type: updateType })
  }

  return { update, flush }
}
