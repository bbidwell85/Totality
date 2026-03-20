/**
 * IPC Handlers for Task Queue System
 */

import { ipcMain } from 'electron'
import { getTaskQueueService } from '../services/TaskQueueService'
import { validateInput, TaskDefinitionSchema, NonEmptyStringSchema } from '../validation/schemas'
import { z } from 'zod'

export function registerTaskQueueHandlers(): void {
  const service = getTaskQueueService()

  /**
   * Get current queue state
   */
  ipcMain.handle('taskQueue:getState', async () => {
    try {
      return service.getQueueState()
    } catch (error) {
      console.error('[IPC taskQueue:getState] Error:', error)
      throw error
    }
  })

  /**
   * Add a task to the queue
   */
  ipcMain.handle('taskQueue:addTask', async (_event, definition: unknown) => {
    try {
      const validDefinition = validateInput(TaskDefinitionSchema, definition, 'taskQueue:addTask')
      console.log('[IPC] taskQueue:addTask called with:', validDefinition)
      const taskId = service.addTask(validDefinition)
      console.log('[IPC] taskQueue:addTask returning taskId:', taskId)
      return { success: true, taskId }
    } catch (error) {
      console.error('[IPC taskQueue:addTask] Error:', error)
      throw error
    }
  })

  /**
   * Remove a task from the queue
   */
  ipcMain.handle('taskQueue:removeTask', async (_event, taskId: unknown) => {
    try {
      const validTaskId = validateInput(NonEmptyStringSchema, taskId, 'taskQueue:removeTask')
      console.log('[IPC taskQueue:removeTask]', validTaskId)
      const removed = service.removeTask(validTaskId)
      return { success: removed }
    } catch (error) {
      console.error('[IPC taskQueue:removeTask] Error:', error)
      throw error
    }
  })

  /**
   * Reorder the queue
   */
  ipcMain.handle('taskQueue:reorderQueue', async (_event, taskIds: unknown) => {
    try {
      const validTaskIds = validateInput(z.array(z.string().min(1)), taskIds, 'taskQueue:reorderQueue')
      service.reorderQueue(validTaskIds)
      return { success: true }
    } catch (error) {
      console.error('[IPC taskQueue:reorderQueue] Error:', error)
      throw error
    }
  })

  /**
   * Clear all queued tasks
   */
  ipcMain.handle('taskQueue:clearQueue', async () => {
    try {
      service.clearQueue()
      return { success: true }
    } catch (error) {
      console.error('[IPC taskQueue:clearQueue] Error:', error)
      throw error
    }
  })

  /**
   * Pause the queue
   */
  ipcMain.handle('taskQueue:pause', async () => {
    try {
      console.log('[IPC taskQueue:pause] Queue paused')
      service.pauseQueue()
      return { success: true }
    } catch (error) {
      console.error('[IPC taskQueue:pause] Error:', error)
      throw error
    }
  })

  /**
   * Resume the queue
   */
  ipcMain.handle('taskQueue:resume', async () => {
    try {
      console.log('[IPC taskQueue:resume] Queue resumed')
      service.resumeQueue()
      return { success: true }
    } catch (error) {
      console.error('[IPC taskQueue:resume] Error:', error)
      throw error
    }
  })

  /**
   * Cancel the current running task
   */
  ipcMain.handle('taskQueue:cancelCurrent', async () => {
    try {
      service.cancelCurrentTask()
      return { success: true }
    } catch (error) {
      console.error('[IPC taskQueue:cancelCurrent] Error:', error)
      throw error
    }
  })

  /**
   * Get task history
   */
  ipcMain.handle('taskQueue:getTaskHistory', async () => {
    try {
      return service.getTaskHistory()
    } catch (error) {
      console.error('[IPC taskQueue:getTaskHistory] Error:', error)
      throw error
    }
  })

  /**
   * Get monitoring history
   */
  ipcMain.handle('taskQueue:getMonitoringHistory', async () => {
    try {
      return service.getMonitoringHistory()
    } catch (error) {
      console.error('[IPC taskQueue:getMonitoringHistory] Error:', error)
      throw error
    }
  })

  /**
   * Clear task history
   */
  ipcMain.handle('taskQueue:clearTaskHistory', async () => {
    try {
      service.clearTaskHistory()
      return { success: true }
    } catch (error) {
      console.error('[IPC taskQueue:clearTaskHistory] Error:', error)
      throw error
    }
  })

  /**
   * Clear monitoring history
   */
  ipcMain.handle('taskQueue:clearMonitoringHistory', async () => {
    try {
      service.clearMonitoringHistory()
      return { success: true }
    } catch (error) {
      console.error('[IPC taskQueue:clearMonitoringHistory] Error:', error)
      throw error
    }
  })

  console.log('[IPC] Task queue handlers registered')
}
