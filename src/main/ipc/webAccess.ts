/**
 * Web Access IPC Handlers
 *
 * Exposes web server status and control to the renderer.
 */

import { ipcMain } from 'electron'
import { getWebServerService } from '../services/WebServerService'
import { getDatabase } from '../database/getDatabase'
import { SETTING_KEYS } from '../../shared/settingKeys'
import os from 'os'

function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

export function registerWebAccessHandlers() {
  ipcMain.handle('webAccess:getStatus', () => {
    const ws = getWebServerService()
    const db = getDatabase()
    const enabled = db.getSetting(SETTING_KEYS.web_access_enabled) === 'true'
    const port = parseInt(db.getSetting(SETTING_KEYS.web_access_port) || '9470', 10) || 9470
    const running = ws?.isRunning() || false
    const connectedClients = ws?.getConnectedClients() || 0
    const localIp = getLocalIp()

    return {
      enabled,
      port,
      running,
      connectedClients,
      isHttps: db.getSetting(SETTING_KEYS.web_access_https) !== 'false',
      localUrl: running ? `${db.getSetting(SETTING_KEYS.web_access_https) !== 'false' ? 'https' : 'http'}://${localIp}:${port}` : null,
    }
  })

  ipcMain.handle('webAccess:start', async () => {
    const ws = getWebServerService()
    if (!ws) throw new Error('Web server not initialized')
    if (ws.isRunning()) return { success: true, message: 'Already running' }

    await ws.start()
    return { success: true }
  })

  ipcMain.handle('webAccess:stop', () => {
    const ws = getWebServerService()
    if (!ws) throw new Error('Web server not initialized')
    ws.stop()
    return { success: true }
  })

}
