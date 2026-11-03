import { fetchJSON, buildUrl } from './utils/httpClient'
import { getLoggingService } from './LoggingService'

interface BarcodeResult {
  type: 'movie' | 'tv' | 'album'
  title: string
  year?: number
  poster_url?: string
  tmdb_id?: number
  musicbrainz_id?: string
  artist_name?: string
  barcode: string
}

interface UPCitemdbResponse {
  code: string
  total: number
  items: Array<{
    title: string
    description?: string
    brand?: string
    category?: string
    images?: string[]
  }>
}

interface MusicBrainzReleaseSearch {
  releases: Array<{
    id: string
    title: string
    date?: string
    country?: string
    'artist-credit'?: Array<{ name: string }>
    'release-group'?: { id: string; title: string; 'primary-type'?: string }
  }>
}

// Strip format/edition tags from UPC product titles
// e.g., "Star Wars: The Force Awakens [4K UHD Blu-ray + Digital]" → "Star Wars: The Force Awakens"
function cleanProductTitle(title: string): string {
  return title
    .replace(/\s*[\[(](?:4K|UHD|Blu-ray|DVD|Digital|HD|Blu Ray|BD|Ultra HD|Steelbook|Limited Edition|Special Edition|Collector'?s? Edition|Widescreen|Fullscreen|Region \w+|NTSC|PAL|Import|Remastered|Deluxe|Box Set|Complete Series|Season \d+)[\w\s+/,·—–-]*[\])]/gi, '')
    .replace(/\s*[\[(].*?(?:Blu-ray|DVD|UHD|Digital|Disc|Edition|Remastered).*?[\])]/gi, '')
    .replace(/\s*-\s*(?:4K|UHD|Blu-ray|DVD|BD)\s*$/i, '')
    .trim()
}

export class BarcodeLookupService {

  /**
   * Look up a barcode and return media metadata.
   * Tries MusicBrainz first (music), then UPCitemdb → TMDB (movies/TV).
   */
  async lookup(barcode: string): Promise<BarcodeResult[]> {
    const verbose = getLoggingService().verbose.bind(getLoggingService())
    verbose('[BarcodeLookup]', `Looking up barcode: ${barcode}`)

    const results: BarcodeResult[] = []

    // Step 1: Try MusicBrainz (music CDs)
    try {
      const mbResults = await this.searchMusicBrainz(barcode)
      if (mbResults.length > 0) {
        verbose('[BarcodeLookup]', `MusicBrainz found ${mbResults.length} results for barcode ${barcode}`)
        results.push(...mbResults)
      }
    } catch (err) {
      verbose('[BarcodeLookup]', `MusicBrainz lookup failed: ${(err as Error).message}`)
    }

    // Step 2: Try UPCitemdb → TMDB (movies/TV)
    try {
      const upcResults = await this.searchUPCitemdb(barcode)
      if (upcResults.length > 0) {
        verbose('[BarcodeLookup]', `UPCitemdb+TMDB found ${upcResults.length} results for barcode ${barcode}`)
        results.push(...upcResults)
      }
    } catch (err) {
      verbose('[BarcodeLookup]', `UPCitemdb lookup failed: ${(err as Error).message}`)
    }

    if (results.length === 0) {
      verbose('[BarcodeLookup]', `No results found for barcode ${barcode}`)
    }

    return results
  }

  /**
   * Search MusicBrainz by barcode — native support for music CDs.
   */
  private async searchMusicBrainz(barcode: string): Promise<BarcodeResult[]> {
    const url = buildUrl('https://musicbrainz.org/ws/2/release', {
      query: `barcode:${barcode}`,
      fmt: 'json',
      limit: 5,
    })
    const response = await fetchJSON<MusicBrainzReleaseSearch>(url, {
      headers: {
        'User-Agent': 'Totality/0.4.3 (https://github.com/bbidwell85/Totality)',
      },
      timeoutMs: 10000,
    })

    if (!response.releases || response.releases.length === 0) return []

    return response.releases.map((release: MusicBrainzReleaseSearch['releases'][number]) => {
      const artist = release['artist-credit']?.[0]?.name
      const year = release.date ? parseInt(release.date.substring(0, 4)) : undefined
      const releaseGroupId = release['release-group']?.id

      return {
        type: 'album' as const,
        title: release['release-group']?.title || release.title,
        year,
        artist_name: artist,
        musicbrainz_id: releaseGroupId,
        poster_url: releaseGroupId
          ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`
          : undefined,
        barcode,
      }
    })
  }

  /**
   * Search UPCitemdb for product title, then search TMDB for media metadata.
   */
  private async searchUPCitemdb(barcode: string): Promise<BarcodeResult[]> {
    // UPCitemdb free tier — no API key, per-IP rate limit (100/day)
    const url = buildUrl('https://api.upcitemdb.com/prod/trial/lookup', { upc: barcode })
    const response = await fetchJSON<UPCitemdbResponse>(url, { timeoutMs: 10000 })

    if (!response.items || response.items.length === 0) return []

    const item = response.items[0]
    const rawTitle = item.title
    if (!rawTitle) return []

    const cleanTitle = cleanProductTitle(rawTitle)
    if (!cleanTitle) return []

    getLoggingService().verbose('[BarcodeLookup]', `UPCitemdb title: "${rawTitle}" → cleaned: "${cleanTitle}"`)

    // Search TMDB with the cleaned title
    const results: BarcodeResult[] = []

    // Try movie search
    try {
      const { getTMDBService } = await import('./TMDBService')
      const tmdb = getTMDBService()
      await tmdb.initialize()

      const movieResponse = await tmdb.searchMovie(cleanTitle)
      if (movieResponse?.results?.length > 0) {
        const movie = movieResponse.results[0]
        results.push({
          type: 'movie',
          title: movie.title,
          year: movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : undefined,
          poster_url: movie.poster_path
            ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
            : undefined,
          tmdb_id: movie.id,
          barcode,
        })
      }

      // Also try TV search
      const tvResponse = await tmdb.searchTVShow(cleanTitle)
      if (tvResponse?.results?.length > 0) {
        const show = tvResponse.results[0]
        results.push({
          type: 'tv',
          title: show.name,
          year: show.first_air_date ? parseInt(show.first_air_date.substring(0, 4)) : undefined,
          poster_url: show.poster_path
            ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
            : undefined,
          tmdb_id: show.id,
          barcode,
        })
      }
    } catch (err) {
      console.warn('[BarcodeLookup] TMDB search failed:', (err as Error).message)
    }

    return results
  }
}

let instance: BarcodeLookupService | null = null

export function getBarcodeLookupService(): BarcodeLookupService {
  if (!instance) {
    instance = new BarcodeLookupService()
  }
  return instance
}
