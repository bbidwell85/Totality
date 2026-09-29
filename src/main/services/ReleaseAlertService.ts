/**
 * ReleaseAlertService — polls TMDB for upcoming releases matching wishlist items
 */

import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { emitNotificationCreated } from '../ipc/utils/notificationEmitter'
import { getLoggingService } from './LoggingService'

export class ReleaseAlertService {
  private pollingTimer: NodeJS.Timeout | null = null
  private alertedIds = new Set<string>() // tmdb_ids already alerted this session

  async start(): Promise<void> {
    const db = getDatabase()
    const enabled = db.getSetting('release_alerts_enabled')
    if (enabled !== 'true') return

    // Run initial check
    await this.checkForReleases()

    // Poll every 6 hours
    this.pollingTimer = setInterval(() => {
      this.checkForReleases().catch(err =>
        console.error('[ReleaseAlertService] Check failed:', err)
      )
    }, 6 * 60 * 60 * 1000)
  }

  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  async checkForReleases(): Promise<number> {
    const db = getDatabase()
    const tmdb = getTMDBService()

    const daysAhead = parseInt(db.getSetting('release_alert_days_ahead') || '30', 10)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() + daysAhead)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    const today = new Date().toISOString().split('T')[0]

    try {
      await tmdb.initialize()
    } catch {
      return 0
    }

    // Get active wishlist movie items with TMDB IDs
    const wishlistItems = db.getWishlistItems({ status: 'active', mediaType: 'movie' })
    const wishlistTmdbIds = new Map<string, { title: string; id: number }>()
    for (const item of wishlistItems) {
      if (item.tmdb_id) {
        wishlistTmdbIds.set(item.tmdb_id, { title: item.title, id: item.id })
      }
    }

    if (wishlistTmdbIds.size === 0) return 0

    // Fetch upcoming movies from TMDB (first 2 pages)
    let alertCount = 0
    for (let page = 1; page <= 2; page++) {
      try {
        const upcoming = await tmdb.getUpcomingMovies(page)
        for (const movie of upcoming.results) {
          const tmdbId = movie.id.toString()
          if (!wishlistTmdbIds.has(tmdbId)) continue
          if (this.alertedIds.has(tmdbId)) continue

          // Check if release date is within window
          if (!movie.release_date) continue
          if (movie.release_date < today || movie.release_date > cutoffStr) continue

          const wishItem = wishlistTmdbIds.get(tmdbId)!
          this.alertedIds.add(tmdbId)
          alertCount++

          db.createNotification({
            type: 'info',
            title: `${wishItem.title} releasing soon`,
            message: `${wishItem.title} has a release date of ${movie.release_date}`,
            metadata: JSON.stringify({ release_alert_tmdb_id: tmdbId, wishlist_id: wishItem.id }),
          })
          emitNotificationCreated()

          getLoggingService().verbose('[ReleaseAlertService]', `Alert: ${wishItem.title} releasing ${movie.release_date}`)
        }
      } catch (err) {
        console.error(`[ReleaseAlertService] Failed to fetch upcoming page ${page}:`, err)
      }
    }

    return alertCount
  }
}

let instance: ReleaseAlertService | null = null
export function getReleaseAlertService(): ReleaseAlertService {
  if (!instance) instance = new ReleaseAlertService()
  return instance
}
