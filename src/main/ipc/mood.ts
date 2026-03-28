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
import { MediaMonkeyProvider } from '../providers/mediamonkey/MediaMonkeyProvider'
import { KodiLocalProvider } from '../providers/kodi/KodiLocalProvider'
import { getMediaMonkeyDiscoveryService } from '../services/MediaMonkeyDiscoveryService'
import { getKodiLocalDiscoveryService } from '../services/KodiLocalDiscoveryService'
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
   * Pre-sync safety check for database write targets (MediaMonkey, Kodi-Local).
   * Returns status info for the confirmation dialog.
   */
  ipcMain.handle('mood:checkMediaMonkeyWrite', async (_event, sourceId: string) => {
    try {
      const manager = getSourceManager()
      const provider = manager.getProvider(sourceId)
      if (!provider) return { canWrite: false, reason: 'Source not found' }

      if (provider.providerType === 'mediamonkey') {
        const discovery = getMediaMonkeyDiscoveryService()
        const isRunning = await discovery.isMediaMonkeyRunning()
        const dbPath = (provider as unknown as { databasePath: string }).databasePath
        return {
          canWrite: !isRunning,
          isRunning,
          databasePath: dbPath,
          appName: 'MediaMonkey',
          reason: isRunning ? 'MediaMonkey is currently running. Close it before syncing.' : undefined,
        }
      }

      if (provider.providerType === 'kodi-local') {
        const discovery = getKodiLocalDiscoveryService()
        const isRunning = await discovery.isKodiRunning()
        const dbPath = (provider as unknown as { musicDatabasePath: string }).musicDatabasePath
        return {
          canWrite: !isRunning,
          isRunning,
          databasePath: dbPath,
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

  // Debug: fetch moods for a specific Plex track by ratingKey
  ipcMain.handle('mood:debugFetchTrack', async (_event, args: { sourceId: string; ratingKey: string }) => {
    try {
      const manager = getSourceManager()
      const provider = manager.getProvider(args.sourceId)
      if (!provider || provider.providerType !== 'plex') return { error: 'Plex provider not found' }
      const plexProvider = provider as PlexProvider
      const moods = await plexProvider.getTrackMoods(args.ratingKey)
      console.warn(`[mood:debugFetchTrack] ratingKey=${args.ratingKey} moods=${JSON.stringify(moods)}`)
      return { ratingKey: args.ratingKey, moods }
    } catch (error) {
      console.warn(`[mood:debugFetchTrack] Error: ${getErrorMessage(error)}`)
      return { error: getErrorMessage(error) }
    }
  })

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
    mode?: 'overwrite' | 'append'
  }) => {
    const { sourceOfTruthId, targetSourceId, trackIds, mode = 'overwrite' } = args
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
          .map(t => {
            // In append mode, merge source moods with existing target moods
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
            current: i,
            total: tracksToSync.length,
            currentTrack: `${track.artist} - ${track.title}`,
            trackId: track.targetTrackId,
            status: 'syncing',
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

            // Notify track completed
            safeSend(mainWindow, 'mood:syncProgress', {
              current: i + 1,
              total: tracksToSync.length,
              currentTrack: `${track.artist} - ${track.title}`,
              trackId: track.targetTrackId,
              status: 'done',
            })

            // Delay between requests for visual feedback + server breathing room
            await new Promise(r => setTimeout(r, 200))
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

            await new Promise(r => setTimeout(r, 200))
          }
        }
      } else if (provider.providerType === 'mediamonkey') {
        // Write moods to MediaMonkey's SQLite database
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
          (current, total, trackName) => {
            const track = trackUpdates[current]
            safeSend(mainWindow, 'mood:syncProgress', {
              current,
              total,
              currentTrack: track ? `${track.artist} - ${track.title}` : trackName,
              trackId: track?.targetTrackId,
              status: 'syncing',
            })
          }
        )

        result.synced = writeResult.written
        result.failed = writeResult.failed
        result.errors = writeResult.errors

        // Update local DB to match what we wrote
        if (writeResult.written > 0) {
          for (const track of trackUpdates) {
            try {
              getDatabase().updateMusicTrackMood(track.targetTrackId, JSON.stringify(track.moods))
            } catch { /* best effort */ }
          }
          // Send final done status for all tracks
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
        // Write moods to Kodi's SQLite database
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
          (current, total) => {
            const track = trackUpdates[current - 1]
            if (track) {
              safeSend(mainWindow, 'mood:syncProgress', {
                current,
                total,
                currentTrack: `${track.artist} - ${track.title}`,
                trackId: track.targetTrackId,
                status: 'done',
              })
            }
          }
        )

        result.synced = writeResult.written
        result.failed = writeResult.failed
        result.errors = writeResult.errors

        // Update local DB to match
        if (writeResult.written > 0) {
          for (const track of trackUpdates) {
            try {
              getDatabase().updateMusicTrackMood(track.targetTrackId, JSON.stringify(track.moods))
            } catch { /* best effort */ }
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
