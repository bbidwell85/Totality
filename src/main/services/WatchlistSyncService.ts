/**
 * WatchlistSyncService — imports watchlists from Trakt and Letterboxd into wishlist
 */

import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { fetchJSON, fetchWithTimeout } from './utils/httpClient'

interface TraktWatchlistItem {
  type: 'movie' | 'show'
  movie?: {
    title: string
    year: number
    ids: { trakt: number; slug: string; imdb?: string; tmdb?: number }
  }
  show?: {
    title: string
    year: number
    ids: { trakt: number; slug: string; imdb?: string; tmdb?: number }
  }
}

interface LetterboxdRSSItem {
  title: string
  year?: number
  tmdbId?: string
}

function parseLetterboxdRSS(xml: string): LetterboxdRSSItem[] {
  const items: LetterboxdRSSItem[] = []
  // Simple RSS XML parsing — extract <item> elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1]
    const titleMatch = /<letterboxd:filmTitle>(.*?)<\/letterboxd:filmTitle>/.exec(itemXml)
      || /<title>(.*?)<\/title>/.exec(itemXml)
    const yearMatch = /<letterboxd:filmYear>(\d{4})<\/letterboxd:filmYear>/.exec(itemXml)
    if (titleMatch) {
      // Clean HTML entities from title
      const title = titleMatch[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")

      items.push({
        title,
        year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
      })
    }
    // Stop after 200 items to prevent memory issues
    if (items.length >= 200) break
  }
  return items
}

export class WatchlistSyncService {

  /**
   * Import Trakt watchlist into Totality wishlist
   */
  private static readonly TRAKT_CLIENT_ID = 'ext9CqECYBdgac-247pr0cfSoy8BrjKAGk65gUSFdEE'

  async syncTrakt(username: string): Promise<{ added: number; total: number }> {
    const apiKey = WatchlistSyncService.TRAKT_CLIENT_ID

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Totality/1.0',
      'trakt-api-version': '2',
      'trakt-api-key': apiKey,
    }

    let response: TraktWatchlistItem[]
    try {
      // Fetch entire watchlist (movies + shows) in one call
      response = await fetchJSON<TraktWatchlistItem[]>(
        `https://api.trakt.tv/users/${encodeURIComponent(username)}/watchlist`,
        { headers, timeoutMs: 15000 }
      )
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('401')) throw new Error('API authentication failed. Please report this issue.')
      if (msg.includes('403')) throw new Error('Access denied. Your Trakt watchlist may be private — set it to public in Trakt Settings → Sharing → Watchlist.')
      if (msg.includes('404')) throw new Error(`User "${username}" not found on Trakt. Check the username is correct.`)
      throw err
    }

    if (!Array.isArray(response)) {
      throw new Error('Unexpected response from Trakt. Check your username.')
    }

    const items = response.map(entry => {
      if (entry.type === 'movie' && entry.movie) {
        return {
          title: entry.movie.title,
          media_type: 'movie' as const,
          year: entry.movie.year || undefined,
          tmdb_id: entry.movie.ids.tmdb?.toString(),
          imdb_id: entry.movie.ids.imdb,
          poster_url: undefined as string | undefined,
          reason: 'missing' as const,
          priority: 3,
          notes: 'Imported from Trakt',
        }
      }
      if (entry.type === 'show' && entry.show) {
        return {
          title: entry.show.title,
          media_type: 'season' as const,
          year: entry.show.year || undefined,
          tmdb_id: entry.show.ids.tmdb?.toString(),
          imdb_id: entry.show.ids.imdb,
          poster_url: undefined as string | undefined,
          reason: 'missing' as const,
          priority: 3,
          notes: 'Imported from Trakt',
        }
      }
      return null
    }).filter((item): item is NonNullable<typeof item> => item !== null && !!(item.tmdb_id || item.title))

    if (items.length === 0) {
      return { added: 0, total: 0 }
    }

    // Auto-fetch posters from TMDB
    const tmdb = getTMDBService()
    try { await tmdb.initialize() } catch { /* continue without posters */ }
    for (const item of items) {
      if (item.tmdb_id && !item.poster_url) {
        try {
          if (item.media_type === 'movie') {
            const details = await tmdb.getMovieDetails(item.tmdb_id)
            if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
          } else {
            const details = await tmdb.getTVShowDetails(item.tmdb_id)
            if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
          }
        } catch { /* continue without poster */ }
      }
    }

    const db = getDatabase()
    const added = await db.addWishlistItemsBulk(items)
    return { added, total: items.length }
  }

  /**
   * Import Plex watchlist using the user's Plex token
   */
  async syncPlex(plexToken: string): Promise<{ added: number; total: number }> {
    if (!plexToken) throw new Error('No Plex token available. Make sure you have a Plex source connected.')

    interface PlexWatchlistItem {
      ratingKey: string
      title: string
      year?: number
      type: 'movie' | 'show'
      thumb?: string
      Guid?: Array<{ id: string }>
    }

    let watchlistItems: PlexWatchlistItem[]
    try {
      const response = await fetchJSON<{ MediaContainer: { Metadata?: PlexWatchlistItem[] } }>(
        'https://metadata.provider.plex.tv/library/sections/watchlist/all',
        {
          headers: {
            'Accept': 'application/json',
            'X-Plex-Token': plexToken,
            'X-Plex-Client-Identifier': 'totality-media-analyzer',
            'X-Plex-Product': 'Totality',
          },
          timeoutMs: 15000,
        }
      )
      watchlistItems = response?.MediaContainer?.Metadata || []
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('401')) throw new Error('Plex token expired. Try removing and re-adding your Plex source.')
      throw new Error(`Failed to fetch Plex watchlist: ${msg}`)
    }

    if (watchlistItems.length === 0) {
      return { added: 0, total: 0 }
    }

    // Extract TMDB IDs from Plex Guid array (format: "tmdb://12345")
    const items = watchlistItems.map(item => {
      const tmdbGuid = item.Guid?.find(g => g.id.startsWith('tmdb://'))
      const tmdbId = tmdbGuid?.id.replace('tmdb://', '')
      return {
        title: item.title,
        media_type: (item.type === 'show' ? 'season' : 'movie') as 'movie' | 'season',
        year: item.year || undefined,
        tmdb_id: tmdbId,
        poster_url: item.thumb ? `https://metadata-static.plex.tv${item.thumb}` : undefined,
        reason: 'missing' as const,
        priority: 3,
        notes: 'Imported from Plex Watchlist',
      }
    }).filter(item => item.title)

    // For items without posters from Plex, try TMDB
    const tmdb = getTMDBService()
    try { await tmdb.initialize() } catch { /* continue */ }
    for (const item of items) {
      if (item.tmdb_id && !item.poster_url) {
        try {
          if (item.media_type === 'movie') {
            const details = await tmdb.getMovieDetails(item.tmdb_id)
            if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
          } else {
            const details = await tmdb.getTVShowDetails(item.tmdb_id)
            if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
          }
        } catch { /* continue */ }
      }
    }

    const db = getDatabase()
    const added = await db.addWishlistItemsBulk(items)
    return { added, total: items.length }
  }

  /**
   * Import Letterboxd watchlist via RSS feed
   */
  async syncLetterboxd(username: string): Promise<{ added: number; total: number }> {
    const url = `https://letterboxd.com/${encodeURIComponent(username)}/watchlist/rss/`
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Totality/1.0' },
    }, 15000)
    const response = await res.text()

    if (!response || (!response.includes('<item>') && !response.includes('<rss'))) {
      if (response?.includes('challenge') || response?.includes('cloudflare')) {
        throw new Error('Letterboxd is blocking automated access (Cloudflare protection). Try again later, or use Trakt instead.')
      }
      throw new Error('Could not load Letterboxd watchlist. Check the username is correct and the watchlist is public.')
    }

    const rssItems = parseLetterboxdRSS(response)
    if (rssItems.length === 0) {
      return { added: 0, total: 0 }
    }

    // Look up TMDB IDs for items that don't have them
    const tmdb = getTMDBService()
    await tmdb.initialize()

    const items = []
    for (const rssItem of rssItems) {
      let tmdbId: string | undefined

      // Try TMDB search to get an ID + poster
      let posterUrl: string | undefined
      try {
        const results = await tmdb.searchMovie(rssItem.title, rssItem.year)
        if (results.results.length > 0) {
          const best = rssItem.year
            ? results.results.find(r => r.release_date?.startsWith(String(rssItem.year))) || results.results[0]
            : results.results[0]
          tmdbId = best.id.toString()
          if (best.poster_path) posterUrl = `https://image.tmdb.org/t/p/w300${best.poster_path}`
        }
      } catch {
        // TMDB lookup failed — add without ID
      }

      items.push({
        title: rssItem.title,
        media_type: 'movie' as const,
        year: rssItem.year,
        tmdb_id: tmdbId,
        poster_url: posterUrl,
        reason: 'missing' as const,
        priority: 3,
        notes: 'Imported from Letterboxd',
      })
    }

    const db = getDatabase()
    const added = await db.addWishlistItemsBulk(items)
    return { added, total: items.length }
  }
}

let instance: WatchlistSyncService | null = null
export function getWatchlistSyncService(): WatchlistSyncService {
  if (!instance) instance = new WatchlistSyncService()
  return instance
}
