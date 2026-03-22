/**
 * IPC Handlers for Notifications
 */

import { ipcMain } from 'electron'
import { getDatabase } from '../database/getDatabase'

export function registerNotificationHandlers(): void {
  ipcMain.handle('notifications:getAll', async (_event, options?: { limit?: number, offset?: number, type?: string, unreadOnly?: boolean }) => {
    try {
      const db = getDatabase()
      return db.getNotifications(options || {})
    } catch (error) {
      console.error('[IPC notifications:getAll] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:getCount', async () => {
    try {
      const db = getDatabase()
      return db.getNotificationCount()
    } catch (error) {
      console.error('[IPC notifications:getCount] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:markRead', async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      db.markNotificationsRead(ids)
    } catch (error) {
      console.error('[IPC notifications:markRead] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:markAllRead', async () => {
    try {
      const db = getDatabase()
      db.markAllNotificationsRead()
    } catch (error) {
      console.error('[IPC notifications:markAllRead] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:delete', async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      db.deleteNotifications(ids)
    } catch (error) {
      console.error('[IPC notifications:delete] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:clear', async () => {
    try {
      const db = getDatabase()
      db.clearAllNotifications()
    } catch (error) {
      console.error('[IPC notifications:clear] Error:', error)
      throw error
    }
  })
}
