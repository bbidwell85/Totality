/**
 * ArrService — integration with Radarr, Sonarr, and Lidarr automation apps.
 *
 * Provides methods to:
 * - Test connections and read available quality profiles / root folders
 * - Add movies/series/artists (or trigger upgrade searches if they already exist)
 * - Fetch and remove items from the download queue
 */

import { fetchJSON, buildUrl, isHttpError } from './utils/httpClient'
import { getDatabase } from '../database/getDatabase'
import { SETTING_KEYS } from '../../shared/settingKeys'

export type ArrType = 'radarr' | 'sonarr' | 'lidarr'

export interface ArrConfig {
  url: string
  apiKey: string
  qualityProfileId?: number
  rootFolderPath?: string
}

export interface ArrQualityProfile {
  id: number
  name: string
}

export interface ArrRootFolder {
  id: number
  path: string
  freeSpace?: number
}

export interface ArrQueueItem {
  id: number
  title: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  artistName?: string
  albumTitle?: string
  status: string
  sizeleft: number
  size: number
  timeleft?: string
  estimatedCompletionTime?: string
  quality?: { quality: { name: string } }
  indexer?: string
  downloadClient?: string
  statusMessages?: Array<{ title: string; messages: string[] }>
  arrType: ArrType
}

export interface ArrAddResult {
  success: boolean
  alreadyExists?: boolean
  triggered?: boolean
  error?: string
}

const API_VERSION: Record<ArrType, string> = {
  radarr: 'v3',
  sonarr: 'v3',
  lidarr: 'v1',
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function apiBase(url: string, type: ArrType): string {
  return `${normalizeUrl(url)}/api/${API_VERSION[type]}`
}

function arrHeaders(apiKey: string): Record<string, string> {
  return { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' }
}

export class ArrService {
  // ─── Configuration ────────────────────────────────────────────────────────

  private getConfig(type: ArrType): ArrConfig | null {
    const db = getDatabase()
    const urlKey = `${type}_url` as keyof typeof SETTING_KEYS
    const apiKeyKey = `${type}_api_key` as keyof typeof SETTING_KEYS
    const profileKey = `${type}_quality_profile_id` as keyof typeof SETTING_KEYS
    const rootFolderKey = `${type}_root_folder` as keyof typeof SETTING_KEYS

    const url = db.getSetting(SETTING_KEYS[urlKey]) as string | null
    const apiKey = db.getSetting(SETTING_KEYS[apiKeyKey]) as string | null
    if (!url || !apiKey) return null

    const profileIdStr = db.getSetting(SETTING_KEYS[profileKey]) as string | null
    const rootFolder = db.getSetting(SETTING_KEYS[rootFolderKey]) as string | null

    return {
      url,
      apiKey,
      qualityProfileId: profileIdStr ? parseInt(profileIdStr, 10) : undefined,
      rootFolderPath: rootFolder || undefined,
    }
  }

  getConfiguredApps(): { radarr: boolean; sonarr: boolean; lidarr: boolean } {
    return {
      radarr: this.getConfig('radarr') !== null,
      sonarr: this.getConfig('sonarr') !== null,
      lidarr: this.getConfig('lidarr') !== null,
    }
  }

  // ─── Connection & Setup ───────────────────────────────────────────────────

  async testConnection(
    type: ArrType,
    url: string,
    apiKey: string,
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    try {
      const result = await fetchJSON<{ version: string }>(
        `${apiBase(url, type)}/system/status`,
        { headers: arrHeaders(apiKey), timeoutMs: 10_000 },
      )
      return { success: true, version: result.version }
    } catch (err) {
      if (isHttpError(err)) {
        if (err.status === 401) return { success: false, error: 'Invalid API key' }
        return { success: false, error: `Server returned ${err.status}` }
      }
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' }
    }
  }

  async getQualityProfiles(type: ArrType, url: string, apiKey: string): Promise<ArrQualityProfile[]> {
    return fetchJSON<ArrQualityProfile[]>(
      `${apiBase(url, type)}/qualityprofile`,
      { headers: arrHeaders(apiKey) },
    )
  }

  async getRootFolders(type: ArrType, url: string, apiKey: string): Promise<ArrRootFolder[]> {
    return fetchJSON<ArrRootFolder[]>(
      `${apiBase(url, type)}/rootfolder`,
      { headers: arrHeaders(apiKey) },
    )
  }

  // ─── Add Movie (Radarr) ───────────────────────────────────────────────────

  async addMovie({
    tmdbId,
    title: _title,
    year: _year,
  }: {
    tmdbId: string | number
    title: string
    year?: number
  }): Promise<ArrAddResult> {
    const config = this.getConfig('radarr')
    if (!config) return { success: false, error: 'Radarr not configured' }
    if (!config.qualityProfileId || !config.rootFolderPath) {
      return {
        success: false,
        error: 'Radarr quality profile and root folder must be set in Settings → Services',
      }
    }

    const base = apiBase(config.url, 'radarr')
    const hdrs = arrHeaders(config.apiKey)

    try {
      // 1. Check if already in Radarr library
      const existing = await fetchJSON<Array<{ id: number; tmdbId: number }>>(
        buildUrl(`${base}/movie`, { tmdbId: Number(tmdbId) }),
        { headers: hdrs },
      ).catch(() => [] as Array<{ id: number; tmdbId: number }>)

      if (existing.length > 0) {
        // Trigger upgrade search for existing movie
        await fetchJSON(`${base}/command`, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({ name: 'MoviesSearch', movieIds: [existing[0].id] }),
        })
        return { success: true, alreadyExists: true, triggered: true }
      }

      // 2. Look up in Radarr catalog
      const lookup = await fetchJSON<Array<Record<string, unknown>>>(
        `${base}/movie/lookup/tmdb?tmdbId=${tmdbId}`,
        { headers: hdrs },
      )
      if (!lookup?.length) return { success: false, error: 'Movie not found in Radarr catalog' }

      // 3. Add to Radarr with search
      await fetchJSON(`${base}/movie`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({
          ...lookup[0],
          qualityProfileId: config.qualityProfileId,
          rootFolderPath: config.rootFolderPath,
          monitored: true,
          addOptions: { searchForMovie: true },
        }),
      })
      return { success: true }
    } catch (err) {
      if (isHttpError(err) && err.status === 400) return { success: true, alreadyExists: true }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add movie' }
    }
  }

  // ─── Add Series (Sonarr) ──────────────────────────────────────────────────

  async addSeries({
    title,
    year,
  }: {
    title: string
    year?: number
  }): Promise<ArrAddResult> {
    const config = this.getConfig('sonarr')
    if (!config) return { success: false, error: 'Sonarr not configured' }
    if (!config.qualityProfileId || !config.rootFolderPath) {
      return {
        success: false,
        error: 'Sonarr quality profile and root folder must be set in Settings → Services',
      }
    }

    const base = apiBase(config.url, 'sonarr')
    const hdrs = arrHeaders(config.apiKey)

    try {
      // 1. Look up in Sonarr catalog
      const searchTerm = year ? `${title} ${year}` : title
      const lookup = await fetchJSON<Array<Record<string, unknown>>>(
        buildUrl(`${base}/series/lookup`, { term: searchTerm }),
        { headers: hdrs },
      )
      if (!lookup?.length) return { success: false, error: 'Series not found in Sonarr catalog' }

      const match = (lookup.find(
        (s) =>
          (s.title as string).toLowerCase() === title.toLowerCase() &&
          (!year || s.year === year),
      ) || lookup[0]) as Record<string, unknown>

      // 2. Check if already in Sonarr library
      const existingAll = await fetchJSON<Array<{ id: number; tvdbId?: number; title: string }>>(
        `${base}/series`,
        { headers: hdrs },
      ).catch(() => [] as Array<{ id: number; tvdbId?: number; title: string }>)

      const existing = match.tvdbId
        ? existingAll.find((s) => s.tvdbId === (match.tvdbId as number))
        : existingAll.find((s) => s.title.toLowerCase() === title.toLowerCase())

      if (existing) {
        await fetchJSON(`${base}/command`, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({ name: 'SeriesSearch', seriesId: existing.id }),
        })
        return { success: true, alreadyExists: true, triggered: true }
      }

      // 3. Add to Sonarr with search
      await fetchJSON(`${base}/series`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({
          ...match,
          qualityProfileId: config.qualityProfileId,
          rootFolderPath: config.rootFolderPath,
          monitored: true,
          addOptions: { searchForMissingEpisodes: true },
        }),
      })
      return { success: true }
    } catch (err) {
      if (isHttpError(err) && err.status === 400) return { success: true, alreadyExists: true }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add series' }
    }
  }

  // ─── Add Artist (Lidarr) ──────────────────────────────────────────────────

  async addArtist({
    name,
    mbId,
  }: {
    name: string
    mbId?: string
  }): Promise<ArrAddResult> {
    const config = this.getConfig('lidarr')
    if (!config) return { success: false, error: 'Lidarr not configured' }
    if (!config.qualityProfileId || !config.rootFolderPath) {
      return {
        success: false,
        error: 'Lidarr quality profile and root folder must be set in Settings → Services',
      }
    }

    const base = apiBase(config.url, 'lidarr')
    const hdrs = arrHeaders(config.apiKey)

    try {
      // 1. Look up in Lidarr catalog
      const searchTerm = mbId ? `lidarr:${mbId}` : name
      const lookup = await fetchJSON<Array<Record<string, unknown>>>(
        buildUrl(`${base}/artist/lookup`, { term: searchTerm }),
        { headers: hdrs },
      )
      if (!lookup?.length) return { success: false, error: 'Artist not found in Lidarr catalog' }

      const match = (lookup.find(
        (a) => (a.artistName as string).toLowerCase() === name.toLowerCase(),
      ) || lookup[0]) as Record<string, unknown>

      // 2. Check if already in Lidarr
      const existingAll = await fetchJSON<Array<{ id: number; foreignArtistId: string; artistName: string }>>(
        `${base}/artist`,
        { headers: hdrs },
      ).catch(() => [] as Array<{ id: number; foreignArtistId: string; artistName: string }>)

      const existing = existingAll.find(
        (a) =>
          a.foreignArtistId === match.foreignArtistId ||
          a.artistName.toLowerCase() === name.toLowerCase(),
      )

      if (existing) {
        await fetchJSON(`${base}/command`, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({ name: 'ArtistSearch', artistId: existing.id }),
        })
        return { success: true, alreadyExists: true, triggered: true }
      }

      // 3. Add to Lidarr with search
      await fetchJSON(`${base}/artist`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({
          ...match,
          qualityProfileId: config.qualityProfileId,
          rootFolderPath: config.rootFolderPath,
          monitored: true,
          addOptions: { searchForMissingAlbums: true },
        }),
      })
      return { success: true }
    } catch (err) {
      if (isHttpError(err) && err.status === 400) return { success: true, alreadyExists: true }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add artist' }
    }
  }

  // ─── Queue ────────────────────────────────────────────────────────────────

  async getQueue(type?: ArrType): Promise<ArrQueueItem[]> {
    const types: ArrType[] = type ? [type] : ['radarr', 'sonarr', 'lidarr']
    const results: ArrQueueItem[] = []

    await Promise.allSettled(
      types.map(async (t) => {
        const config = this.getConfig(t)
        if (!config) return

        const response = await fetchJSON<{
          records: Array<Record<string, unknown>>
        }>(
          buildUrl(`${apiBase(config.url, t)}/queue`, { pageSize: 100 }),
          { headers: arrHeaders(config.apiKey) },
        )

        if (response?.records) {
          results.push(
            ...response.records.map((item) => ({ ...(item as ArrQueueItem), arrType: t })),
          )
        }
      }),
    )

    return results
  }

  async removeFromQueue(
    type: ArrType,
    queueId: number,
    blacklist = false,
  ): Promise<{ success: boolean; error?: string }> {
    const config = this.getConfig(type)
    if (!config) return { success: false, error: `${type} not configured` }

    try {
      await fetchJSON(
        buildUrl(`${apiBase(config.url, type)}/queue/${queueId}`, {
          blacklist,
          removeFromClient: true,
        }),
        { method: 'DELETE', headers: arrHeaders(config.apiKey) },
      )
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove from queue' }
    }
  }
}

let instance: ArrService | null = null

export function getArrService(): ArrService {
  if (!instance) instance = new ArrService()
  return instance
}
