/**
 * Shared utility for querying artist albums with deduplication.
 *
 * Combines albums found by artist_id FK and by artist_name string,
 * deduplicating by album.id. This ensures albums with mismatched FKs
 * across sources are included (matching completeness handler behavior).
 */

import type { MusicAlbum } from '../../types/database'

/**
 * Get all albums for an artist by both FK and name, deduplicated by id.
 *
 * @param db Database service instance (from getDatabase())
 * @param artistId The artist's database ID
 * @param artistName The artist's name string
 */
export function getArtistAlbumsCombined(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  artistId: number,
  artistName: string
): MusicAlbum[] {
  const albumsById = db.getMusicAlbums({ artistId }) as MusicAlbum[]
  const albumsByName = db.getMusicAlbumsByArtistName(artistName) as MusicAlbum[]

  const albumMap = new Map<number, MusicAlbum>()
  for (const album of [...albumsById, ...albumsByName]) {
    if (album.id !== undefined) {
      albumMap.set(album.id, album)
    }
  }
  return Array.from(albumMap.values())
}
