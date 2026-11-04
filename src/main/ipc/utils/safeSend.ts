/**
 * Safe IPC Send Utilities
 *
 * Provides a safe way to send messages to BrowserWindow webContents,
 * handling cases where the window may have been closed during an operation.
 */

import { BrowserWindow } from 'electron'
import { getWebServerService } from '../../services/WebServerService'

// Channels that should NOT be broadcast to web clients (desktop-only events)
const BROADCAST_SKIP = new Set(['logs:new', 'logging:entry'])

/**
 * Safely send a message to a BrowserWindow's webContents.
 * Returns false if the window or webContents is no longer valid.
 *
 * @param win The target BrowserWindow (may be null)
 * @param channel The IPC channel name
 * @param args Arguments to send
 * @returns true if message was sent, false if window was invalid
 *
 * @example
 * const win = BrowserWindow.fromWebContents(event.sender)
 * safeSend(win, 'sources:scanProgress', { current: 5, total: 100 })
 */
export function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]): boolean {
  let sent = false
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args)
      sent = true
    }
  } catch (error) {
    // Silently ignore - window was likely closed during operation
  }
  // Always broadcast to web clients (except desktop-only channels)
  if (!BROADCAST_SKIP.has(channel)) {
    try {
      const webServer = getWebServerService()
      if (webServer?.isRunning()) {
        webServer.broadcastEvent(channel, ...args)
      }
    } catch { /* web server not initialized yet */ }
  }

  return sent
}

/**
 * Get the BrowserWindow from an IPC event sender.
 * Convenience wrapper around BrowserWindow.fromWebContents.
 *
 * @param event The IPC event with a sender property
 * @returns The BrowserWindow or null if not found
 */
export function getWindowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}
