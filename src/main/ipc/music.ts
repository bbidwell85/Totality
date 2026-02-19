/**
 * Music IPC Handlers
 *
 * Handles IPC communication for music library operations.
 */

import { ipcMain } from 'electron'
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from '../services/QualityAnalyzer'
import { getMusicBrainzService } from '../services/MusicBrainzService'
import { getSourceManager } from '../services/SourceManager'
import { PlexProvider } from '../providers/plex/PlexProvider'
import { LocalFolderProvider } from '../providers/local/LocalFolderProvider'
import { JellyfinEmbyBase } from '../providers/jellyfin-emby/JellyfinEmbyBase'
import { KodiProvider } from '../providers/kodi/KodiProvider'
import { KodiLocalProvider } from '../providers/kodi/KodiLocalProvider'
import type { MusicFilters, MusicTrack } from '../types/database'
import { safeSend, getWindowFromEvent } from './utils/safeSend'
import { createProgressUpdater } from './utils/progressUpdater'
import { validateInput, PositiveIntSchema, NonEmptyStringSchema, OptionalSourceIdSchema, SourceIdSchema, LibraryIdSchema, MusicFiltersSchema } from '../validation/schemas'
import { z } from 'zod'

export function registerMusicHandlers(): void {
  // ============================================================================
  // MUSIC LIBRARY SCANNING
  // ============================================================================

  /**
   * Scan a music library from a source
   */
  ipcMain.handle('music:scanLibrary', async (_event, sourceId: unknown, libraryId: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'music:scanLibrary')
    const validLibraryId = validateInput(LibraryIdSchema, libraryId, 'music:scanLibrary')
    console.log(`[music:scanLibrary] Starting scan for source=${validSourceId}, library=${validLibraryId}`)

    const manager = getSourceManager()
    const provider = manager.getProvider(validSourceId)

    console.log(`[music:scanLibrary] Provider found: ${provider ? provider.providerType : 'none'}`)

    if (!provider) {
      throw new Error(`Source not found: ${validSourceId}`)
    }

    const win = getWindowFromEvent(_event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:scanProgress', 'music')

    const progressCallback = (progress: { current: number; total: number; currentItem?: string; percentage?: number }) => {
      onProgress(progress, { sourceId: validSourceId, libraryId: validLibraryId })
    }

    try {
      let result

      // Get library info first (for timestamp recording)
      const libraries = await provider.getLibraries()
      const library = libraries.find(lib => lib.id === validLibraryId)

      if (provider.providerType === 'plex') {
        // Plex provider
        const plexProvider = provider as PlexProvider
        console.log(`[music:scanLibrary] Plex provider - has selected server: ${plexProvider.hasSelectedServer()}`)

        if (!plexProvider.hasSelectedServer()) {
          throw new Error('Plex provider has no selected server. Please reconnect to your Plex server.')
        }

        result = await plexProvider.scanMusicLibrary(validLibraryId, progressCallback)
      } else if (provider.providerType === 'local') {
        // Local folder provider
        const localProvider = provider as LocalFolderProvider
        console.log(`[music:scanLibrary] Local folder provider`)

        // Local folder uses scanLibrary which routes to scanMusicLibrary internally
        result = await localProvider.scanLibrary(validLibraryId, { onProgress: progressCallback })
      } else if (provider.providerType === 'jellyfin' || provider.providerType === 'emby') {
        // Jellyfin/Emby provider
        const jellyfinProvider = provider as JellyfinEmbyBase
        console.log(`[music:scanLibrary] ${provider.providerType} provider`)

        result = await jellyfinProvider.scanMusicLibrary(validLibraryId, progressCallback)
      } else if (provider.providerType === 'kodi') {
        // Kodi JSON-RPC provider
        const kodiProvider = provider as KodiProvider
        console.log(`[music:scanLibrary] Kodi JSON-RPC provider`)

        result = await kodiProvider.scanMusicLibrary(progressCallback)
      } else if (provider.providerType === 'kodi-local') {
        // Kodi-Local SQLite provider
        const kodiLocalProvider = provider as KodiLocalProvider
        console.log(`[music:scanLibrary] Kodi-Local provider`)

        result = await kodiLocalProvider.scanMusicLibrary(progressCallback)
      } else {
        throw new Error(`Music scanning is not supported for provider type: ${provider.providerType}`)
      }

      console.log(`[music:scanLibrary] Scan result:`, JSON.stringify(result, null, 2))

      // Analyze quality for all albums
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      const albums = db.getMusicAlbums({ sourceId: validSourceId })
      console.log(`[music:scanLibrary] Found ${albums.length} albums in database for sourceId=${validSourceId}`)

      // Batch fetch all tracks to avoid N+1 queries
      const albumIds = albums.map((a: { id?: number }) => a.id).filter((id: number | undefined): id is number => id != null)
      const tracksByAlbum = 'getMusicTracksByAlbumIds' in db
        ? (db as unknown as { getMusicTracksByAlbumIds: (ids: number[]) => Map<number, MusicTrack[]> }).getMusicTracksByAlbumIds(albumIds)
        : null

      db.startBatch()
      for (const album of albums) {
        const tracks = tracksByAlbum
          ? (tracksByAlbum.get(album.id!) || [])
          : db.getMusicTracks({ albumId: album.id })
        const qualityScore = analyzer.analyzeMusicAlbum(album, tracks)
        await db.upsertMusicQualityScore(qualityScore)
      }
      await db.endBatch()

      // Update library scan timestamp if successful
      if (result.success && library) {
        await db.updateLibraryScanTime(
          validSourceId,
          validLibraryId,
          library.name,
          library.type,
          result.itemsScanned
        )
        console.log(`[music:scanLibrary] Updated scan timestamp for library ${library.name}`)
      }

      return result
    } catch (error: unknown) {
      console.error('[music:scanLibrary] Error:', error)
      throw error
    } finally {
      flush()
    }
  })

  // ============================================================================
  // MUSIC DATA RETRIEVAL
  // ============================================================================

  /**
   * Get all music artists
   */
  ipcMain.handle('music:getArtists', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(MusicFiltersSchema, filters, 'music:getArtists')
      const db = getDatabase()
      return db.getMusicArtists(validFilters)
    } catch (error: unknown) {
      console.error('[music:getArtists] Error:', error)
      throw error
    }
  })

  /**
   * Get a music artist by ID
   */
  ipcMain.handle('music:getArtistById', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'music:getArtistById')
      const db = getDatabase()
      return db.getMusicArtistById(validId)
    } catch (error: unknown) {
      console.error('[music:getArtistById] Error:', error)
      throw error
    }
  })

  /**
   * Get all music albums
   */
  ipcMain.handle('music:getAlbums', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(MusicFiltersSchema, filters, 'music:getAlbums')
      const db = getDatabase()
      return db.getMusicAlbums(validFilters)
    } catch (error: unknown) {
      console.error('[music:getAlbums] Error:', error)
      throw error
    }
  })

  /**
   * Get albums for a specific artist
   */
  ipcMain.handle('music:getAlbumsByArtist', async (_event, artistId: unknown) => {
    try {
      const validArtistId = validateInput(PositiveIntSchema, artistId, 'music:getAlbumsByArtist')
      const db = getDatabase()
      return db.getMusicAlbums({ artistId: validArtistId })
    } catch (error: unknown) {
      console.error('[music:getAlbumsByArtist] Error:', error)
      throw error
    }
  })

  /**
   * Get a music album by ID
   */
  ipcMain.handle('music:getAlbumById', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'music:getAlbumById')
      const db = getDatabase()
      return db.getMusicAlbumById(validId)
    } catch (error: unknown) {
      console.error('[music:getAlbumById] Error:', error)
      throw error
    }
  })

  /**
   * Get all music tracks
   */
  ipcMain.handle('music:getTracks', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(MusicFiltersSchema, filters, 'music:getTracks')
      const db = getDatabase()
      return db.getMusicTracks(validFilters)
    } catch (error: unknown) {
      console.error('[music:getTracks] Error:', error)
      throw error
    }
  })

  /**
   * Count music items (for pagination)
   */
  ipcMain.handle('music:countArtists', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(MusicFiltersSchema, filters, 'music:countArtists')
      const db = getDatabase()
      return db.countMusicArtists(validFilters)
    } catch (error: unknown) {
      console.error('[music:countArtists] Error:', error)
      throw error
    }
  })

  ipcMain.handle('music:countAlbums', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(MusicFiltersSchema, filters, 'music:countAlbums')
      const db = getDatabase()
      return db.countMusicAlbums(validFilters)
    } catch (error: unknown) {
      console.error('[music:countAlbums] Error:', error)
      throw error
    }
  })

  ipcMain.handle('music:countTracks', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(MusicFiltersSchema, filters, 'music:countTracks')
      const db = getDatabase()
      return db.countMusicTracks(validFilters)
    } catch (error: unknown) {
      console.error('[music:countTracks] Error:', error)
      throw error
    }
  })

  /**
   * Get tracks for a specific album
   */
  ipcMain.handle('music:getTracksByAlbum', async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:getTracksByAlbum')
      const db = getDatabase()
      return db.getMusicTracks({ albumId: validAlbumId })
    } catch (error: unknown) {
      console.error('[music:getTracksByAlbum] Error:', error)
      throw error
    }
  })

  /**
   * Get music library statistics
   */
  ipcMain.handle('music:getStats', async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:getStats') : undefined
      const db = getDatabase()
      return db.getMusicStats(validSourceId)
    } catch (error: unknown) {
      console.error('[music:getStats] Error:', error)
      throw error
    }
  })

  // ============================================================================
  // QUALITY ANALYSIS
  // ============================================================================

  /**
   * Get quality score for an album
   */
  ipcMain.handle('music:getAlbumQuality', async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:getAlbumQuality')
      const db = getDatabase()
      return db.getMusicQualityScore(validAlbumId)
    } catch (error: unknown) {
      console.error('[music:getAlbumQuality] Error:', error)
      throw error
    }
  })

  /**
   * Get albums that need quality upgrades
   */
  ipcMain.handle('music:getAlbumsNeedingUpgrade', async (_event, limit?: unknown, sourceId?: unknown) => {
    try {
      const validLimit = limit !== undefined ? validateInput(z.number().int().positive().optional(), limit, 'music:getAlbumsNeedingUpgrade') : undefined
      const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:getAlbumsNeedingUpgrade') : undefined
      const db = getDatabase()
      return db.getAlbumsNeedingUpgrade(validLimit, validSourceId)
    } catch (error: unknown) {
      console.error('[music:getAlbumsNeedingUpgrade] Error:', error)
      throw error
    }
  })

  /**
   * Analyze quality for all albums
   */
  ipcMain.handle('music:analyzeAllQuality', async (event, sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:analyzeAllQuality') : undefined
    const db = getDatabase()
    const analyzer = getQualityAnalyzer()
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:qualityProgress', 'music')

    try {
      const filters: MusicFilters = validSourceId ? { sourceId: validSourceId } : {}
      const albums = db.getMusicAlbums(filters)

      // Batch fetch all tracks to avoid N+1 queries
      const albumIds = albums.map((a: { id?: number }) => a.id).filter((id: number | undefined): id is number => id != null)
      const tracksByAlbum = 'getMusicTracksByAlbumIds' in db
        ? (db as unknown as { getMusicTracksByAlbumIds: (ids: number[]) => Map<number, MusicTrack[]> }).getMusicTracksByAlbumIds(albumIds)
        : null

      let processed = 0

      db.startBatch()
      for (const album of albums) {
        const tracks = tracksByAlbum
          ? (tracksByAlbum.get(album.id!) || [])
          : db.getMusicTracks({ albumId: album.id })
        const qualityScore = analyzer.analyzeMusicAlbum(album, tracks)
        await db.upsertMusicQualityScore(qualityScore)

        processed++
        onProgress({
          current: processed,
          total: albums.length,
          currentItem: `${album.artist_name} - ${album.title}`,
          percentage: (processed / albums.length) * 100,
        })
      }
      await db.endBatch()

      return { success: true, analyzed: albums.length }
    } catch (error: unknown) {
      console.error('[music:analyzeAllQuality] Error:', error)
      throw error
    } finally {
      flush()
    }
  })

  // ============================================================================
  // UNIFIED MUSICBRAINZ COMPLETENESS ANALYSIS
  // ============================================================================

  /**
   * Analyze completeness for all artists AND all albums in one pass
   * Uses the public MusicBrainz API
   * For local sources (kodi-local, local), also fetches artwork from Cover Art Archive
   *
   * @param sourceId Optional source ID to scope analysis
   */
  ipcMain.handle('music:analyzeAll', async (event, sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:analyzeAll') : undefined
    const mbService = getMusicBrainzService()
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:analysisProgress', 'music')

    try {
      const result = await mbService.analyzeAllMusic((progress) => {
        onProgress(progress)
      }, validSourceId)

      return { success: true, ...result }
    } catch (error: unknown) {
      console.error('[music:analyzeAll] Error:', error)
      throw error
    } finally {
      flush()
    }
  })

  /**
   * Cancel the current music analysis
   */
  ipcMain.handle('music:cancelAnalysis', async () => {
    try {
      const mbService = getMusicBrainzService()
      mbService.cancel()
      return { success: true }
    } catch (error: unknown) {
      console.error('[music:cancelAnalysis] Error:', error)
      throw error
    }
  })

  /**
   * Search for an artist in MusicBrainz
   */
  ipcMain.handle('music:searchMusicBrainzArtist', async (_event, name: unknown) => {
    try {
      const validName = validateInput(NonEmptyStringSchema, name, 'music:searchMusicBrainzArtist')
      const mbService = getMusicBrainzService()
      return await mbService.searchArtist(validName)
    } catch (error: unknown) {
      console.error('[music:searchMusicBrainzArtist] Error:', error)
      throw error
    }
  })

  /**
   * Analyze completeness for a specific artist
   */
  ipcMain.handle('music:analyzeArtistCompleteness', async (_event, artistId: unknown) => {
    try {
      const validArtistId = validateInput(PositiveIntSchema, artistId, 'music:analyzeArtistCompleteness')
      const db = getDatabase()
      const mbService = getMusicBrainzService()

      const artist = db.getMusicArtistById(validArtistId)
      if (!artist) {
        throw new Error(`Artist not found: ${validArtistId}`)
      }

      // Get albums by artist_id AND by artist_name to catch all albums
      const albumsById = db.getMusicAlbums({ artistId: validArtistId })
      const albumsByName = db.getMusicAlbumsByArtistName(artist.name)

      // Combine and deduplicate by album id
      const albumMap = new Map<number, typeof albumsById[0]>()
      for (const album of [...albumsById, ...albumsByName]) {
        if (album.id !== undefined) {
          albumMap.set(album.id, album)
        }
      }
      const albums = Array.from(albumMap.values())

      const ownedTitles = albums.map(a => a.title)
      const ownedMbIds = albums.filter(a => a.musicbrainz_id).map(a => a.musicbrainz_id!)

      const completeness = await mbService.analyzeArtistCompleteness(
        artist.name,
        artist.musicbrainz_id,
        ownedTitles,
        ownedMbIds
      )

      await db.upsertArtistCompleteness(completeness)

      // Also analyze track completeness for all owned albums
      console.log(`[music:analyzeArtistCompleteness] Analyzing track completeness for ${albums.length} albums...`)
      for (const album of albums) {
        if (!album.id) continue
        try {
          const tracks = db.getMusicTracks({ albumId: album.id }) as MusicTrack[]
          const trackTitles = tracks.map((t: MusicTrack) => t.title)

          const albumCompleteness = await mbService.analyzeAlbumTrackCompleteness(
            album.id,
            album.artist_name,
            album.title,
            album.musicbrainz_id,
            trackTitles
          )

          if (albumCompleteness) {
            await db.upsertAlbumCompleteness(albumCompleteness)
            console.log(`[music:analyzeArtistCompleteness] ${album.title}: ${albumCompleteness.owned_tracks}/${albumCompleteness.total_tracks} tracks`)
          }
        } catch (albumError) {
          console.warn(`[music:analyzeArtistCompleteness] Failed to analyze album "${album.title}":`, albumError)
        }
      }

      return completeness
    } catch (error: unknown) {
      console.error('[music:analyzeArtistCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get artist completeness data
   */
  ipcMain.handle('music:getArtistCompleteness', async (_event, artistName: unknown) => {
    try {
      const validArtistName = validateInput(NonEmptyStringSchema, artistName, 'music:getArtistCompleteness')
      const db = getDatabase()
      return db.getArtistCompleteness(validArtistName)
    } catch (error: unknown) {
      console.error('[music:getArtistCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get all artist completeness data
   */
  ipcMain.handle('music:getAllArtistCompleteness', async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:getAllArtistCompleteness') : undefined
      const db = getDatabase()
      return db.getAllArtistCompleteness(validSourceId)
    } catch (error: unknown) {
      console.error('[music:getAllArtistCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Analyze track completeness for a single album
   */
  ipcMain.handle('music:analyzeAlbumTrackCompleteness', async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:analyzeAlbumTrackCompleteness')
      const db = getDatabase()
      const mbService = getMusicBrainzService()

      const album = db.getMusicAlbumById(validAlbumId)
      if (!album) {
        throw new Error(`Album not found: ${validAlbumId}`)
      }

      console.log(`[music:analyzeAlbumTrackCompleteness] Analyzing: ${album.artist_name} - ${album.title} (id=${validAlbumId}, mbid=${album.musicbrainz_id || 'none'})`)

      const tracks = db.getMusicTracks({ albumId: validAlbumId }) as MusicTrack[]
      const ownedTrackTitles = tracks.map((t: MusicTrack) => t.title)
      console.log(`[music:analyzeAlbumTrackCompleteness] Owned tracks: ${ownedTrackTitles.length}`)

      const completeness = await mbService.analyzeAlbumTrackCompleteness(
        album.id!,
        album.artist_name,
        album.title,
        album.musicbrainz_id,
        ownedTrackTitles
      )

      if (completeness) {
        console.log(`[music:analyzeAlbumTrackCompleteness] Found completeness: ${completeness.owned_tracks}/${completeness.total_tracks} tracks, missing: ${completeness.total_tracks - completeness.owned_tracks}`)
        await db.upsertAlbumCompleteness(completeness)
      } else {
        console.log(`[music:analyzeAlbumTrackCompleteness] No completeness data found (album not in MusicBrainz?)`)
      }

      return completeness
    } catch (error: unknown) {
      console.error('[music:analyzeAlbumTrackCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get album completeness data
   */
  ipcMain.handle('music:getAlbumCompleteness', async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:getAlbumCompleteness')
      const db = getDatabase()
      return db.getAlbumCompleteness(validAlbumId)
    } catch (error: unknown) {
      console.error('[music:getAlbumCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get all album completeness data
   */
  ipcMain.handle('music:getAllAlbumCompleteness', async () => {
    try {
      const db = getDatabase()
      return db.getAllAlbumCompleteness()
    } catch (error: unknown) {
      console.error('[music:getAllAlbumCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get incomplete albums (albums with missing tracks)
   */
  ipcMain.handle('music:getIncompleteAlbums', async () => {
    try {
      const db = getDatabase()
      return db.getIncompleteAlbums()
    } catch (error: unknown) {
      console.error('[music:getIncompleteAlbums] Error:', error)
      throw error
    }
  })

  // ============================================================================
  // CANCELLATION
  // ============================================================================

  /**
   * Cancel music library scan
   */
  ipcMain.handle('music:cancelScan', async (_event, sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'music:cancelScan')
      const manager = getSourceManager()
      const provider = manager.getProvider(validSourceId)

      if (!provider) {
        throw new Error(`Source not found: ${validSourceId}`)
      }

      // Call cancelMusicScan on the appropriate provider
      if (provider.providerType === 'plex') {
        const plexProvider = provider as PlexProvider
        plexProvider.cancelMusicScan()
      } else if (provider.providerType === 'jellyfin' || provider.providerType === 'emby') {
        const jellyfinProvider = provider as JellyfinEmbyBase
        jellyfinProvider.cancelMusicScan()
      } else if (provider.providerType === 'kodi') {
        const kodiProvider = provider as KodiProvider
        kodiProvider.cancelMusicScan()
      } else if (provider.providerType === 'kodi-local') {
        const kodiLocalProvider = provider as KodiLocalProvider
        kodiLocalProvider.cancelMusicScan()
      } else {
        throw new Error(`Music scan cancellation is not supported for provider type: ${provider.providerType}`)
      }

      return { success: true }
    } catch (error: unknown) {
      console.error('[music:cancelScan] Error:', error)
      throw error
    }
  })

  // ============================================================================
  // MATCH FIXING - Fix incorrect MusicBrainz matches for artists/albums
  // ============================================================================

  /**
   * Fix the MusicBrainz match for an artist
   * Updates the artist's musicbrainz_id and re-runs completeness analysis
   */
  ipcMain.handle('music:fixArtistMatch', async (event, artistId: unknown, musicbrainzId: unknown) => {
    try {
      const validArtistId = validateInput(PositiveIntSchema, artistId, 'music:fixArtistMatch')
      const validMusicbrainzId = validateInput(NonEmptyStringSchema, musicbrainzId, 'music:fixArtistMatch')
      const db = getDatabase()
      const mbService = getMusicBrainzService()
      const win = getWindowFromEvent(event)

      // Get the artist
      const artist = db.getMusicArtistById(validArtistId)
      if (!artist) {
        throw new Error(`Artist not found: ${validArtistId}`)
      }

      // Update the artist with the new MusicBrainz ID
      await db.updateArtistMatch(validArtistId, validMusicbrainzId)

      // Get albums for re-analysis
      const albumsById = db.getMusicAlbums({ artistId: validArtistId })
      const albumsByName = db.getMusicAlbumsByArtistName(artist.name)

      // Combine and deduplicate
      const albumMap = new Map<number, typeof albumsById[0]>()
      for (const album of [...albumsById, ...albumsByName]) {
        if (album.id !== undefined) {
          albumMap.set(album.id, album)
        }
      }
      const albums = Array.from(albumMap.values())

      const ownedTitles = albums.map(a => a.title)
      const ownedMbIds = albums.filter(a => a.musicbrainz_id).map(a => a.musicbrainz_id!)

      // Re-analyze with the new MusicBrainz ID
      const completeness = await mbService.analyzeArtistCompleteness(
        artist.name,
        validMusicbrainzId,
        ownedTitles,
        ownedMbIds
      )

      await db.upsertArtistCompleteness(completeness)

      // Send library update for live refresh
      safeSend(win, 'library:updated', { type: 'music' })

      return {
        success: true,
        completeness,
      }
    } catch (error: unknown) {
      console.error('[music:fixArtistMatch] Error:', error)
      throw error
    }
  })

  /**
   * Search MusicBrainz for releases (albums) to fix a match
   */
  ipcMain.handle('music:searchMusicBrainzRelease', async (_event, artistName: unknown, albumTitle: unknown) => {
    try {
      const validArtistName = validateInput(NonEmptyStringSchema, artistName, 'music:searchMusicBrainzRelease')
      const validAlbumTitle = validateInput(NonEmptyStringSchema, albumTitle, 'music:searchMusicBrainzRelease')
      const mbService = getMusicBrainzService()
      return await mbService.searchRelease(validArtistName, validAlbumTitle)
    } catch (error: unknown) {
      console.error('[music:searchMusicBrainzRelease] Error:', error)
      throw error
    }
  })

  /**
   * Fix the MusicBrainz match for an album
   * Updates the album's musicbrainz_id and re-runs track completeness analysis
   */
  ipcMain.handle('music:fixAlbumMatch', async (event, albumId: unknown, musicbrainzReleaseGroupId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:fixAlbumMatch')
      const validMusicbrainzReleaseGroupId = validateInput(NonEmptyStringSchema, musicbrainzReleaseGroupId, 'music:fixAlbumMatch')
      const db = getDatabase()
      const mbService = getMusicBrainzService()
      const win = getWindowFromEvent(event)

      // Get the album
      const album = db.getMusicAlbumById(validAlbumId)
      if (!album) {
        throw new Error(`Album not found: ${validAlbumId}`)
      }

      // Update the album with the new MusicBrainz ID
      await db.updateAlbumMatch(validAlbumId, validMusicbrainzReleaseGroupId)

      // Get tracks for re-analysis
      const tracks = db.getMusicTracks({ albumId: validAlbumId }) as MusicTrack[]
      const ownedTrackTitles = tracks.map((t: MusicTrack) => t.title)

      // Re-analyze track completeness with the new MusicBrainz ID
      const completeness = await mbService.analyzeAlbumTrackCompleteness(
        validAlbumId,
        album.artist_name,
        album.title,
        validMusicbrainzReleaseGroupId,
        ownedTrackTitles
      )

      if (completeness) {
        await db.upsertAlbumCompleteness(completeness)
      }

      // Send library update for live refresh
      safeSend(win, 'library:updated', { type: 'music' })

      return {
        success: true,
        completeness,
      }
    } catch (error: unknown) {
      console.error('[music:fixAlbumMatch] Error:', error)
      throw error
    }
  })
}
