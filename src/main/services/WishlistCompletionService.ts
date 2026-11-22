/**
 * WishlistCompletionService - Automatic wishlist item completion
 *
 * Checks active wishlist items against the library and marks them as completed
 * when their criteria are fulfilled:
 * - Missing items: marked complete when the item appears in the library
 * - Upgrade items: marked complete when quality tier or level improves
 *
 * Triggered after library scans and during live monitoring change detection.
 */

import { BrowserWindow } from 'electron'
import { getDatabase } from '../database/getDatabase'
import { safeSend } from '../ipc/utils/safeSend'
import type { WishlistItem } from '../types/database'

// Video quality tier rankings (higher = better)
const VIDEO_TIER_RANK: Record<string, number> = {
  SD: 0,
  '720p': 1,
  '1080p': 2,
  '4K': 3,
}

// Video quality level rankings within a tier
const VIDEO_LEVEL_RANK: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
}

// Music quality tier rankings (higher = better)
const MUSIC_TIER_RANK: Record<string, number> = {
  LOSSY_LOW: 0,
  LOSSY_MID: 1,
  LOSSY_HIGH: 2,
  LOSSLESS: 3,
  HI_RES: 4,
}

interface CompletionResult {
  id: number
  title: string
  reason: string
  media_type: string
}

export class WishlistCompletionService {
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  /**
   * Check all active wishlist items and auto-complete any that are fulfilled
   */
  async checkAndComplete(): Promise<void> {
    const db = getDatabase()
    const activeItems = db.getActiveWishlistItems() as WishlistItem[]

    console.log(`[WishlistCompletion] Checking ${activeItems.length} active wishlist items`)

    if (activeItems.length === 0) return

    const missingItems = activeItems.filter((i: WishlistItem) => i.reason === 'missing')
    const upgradeItems = activeItems.filter((i: WishlistItem) => i.reason === 'upgrade')

    console.log(`[WishlistCompletion] Missing: ${missingItems.length}, Upgrade: ${upgradeItems.length}`)
    for (const item of missingItems) {
      console.log(`[WishlistCompletion]   Missing: "${item.title}" type=${item.media_type} series="${item.series_title}" season=${item.season_number} tmdb=${item.tmdb_id}`)
    }

    const completed: CompletionResult[] = []

    if (missingItems.length > 0) {
      try {
        completed.push(...this.checkMissingItems(missingItems))
      } catch (err) {
        console.error('[WishlistCompletion] Error checking missing items:', err)
      }
    }

    if (upgradeItems.length > 0) {
      try {
        completed.push(...this.checkUpgradeItems(upgradeItems))
      } catch (err) {
        console.error('[WishlistCompletion] Error checking upgrade items:', err)
      }
    }

    if (completed.length > 0) {
      // Mark items as completed in the database
      for (const item of completed) {
        db.updateWishlistItem(item.id, { status: 'completed' })
      }

      // Notify the renderer
      safeSend(this.mainWindow, 'wishlist:autoCompleted', completed)

      console.log(
        `[WishlistCompletion] Auto-completed ${completed.length} item(s):`,
        completed.map((c) => c.title).join(', ')
      )
    }
  }

  /**
   * Check missing items against the library
   */
  private checkMissingItems(items: WishlistItem[]): CompletionResult[] {
    const db = getDatabase()
    const completed: CompletionResult[] = []

    // Group items by type for batch queries
    const movieItems = items.filter((i) => i.media_type === 'movie' && (i.tmdb_id || i.title))
    const seasonItems = items.filter(
      (i) => i.media_type === 'season' && (i.series_title || i.tmdb_id)
    )
    const episodeItems = items.filter(
      (i) => i.media_type === 'episode' && i.series_title && i.season_number != null && i.episode_number != null
    )
    const albumItems = items.filter((i) => i.media_type === 'album' && (i.musicbrainz_id || i.title))
    const trackItems = items.filter((i) => i.media_type === 'track' && (i.musicbrainz_id || i.title))

    // Batch check movies by TMDB ID, with title fallback
    if (movieItems.length > 0) {
      const itemsWithTmdb = movieItems.filter(i => i.tmdb_id)
      const tmdbIds = itemsWithTmdb.map((i) => i.tmdb_id!)
      const foundMovies = tmdbIds.length > 0 ? db.getMediaItemsByTmdbIds(tmdbIds) : new Map()

      for (const item of movieItems) {
        let found = false

        // Primary: match by TMDB ID
        if (item.tmdb_id && foundMovies.get(item.tmdb_id)?.type === 'movie') {
          found = true
        }

        // Fallback: match by title + year (case-insensitive)
        if (!found && !item.tmdb_id && item.title) {
          const matches = db.getMediaItems({ type: 'movie', searchQuery: item.title })
          found = matches.some((m: { title?: string; year?: number }) =>
            m.title?.toLowerCase() === item.title.toLowerCase() &&
            (!item.year || m.year === item.year)
          )
        }

        if (found) {
          completed.push({
            id: item.id!,
            title: item.title,
            reason: 'missing',
            media_type: item.media_type,
          })
        }
      }
    }

    // Check seasons by series_title + season_number, or by title, or by TMDB ID
    for (const item of seasonItems) {
      let count = 0
      const seriesName = item.series_title || item.title

      if (seriesName && item.season_number != null) {
        count = db.getEpisodeCountForSeason(seriesName, item.season_number!)
      } else if (seriesName) {
        count = db.getEpisodeCountForSeries(seriesName)
      }

      // Fallback: check series_completeness table by TMDB ID
      if (count === 0 && item.tmdb_id && item.season_number == null) {
        // Series-level evidence cannot establish ownership of a particular season.
        const seriesRecord = db.getSeriesCompletenessByTmdbId?.(item.tmdb_id)
        if (seriesRecord && seriesRecord.owned_episodes > 0) {
          count = seriesRecord.owned_episodes
        }
      }

      console.log(`[WishlistCompletion]   Season check: "${seriesName}" S${item.season_number ?? 'any'} tmdb=${item.tmdb_id} → ${count} episodes found`)
      if (count > 0) {
        completed.push({
          id: item.id!,
          title: item.title,
          reason: 'missing',
          media_type: item.media_type,
        })
      }
    }

    // Check episodes by series_title + season_number + episode_number
    for (const item of episodeItems) {
      const count = db.getEpisodeCountForSeasonEpisode(item.series_title!, item.season_number!, item.episode_number!)
      if (count > 0) {
        completed.push({
          id: item.id!,
          title: item.title,
          reason: 'missing',
          media_type: item.media_type,
        })
      }
    }

    // Batch check albums by MusicBrainz ID, with title+artist fallback
    if (albumItems.length > 0) {
      const itemsWithMb = albumItems.filter(i => i.musicbrainz_id)
      const mbIds = itemsWithMb.map((i) => i.musicbrainz_id!)
      const foundAlbums = mbIds.length > 0 ? db.getMusicAlbumsByMusicbrainzIds(mbIds) : new Map()

      for (const item of albumItems) {
        let found = false

        // Primary: match by MusicBrainz ID
        if (item.musicbrainz_id && foundAlbums.has(item.musicbrainz_id)) {
          found = true
        }

        // Fallback: match by title + artist_name (case-insensitive)
        if (!found && !item.musicbrainz_id && item.title && item.artist_name) {
          const albums = db.getMusicAlbums({ artistName: item.artist_name })
          found = (albums as { title?: string; artist_name?: string }[]).some((a) =>
            a.title?.toLowerCase() === item.title.toLowerCase() &&
            a.artist_name?.toLowerCase() === item.artist_name!.toLowerCase()
          )
        }

        if (found) {
          completed.push({
            id: item.id!,
            title: item.title,
            reason: 'missing',
            media_type: item.media_type,
          })
        }
      }
    }

    // Batch check tracks by MusicBrainz ID, with title+artist fallback
    if (trackItems.length > 0) {
      const itemsWithMb = trackItems.filter(i => i.musicbrainz_id)
      const mbIds = itemsWithMb.map((i) => i.musicbrainz_id!)
      const foundTracks = mbIds.length > 0 ? db.getMusicTracksByMusicbrainzIds(mbIds) : new Map()

      for (const item of trackItems) {
        let found = false

        // Primary: match by MusicBrainz ID
        if (item.musicbrainz_id && foundTracks.has(item.musicbrainz_id)) {
          found = true
        }

        // Fallback: match by title + artist_name (case-insensitive)
        if (!found && !item.musicbrainz_id && item.title && item.artist_name) {
          const tracks = db.getMusicTracks({ artistName: item.artist_name, limit: 100 })
          found = (tracks as { title?: string; artist_name?: string }[]).some((t) =>
            t.title?.toLowerCase() === item.title.toLowerCase() &&
            t.artist_name?.toLowerCase() === item.artist_name!.toLowerCase()
          )
        }

        if (found) {
          completed.push({
            id: item.id!,
            title: item.title,
            reason: 'missing',
            media_type: item.media_type,
          })
        }
      }
    }

    return completed
  }

  /**
   * Check upgrade items against current library quality
   */
  private checkUpgradeItems(items: WishlistItem[]): CompletionResult[] {
    const db = getDatabase()
    const completed: CompletionResult[] = []

    // Separate video (movie/episode) and music upgrade items
    const videoItems = items.filter(
      (i) =>
        (i.media_type === 'movie' || i.media_type === 'episode') &&
        i.media_item_id &&
        i.current_quality_tier
    )
    const musicItems = items.filter(
      (i) => i.media_type === 'album' && i.musicbrainz_id && i.current_quality_tier
    )

    // Batch check video quality scores
    if (videoItems.length > 0) {
      const mediaItemIds = videoItems.map((i) => i.media_item_id!)
      const qualityScores = db.getQualityScoresByMediaItemIds(mediaItemIds)

      for (const item of videoItems) {
        const score = qualityScores.get(item.media_item_id!)
        if (!score) continue

        if (this.isVideoQualityImproved(item, score.quality_tier, score.tier_quality)) {
          completed.push({
            id: item.id!,
            title: item.title,
            reason: 'upgrade',
            media_type: item.media_type,
          })
        }
      }
    }

    // Check music album quality
    for (const item of musicItems) {
      const albums = db.getMusicAlbumsByMusicbrainzIds([item.musicbrainz_id!])
      const album = albums.get(item.musicbrainz_id!)
      if (!album || !album.id) continue

      const qualityScore = db.getMusicQualityScore(album.id)
      if (!qualityScore) continue

      if (this.isMusicQualityImproved(item, qualityScore.quality_tier)) {
        completed.push({
          id: item.id!,
          title: item.title,
          reason: 'upgrade',
          media_type: item.media_type,
        })
      }
    }

    // Check track upgrades via album quality
    const trackItems = items.filter(
      (i) => i.media_type === 'track' && i.musicbrainz_id && i.current_quality_tier
    )

    if (trackItems.length > 0) {
      const mbIds = trackItems.map((i) => i.musicbrainz_id!)
      const foundTracks = db.getMusicTracksByMusicbrainzIds(mbIds)

      for (const item of trackItems) {
        const track = foundTracks.get(item.musicbrainz_id!)
        if (!track || !track.album_id) continue

        const qualityScore = db.getMusicQualityScore(track.album_id)
        if (!qualityScore) continue

        if (this.isMusicQualityImproved(item, qualityScore.quality_tier)) {
          completed.push({
            id: item.id!,
            title: item.title,
            reason: 'upgrade',
            media_type: item.media_type,
          })
        }
      }
    }

    return completed
  }

  /**
   * Check if video quality has improved (tier rank increased, or same tier but level increased)
   */
  private isVideoQualityImproved(
    item: WishlistItem,
    currentTier: string,
    currentLevel: string
  ): boolean {
    const oldTierRank = VIDEO_TIER_RANK[item.current_quality_tier || ''] ?? -1
    const newTierRank = VIDEO_TIER_RANK[currentTier] ?? -1

    if (newTierRank > oldTierRank) return true

    if (newTierRank === oldTierRank) {
      const oldLevelRank = VIDEO_LEVEL_RANK[item.current_quality_level || ''] ?? -1
      const newLevelRank = VIDEO_LEVEL_RANK[currentLevel] ?? -1
      return newLevelRank > oldLevelRank
    }

    return false
  }

  /**
   * Check if music quality has improved (tier rank increased)
   */
  private isMusicQualityImproved(item: WishlistItem, currentTier: string): boolean {
    const oldTierRank = MUSIC_TIER_RANK[item.current_quality_tier || ''] ?? -1
    const newTierRank = MUSIC_TIER_RANK[currentTier] ?? -1
    return newTierRank > oldTierRank
  }
}

// Singleton
let wishlistCompletionService: WishlistCompletionService | null = null

export function getWishlistCompletionService(): WishlistCompletionService {
  if (!wishlistCompletionService) {
    wishlistCompletionService = new WishlistCompletionService()
  }
  return wishlistCompletionService
}
