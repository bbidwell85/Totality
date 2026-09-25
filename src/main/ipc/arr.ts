/**
 * IPC Handlers for Arr Automation (Radarr / Sonarr / Lidarr)
 */

import { ipcMain } from 'electron'
import { getArrService } from '../services/ArrService'
import type { ArrType } from '../services/ArrService'

export function registerArrHandlers(): void {
  const arr = getArrService()

  // ── Connection & setup ──────────────────────────────────────────────────

  ipcMain.handle('arr:testConnection', async (_, { type, url, apiKey }: { type: ArrType; url: string; apiKey: string }) => {
    return arr.testConnection(type, url, apiKey)
  })

  ipcMain.handle('arr:getQualityProfiles', async (_, { type, url, apiKey }: { type: ArrType; url: string; apiKey: string }) => {
    return arr.getQualityProfiles(type, url, apiKey)
  })

  ipcMain.handle('arr:getRootFolders', async (_, { type, url, apiKey }: { type: ArrType; url: string; apiKey: string }) => {
    return arr.getRootFolders(type, url, apiKey)
  })

  ipcMain.handle('arr:getConfiguredApps', async () => {
    return arr.getConfiguredApps()
  })

  // ── Add items ──────────────────────────────────────────────────────────

  ipcMain.handle('arr:addMovie', async (_, { tmdbId, title, year }: { tmdbId: string | number; title: string; year?: number }) => {
    return arr.addMovie({ tmdbId, title, year })
  })

  ipcMain.handle('arr:addSeries', async (_, { title, year }: { title: string; year?: number }) => {
    return arr.addSeries({ title, year })
  })

  ipcMain.handle('arr:addArtist', async (_, { name, mbId }: { name: string; mbId?: string }) => {
    return arr.addArtist({ name, mbId })
  })

  // ── Queue ───────────────────────────────────────────────────────────────

  ipcMain.handle('arr:getQueue', async (_, type?: ArrType) => {
    return arr.getQueue(type)
  })

  ipcMain.handle('arr:removeFromQueue', async (_, { type, queueId, blacklist }: { type: ArrType; queueId: number; blacklist?: boolean }) => {
    return arr.removeFromQueue(type, queueId, blacklist)
  })
}
