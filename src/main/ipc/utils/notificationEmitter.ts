/**
 * Notification push event emitter
 *
 * After a notification is created in the database, this emits
 * 'notifications:new' to the renderer so the ActivityPanel can
 * reload immediately instead of waiting for the 10s poll.
 */

import { BrowserWindow } from 'electron'
import { safeSend } from './safeSend'

/**
 * Emit 'notifications:new' to the first available BrowserWindow.
 * Call this after every db.createNotification() to push updates to the UI.
 */
export function emitNotificationCreated(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    safeSend(win, 'notifications:new', {})
  }
}
