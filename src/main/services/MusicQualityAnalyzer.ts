/**
 * Shared music quality analysis utility
 *
 * Encapsulates the pattern: fetch albums → batch-fetch tracks → analyze → upsert
 * Used by music:scanLibrary, music:analyzeAllQuality, and TaskQueueService.executeMusicScan
 */

import { getQualityAnalyzer } from './QualityAnalyzer'
import type { MusicTrack, MusicFilters } from '../types/database'

/**
 * Analyze quality for all albums matching the given filters.
 * Wraps the analysis in batch mode and uses bulk track fetching when available.
 *
 * @param db Database service instance (from getDatabase())
 * @param sourceId Optional source ID to scope albums
 * @param onProgress Optional progress callback (current, total)
 */
export async function analyzeAlbumQuality(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sourceId?: string,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const analyzer = getQualityAnalyzer()
  const filters: MusicFilters = sourceId ? { sourceId } : {}
  const albums = db.getMusicAlbums(filters)

  if (albums.length === 0) return

  // Batch fetch all tracks to avoid N+1 queries
  const albumIds = albums
    .map((a: { id?: number }) => a.id)
    .filter((id: number | undefined): id is number => id != null)
  const tracksByAlbum = 'getMusicTracksByAlbumIds' in db
    ? (db as { getMusicTracksByAlbumIds: (ids: number[]) => Map<number, MusicTrack[]> }).getMusicTracksByAlbumIds(albumIds)
    : null

  let processed = 0

  db.startBatch()
  try {
    for (const album of albums) {
      const tracks = tracksByAlbum
        ? (tracksByAlbum.get(album.id!) || [])
        : db.getMusicTracks({ albumId: album.id })
      const qualityScore = analyzer.analyzeMusicAlbum(album, tracks as MusicTrack[])
      await db.upsertMusicQualityScore(qualityScore)

      processed++
      onProgress?.(processed, albums.length)
    }
  } finally {
    await db.endBatch()
  }
}
