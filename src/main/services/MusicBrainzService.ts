import { getErrorMessage, isNodeError } from './utils/errorUtils'
import { retryWithBackoff } from './utils/retryWithBackoff'
/**
 * MusicBrainzService
 *
 * Service for fetching artist discography and completeness data from the public MusicBrainz API.
 *
 * MusicBrainz API Guidelines (https://wiki.musicbrainz.org/MusicBrainz_API):
 * - Rate limit: Maximum 1 request per second (we use 1.5s to be safe)
 * - User-Agent: Must include application name, version, and contact URL/email
 * - Format: JSON via Accept header or fmt=json parameter
 *
 * Cover Art Archive (https://coverartarchive.org):
 * - Provides album artwork linked to MusicBrainz IDs
 * - No rate limiting but be respectful
 */

import axios, { AxiosInstance } from 'axios'
import { getDatabase } from '../database/getDatabase'
import { RateLimiters, SimpleDelayRateLimiter } from './utils/RateLimiter'
import {
  CancellableOperation,
  wasRecentlyAnalyzed,
  type AnalysisOptions,
} from './utils/ProgressTracker'
import type { ArtistCompleteness, AlbumCompleteness, MissingAlbum, MissingTrack, MusicAlbum } from '../types/database'

// MusicBrainz API response types
interface MBReleaseGroup {
  id: string
  title: string
  'first-release-date'?: string
  'primary-type'?: string
  'secondary-types'?: string[]
}

interface MBRelease {
  id: string
  title: string
  status?: string
  media?: Array<{
    format?: string
  }>
}

// Digital media formats we want to include (exclude vinyl)
const DIGITAL_FORMATS = [
  'CD', 'Digital Media', 'Enhanced CD', 'CD-R', 'HDCD', 'DualDisc',
  'SACD', 'Hybrid SACD', 'SHM-CD', 'Blu-spec CD', 'Blu-spec CD2',
  'USB Flash Drive', 'slotMusic', 'UMD', 'Cassette', '8cm CD'
]

// Vinyl formats we want to exclude
const VINYL_FORMATS = [
  'Vinyl', '7" Vinyl', '10" Vinyl', '12" Vinyl', 'Flexi-disc',
  'Shellac', 'Acetate', 'Lathe Cut'
]

interface MBArtist {
  id: string
  name: string
  'sort-name': string
  country?: string
  type?: string
  'life-span'?: {
    begin?: string
    end?: string
    ended?: boolean
  }
  'release-groups'?: MBReleaseGroup[]
}

interface MBArtistSearchResult {
  artists: MBArtist[]
}

/** Progress phases for music analysis */
export type MusicAnalysisPhase = 'artists' | 'albums' | 'complete'

export interface MusicAnalysisProgress {
  current: number
  total: number
  currentItem: string
  phase: MusicAnalysisPhase
  percentage: number
  // Detailed counts for better progress display
  artistsTotal: number
  albumsTotal: number
  phaseIndex: number  // Current item index within the phase (1-based)
  // Additional context
  skipped?: number  // Number of items skipped (already analyzed)
}

export interface MusicAnalysisOptions extends AnalysisOptions {
  /** Check if releases are available digitally - slower but more accurate (default: false) */
  filterVinylOnly?: boolean
}

export class MusicBrainzService extends CancellableOperation {
  private api: AxiosInstance

  // Rate limiting - MusicBrainz requires max 1 req/sec
  // We use 1.5 seconds to be safe and comply with guidelines
  private rateLimiter: SimpleDelayRateLimiter = RateLimiters.createMusicBrainzLimiter()
  private readonly MAX_RETRIES = 3
  private readonly RETRY_DELAY_MS = 5000

  // User-Agent per MusicBrainz guidelines
  private readonly USER_AGENT = 'Totality/0.1.0 (https://github.com/totality-app/totality)'

  // Cover Art Archive base URL
  private static readonly COVER_ART_BASE_URL = 'https://coverartarchive.org'

  constructor() {
    super()
    this.api = axios.create({
      baseURL: 'https://musicbrainz.org/ws/2',
      headers: {
        'User-Agent': this.USER_AGENT,
        'Accept': 'application/json',
      },
      timeout: 30000,
    })
  }

  /**
   * Build Cover Art Archive URL for album artwork
   * @param releaseGroupId MusicBrainz release group ID
   * @param size 'front' for full size, '250' for small, '500' for medium, '1200' for large
   */
  buildCoverArtUrl(releaseGroupId: string, size: 'front' | '250' | '500' | '1200' = 'front'): string {
    if (size === 'front') {
      return `${MusicBrainzService.COVER_ART_BASE_URL}/release-group/${releaseGroupId}/front`
    }
    return `${MusicBrainzService.COVER_ART_BASE_URL}/release-group/${releaseGroupId}/front-${size}`
  }

  /**
   * Check if cover art exists for a release group
   * Returns the artwork URL if available, null otherwise
   */
  async getCoverArtUrl(releaseGroupId: string): Promise<string | null> {
    try {
      // Try to get the cover art info from Cover Art Archive
      const response = await axios.head(
        `${MusicBrainzService.COVER_ART_BASE_URL}/release-group/${releaseGroupId}/front`,
        {
          timeout: 5000,
          maxRedirects: 5,
          validateStatus: (status) => status < 400 || status === 404,
        }
      )

      if (response.status === 200 || response.status === 307 || response.status === 302) {
        // Cover art exists - return the URL (with 500px size for reasonable quality)
        return this.buildCoverArtUrl(releaseGroupId, '500')
      }

      return null
    } catch (error) {
      // Cover art not available or request failed
      return null
    }
  }

  /**
   * Rate limit - ensures compliance with MusicBrainz 1 req/sec limit
   * Uses shared SimpleDelayRateLimiter (1.5s between requests)
   */
  private async rateLimit(): Promise<void> {
    await this.rateLimiter.waitForSlot()
  }

  /**
   * Check if an error is a retryable connection error
   */
  private isRetryableConnectionError(error: unknown): boolean {
    const errorCode = isNodeError(error) ? error.code : undefined
    const errorMessage = getErrorMessage(error) || ''

    return (
      errorCode === 'ECONNRESET' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ENOTFOUND' ||
      errorMessage.includes('socket') ||
      errorMessage.includes('network') ||
      errorMessage.includes('503') ||
      errorMessage.includes('429')
    )
  }

  /**
   * Make a request with retry logic using exponential backoff
   */
  private async requestWithRetry<T>(
    requestFn: () => Promise<T>,
    context: string
  ): Promise<T> {
    return retryWithBackoff(
      async () => {
        await this.rateLimit()
        try {
          return await requestFn()
        } catch (error: unknown) {
          // Re-throw retryable errors so retry logic can handle them
          if (this.isRetryableConnectionError(error)) {
            throw error
          }
          // For non-retryable errors, wrap with a marker so retry stops
          const wrappedError = new Error(getErrorMessage(error)) as Error & { nonRetryable: boolean }
          wrappedError.nonRetryable = true
          throw wrappedError
        }
      },
      {
        maxRetries: this.MAX_RETRIES,
        initialDelay: this.RETRY_DELAY_MS,
        maxDelay: 30000,
        backoffFactor: 2,
        retryableStatuses: [429, 500, 502, 503, 504],
        onRetry: (attempt, error, delay) => {
          console.warn(`[MusicBrainzService] ${context} - Retry ${attempt}/${this.MAX_RETRIES} after ${delay}ms: ${error.message}`)
        }
      }
    )
  }

  /**
   * Search for an artist by name
   */
  async searchArtist(name: string): Promise<MBArtist[]> {
    return this.requestWithRetry(async () => {
      const response = await this.api.get<MBArtistSearchResult>('/artist', {
        params: {
          query: `artist:${name}`,
          fmt: 'json',
          limit: 10,
        },
      })
      return response.data.artists || []
    }, `searchArtist(${name})`)
  }

  /**
   * Check if a release group has any digital/CD releases (not vinyl-only)
   */
  private async hasDigitalRelease(releaseGroupId: string): Promise<boolean> {
    try {
      const releases = await this.requestWithRetry(async () => {
        const response = await this.api.get<{ releases: MBRelease[] }>(`/release`, {
          params: {
            'release-group': releaseGroupId,
            fmt: 'json',
            limit: 50,
          },
        })
        return response.data.releases || []
      }, `checkDigitalRelease(${releaseGroupId})`)

      // Check if any release has a digital/CD format
      for (const release of releases) {
        if (!release.media || release.media.length === 0) {
          // No format info - assume it's available digitally
          return true
        }

        for (const medium of release.media) {
          const format = medium.format || ''

          // Check if it's a digital format
          if (DIGITAL_FORMATS.some(f => format.toLowerCase().includes(f.toLowerCase()))) {
            return true
          }

          // Check if format is not explicitly vinyl
          if (!VINYL_FORMATS.some(f => format.toLowerCase().includes(f.toLowerCase()))) {
            // Unknown format that's not vinyl - include it
            if (format && !format.toLowerCase().includes('vinyl')) {
              return true
            }
          }
        }
      }

      // If we only found vinyl releases, exclude this release group
      console.log(`[MusicBrainzService] Excluding vinyl-only release group: ${releaseGroupId}`)
      return false
    } catch (error) {
      // On error, include the release group (don't exclude based on failed API call)
      console.warn(`[MusicBrainzService] Failed to check format for ${releaseGroupId}, including by default`)
      return true
    }
  }

  /**
   * Get artist discography (all releases)
   * @param musicbrainzId MusicBrainz artist ID
   * @param filterVinylOnly If true, excludes vinyl-only releases (much slower due to extra API calls)
   */
  async getArtistDiscography(musicbrainzId: string, filterVinylOnly: boolean = false): Promise<{
    artist: MBArtist
    albums: MBReleaseGroup[]
    eps: MBReleaseGroup[]
    singles: MBReleaseGroup[]
  }> {
    // Get artist info with release groups in a single call for efficiency
    const artist = await this.requestWithRetry(async () => {
      const response = await this.api.get<MBArtist>(`/artist/${musicbrainzId}`, {
        params: {
          fmt: 'json',
          inc: 'release-groups',
        },
      })
      return response.data
    }, `getArtist(${musicbrainzId})`)

    // Use release groups from artist response if available, otherwise fetch separately
    let releaseGroups = artist['release-groups'] || []

    if (releaseGroups.length === 0) {
      // Fallback: fetch release groups separately if not included
      releaseGroups = await this.requestWithRetry(async () => {
        const response = await this.api.get<{ 'release-groups': MBReleaseGroup[] }>(
          `/release-group`,
          {
            params: {
              artist: musicbrainzId,
              fmt: 'json',
              limit: 100,
            },
          }
        )
        return response.data['release-groups'] || []
      }, `getReleaseGroups(${musicbrainzId})`)
    }

    // Categorize by type - only official studio albums (exclude compilations, live, soundtracks)
    const allAlbums = releaseGroups.filter(rg =>
      rg['primary-type'] === 'Album' &&
      !rg['secondary-types']?.includes('Compilation') &&
      !rg['secondary-types']?.includes('Live') &&
      !rg['secondary-types']?.includes('Soundtrack')
    )

    const allEps = releaseGroups.filter(rg => rg['primary-type'] === 'EP')
    const allSingles = releaseGroups.filter(rg => rg['primary-type'] === 'Single')

    // Only filter for digital availability if explicitly requested (slow operation)
    if (filterVinylOnly) {
      console.log(`[MusicBrainzService] Filtering ${allAlbums.length} albums for digital availability (this may take a while)...`)

      const albums: MBReleaseGroup[] = []
      for (const album of allAlbums) {
        if (await this.hasDigitalRelease(album.id)) {
          albums.push(album)
        }
      }
      console.log(`[MusicBrainzService] ${albums.length}/${allAlbums.length} albums have digital releases`)

      const eps: MBReleaseGroup[] = []
      for (const ep of allEps) {
        if (await this.hasDigitalRelease(ep.id)) {
          eps.push(ep)
        }
      }

      const singles: MBReleaseGroup[] = []
      for (const single of allSingles) {
        if (await this.hasDigitalRelease(single.id)) {
          singles.push(single)
        }
      }

      return { artist, albums, eps, singles }
    }

    // Default: include all releases (much faster - 2 API calls vs potentially 50+)
    console.log(`[MusicBrainzService] Found ${allAlbums.length} albums, ${allEps.length} EPs, ${allSingles.length} singles`)
    return { artist, albums: allAlbums, eps: allEps, singles: allSingles }
  }

  /**
   * Get track list for a release from MusicBrainz
   * Optimized to fetch releases with media+recordings in a single API call
   */
  async getReleaseTracklist(releaseGroupId: string): Promise<{
    releaseId: string
    tracks: Array<{
      musicbrainz_id: string
      title: string
      track_number: number
      disc_number: number
      duration_ms?: number
    }>
  } | null> {
    try {
      // Get releases with media and recordings in a single call (optimization)
      let releases = await this.requestWithRetry(async () => {
        const response = await this.api.get(`/release`, {
          params: {
            'release-group': releaseGroupId,
            fmt: 'json',
            limit: 5,
            status: 'official',
            inc: 'media+recordings',  // Include tracks in the same request
          },
        })
        interface MBReleasesResponse { releases?: MBRelease[] }
        return (response.data as MBReleasesResponse)?.releases || []
      }, `getReleases(${releaseGroupId})`)

      // If no official releases, try without status filter
      if (releases.length === 0) {
        console.log(`[MusicBrainzService] No official releases found, trying all releases...`)
        releases = await this.requestWithRetry(async () => {
          const response = await this.api.get(`/release`, {
            params: {
              'release-group': releaseGroupId,
              fmt: 'json',
              limit: 5,
              inc: 'media+recordings',  // Include tracks in the same request
            },
          })
          interface MBReleasesResponse { releases?: MBRelease[] }
          return (response.data as MBReleasesResponse)?.releases || []
        }, `getReleasesAll(${releaseGroupId})`)
      }

      if (releases.length === 0) {
        console.log(`[MusicBrainzService] No releases found for release group ${releaseGroupId}`)
        return null
      }

      // Find the first release with media/tracks
      interface MBReleaseWithMedia {
        id: string
        title: string
        media?: Array<{
          position?: number
          tracks?: Array<{
            id: string
            title: string
            position?: number
            number?: number
            length?: number
          }>
        }>
      }
      const release = (releases as MBReleaseWithMedia[]).find((r) => r.media && r.media.length > 0) || releases[0] as MBReleaseWithMedia
      console.log(`[MusicBrainzService] Using release: ${release.title} (${release.id})`)
      const releaseId = release.id

      const tracks: Array<{
        musicbrainz_id: string
        title: string
        track_number: number
        disc_number: number
        duration_ms?: number
      }> = []

      // Extract tracks from media (discs)
      const media = release.media || []
      console.log(`[MusicBrainzService] Release has ${media.length} media/discs`)

      for (const disc of media) {
        const discNumber = disc.position || 1
        const discTracks = disc.tracks || []
        console.log(`[MusicBrainzService] Disc ${discNumber} has ${discTracks.length} tracks`)

        for (const track of discTracks) {
          tracks.push({
            musicbrainz_id: track.id,
            title: track.title,
            track_number: track.position ?? track.number ?? 0,
            disc_number: discNumber,
            duration_ms: track.length,
          })
        }
      }

      console.log(`[MusicBrainzService] Total tracks extracted: ${tracks.length}`)
      return { releaseId, tracks }
    } catch (error) {
      console.error('[MusicBrainzService] Track list fetch failed:', error)
      return null
    }
  }

  /**
   * Clean album title for MusicBrainz search
   * Strips common suffixes that aren't part of the canonical title
   */
  private cleanAlbumTitleForSearch(title: string): string {
    return title
      // Remove year in parentheses at end: "Album (1996)" -> "Album"
      .replace(/\s*\(\d{4}\)\s*$/, '')
      // Remove common edition markers
      .replace(/\s*\((Deluxe|Remaster(ed)?|Anniversary|Expanded|Special|Limited)\s*(Edition|Version)?\)\s*$/i, '')
      // Remove disc indicators
      .replace(/\s*\[?(Disc|CD)\s*\d+\]?\s*$/i, '')
      .trim()
  }

  /**
   * Search for a release by artist and album title
   */
  async searchRelease(artistName: string, albumTitle: string): Promise<Array<{
    id: string
    title: string
    artist_credit: string
    date?: string
    country?: string
    score: number
  }>> {
    try {
      // Clean the album title to improve MusicBrainz matching
      const cleanedTitle = this.cleanAlbumTitleForSearch(albumTitle)
      if (cleanedTitle !== albumTitle) {
        console.log(`[MusicBrainzService] Cleaned title for search: "${albumTitle}" -> "${cleanedTitle}"`)
      }
      const query = `release:"${cleanedTitle}" AND artist:"${artistName}"`
      const releaseGroups = await this.requestWithRetry(async () => {
        const response = await this.api.get('/release-group', {
          params: {
            query,
            fmt: 'json',
            limit: 5,
          },
        })
        interface MBReleaseGroupsResponse { 'release-groups'?: Array<{
          id: string
          title: string
          'first-release-date'?: string
          score?: number
          'artist-credit'?: Array<{ name?: string; artist?: { country?: string } }>
        }> }
        return (response.data as MBReleaseGroupsResponse)?.['release-groups'] || []
      }, `searchRelease(${artistName} - ${albumTitle})`)

      return releaseGroups.map((rg) => ({
        id: rg.id,  // MusicBrainz release group ID
        title: rg.title,
        artist_credit: rg['artist-credit']?.[0]?.name || artistName,
        date: rg['first-release-date'] || undefined,
        country: rg['artist-credit']?.[0]?.artist?.country || undefined,
        score: rg.score || 0,
      }))
    } catch (error) {
      console.error('[MusicBrainzService] Release search failed:', error)
      return []
    }
  }

  /**
   * Analyze artist completeness by comparing owned albums against MusicBrainz discography
   * @returns Object with completeness data and foundMbId if a new MBID was discovered
   */
  async analyzeArtistCompleteness(
    artistName: string,
    musicbrainzId: string | undefined,
    ownedAlbumTitles: string[],
    ownedAlbumMbIds: string[],
    filterVinylOnly: boolean = false
  ): Promise<ArtistCompleteness & { foundMbId?: string }> {
    let mbId = musicbrainzId
    let foundMbId: string | undefined

    // If no MusicBrainz ID, try to find one
    if (!mbId) {
      const searchResults = await this.searchArtist(artistName)
      if (searchResults.length > 0) {
        const exactMatch = searchResults.find(a =>
          a.name.toLowerCase() === artistName.toLowerCase()
        )
        mbId = exactMatch?.id || searchResults[0].id
        foundMbId = mbId  // Mark that we found a new MBID to cache
      }
    }

    if (!mbId) {
      // Cannot find artist in MusicBrainz
      return {
        artist_name: artistName,
        total_albums: 0,
        owned_albums: ownedAlbumTitles.length,
        total_singles: 0,
        owned_singles: 0,
        total_eps: 0,
        owned_eps: 0,
        missing_albums: '[]',
        missing_singles: '[]',
        missing_eps: '[]',
        completeness_percentage: 100,
        last_sync_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    // Get discography (vinyl filtering disabled by default for speed)
    const discography = await this.getArtistDiscography(mbId, filterVinylOnly)

    // Normalize titles for comparison - strip years, editions, and punctuation
    const normalizeTitle = (title: string) => {
      return title
        // Remove year in parentheses: "Album (1996)" -> "Album"
        .replace(/\s*\(\d{4}\)\s*/g, ' ')
        // Remove common edition markers
        .replace(/\s*\((Deluxe|Remaster(ed)?|Anniversary|Expanded|Special|Limited|Explicit)\s*(Edition|Version)?\)\s*/gi, ' ')
        // Remove disc indicators
        .replace(/\s*\[?(Disc|CD)\s*\d+\]?\s*/gi, ' ')
        // Now normalize: lowercase and remove remaining punctuation
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const ownedNormalized = new Set([
      ...ownedAlbumTitles.map(normalizeTitle),
      ...ownedAlbumMbIds,
    ])

    // Find missing albums
    const missingAlbums: MissingAlbum[] = []
    for (const album of discography.albums) {
      const normalizedTitle = normalizeTitle(album.title)
      const isOwned = ownedNormalized.has(normalizedTitle) || ownedNormalized.has(album.id)

      if (!isOwned) {
        missingAlbums.push({
          musicbrainz_id: album.id,
          title: album.title,
          year: album['first-release-date'] ? parseInt(album['first-release-date'].substring(0, 4)) : undefined,
          album_type: 'album',
        })
      }
    }

    // Find missing EPs
    const missingEps: MissingAlbum[] = []
    for (const ep of discography.eps) {
      const normalizedTitle = normalizeTitle(ep.title)
      const isOwned = ownedNormalized.has(normalizedTitle) || ownedNormalized.has(ep.id)

      if (!isOwned) {
        missingEps.push({
          musicbrainz_id: ep.id,
          title: ep.title,
          year: ep['first-release-date'] ? parseInt(ep['first-release-date'].substring(0, 4)) : undefined,
          album_type: 'ep',
        })
      }
    }

    // Find missing singles
    const missingSingles: MissingAlbum[] = []
    for (const single of discography.singles) {
      const normalizedTitle = normalizeTitle(single.title)
      const isOwned = ownedNormalized.has(normalizedTitle) || ownedNormalized.has(single.id)

      if (!isOwned) {
        missingSingles.push({
          musicbrainz_id: single.id,
          title: single.title,
          year: single['first-release-date'] ? parseInt(single['first-release-date'].substring(0, 4)) : undefined,
          album_type: 'single',
        })
      }
    }

    // Calculate owned counts
    // Use the actual number of albums the user has in their library, not just MusicBrainz matches
    const ownedAlbumsCount = ownedAlbumTitles.length
    const ownedEpsCount = discography.eps.length - missingEps.length
    const ownedSinglesCount = discography.singles.length - missingSingles.length

    // Calculate completeness (albums weighted more heavily)
    const totalItems = discography.albums.length * 3 + discography.eps.length * 2 + discography.singles.length
    const ownedItems = ownedAlbumsCount * 3 + ownedEpsCount * 2 + ownedSinglesCount

    const completenessPercentage = totalItems > 0
      ? Math.round((ownedItems / totalItems) * 100)
      : 100

    return {
      artist_name: artistName,
      musicbrainz_id: mbId,
      total_albums: discography.albums.length,
      owned_albums: ownedAlbumsCount,
      total_singles: discography.singles.length,
      owned_singles: ownedSinglesCount,
      total_eps: discography.eps.length,
      owned_eps: ownedEpsCount,
      missing_albums: JSON.stringify(missingAlbums),
      missing_singles: JSON.stringify(missingSingles),
      missing_eps: JSON.stringify(missingEps),
      completeness_percentage: completenessPercentage,
      country: discography.artist.country,
      active_years: discography.artist['life-span'] ? JSON.stringify({
        begin: discography.artist['life-span'].begin,
        end: discography.artist['life-span'].end,
      }) : undefined,
      artist_type: discography.artist.type,
      last_sync_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      foundMbId,  // Return newly discovered MBID for caching
    }
  }

  /**
   * Analyze track completeness for a single album
   * @returns Object with completeness data and foundMbId if a new MBID was discovered
   */
  async analyzeAlbumTrackCompleteness(
    albumId: number,
    artistName: string,
    albumTitle: string,
    musicbrainzReleaseGroupId: string | undefined,
    ownedTrackTitles: string[]
  ): Promise<(AlbumCompleteness & { foundMbId?: string }) | null> {
    console.log(`[MusicBrainzService] analyzeAlbumTrackCompleteness: "${artistName}" - "${albumTitle}" (mbid: ${musicbrainzReleaseGroupId || 'none'})`)

    let tracklist: Awaited<ReturnType<typeof this.getReleaseTracklist>> = null
    let foundMbId: string | undefined
    const originalMbId = musicbrainzReleaseGroupId

    // Try stored MBID first if available
    if (musicbrainzReleaseGroupId) {
      console.log(`[MusicBrainzService] Trying stored MBID: ${musicbrainzReleaseGroupId}`)
      tracklist = await this.getReleaseTracklist(musicbrainzReleaseGroupId)
    }

    // If no tracklist from stored MBID, search MusicBrainz
    if (!tracklist || tracklist.tracks.length === 0) {
      console.log(`[MusicBrainzService] Stored MBID didn't work, searching MusicBrainz for "${artistName}" - "${albumTitle}"...`)
      const searchResults = await this.searchRelease(artistName, albumTitle)

      // Try each search result until we find one with tracks
      for (const result of searchResults) {
        console.log(`[MusicBrainzService] Trying search result: ${result.id} (${result.title})`)
        tracklist = await this.getReleaseTracklist(result.id)
        if (tracklist && tracklist.tracks.length > 0) {
          musicbrainzReleaseGroupId = result.id
          // Mark as found if we didn't have an MBID before
          if (!originalMbId) {
            foundMbId = result.id
          }
          console.log(`[MusicBrainzService] Found tracklist with ${tracklist.tracks.length} tracks`)
          break
        }
      }
    }

    if (!tracklist || tracklist.tracks.length === 0) {
      console.log(`[MusicBrainzService] No tracklist found for "${artistName}" - "${albumTitle}"`)
      return null
    }
    console.log(`[MusicBrainzService] Using tracklist with ${tracklist.tracks.length} tracks`)

    // Normalize titles for comparison
    const normalizeTitle = (title: string) =>
      title.toLowerCase().replace(/[^\w\s]/g, '').trim()

    const ownedNormalized = new Set(ownedTrackTitles.map(normalizeTitle))

    // Find missing tracks
    const missingTracks: MissingTrack[] = []
    for (const track of tracklist.tracks) {
      const normalizedTitle = normalizeTitle(track.title)
      if (!ownedNormalized.has(normalizedTitle)) {
        missingTracks.push({
          musicbrainz_id: track.musicbrainz_id,
          title: track.title,
          track_number: track.track_number,
          disc_number: track.disc_number,
          duration_ms: track.duration_ms,
        })
      }
    }

    const ownedTracks = tracklist.tracks.length - missingTracks.length
    const completenessPercentage = tracklist.tracks.length > 0
      ? Math.round((ownedTracks / tracklist.tracks.length) * 100)
      : 100

    return {
      album_id: albumId,
      artist_name: artistName,
      album_title: albumTitle,
      musicbrainz_release_id: tracklist.releaseId,
      musicbrainz_release_group_id: musicbrainzReleaseGroupId,
      total_tracks: tracklist.tracks.length,
      owned_tracks: ownedTracks,
      missing_tracks: JSON.stringify(missingTracks),
      completeness_percentage: completenessPercentage,
      last_sync_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      foundMbId,  // Return newly discovered MBID for caching
    }
  }


  /**
   * Unified analysis: Analyze all artists AND all albums in one pass
   * Phase 1: Analyze artist completeness (missing albums/EPs/singles)
   * Phase 2: Analyze album track completeness (missing tracks)
   *
   * @param onProgress Progress callback
   * @param sourceId Optional source ID to scope analysis and enable artwork updates for local sources
   * @param options Analysis options for performance tuning
   */
  async analyzeAllMusic(
    onProgress?: (progress: MusicAnalysisProgress) => void,
    sourceId?: string,
    options: MusicAnalysisOptions = {}
  ): Promise<{ completed: boolean; artistsAnalyzed: number; albumsAnalyzed: number; skipped: number }> {
    // Apply default options
    const {
      skipRecentlyAnalyzed = true,
      reanalyzeAfterDays = 7,
      filterVinylOnly = false,
    } = options

    // Reset cancellation flag at start
    this.resetCancellation()

    const db = getDatabase()

    // Enable Cover Art Archive as fallback for albums without artwork
    // The updateAlbumArtworkFromCoverArt() method already checks if album has
    // existing artwork (thumb_url/art_url) and skips if so, preserving embedded/folder art
    const updateArtwork = true

    // Get artists and albums, optionally filtered by source
    const artistFilters = sourceId ? { sourceId } : undefined
    const albumFilters = sourceId ? { sourceId } : undefined

    const artists = db.getMusicArtists(artistFilters)
    const albums = db.getMusicAlbums(albumFilters)

    // Pre-fetch existing completeness data to check for recently analyzed items
    const existingArtistCompleteness = new Map<string, string>()  // artist_name -> last_sync_at
    const existingAlbumCompleteness = new Map<number, string>()   // album_id -> last_sync_at

    if (skipRecentlyAnalyzed) {
      const allArtistCompleteness = db.getAllArtistCompleteness()
      for (const ac of allArtistCompleteness) {
        if (ac.last_sync_at) {
          existingArtistCompleteness.set(ac.artist_name, ac.last_sync_at)
        }
      }
      const allAlbumCompleteness = db.getAllAlbumCompleteness()
      for (const ac of allAlbumCompleteness) {
        if (ac.last_sync_at && ac.album_id) {
          existingAlbumCompleteness.set(ac.album_id, ac.last_sync_at)
        }
      }
      console.log(`[MusicBrainzService] Found ${existingArtistCompleteness.size} artists and ${existingAlbumCompleteness.size} albums with existing completeness data`)
    }

    const totalItems = artists.length + albums.length
    let currentItem = 0
    let artistsAnalyzed = 0
    let albumsAnalyzed = 0
    let skipped = 0

    // Send initial progress immediately so UI shows something right away
    onProgress?.({
      current: 0,
      total: totalItems,
      currentItem: 'Starting analysis...',
      phase: 'artists',
      percentage: 0,
      artistsTotal: artists.length,
      albumsTotal: albums.length,
      phaseIndex: 0,
      skipped: 0,
    })

    // Phase 1: Analyze artist completeness
    console.log(`[MusicBrainzService] Phase 1: Analyzing ${artists.length} artists (skipRecent=${skipRecentlyAnalyzed}, vinylFilter=${filterVinylOnly})`)

    for (const artist of artists) {
      if (this.isCancelled()) {
        console.log(`[MusicBrainzService] Analysis cancelled at artist ${currentItem + 1}/${totalItems}`)
        return { completed: false, artistsAnalyzed, albumsAnalyzed, skipped }
      }

      // Check if recently analyzed
      if (skipRecentlyAnalyzed) {
        const lastSync = existingArtistCompleteness.get(artist.name)
        if (wasRecentlyAnalyzed(lastSync, reanalyzeAfterDays)) {
          skipped++
          currentItem++
          continue
        }
      }

      // Send progress BEFORE processing so user sees what's being analyzed
      const artistIndex = currentItem + 1  // 1-based for display
      onProgress?.({
        current: currentItem,
        total: totalItems,
        currentItem: artist.name,
        phase: 'artists',
        percentage: (currentItem / totalItems) * 100,
        artistsTotal: artists.length,
        albumsTotal: albums.length,
        phaseIndex: artistIndex,
        skipped,
      })

      try {
        const artistAlbums = db.getMusicAlbums({ artistId: artist.id, sourceId }) as Array<{ title: string; musicbrainz_id?: string }>
        const ownedTitles = artistAlbums.map((a: typeof artistAlbums[0]) => a.title)
        const ownedMbIds = artistAlbums
          .filter((a: typeof artistAlbums[0]) => a.musicbrainz_id)
          .map((a: typeof artistAlbums[0]) => a.musicbrainz_id!)

        const completeness = await this.analyzeArtistCompleteness(
          artist.name,
          artist.musicbrainz_id,
          ownedTitles,
          ownedMbIds,
          filterVinylOnly
        )

        await db.upsertArtistCompleteness(completeness)

        // Cache the found MBID if we discovered one (and artist doesn't already have one)
        if (completeness.foundMbId && !artist.musicbrainz_id && artist.id) {
          try {
            await db.updateMusicArtistMbid(artist.id, completeness.foundMbId)
            console.log(`[MusicBrainzService] Cached MBID for artist "${artist.name}": ${completeness.foundMbId}`)
          } catch (e) {
            // Silently ignore - method may not exist yet
          }
        }

        artistsAnalyzed++
      } catch (error) {
        console.error(`[MusicBrainzService] Failed to analyze artist "${artist.name}":`, error)
      }

      currentItem++
    }

    // Phase 2: Analyze album track completeness
    console.log(`[MusicBrainzService] Phase 2: Analyzing ${albums.length} albums`)

    for (const album of albums) {
      if (this.isCancelled()) {
        console.log(`[MusicBrainzService] Analysis cancelled at album ${currentItem + 1}/${totalItems}`)
        return { completed: false, artistsAnalyzed, albumsAnalyzed, skipped }
      }

      // Check if recently analyzed
      if (skipRecentlyAnalyzed && album.id) {
        const lastSync = existingAlbumCompleteness.get(album.id)
        if (wasRecentlyAnalyzed(lastSync, reanalyzeAfterDays)) {
          skipped++
          currentItem++
          continue
        }
      }

      // Send progress BEFORE processing
      const albumIndex = currentItem - artists.length + 1  // 1-based within albums phase
      onProgress?.({
        current: currentItem,
        total: totalItems,
        currentItem: `${album.artist_name} - ${album.title}`,
        phase: 'albums',
        percentage: (currentItem / totalItems) * 100,
        artistsTotal: artists.length,
        albumsTotal: albums.length,
        phaseIndex: albumIndex,
        skipped,
      })

      try {
        const tracks = db.getMusicTracks({ albumId: album.id, sourceId }) as Array<{ title: string }>
        const ownedTrackTitles = tracks.map((t: typeof tracks[0]) => t.title)

        const completeness = await this.analyzeAlbumTrackCompleteness(
          album.id!,
          album.artist_name,
          album.title,
          album.musicbrainz_id,
          ownedTrackTitles
        )

        if (completeness) {
          await db.upsertAlbumCompleteness(completeness)

          // Cache the found MBID if we discovered one (and album doesn't already have one)
          if (completeness.foundMbId && !album.musicbrainz_id && album.id) {
            try {
              await db.updateMusicAlbumMbid(album.id, completeness.foundMbId)
              console.log(`[MusicBrainzService] Cached MBID for album "${album.title}": ${completeness.foundMbId}`)
            } catch (e) {
              // Silently ignore - method may not exist yet
            }
          }

          // Update artwork for local sources if we found a MusicBrainz release group ID
          if (updateArtwork && completeness.musicbrainz_release_group_id) {
            await this.updateAlbumArtworkFromCoverArt(album, completeness.musicbrainz_release_group_id)
          }
        }
        albumsAnalyzed++
      } catch (error) {
        console.error(`[MusicBrainzService] Failed to analyze album "${album.title}":`, error)
      }

      currentItem++
    }

    onProgress?.({
      current: totalItems,
      total: totalItems,
      currentItem: '',
      phase: 'complete',
      percentage: 100,
      artistsTotal: artists.length,
      albumsTotal: albums.length,
      phaseIndex: 0,
      skipped,
    })

    console.log(`[MusicBrainzService] Analysis complete: ${artistsAnalyzed} artists, ${albumsAnalyzed} albums analyzed, ${skipped} skipped (recently analyzed)`)
    return { completed: true, artistsAnalyzed, albumsAnalyzed, skipped }
  }

  /**
   * Update album artwork from Cover Art Archive
   * Only fetches if album doesn't already have artwork (e.g., from embedded metadata)
   * @param album The album to update
   * @param releaseGroupId MusicBrainz release group ID
   */
  private async updateAlbumArtworkFromCoverArt(album: MusicAlbum, releaseGroupId: string): Promise<void> {
    const db = getDatabase()

    // Skip if album already has artwork (e.g., extracted from embedded metadata during scan)
    if (album.thumb_url || album.art_url) {
      return
    }

    try {
      const artworkUrl = await this.getCoverArtUrl(releaseGroupId)

      if (artworkUrl) {
        await db.updateMusicAlbumArtwork(album.source_id, album.provider_id, {
          thumbUrl: artworkUrl,
          artUrl: this.buildCoverArtUrl(releaseGroupId, '1200'), // Large version for art_url
        })
        console.log(`[MusicBrainzService] Updated artwork for "${album.artist_name} - ${album.title}"`)
      }
    } catch (error) {
      // Don't fail the whole analysis if artwork fetch fails
      console.warn(`[MusicBrainzService] Failed to fetch artwork for "${album.title}":`, error)
    }
  }
}

// Export singleton instance
let musicBrainzInstance: MusicBrainzService | null = null

export function getMusicBrainzService(): MusicBrainzService {
  if (!musicBrainzInstance) {
    musicBrainzInstance = new MusicBrainzService()
  }
  return musicBrainzInstance
}
