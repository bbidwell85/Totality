/**
 * MoodSyncService
 *
 * Compares mood tags across music sources and enables one-directional sync
 * from a user-chosen source of truth to target sources.
 *
 * Track matching: MusicBrainz ID (primary), then title+artist (fallback, case-insensitive)
 */

import { getDatabase } from '../database/getDatabase'
import type { ProviderType, MusicTrack } from '../types/database'

export interface MoodComparisonTarget {
  sourceId: string
  sourceName: string
  sourceType: ProviderType
  moods: string[]
  trackId: number
  trackProviderId: string
  libraryId?: string
  hasMismatch: boolean
}

export interface MoodComparison {
  trackTitle: string
  artist: string
  album: string
  sourceOfTruthMoods: string[]
  sourceOfTruthTrackId: number
  targets: MoodComparisonTarget[]
}

export interface MoodSyncResult {
  synced: number
  failed: number
  skipped: number
  errors: string[]
}

export interface MoodSourceInfo {
  sourceId: string
  sourceName: string
  sourceType: ProviderType
  tracksWithMoods: number
  totalTracks: number
}

let moodSyncServiceInstance: MoodSyncService | null = null

export function getMoodSyncService(): MoodSyncService {
  if (!moodSyncServiceInstance) {
    moodSyncServiceInstance = new MoodSyncService()
  }
  return moodSyncServiceInstance
}

export class MoodSyncService {
  /**
   * Get all sources that have music tracks (with mood count for each).
   * Uses count queries — does NOT load track data into memory.
   */
  getSources(): MoodSourceInfo[] {
    const db = getDatabase()
    const sources = db.getMediaSources() as Array<{ source_id: string; display_name: string; source_type: string }>
    const result: MoodSourceInfo[] = []

    for (const source of sources) {
      const totalTracks = db.countMusicTracks({ sourceId: source.source_id })
      if (totalTracks === 0) continue

      const tracksWithMoods = db.countMusicTracks({ sourceId: source.source_id, hasMood: true })

      result.push({
        sourceId: source.source_id,
        sourceName: source.display_name,
        sourceType: source.source_type as ProviderType,
        tracksWithMoods,
        totalTracks,
      })
    }

    return result
  }

  /**
   * Compare moods between a source of truth and all other sources.
   * Only loads tracks with moods from SOT, and all tracks from targets for matching.
   */
  getComparison(sourceOfTruthId: string): MoodComparison[] {
    const db = getDatabase()

    // Only load tracks WITH moods from source of truth (not the entire library)
    const sotTracks = db.getMusicTracks({ sourceId: sourceOfTruthId, hasMood: true }) as MusicTrack[]
    if (!sotTracks || sotTracks.length === 0) return []

    // Get all other sources
    const sources = db.getMediaSources() as Array<{ source_id: string; display_name: string; source_type: string }>
    const otherSources = sources.filter(s => s.source_id !== sourceOfTruthId)
    if (otherSources.length === 0) return []

    // Build lookup maps for other sources: key → track
    // Only load tracks from sources that actually have music
    const targetTrackMaps = new Map<string, Map<string, {
      track: MusicTrack
      sourceId: string
      sourceName: string
      sourceType: ProviderType
    }>>()

    for (const source of otherSources) {
      const trackCount = db.countMusicTracks({ sourceId: source.source_id })
      if (trackCount === 0) continue

      const tracks = db.getMusicTracks({ sourceId: source.source_id }) as MusicTrack[]

      for (const track of tracks) {
        const keys = this.getMatchKeys(track.title, track.artist_name, track.musicbrainz_id)
        for (const key of keys) {
          if (!targetTrackMaps.has(key)) {
            targetTrackMaps.set(key, new Map())
          }
          const keyMap = targetTrackMaps.get(key)!
          if (!keyMap.has(source.source_id)) {
            keyMap.set(source.source_id, {
              track,
              sourceId: source.source_id,
              sourceName: source.display_name,
              sourceType: source.source_type as ProviderType,
            })
          }
        }
      }
    }

    // Match source of truth tracks against targets
    const comparisons: MoodComparison[] = []

    for (const sotTrack of sotTracks) {
      const sotMoods = this.parseMoods(sotTrack.mood)
      if (sotMoods.length === 0) continue

      const keys = this.getMatchKeys(sotTrack.title, sotTrack.artist_name, sotTrack.musicbrainz_id)
      const matchedTargets: MoodComparisonTarget[] = []
      const seenSources = new Set<string>()

      for (const key of keys) {
        const matches = targetTrackMaps.get(key)
        if (!matches) continue

        for (const [sourceId, match] of matches) {
          if (seenSources.has(sourceId)) continue
          seenSources.add(sourceId)

          const targetMoods = this.parseMoods(match.track.mood)
          const hasMismatch = !this.moodsMatch(sotMoods, targetMoods)

          matchedTargets.push({
            sourceId: match.sourceId,
            sourceName: match.sourceName,
            sourceType: match.sourceType,
            moods: targetMoods,
            trackId: match.track.id!,
            trackProviderId: match.track.provider_id,
            libraryId: match.track.library_id,
            hasMismatch,
          })
        }
      }

      if (matchedTargets.length > 0) {
        comparisons.push({
          trackTitle: sotTrack.title,
          artist: sotTrack.artist_name,
          album: sotTrack.album_name || '',
          sourceOfTruthMoods: sotMoods,
          sourceOfTruthTrackId: sotTrack.id!,
          targets: matchedTargets,
        })
      }
    }

    return comparisons
  }

  /**
   * Parse mood JSON string into array
   */
  private parseMoods(mood?: string | null): string[] {
    if (!mood) return []
    try {
      const parsed = JSON.parse(mood)
      if (Array.isArray(parsed)) return parsed.filter(m => m && m !== 'None')
      return []
    } catch {
      return []
    }
  }

  /**
   * Check if two mood arrays match (order-independent)
   */
  private moodsMatch(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.every((val, i) => val === sortedB[i])
  }

  /**
   * Generate match keys for a track. Returns multiple keys for fallback matching.
   */
  private getMatchKeys(title: string, artist: string, musicbrainzId?: string | null): string[] {
    const keys: string[] = []

    if (musicbrainzId) {
      keys.push(`mbid:${musicbrainzId}`)
    }

    const normTitle = title.toLowerCase().trim().replace(/\s+/g, ' ')
    const normArtist = artist.toLowerCase().trim().replace(/\s+/g, ' ')
    keys.push(`ta:${normTitle}|${normArtist}`)

    return keys
  }
}
