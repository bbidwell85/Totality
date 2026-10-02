/**
 * WatchlistSyncService — imports watchlists from Trakt and Letterboxd into wishlist
 */

import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { fetchJSON } from './utils/httpClient'

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
   * Fetch Trakt watchlist for preview (no DB insert)
   */
  async fetchTrakt(username: string): Promise<Array<{
    title: string; media_type: string; year?: number; tmdb_id?: string; poster_url?: string
  }>> {
    const apiKey = WatchlistSyncService.TRAKT_CLIENT_ID
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Totality/1.0',
      'trakt-api-version': '2',
      'trakt-api-key': apiKey,
    }

    let response: TraktWatchlistItem[]
    try {
      response = await fetchJSON<TraktWatchlistItem[]>(
        `https://api.trakt.tv/users/${encodeURIComponent(username)}/watchlist`,
        { headers, timeoutMs: 15000 }
      )
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('401')) throw new Error('API authentication failed.')
      if (msg.includes('403')) throw new Error('Watchlist may be private — set to public in Trakt Settings.')
      if (msg.includes('404')) throw new Error(`User "${username}" not found on Trakt.`)
      throw err
    }
    if (!Array.isArray(response)) throw new Error('Unexpected response from Trakt.')

    const items = response.map(entry => {
      const data = entry.type === 'movie' ? entry.movie : entry.show
      if (!data) return null
      return {
        title: data.title,
        media_type: entry.type === 'movie' ? 'movie' : 'season',
        year: data.year || undefined,
        tmdb_id: data.ids.tmdb?.toString(),
        poster_url: undefined as string | undefined,
      }
    }).filter((item): item is NonNullable<typeof item> => item !== null && !!item.title)

    const tmdb = getTMDBService()
    try { await tmdb.initialize() } catch { return items }
    for (const item of items) {
      try {
        if (item.tmdb_id) {
          const details = item.media_type === 'movie'
            ? await tmdb.getMovieDetails(item.tmdb_id)
            : await tmdb.getTVShowDetails(item.tmdb_id)
          if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
        }
      } catch { /* continue */ }
    }
    return items
  }

  /**
   * Fetch Plex watchlist for preview (no DB insert)
   */
  async fetchPlex(plexToken: string): Promise<Array<{
    title: string; media_type: string; year?: number; tmdb_id?: string; poster_url?: string
  }>> {
    if (!plexToken) throw new Error('No Plex token available.')

    interface PlexWatchlistItem {
      ratingKey: string; title: string; year?: number; type: 'movie' | 'show'; thumb?: string
      Guid?: Array<{ id: string }>
    }

    const plexHeaders = {
      'Accept': 'application/json',
      'X-Plex-Token': plexToken,
      'X-Plex-Client-Identifier': 'totality-media-analyzer',
      'X-Plex-Product': 'Totality',
    }
    let watchlistItems: PlexWatchlistItem[] = []
    for (const endpoint of [
      'https://discover.provider.plex.tv/library/sections/watchlist/all',
      'https://metadata.provider.plex.tv/library/sections/watchlist/all',
    ]) {
      try {
        const raw = await fetchJSON<{ MediaContainer: { Metadata?: PlexWatchlistItem[] } }>(endpoint, { headers: plexHeaders, timeoutMs: 15000 })
        watchlistItems = raw?.MediaContainer?.Metadata || []
        break
      } catch (err) {
        const msg = (err as Error).message || ''
        if (msg.includes('401')) throw new Error('Plex token expired.')
        if (!msg.includes('404')) throw err
      }
    }

    const items = watchlistItems.map(item => {
      const tmdbGuid = item.Guid?.find(g => g.id.startsWith('tmdb://'))
      return {
        title: item.title,
        media_type: item.type === 'show' ? 'season' : 'movie',
        year: item.year || undefined,
        tmdb_id: tmdbGuid?.id.replace('tmdb://', ''),
        poster_url: undefined as string | undefined,
      }
    }).filter(item => item.title)

    const tmdb = getTMDBService()
    try { await tmdb.initialize() } catch { return items }
    for (const item of items) {
      try {
        if (item.tmdb_id) {
          const details = item.media_type === 'movie'
            ? await tmdb.getMovieDetails(item.tmdb_id)
            : await tmdb.getTVShowDetails(item.tmdb_id)
          if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
        } else {
          const results = item.media_type === 'movie'
            ? await tmdb.searchMovie(item.title, item.year)
            : await tmdb.searchTVShow(item.title)
          if (results.results.length > 0) {
            const best = results.results[0]
            item.tmdb_id = best.id.toString()
            if (best.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${best.poster_path}`
          }
        }
      } catch { /* continue */ }
    }
    return items
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
      // Try discover endpoint first, fall back to metadata endpoint
      let rawResponse: { MediaContainer: { Metadata?: PlexWatchlistItem[] } } | undefined
      const plexHeaders = {
        'Accept': 'application/json',
        'X-Plex-Token': plexToken,
        'X-Plex-Client-Identifier': 'totality-media-analyzer',
        'X-Plex-Product': 'Totality',
      }
      const endpoints = [
        'https://discover.provider.plex.tv/library/sections/watchlist/all',
        'https://metadata.provider.plex.tv/library/sections/watchlist/all',
      ]
      for (const endpoint of endpoints) {
        try {
          rawResponse = await fetchJSON<{ MediaContainer: { Metadata?: PlexWatchlistItem[] } }>(
            endpoint,
            { headers: plexHeaders, timeoutMs: 15000 }
          )
          break
        } catch (err) {
          const msg = (err as Error).message || ''
          if (msg.includes('401')) throw new Error('Plex token expired. Try removing and re-adding your Plex source.')
          // Try next endpoint on 404
          if (!msg.includes('404')) throw err
        }
      }
      const response = rawResponse
      if (!response) throw new Error('Could not reach Plex watchlist API. Try removing and re-adding your Plex source.')
      watchlistItems = response?.MediaContainer?.Metadata || []
    } catch (err) {
      throw err instanceof Error ? err : new Error(`Failed to fetch Plex watchlist: ${err}`)
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
        poster_url: undefined as string | undefined, // fetched from TMDB below
        reason: 'missing' as const,
        priority: 3,
        notes: 'Imported from Plex Watchlist',
      }
    }).filter(item => item.title)

    // Fetch posters from TMDB
    const tmdb = getTMDBService()
    try { await tmdb.initialize() } catch { /* continue */ }
    for (const item of items) {
      try {
        if (item.tmdb_id) {
          // Have TMDB ID — fetch details directly
          if (item.media_type === 'movie') {
            const details = await tmdb.getMovieDetails(item.tmdb_id)
            if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
          } else {
            const details = await tmdb.getTVShowDetails(item.tmdb_id)
            if (details.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${details.poster_path}`
          }
        } else {
          // No TMDB ID — search by title
          const results = item.media_type === 'movie'
            ? await tmdb.searchMovie(item.title, item.year)
            : await tmdb.searchTVShow(item.title)
          if (results.results.length > 0) {
            const best = results.results[0]
            item.tmdb_id = best.id.toString()
            if (best.poster_path) item.poster_url = `https://image.tmdb.org/t/p/w300${best.poster_path}`
          }
        }
      } catch { /* continue without poster */ }
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
