/**
 * IPC Handlers for Mood Sync
 *
 * Handles mood comparison, sync operations, and source listing.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getMoodSyncService } from '../services/MoodSyncService'
import { getSourceManager } from '../services/SourceManager'
import { getDatabase } from '../database/getDatabase'
import { PlexProvider } from '../providers/plex/PlexProvider'
import { getErrorMessage } from '../services/utils/errorUtils'

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}

let mainWindow: BrowserWindow | null = null

export function setMoodMainWindow(win: BrowserWindow) {
  mainWindow = win
}

export function registerMoodHandlers() {
  /**
   * Get sources that have music tracks (with mood counts)
   */
  ipcMain.handle('mood:getSources', async () => {
    try {
      const sources = getMoodSyncService().getSources()
      console.warn('[mood:getSources] Found sources:', sources.map(s => `${s.sourceName} (${s.tracksWithMoods}/${s.totalTracks} moods)`).join(', '))
      return sources
    } catch (error) {
      console.error('[mood:getSources] Error:', getErrorMessage(error))
      return []
    }
  })

  /**
   * Get mood comparison between source of truth and all other sources
   */
  ipcMain.handle('mood:getComparison', async (_event, sourceOfTruthId: string) => {
    try {
      const result = getMoodSyncService().getComparison(sourceOfTruthId)
      console.warn(`[mood:getComparison] Source: ${sourceOfTruthId}, found ${result.length} matched tracks with moods`)
      if (result.length > 0) {
        console.warn(`[mood:getComparison] Sample: ${result[0].trackTitle} by ${result[0].artist} — moods: ${result[0].sourceOfTruthMoods.join(', ')}`)
      }
      return result
    } catch (error) {
      console.error('[mood:getComparison] Error:', getErrorMessage(error))
      return []
    }
  })

  /**
   * Sync moods from source of truth to a target source
   */
  ipcMain.handle('mood:syncToTarget', async (_event, args: {
    sourceOfTruthId: string
    targetSourceId: string
    trackIds?: number[]
  }) => {
    const { sourceOfTruthId, targetSourceId, trackIds } = args
    const result = { synced: 0, failed: 0, skipped: 0, errors: [] as string[] }

    try {
      console.warn(`[mood:syncToTarget] Starting sync: SOT=${sourceOfTruthId}, target=${targetSourceId}`)
      const comparison = getMoodSyncService().getComparison(sourceOfTruthId)
      console.warn(`[mood:syncToTarget] Comparison returned ${comparison.length} tracks`)
      const manager = getSourceManager()
      const provider = manager.getProvider(targetSourceId)

      if (!provider) {
        console.warn('[mood:syncToTarget] Target provider not found!')
        return { ...result, errors: ['Target provider not found'] }
      }
      console.warn(`[mood:syncToTarget] Provider type: ${provider.providerType}`)

      // Filter to only tracks targeting this source with mismatches
      const tracksToSync = comparison.flatMap(c =>
        c.targets
          .filter(t => t.sourceId === targetSourceId && t.hasMismatch)
          .filter(t => !trackIds || trackIds.includes(t.trackId))
          .map(t => ({
            title: c.trackTitle,
            artist: c.artist,
            moods: c.sourceOfTruthMoods,
            targetProviderId: t.trackProviderId,
            targetTrackId: t.trackId,
            libraryId: t.libraryId,
          }))
      )

      console.warn(`[mood:syncToTarget] Tracks to sync: ${tracksToSync.length}`)
      if (tracksToSync.length === 0) {
        return { ...result, skipped: comparison.length }
      }

      // Sync based on target provider type
      if (provider.providerType === 'plex') {
        const plexProvider = provider as PlexProvider
        for (let i = 0; i < tracksToSync.length; i++) {
          const track = tracksToSync[i]
          safeSend(mainWindow, 'mood:syncProgress', {
            current: i + 1,
            total: tracksToSync.length,
            currentTrack: `${track.artist} - ${track.title}`,
          })

          try {
            await plexProvider.setTrackMoods(
              track.targetProviderId,
              track.moods,
              track.libraryId || ''
            )
            // Update local DB so comparison reflects the change
            try {
              getDatabase().updateMusicTrackMood(track.targetTrackId, JSON.stringify(track.moods))
            } catch { /* best effort */ }
            result.synced++
            // Small delay between requests
            if (i < tracksToSync.length - 1) {
              await new Promise(r => setTimeout(r, 75))
            }
          } catch (error) {
            result.failed++
            result.errors.push(`${track.artist} - ${track.title}: ${getErrorMessage(error)}`)
          }
        }
      } else {
        return { ...result, errors: [`Mood sync not yet supported for ${provider.providerType}`] }
      }

      return result
    } catch (error) {
      return { ...result, errors: [getErrorMessage(error)] }
    }
  })
}
