/**
 * Shared completeness exclusion filters used by both Dashboard and MediaBrowser.
 *
 * All functions are pure — they return modified copies, never mutate inputs.
 */

import type { MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData, MissingMovie, MissingEpisode } from '../components/library/types'

// ---------------------------------------------------------------------------
// Auto-Dismiss Rules
// ---------------------------------------------------------------------------

export interface AutoDismissRule {
  id: string
  field: 'year' | 'title'
  operator: 'lt' | 'gt' | 'contains'
  value: string | number
}

export function parseAutoRules(json: string | null): AutoDismissRule[] {
  if (!json) return []
  try { return JSON.parse(json) } catch { return [] }
}

function matchesAnyRule(item: { title?: string; year?: number; release_date?: string }, rules: AutoDismissRule[]): boolean {
  for (const rule of rules) {
    if (rule.field === 'year') {
      const year = item.year || (item.release_date ? parseInt(item.release_date.split('-')[0], 10) : null)
      if (year == null) continue
      if (rule.operator === 'lt' && year < Number(rule.value)) return true
      if (rule.operator === 'gt' && year > Number(rule.value)) return true
    }
    if (rule.field === 'title' && rule.operator === 'contains') {
      const title = item.title || ''
      if (title.toLowerCase().includes(String(rule.value).toLowerCase())) return true
    }
  }
  return false
}

export function filterMissingMoviesByRules(movies: MissingMovie[], rules: AutoDismissRule[]): MissingMovie[] {
  if (rules.length === 0) return movies
  return movies.filter(m => !matchesAnyRule(m, rules))
}

export function filterMissingEpisodesByRules(episodes: MissingEpisode[], rules: AutoDismissRule[]): MissingEpisode[] {
  if (rules.length === 0) return episodes
  return episodes.filter(e => !matchesAnyRule(e, rules))
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/**
 * Build the ISO date string representing the theatrical-lag cutoff.
 * Missing movies released more recently than this date are ignored.
 * Returns null when lagDays is 0 (feature disabled).
 */
export function buildTheatricalCutoff(lagDays: number): string | null {
  if (lagDays <= 0) return null
  const d = new Date()
  d.setDate(d.getDate() - lagDays)
  return d.toISOString().split('T')[0]
}

/**
 * Apply exclusions and theatrical-lag filter to a single collection.
 * Returns a modified copy if anything was removed, otherwise returns the
 * original object (referentially stable when nothing changes).
 */
export function applyCollectionFilters(
  collection: MovieCollectionData,
  excludedMovies: Set<string>,        // `${tmdb_collection_id}:${tmdb_id}`
  theatricalCutoff: string | null,    // YYYY-MM-DD or null
): MovieCollectionData {
  const rawMissing = collection.missing_movies || []
  let filtered = rawMissing.filter(
    m => !excludedMovies.has(`${collection.tmdb_collection_id}:${m.tmdb_id}`)
  )
  if (theatricalCutoff) {
    filtered = filtered.filter(m => !m.release_date || m.release_date <= theatricalCutoff)
  }
  if (filtered.length === rawMissing.length) return collection

  const excludedCount = rawMissing.length - filtered.length
  const newTotal = collection.total_movies - excludedCount
  return {
    ...collection,
    missing_movies: filtered,
    total_movies: newTotal,
    completeness_percentage: newTotal > 0
      ? Math.round((collection.owned_movies / newTotal) * 100)
      : 100,
  }
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

/**
 * Apply episode exclusions (and optionally empty-season suppression) to a
 * single series. Returns a modified copy or the original when nothing changes.
 */
export function applySeriesFilters(
  series: SeriesCompletenessData,
  excludedEpisodes: Set<string>,    // `${parentKey}:S${n}E${n}`
  excludeEmptySeasons = false,
): SeriesCompletenessData {
  const rawMissing = series.missing_episodes || []
  const parentKey = series.tmdb_id || series.series_title

  let filtered = rawMissing.filter(
    ep => !excludedEpisodes.has(`${parentKey}:S${ep.season_number}E${ep.episode_number}`)
  )

  if (excludeEmptySeasons) {
    const emptySeasons = new Set<number>(series.missing_seasons || [])
    filtered = filtered.filter(ep => !emptySeasons.has(ep.season_number))
  }

  if (filtered.length === rawMissing.length) return series

  const excludedCount = rawMissing.length - filtered.length
  const newTotal = Math.max(series.owned_episodes, series.total_episodes - excludedCount)
  return {
    ...series,
    missing_episodes: filtered,
    total_episodes: newTotal,
    completeness_percentage: newTotal > 0
      ? Math.round((series.owned_episodes / newTotal) * 100)
      : 100,
  }
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

type JsonAlbumItem = { musicbrainz_id?: string }

function filterJsonAlbums(json: string | undefined, excludedSet: Set<string>, parentKey: string): { filtered: string; removedCount: number } {
  try {
    const parsed = JSON.parse(json || '[]') as JsonAlbumItem[]
    const filtered = parsed.filter(item => !excludedSet.has(`${parentKey}:${item.musicbrainz_id}`))
    if (filtered.length !== parsed.length) {
      return { filtered: JSON.stringify(filtered), removedCount: parsed.length - filtered.length }
    }
  } catch { /* keep original */ }
  return { filtered: json || '[]', removedCount: 0 }
}

/**
 * Apply album exclusions to a single artist entry and recalculate completeness.
 * includeEps / includeSingles control whether those counts factor into the percentage.
 */
export function applyArtistFilters(
  artist: ArtistCompletenessData,
  excludedAlbums: Set<string>,   // `${parentKey}:${musicbrainz_id}`
  includeEps: boolean,
  includeSingles: boolean,
): ArtistCompletenessData {
  const parentKey = artist.musicbrainz_id || artist.artist_name
  const albums = filterJsonAlbums(artist.missing_albums, excludedAlbums, parentKey)
  const eps = filterJsonAlbums(artist.missing_eps, excludedAlbums, parentKey)
  const singles = filterJsonAlbums(artist.missing_singles, excludedAlbums, parentKey)

  const adjTotalAlbums = artist.total_albums - albums.removedCount
  const adjTotalEps = artist.total_eps - eps.removedCount
  const adjTotalSingles = artist.total_singles - singles.removedCount
  const totalItems = adjTotalAlbums + (includeEps ? adjTotalEps : 0) + (includeSingles ? adjTotalSingles : 0)
  const ownedItems = artist.owned_albums + (includeEps ? artist.owned_eps : 0) + (includeSingles ? artist.owned_singles : 0)
  const pct = totalItems > 0 ? Math.round((ownedItems / totalItems) * 100) : 100

  return {
    ...artist,
    missing_albums: albums.filtered,
    missing_eps: eps.filtered,
    missing_singles: singles.filtered,
    total_albums: adjTotalAlbums,
    total_eps: adjTotalEps,
    total_singles: adjTotalSingles,
    completeness_percentage: pct,
  }
}
