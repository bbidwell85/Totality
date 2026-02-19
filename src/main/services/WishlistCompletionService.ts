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

    if (activeItems.length === 0) return

    const missingItems = activeItems.filter((i: WishlistItem) => i.reason === 'missing')
    const upgradeItems = activeItems.filter((i: WishlistItem) => i.reason === 'upgrade')

    const completed: CompletionResult[] = []

    if (missingItems.length > 0) {
      completed.push(...this.checkMissingItems(missingItems))
    }

    if (upgradeItems.length > 0) {
      completed.push(...this.checkUpgradeItems(upgradeItems))
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
    const movieItems = items.filter((i) => i.media_type === 'movie' && i.tmdb_id)
    const seasonItems = items.filter(
      (i) => i.media_type === 'season' && i.series_title && i.season_number != null
    )
    const episodeItems = items.filter(
      (i) => i.media_type === 'episode' && i.series_title && i.season_number != null && i.episode_number != null
    )
    const albumItems = items.filter((i) => i.media_type === 'album' && i.musicbrainz_id)
    const trackItems = items.filter((i) => i.media_type === 'track' && i.musicbrainz_id)

    // Batch check movies by TMDB ID
    if (movieItems.length > 0) {
      const tmdbIds = movieItems.map((i) => i.tmdb_id!)
      const foundMovies = db.getMediaItemsByTmdbIds(tmdbIds)

      for (const item of movieItems) {
        if (foundMovies.has(item.tmdb_id!)) {
          completed.push({
            id: item.id!,
            title: item.title,
            reason: 'missing',
            media_type: item.media_type,
          })
        }
      }
    }

    // Check seasons by series_title + season_number
    for (const item of seasonItems) {
      const count = db.getEpisodeCountForSeason(item.series_title!, item.season_number!)
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

    // Batch check albums by MusicBrainz ID
    if (albumItems.length > 0) {
      const mbIds = albumItems.map((i) => i.musicbrainz_id!)
      const foundAlbums = db.getMusicAlbumsByMusicbrainzIds(mbIds)

      for (const item of albumItems) {
        if (foundAlbums.has(item.musicbrainz_id!)) {
          completed.push({
            id: item.id!,
            title: item.title,
            reason: 'missing',
            media_type: item.media_type,
          })
        }
      }
    }

    // Check tracks by MusicBrainz ID
    for (const item of trackItems) {
      const track = db.getMusicTrackByMusicbrainzId(item.musicbrainz_id!)
      if (track) {
        completed.push({
          id: item.id!,
          title: item.title,
          reason: 'missing',
          media_type: item.media_type,
        })
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
