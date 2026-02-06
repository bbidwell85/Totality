/**
 * MusicRepository
 *
 * Handles all music-related database operations including artists, albums,
 * tracks, quality scores, and completeness data.
 */

import type { Database } from 'sql.js'
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicQualityScore,
  ArtistCompleteness,
  AlbumCompleteness,
  MusicFilters,
} from '../../types/database'

/** Music library statistics */
export interface MusicStats {
  totalArtists: number
  totalAlbums: number
  totalTracks: number
  losslessAlbums: number
  hiResAlbums: number
  avgBitrate: number
}

/** Callback for persisting database changes */
type SaveCallback = () => Promise<void>

export class MusicRepository {
  constructor(
    private getDb: () => Database | null,
    private save: SaveCallback
  ) {}

  /**
   * Convert SQL.js result rows to typed objects
   */
  private rowsToObjects<T>(result: { columns: string[]; values: unknown[][] }): T[] {
    const { columns, values } = result
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col, index) => {
        obj[col] = row[index]
      })
      return obj as T
    })
  }

  private get db(): Database {
    const db = this.getDb()
    if (!db) throw new Error('Database not initialized')
    return db
  }

  // ============================================================================
  // ARTIST OPERATIONS
  // ============================================================================

  /**
   * Insert or update a music artist
   */
  async upsertArtist(artist: MusicArtist): Promise<number> {
    const sql = `
      INSERT INTO music_artists (
        source_id, source_type, provider_id, name, sort_name,
        musicbrainz_id, genres, country, biography,
        thumb_url, art_url, album_count, track_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        source_type = excluded.source_type,
        name = excluded.name,
        sort_name = excluded.sort_name,
        musicbrainz_id = CASE WHEN music_artists.user_fixed_match = 1 THEN music_artists.musicbrainz_id ELSE COALESCE(excluded.musicbrainz_id, music_artists.musicbrainz_id) END,
        genres = excluded.genres,
        country = excluded.country,
        biography = excluded.biography,
        thumb_url = CASE WHEN music_artists.user_fixed_match = 1 AND music_artists.thumb_url IS NOT NULL THEN music_artists.thumb_url ELSE COALESCE(excluded.thumb_url, music_artists.thumb_url) END,
        art_url = CASE WHEN music_artists.user_fixed_match = 1 AND music_artists.art_url IS NOT NULL THEN music_artists.art_url ELSE COALESCE(excluded.art_url, music_artists.art_url) END,
        album_count = excluded.album_count,
        track_count = excluded.track_count
    `

    this.db.run(sql, [
      artist.source_id,
      artist.source_type,
      artist.provider_id,
      artist.name,
      artist.sort_name || artist.name,
      artist.musicbrainz_id || null,
      artist.genres || null,
      artist.country || null,
      artist.biography || null,
      artist.thumb_url || null,
      artist.art_url || null,
      artist.album_count || 0,
      artist.track_count || 0,
    ])

    await this.save()

    const result = this.db.exec(
      'SELECT id FROM music_artists WHERE source_id = ? AND provider_id = ?',
      [artist.source_id, artist.provider_id]
    )

    return result[0]?.values[0]?.[0] as number
  }

  /**
   * Update artist album and track counts
   */
  async updateArtistCounts(artistId: number, albumCount: number, trackCount: number): Promise<void> {
    this.db.run(
      'UPDATE music_artists SET album_count = ?, track_count = ? WHERE id = ?',
      [albumCount, trackCount, artistId]
    )
    await this.save()
  }

  /**
   * Update artist MusicBrainz ID (auto-cache from completeness analysis)
   * Only updates if artist doesn't already have a user-fixed match
   */
  async updateArtistMbid(artistId: number, musicbrainzId: string): Promise<void> {
    this.db.run(
      `UPDATE music_artists
       SET musicbrainz_id = ?
       WHERE id = ? AND (user_fixed_match IS NULL OR user_fixed_match = 0)`,
      [musicbrainzId, artistId]
    )
    await this.save()
  }

  /**
   * Update artwork URL for a music artist
   */
  async updateArtistArtwork(
    sourceId: string,
    providerId: string,
    artwork: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    const updates: string[] = []
    const params: (string | null)[] = []

    if (artwork.thumbUrl !== undefined) {
      updates.push('thumb_url = ?')
      params.push(artwork.thumbUrl || null)
    }
    if (artwork.artUrl !== undefined) {
      updates.push('art_url = ?')
      params.push(artwork.artUrl || null)
    }

    if (updates.length === 0) return

    params.push(sourceId, providerId)

    const sql = `UPDATE music_artists SET ${updates.join(', ')} WHERE source_id = ? AND provider_id = ?`
    this.db.run(sql, params)
    await this.save()
  }

  /**
   * Get all music artists
   */
  getArtists(filters?: MusicFilters): MusicArtist[] {
    let sql = 'SELECT * FROM music_artists WHERE 1=1'
    const params: (string | number)[] = []

    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.searchQuery) {
      sql += ' AND name LIKE ?'
      params.push(`%${filters.searchQuery}%`)
    }

    sql += ' ORDER BY sort_name ASC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<MusicArtist>(result[0])
  }

  /**
   * Get a music artist by ID
   */
  getArtistById(id: number): MusicArtist | null {
    const result = this.db.exec('SELECT * FROM music_artists WHERE id = ?', [id])
    if (!result.length) return null

    const items = this.rowsToObjects<MusicArtist>(result[0])
    return items[0] || null
  }

  /**
   * Get a music artist by name and source
   */
  getArtistByName(name: string, sourceId: string): MusicArtist | null {
    const result = this.db.exec(
      'SELECT * FROM music_artists WHERE LOWER(name) = LOWER(?) AND source_id = ?',
      [name, sourceId]
    )
    if (!result.length) return null

    const items = this.rowsToObjects<MusicArtist>(result[0])
    return items[0] || null
  }

  // ============================================================================
  // ALBUM OPERATIONS
  // ============================================================================

  /**
   * Insert or update a music album
   */
  async upsertAlbum(album: MusicAlbum): Promise<number> {
    const sql = `
      INSERT INTO music_albums (
        source_id, source_type, provider_id, artist_id, artist_name,
        title, sort_title, year, musicbrainz_id, musicbrainz_release_group_id,
        genres, studio, album_type, track_count, total_duration, total_size,
        best_audio_codec, best_audio_bitrate, best_sample_rate, best_bit_depth,
        avg_audio_bitrate, thumb_url, art_url, release_date, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        source_type = excluded.source_type,
        artist_id = excluded.artist_id,
        artist_name = excluded.artist_name,
        title = excluded.title,
        sort_title = excluded.sort_title,
        year = excluded.year,
        musicbrainz_id = CASE WHEN music_albums.user_fixed_match = 1 THEN music_albums.musicbrainz_id ELSE COALESCE(excluded.musicbrainz_id, music_albums.musicbrainz_id) END,
        musicbrainz_release_group_id = CASE WHEN music_albums.user_fixed_match = 1 THEN music_albums.musicbrainz_release_group_id ELSE COALESCE(excluded.musicbrainz_release_group_id, music_albums.musicbrainz_release_group_id) END,
        genres = excluded.genres,
        studio = excluded.studio,
        album_type = excluded.album_type,
        track_count = excluded.track_count,
        total_duration = excluded.total_duration,
        total_size = excluded.total_size,
        best_audio_codec = excluded.best_audio_codec,
        best_audio_bitrate = excluded.best_audio_bitrate,
        best_sample_rate = excluded.best_sample_rate,
        best_bit_depth = excluded.best_bit_depth,
        avg_audio_bitrate = excluded.avg_audio_bitrate,
        thumb_url = CASE WHEN music_albums.user_fixed_match = 1 AND music_albums.thumb_url IS NOT NULL THEN music_albums.thumb_url ELSE COALESCE(excluded.thumb_url, music_albums.thumb_url) END,
        art_url = CASE WHEN music_albums.user_fixed_match = 1 AND music_albums.art_url IS NOT NULL THEN music_albums.art_url ELSE COALESCE(excluded.art_url, music_albums.art_url) END,
        release_date = excluded.release_date,
        added_at = excluded.added_at
    `

    this.db.run(sql, [
      album.source_id,
      album.source_type,
      album.provider_id,
      album.artist_id || null,
      album.artist_name,
      album.title,
      album.sort_title || album.title,
      album.year || null,
      album.musicbrainz_id || null,
      album.musicbrainz_release_group_id || null,
      album.genres || null,
      album.studio || null,
      album.album_type || 'album',
      album.track_count || 0,
      album.total_duration || 0,
      album.total_size || 0,
      album.best_audio_codec || null,
      album.best_audio_bitrate || null,
      album.best_sample_rate || null,
      album.best_bit_depth || null,
      album.avg_audio_bitrate || null,
      album.thumb_url || null,
      album.art_url || null,
      album.release_date || null,
      album.added_at || null,
    ])

    await this.save()

    const result = this.db.exec(
      'SELECT id FROM music_albums WHERE source_id = ? AND provider_id = ?',
      [album.source_id, album.provider_id]
    )

    return result[0]?.values[0]?.[0] as number
  }

  /**
   * Update artwork URLs for a music album
   */
  async updateAlbumArtwork(
    sourceIdOrAlbumId: string | number,
    providerIdOrThumbUrl?: string,
    artwork?: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    // Check if called with album ID directly (new signature)
    if (typeof sourceIdOrAlbumId === 'number') {
      const albumId = sourceIdOrAlbumId
      const thumbUrl = providerIdOrThumbUrl as string | undefined

      if (!thumbUrl) return

      const sql = `UPDATE music_albums SET thumb_url = ? WHERE id = ?`
      this.db.run(sql, [thumbUrl, albumId])
      await this.save()
      return
    }

    // Legacy signature: sourceId, providerId, artwork object
    const sourceId = sourceIdOrAlbumId
    const providerId = providerIdOrThumbUrl as string
    const artworkObj = artwork

    if (!artworkObj) return

    const updates: string[] = []
    const params: (string | null)[] = []

    if (artworkObj.thumbUrl !== undefined) {
      updates.push('thumb_url = ?')
      params.push(artworkObj.thumbUrl || null)
    }
    if (artworkObj.artUrl !== undefined) {
      updates.push('art_url = ?')
      params.push(artworkObj.artUrl || null)
    }

    if (updates.length === 0) return

    params.push(sourceId, providerId)

    const sql = `UPDATE music_albums SET ${updates.join(', ')} WHERE source_id = ? AND provider_id = ?`
    this.db.run(sql, params)
    await this.save()
  }

  /**
   * Update album MusicBrainz ID (auto-cache from completeness analysis)
   * Only updates if album doesn't already have a user-fixed match
   */
  async updateAlbumMbid(albumId: number, musicbrainzId: string): Promise<void> {
    this.db.run(
      `UPDATE music_albums
       SET musicbrainz_id = ?
       WHERE id = ? AND (user_fixed_match IS NULL OR user_fixed_match = 0)`,
      [musicbrainzId, albumId]
    )
    await this.save()
  }

  /**
   * Get all music albums
   */
  getAlbums(filters?: MusicFilters): MusicAlbum[] {
    let sql = 'SELECT * FROM music_albums WHERE 1=1'
    const params: (string | number)[] = []

    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    }

    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR artist_name LIKE ?)'
      params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`)
    }

    sql += ' ORDER BY artist_name ASC, year DESC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<MusicAlbum>(result[0])
  }

  /**
   * Get music albums by artist name (case-insensitive)
   */
  getAlbumsByArtistName(artistName: string): MusicAlbum[] {
    const sql = 'SELECT * FROM music_albums WHERE LOWER(artist_name) = LOWER(?) ORDER BY year DESC'
    const result = this.db.exec(sql, [artistName])
    if (!result.length) return []

    return this.rowsToObjects<MusicAlbum>(result[0])
  }

  /**
   * Get a music album by ID
   */
  getAlbumById(id: number): MusicAlbum | null {
    const result = this.db.exec('SELECT * FROM music_albums WHERE id = ?', [id])
    if (!result.length) return null

    const items = this.rowsToObjects<MusicAlbum>(result[0])
    return items[0] || null
  }

  /**
   * Get a music album by title and artist ID
   */
  getAlbumByName(title: string, artistId: number): MusicAlbum | null {
    const result = this.db.exec(
      'SELECT * FROM music_albums WHERE LOWER(title) = LOWER(?) AND artist_id = ?',
      [title, artistId]
    )
    if (!result.length) return null

    const items = this.rowsToObjects<MusicAlbum>(result[0])
    return items[0] || null
  }

  /**
   * Get albums that need quality upgrades, sorted by worst quality first
   */
  getAlbumsNeedingUpgrade(limit: number = 50): (MusicAlbum & {
    quality_tier: string
    tier_quality: string
    tier_score: number
  })[] {
    const sql = `
      SELECT ma.*, mqs.quality_tier, mqs.tier_quality, mqs.tier_score
      FROM music_albums ma
      INNER JOIN music_quality_scores mqs ON ma.id = mqs.album_id
      WHERE mqs.needs_upgrade = 1
      ORDER BY mqs.tier_score ASC
      LIMIT ?
    `
    const result = this.db.exec(sql, [limit])
    if (!result.length) return []

    return this.rowsToObjects<MusicAlbum & {
      quality_tier: string
      tier_quality: string
      tier_score: number
    }>(result[0])
  }

  // ============================================================================
  // TRACK OPERATIONS
  // ============================================================================

  /**
   * Insert or update a music track
   */
  async upsertTrack(track: MusicTrack): Promise<number> {
    const sql = `
      INSERT INTO music_tracks (
        source_id, source_type, provider_id, album_id, artist_id,
        album_name, artist_name, title, track_number, disc_number, duration,
        file_path, file_size, container, audio_codec, audio_bitrate,
        sample_rate, bit_depth, channels, is_lossless, is_hi_res,
        musicbrainz_id, genres, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        source_type = excluded.source_type,
        album_id = excluded.album_id,
        artist_id = excluded.artist_id,
        album_name = excluded.album_name,
        artist_name = excluded.artist_name,
        title = excluded.title,
        track_number = excluded.track_number,
        disc_number = excluded.disc_number,
        duration = excluded.duration,
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        container = excluded.container,
        audio_codec = excluded.audio_codec,
        audio_bitrate = excluded.audio_bitrate,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        channels = excluded.channels,
        is_lossless = excluded.is_lossless,
        is_hi_res = excluded.is_hi_res,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id),
        genres = excluded.genres,
        added_at = excluded.added_at
    `

    this.db.run(sql, [
      track.source_id,
      track.source_type,
      track.provider_id,
      track.album_id || null,
      track.artist_id || null,
      track.album_name || null,
      track.artist_name,
      track.title,
      track.track_number || null,
      track.disc_number || 1,
      track.duration || null,
      track.file_path || null,
      track.file_size || null,
      track.container || null,
      track.audio_codec,
      track.audio_bitrate || null,
      track.sample_rate || null,
      track.bit_depth || null,
      track.channels || 2,
      track.is_lossless ? 1 : 0,
      track.is_hi_res ? 1 : 0,
      track.musicbrainz_id || null,
      track.genres || null,
      track.added_at || null,
    ])

    await this.save()

    const result = this.db.exec(
      'SELECT id FROM music_tracks WHERE source_id = ? AND provider_id = ?',
      [track.source_id, track.provider_id]
    )

    return result[0]?.values[0]?.[0] as number
  }

  /**
   * Get all music tracks
   */
  getTracks(filters?: MusicFilters): MusicTrack[] {
    let sql = 'SELECT * FROM music_tracks WHERE 1=1'
    const params: (string | number)[] = []

    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    }

    if (filters?.albumId) {
      sql += ' AND album_id = ?'
      params.push(filters.albumId)
    }

    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR artist_name LIKE ? OR album_name LIKE ?)'
      params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`, `%${filters.searchQuery}%`)
    }

    sql += ' ORDER BY disc_number ASC, track_number ASC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<MusicTrack>(result[0])
  }

  /**
   * Get a music track by ID
   */
  getTrackById(id: number): MusicTrack | null {
    const result = this.db.exec('SELECT * FROM music_tracks WHERE id = ?', [id])
    if (!result.length) return null

    const items = this.rowsToObjects<MusicTrack>(result[0])
    return items[0] || null
  }

  /**
   * Get a music track by file path
   */
  getTrackByPath(filePath: string): MusicTrack | null {
    const result = this.db.exec('SELECT * FROM music_tracks WHERE file_path = ?', [filePath])
    if (!result.length) return null

    const items = this.rowsToObjects<MusicTrack>(result[0])
    return items[0] || null
  }

  /**
   * Delete a music track by ID
   */
  async deleteTrack(id: number): Promise<void> {
    this.db.run('DELETE FROM music_tracks WHERE id = ?', [id])
    await this.save()
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get music library stats
   */
  getStats(sourceId?: string): MusicStats {
    const sourceFilter = sourceId ? ' WHERE source_id = ?' : ''
    const params = sourceId ? [sourceId] : []

    const artistCount = this.db.exec(`SELECT COUNT(*) FROM music_artists${sourceFilter}`, params)
    const albumCount = this.db.exec(`SELECT COUNT(*) FROM music_albums${sourceFilter}`, params)
    const trackCount = this.db.exec(`SELECT COUNT(*) FROM music_tracks${sourceFilter}`, params)

    const losslessFilter = sourceId ? ' AND source_id = ?' : ''
    const losslessParams = sourceId ? [sourceId] : []
    const losslessCount = this.db.exec(
      `SELECT COUNT(DISTINCT album_id) FROM music_tracks WHERE is_lossless = 1${losslessFilter}`,
      losslessParams
    )
    const hiResCount = this.db.exec(
      `SELECT COUNT(DISTINCT album_id) FROM music_tracks WHERE is_hi_res = 1${losslessFilter}`,
      losslessParams
    )

    const avgBitrate = this.db.exec(
      `SELECT AVG(audio_bitrate) FROM music_tracks WHERE audio_bitrate > 0${losslessFilter}`,
      losslessParams
    )

    return {
      totalArtists: (artistCount[0]?.values[0]?.[0] as number) || 0,
      totalAlbums: (albumCount[0]?.values[0]?.[0] as number) || 0,
      totalTracks: (trackCount[0]?.values[0]?.[0] as number) || 0,
      losslessAlbums: (losslessCount[0]?.values[0]?.[0] as number) || 0,
      hiResAlbums: (hiResCount[0]?.values[0]?.[0] as number) || 0,
      avgBitrate: Math.round((avgBitrate[0]?.values[0]?.[0] as number) || 0),
    }
  }

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  /**
   * Insert or update music quality score for an album
   */
  async upsertQualityScore(score: MusicQualityScore): Promise<void> {
    const sql = `
      INSERT INTO music_quality_scores (
        album_id, quality_tier, tier_quality, tier_score,
        codec_score, bitrate_score, needs_upgrade, issues
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(album_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        codec_score = excluded.codec_score,
        bitrate_score = excluded.bitrate_score,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues
    `

    this.db.run(sql, [
      score.album_id,
      score.quality_tier,
      score.tier_quality,
      score.tier_score,
      score.codec_score,
      score.bitrate_score,
      score.needs_upgrade ? 1 : 0,
      score.issues,
    ])

    await this.save()
  }

  /**
   * Get music quality score for an album
   */
  getQualityScore(albumId: number): MusicQualityScore | null {
    const result = this.db.exec('SELECT * FROM music_quality_scores WHERE album_id = ?', [albumId])
    if (!result.length) return null

    const items = this.rowsToObjects<MusicQualityScore>(result[0])
    if (items.length > 0) {
      const score = items[0]
      score.needs_upgrade = Boolean(score.needs_upgrade)
      return score
    }

    return null
  }

  // ============================================================================
  // ARTIST COMPLETENESS
  // ============================================================================

  /**
   * Insert or update artist completeness data
   */
  async upsertArtistCompleteness(data: ArtistCompleteness): Promise<void> {
    const sql = `
      INSERT INTO artist_completeness (
        artist_name, musicbrainz_id, total_albums, owned_albums,
        total_singles, owned_singles, total_eps, owned_eps,
        missing_albums, missing_singles, missing_eps,
        completeness_percentage, country, active_years, artist_type,
        thumb_url, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(artist_name) DO UPDATE SET
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, artist_completeness.musicbrainz_id),
        total_albums = excluded.total_albums,
        owned_albums = excluded.owned_albums,
        total_singles = excluded.total_singles,
        owned_singles = excluded.owned_singles,
        total_eps = excluded.total_eps,
        owned_eps = excluded.owned_eps,
        missing_albums = excluded.missing_albums,
        missing_singles = excluded.missing_singles,
        missing_eps = excluded.missing_eps,
        completeness_percentage = excluded.completeness_percentage,
        country = excluded.country,
        active_years = excluded.active_years,
        artist_type = excluded.artist_type,
        thumb_url = excluded.thumb_url,
        last_sync_at = excluded.last_sync_at
    `

    this.db.run(sql, [
      data.artist_name,
      data.musicbrainz_id || null,
      data.total_albums,
      data.owned_albums,
      data.total_singles,
      data.owned_singles,
      data.total_eps,
      data.owned_eps,
      data.missing_albums,
      data.missing_singles,
      data.missing_eps,
      data.completeness_percentage,
      data.country || null,
      data.active_years || null,
      data.artist_type || null,
      data.thumb_url || null,
      data.last_sync_at || null,
    ])

    await this.save()
  }

  /**
   * Get artist completeness by name
   */
  getArtistCompleteness(artistName: string): ArtistCompleteness | null {
    const result = this.db.exec('SELECT * FROM artist_completeness WHERE artist_name = ?', [
      artistName,
    ])
    if (!result.length) return null

    const items = this.rowsToObjects<ArtistCompleteness>(result[0])
    return items[0] || null
  }

  /**
   * Get all artist completeness records with thumb URLs from music_artists
   */
  getAllArtistCompleteness(): ArtistCompleteness[] {
    const result = this.db.exec(`
      SELECT ac.*, ma.thumb_url
      FROM artist_completeness ac
      LEFT JOIN music_artists ma ON ac.artist_name = ma.name
      ORDER BY ac.artist_name ASC
    `)
    if (!result.length) return []

    return this.rowsToObjects<ArtistCompleteness>(result[0])
  }

  // ============================================================================
  // ALBUM COMPLETENESS (Track-level)
  // ============================================================================

  /**
   * Upsert album completeness data
   */
  async upsertAlbumCompleteness(data: AlbumCompleteness): Promise<void> {
    const sql = `
      INSERT INTO album_completeness (
        album_id, artist_name, album_title,
        musicbrainz_release_id, musicbrainz_release_group_id,
        total_tracks, owned_tracks, missing_tracks,
        completeness_percentage, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(album_id) DO UPDATE SET
        artist_name = excluded.artist_name,
        album_title = excluded.album_title,
        musicbrainz_release_id = excluded.musicbrainz_release_id,
        musicbrainz_release_group_id = excluded.musicbrainz_release_group_id,
        total_tracks = excluded.total_tracks,
        owned_tracks = excluded.owned_tracks,
        missing_tracks = excluded.missing_tracks,
        completeness_percentage = excluded.completeness_percentage,
        last_sync_at = excluded.last_sync_at
    `

    this.db.run(sql, [
      data.album_id,
      data.artist_name,
      data.album_title,
      data.musicbrainz_release_id || null,
      data.musicbrainz_release_group_id || null,
      data.total_tracks,
      data.owned_tracks,
      data.missing_tracks,
      data.completeness_percentage,
      data.last_sync_at || new Date().toISOString(),
    ])

    await this.save()
  }

  /**
   * Get album completeness by album ID
   */
  getAlbumCompleteness(albumId: number): AlbumCompleteness | null {
    const result = this.db.exec('SELECT * FROM album_completeness WHERE album_id = ?', [albumId])
    if (!result.length) return null

    const items = this.rowsToObjects<AlbumCompleteness>(result[0])
    return items[0] || null
  }

  /**
   * Get all album completeness records
   */
  getAllAlbumCompleteness(): AlbumCompleteness[] {
    const result = this.db.exec(
      'SELECT * FROM album_completeness ORDER BY artist_name ASC, album_title ASC'
    )
    if (!result.length) return []

    return this.rowsToObjects<AlbumCompleteness>(result[0])
  }

  /**
   * Get album completeness records for a specific artist
   */
  getAlbumCompletenessByArtist(artistName: string): AlbumCompleteness[] {
    const result = this.db.exec(
      'SELECT * FROM album_completeness WHERE artist_name = ? ORDER BY album_title ASC',
      [artistName]
    )
    if (!result.length) return []

    return this.rowsToObjects<AlbumCompleteness>(result[0])
  }

  /**
   * Get incomplete albums (albums with missing tracks)
   */
  getIncompleteAlbums(): AlbumCompleteness[] {
    const result = this.db.exec(
      'SELECT * FROM album_completeness WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    if (!result.length) return []

    return this.rowsToObjects<AlbumCompleteness>(result[0])
  }
}
