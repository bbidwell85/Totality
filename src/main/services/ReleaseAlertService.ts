/**
 * ReleaseAlertService — checks TMDB release dates for wishlist items
 * and notifies when digital/physical releases are upcoming.
 *
 * TMDB release types: 1=Premiere, 2=Theatrical (limited), 3=Theatrical, 4=Digital, 5=Physical
 */

import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { emitNotificationCreated } from '../ipc/utils/notificationEmitter'
import { getLoggingService } from './LoggingService'

const RELEASE_TYPE_LABELS: Record<number, string> = {
  1: 'Premiere',
  2: 'Theatrical',
  3: 'Theatrical',
  4: 'Digital',
  5: 'Physical',
}

export class ReleaseAlertService {
  private pollingTimer: NodeJS.Timeout | null = null
  private alertedIds = new Set<string>() // "tmdbId:type" keys already alerted this session

  async start(): Promise<void> {
    const db = getDatabase()
    const enabled = db.getSetting('release_alerts_enabled')
    if (enabled !== 'true') return

    // Run initial check after a short delay to let app settle
    setTimeout(() => {
      this.checkForReleases().catch(err =>
        console.error('[ReleaseAlertService] Initial check failed:', err)
      )
    }, 10000)

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

    // Get user's region for country-specific release dates
    const region = (db.getSetting('store_region') || 'US').toUpperCase()

    try {
      await tmdb.initialize()
    } catch {
      return 0
    }

    // Get active wishlist items with TMDB IDs (movies and TV)
    const wishlistItems = db.getWishlistItems({ status: 'active', limit: 200 })
    const itemsWithTmdb = wishlistItems.filter(item => item.tmdb_id)

    if (itemsWithTmdb.length === 0) return 0

    let alertCount = 0

    for (const item of itemsWithTmdb) {
      const tmdbId = item.tmdb_id as string
      const mediaType = item.media_type as string

      try {
        if (mediaType === 'movie') {
          // Check movie release dates (digital + physical)
          const releaseDates = await tmdb.getMovieReleaseDates(tmdbId)

          // Find releases for user's region, fall back to US
          let countryReleases = releaseDates.results.find(r => r.iso_3166_1 === region)
          if (!countryReleases && region !== 'US') {
            countryReleases = releaseDates.results.find(r => r.iso_3166_1 === 'US')
          }
          if (!countryReleases) continue

          // Check digital (4) and physical (5) releases
          for (const release of countryReleases.release_dates) {
            if (release.type !== 4 && release.type !== 5) continue

            const releaseDate = release.release_date.split('T')[0]
            if (releaseDate < today || releaseDate > cutoffStr) continue

            const alertKey = `${tmdbId}:${release.type}`
            if (this.alertedIds.has(alertKey)) continue
            this.alertedIds.add(alertKey)

            const typeLabel = RELEASE_TYPE_LABELS[release.type] || 'Release'
            const formattedDate = new Date(releaseDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

            db.createNotification({
              type: 'info',
              title: `${item.title} — ${typeLabel} release`,
              message: `${item.title} has a ${typeLabel.toLowerCase()} release on ${formattedDate}${release.note ? ` (${release.note})` : ''}`,
              metadata: JSON.stringify({ release_alert_tmdb_id: tmdbId, wishlist_id: item.id, release_type: release.type }),
            })
            emitNotificationCreated()
            alertCount++

            getLoggingService().verbose('[ReleaseAlertService]', `Alert: ${item.title} ${typeLabel} release ${releaseDate}`)
          }
        } else {
          // TV shows: check if the show has an upcoming season via TMDB details
          try {
            const details = await tmdb.getTVShowDetails(tmdbId) as unknown as Record<string, unknown>
            if (details.next_episode_to_air) {
              const airDate = (details.next_episode_to_air as Record<string, string>).air_date
              if (airDate && airDate >= today && airDate <= cutoffStr) {
                const alertKey = `${tmdbId}:tv`
                if (!this.alertedIds.has(alertKey)) {
                  this.alertedIds.add(alertKey)
                  const formattedDate = new Date(airDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
                  db.createNotification({
                    type: 'info',
                    title: `${item.title} — New episode`,
                    message: `${item.title} has a new episode airing on ${formattedDate}`,
                    metadata: JSON.stringify({ release_alert_tmdb_id: tmdbId, wishlist_id: item.id }),
                  })
                  emitNotificationCreated()
                  alertCount++
                }
              }
            }
          } catch { /* TV details fetch failed, skip */ }
        }
      } catch (err) {
        getLoggingService().verbose('[ReleaseAlertService]', `Failed to check ${item.title}: ${(err as Error).message}`)
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
