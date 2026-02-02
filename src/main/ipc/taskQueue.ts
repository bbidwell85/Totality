/**
 * IPC Handlers for Task Queue System
 */

import { ipcMain } from 'electron'
import { getTaskQueueService, TaskDefinition } from '../services/TaskQueueService'

export function registerTaskQueueHandlers(): void {
  const service = getTaskQueueService()

  /**
   * Get current queue state
   */
  ipcMain.handle('taskQueue:getState', async () => {
    return service.getQueueState()
  })

  /**
   * Add a task to the queue
   */
  ipcMain.handle('taskQueue:addTask', async (_event, definition: TaskDefinition) => {
    console.log('[IPC] taskQueue:addTask called with:', definition)
    const taskId = service.addTask(definition)
    console.log('[IPC] taskQueue:addTask returning taskId:', taskId)
    return { success: true, taskId }
  })

  /**
   * Remove a task from the queue
   */
  ipcMain.handle('taskQueue:removeTask', async (_event, taskId: string) => {
    const removed = service.removeTask(taskId)
    return { success: removed }
  })

  /**
   * Reorder the queue
   */
  ipcMain.handle('taskQueue:reorderQueue', async (_event, taskIds: string[]) => {
    service.reorderQueue(taskIds)
    return { success: true }
  })

  /**
   * Clear all queued tasks
   */
  ipcMain.handle('taskQueue:clearQueue', async () => {
    service.clearQueue()
    return { success: true }
  })

  /**
   * Pause the queue
   */
  ipcMain.handle('taskQueue:pause', async () => {
    service.pauseQueue()
    return { success: true }
  })

  /**
   * Resume the queue
   */
  ipcMain.handle('taskQueue:resume', async () => {
    service.resumeQueue()
    return { success: true }
  })

  /**
   * Cancel the current running task
   */
  ipcMain.handle('taskQueue:cancelCurrent', async () => {
    service.cancelCurrentTask()
    return { success: true }
  })

  /**
   * Get task history
   */
  ipcMain.handle('taskQueue:getTaskHistory', async () => {
    return service.getTaskHistory()
  })

  /**
   * Get monitoring history
   */
  ipcMain.handle('taskQueue:getMonitoringHistory', async () => {
    return service.getMonitoringHistory()
  })

  /**
   * Clear task history
   */
  ipcMain.handle('taskQueue:clearTaskHistory', async () => {
    service.clearTaskHistory()
    return { success: true }
  })

  /**
   * Clear monitoring history
   */
  ipcMain.handle('taskQueue:clearMonitoringHistory', async () => {
    service.clearMonitoringHistory()
    return { success: true }
  })

  console.log('[IPC] Task queue handlers registered')
}
