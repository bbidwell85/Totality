/**
 * IPC Handlers for Mood Sync
 *
 * Handles mood comparison, sync operations, and source listing.
 */

import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import { getMoodSyncService } from '../services/MoodSyncService'
import { getSourceManager } from '../services/SourceManager'
import { getDatabase } from '../database/getDatabase'
import { PlexProvider } from '../providers/plex/PlexProvider'
import { MediaMonkeyProvider } from '../providers/mediamonkey/MediaMonkeyProvider'
import { KodiLocalProvider } from '../providers/kodi/KodiLocalProvider'
import { getMediaMonkeyDiscoveryService } from '../services/MediaMonkeyDiscoveryService'
import { getKodiLocalDiscoveryService } from '../services/KodiLocalDiscoveryService'
import { getErrorMessage } from '../services/utils/errorUtils'
import { safeSend } from './utils/safeSend'

let mainWindow: BrowserWindow | null = null

export function setMoodMainWindow(win: BrowserWindow) {
  mainWindow = win
}

/**
 * Helper: update local DB moods for a batch of tracks
 */
function updateLocalDbTags(tracks: Array<{ targetTrackId: number; moods: string[] }>, field: 'mood' | 'genre' = 'mood') {
  const db = getDatabase()
  for (const track of tracks) {
    try {
      db.updateMusicTrackTag(track.targetTrackId, field, JSON.stringify(track.moods))
    } catch { /* best effort */ }
  }
}

export function registerMoodHandlers() {
  /**
   * Pre-sync safety check for database write targets (MediaMonkey, Kodi-Local).
   * Returns status info for the confirmation dialog.
   * Only sends basename of database path to renderer (not full filesystem path).
   */
  ipcMain.handle('mood:checkMediaMonkeyWrite', async (_event, sourceId: string) => {
    try {
      const manager = getSourceManager()
      const provider = manager.getProvider(sourceId)
      if (!provider) return { canWrite: false, reason: 'Source not found' }

      if (provider.providerType === 'mediamonkey') {
        const discovery = getMediaMonkeyDiscoveryService()
        const isRunning = await discovery.isMediaMonkeyRunning()
        const mmProvider = provider as MediaMonkeyProvider
        return {
          canWrite: !isRunning,
          isRunning,
          databasePath: path.basename(mmProvider.getDatabasePath()),
          appName: 'MediaMonkey',
          reason: isRunning ? 'MediaMonkey is currently running. Close it before syncing.' : undefined,
        }
      }

      if (provider.providerType === 'kodi-local') {
        const discovery = getKodiLocalDiscoveryService()
        const isRunning = await discovery.isKodiRunning()
        const kodiProvider = provider as KodiLocalProvider
        return {
          canWrite: !isRunning,
          isRunning,
          databasePath: path.basename(kodiProvider.getMusicDatabasePath()),
          appName: 'Kodi',
          reason: isRunning ? 'Kodi is currently running. Close it before syncing.' : undefined,
        }
      }

      // Plex and other API-based targets don't need safety checks
      return { canWrite: true }
    } catch (error) {
      return { canWrite: false, reason: getErrorMessage(error) }
    }
  })

  /**
   * Get sources that have music tracks (with tag counts for a specific field)
   */
  ipcMain.handle('mood:getSources', async (_event, field?: 'mood' | 'genre') => {
    try {
      return getMoodSyncService().getSources(field || 'mood')
    } catch (error) {
      console.error('[mood:getSources] Error:', getErrorMessage(error))
      return []
    }
  })

  /**
   * Get tag comparison between source of truth and all other sources
   */
  ipcMain.handle('mood:getComparison', async (_event, args: string | { sourceOfTruthId: string; field?: 'mood' | 'genre' }) => {
    try {
      // Support both old (string) and new (object) call signatures
      const sourceOfTruthId = typeof args === 'string' ? args : args.sourceOfTruthId
      const field = typeof args === 'string' ? 'mood' : (args.field || 'mood')
      return getMoodSyncService().getComparison(sourceOfTruthId, field)
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
    mode?: 'overwrite' | 'append'
    field?: 'mood' | 'genre'
  }) => {
    const { sourceOfTruthId, targetSourceId, trackIds, mode = 'overwrite', field = 'mood' } = args
    const result = { synced: 0, failed: 0, skipped: 0, errors: [] as string[] }

    try {
      const comparison = getMoodSyncService().getComparison(sourceOfTruthId, field)
      const manager = getSourceManager()
      const provider = manager.getProvider(targetSourceId)

      if (!provider) {
        return { ...result, errors: ['Target provider not found'] }
      }

      // Filter to only tracks targeting this source with mismatches
      const tracksToSync = comparison.flatMap(c =>
        c.targets
          .filter(t => t.sourceId === targetSourceId && t.hasMismatch)
          .filter(t => !trackIds || trackIds.includes(t.trackId))
          .map(t => {
            const finalMoods = mode === 'append'
              ? [...new Set([...t.moods, ...c.sourceOfTruthMoods])]
              : c.sourceOfTruthMoods
            return {
              title: c.trackTitle,
              artist: c.artist,
              moods: finalMoods,
              targetProviderId: t.trackProviderId,
              targetTrackId: t.trackId,
              libraryId: t.libraryId,
            }
          })
      )

      if (tracksToSync.length === 0) {
        return { ...result, skipped: comparison.length }
      }

      console.log(`[mood:syncToTarget] Syncing ${tracksToSync.length} tracks to ${provider.providerType}`)

      // Sync based on target provider type
      if (provider.providerType === 'plex') {
        const plexProvider = provider as PlexProvider
        for (let i = 0; i < tracksToSync.length; i++) {
          const track = tracksToSync[i]
          safeSend(mainWindow, 'mood:syncProgress', {
            current: i,
            total: tracksToSync.length,
            currentTrack: `${track.artist} - ${track.title}`,
            trackId: track.targetTrackId,
            status: 'syncing',
          })

          try {
            await plexProvider.setTrackTags(
              track.targetProviderId,
              track.moods,
              track.libraryId || '',
              field
            )
            updateLocalDbTags([track], field)
            result.synced++

            safeSend(mainWindow, 'mood:syncProgress', {
              current: i + 1,
              total: tracksToSync.length,
              currentTrack: `${track.artist} - ${track.title}`,
              trackId: track.targetTrackId,
              status: 'done',
            })

            // Small delay between Plex API requests
            await new Promise(r => setTimeout(r, 50))
          } catch (error) {
            result.failed++
            result.errors.push(`${track.artist} - ${track.title}: ${getErrorMessage(error)}`)

            safeSend(mainWindow, 'mood:syncProgress', {
              current: i + 1,
              total: tracksToSync.length,
              currentTrack: `${track.artist} - ${track.title}`,
              trackId: track.targetTrackId,
              status: 'failed',
            })

            await new Promise(r => setTimeout(r, 50))
          }
        }
      } else if (provider.providerType === 'mediamonkey') {
        const mmProvider = provider as MediaMonkeyProvider
        const trackUpdates = tracksToSync.map(t => ({
          songId: parseInt(t.targetProviderId),
          moods: t.moods,
          title: t.title,
          artist: t.artist,
          targetTrackId: t.targetTrackId,
        }))

        const writeResult = await mmProvider.writeMoods(
          trackUpdates.map(t => ({ songId: t.songId, moods: t.moods })),
          undefined,
          field,
        )

        result.synced = writeResult.written
        result.failed = writeResult.failed
        result.errors = writeResult.errors

        if (writeResult.written > 0) {
          updateLocalDbTags(trackUpdates, field)
          for (let i = 0; i < trackUpdates.length; i++) {
            safeSend(mainWindow, 'mood:syncProgress', {
              current: i + 1,
              total: trackUpdates.length,
              currentTrack: `${trackUpdates[i].artist} - ${trackUpdates[i].title}`,
              trackId: trackUpdates[i].targetTrackId,
              status: writeResult.errors.length === 0 ? 'done' : 'failed',
            })
          }
        }
      } else if (provider.providerType === 'kodi-local') {
        const kodiProvider = provider as KodiLocalProvider
        const trackUpdates = tracksToSync.map(t => ({
          songId: parseInt(t.targetProviderId),
          moods: t.moods,
          title: t.title,
          artist: t.artist,
          targetTrackId: t.targetTrackId,
        }))

        const writeResult = await kodiProvider.writeMoods(
          trackUpdates.map(t => ({ songId: t.songId, moods: t.moods })),
          undefined,
          field,
        )

        result.synced = writeResult.written
        result.failed = writeResult.failed
        result.errors = writeResult.errors

        if (writeResult.written > 0) {
          updateLocalDbTags(trackUpdates, field)
          for (let i = 0; i < trackUpdates.length; i++) {
            safeSend(mainWindow, 'mood:syncProgress', {
              current: i + 1,
              total: trackUpdates.length,
              currentTrack: `${trackUpdates[i].artist} - ${trackUpdates[i].title}`,
              trackId: trackUpdates[i].targetTrackId,
              status: writeResult.errors.length === 0 ? 'done' : 'failed',
            })
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
