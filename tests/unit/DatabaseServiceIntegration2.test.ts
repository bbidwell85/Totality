/**
 * DatabaseService Integration Tests (Part 2)
 *
 * Tests additional database operations with a real in-memory SQL.js database:
 * TV show queries, series completeness, movie collections, updateBestVersion,
 * library management, and globalSearch.
 */

import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'

// Unmock sql.js so we get a real in-memory database
vi.unmock('sql.js')

// Mock credential encryption to pass through values
vi.mock('../../src/main/services/CredentialEncryptionService', () => ({
  getCredentialEncryptionService: vi.fn(() => ({
    encryptSetting: vi.fn((_key: string, val: string) => val),
    decryptSetting: vi.fn((_key: string, val: string) => val),
    isEncryptionAvailable: vi.fn(() => false),
    isEncrypted: vi.fn(() => false),
    encrypt: vi.fn((val: string) => val),
    decrypt: vi.fn((val: string) => val),
    encryptConnectionConfig: vi.fn((val: string) => val),
    decryptConnectionConfig: vi.fn((val: string) => val),
  })),
}))

import initSqlJs, { type Database } from 'sql.js'
import { DATABASE_SCHEMA } from '../../src/main/database/schema'

/**
 * Helper that mirrors BetterSQLiteService SQL logic using raw SQL.js queries.
 */
class TestDatabaseHelper2 {
  db: Database
  private itemCounter = 0

  constructor(db: Database) {
    this.db = db
  }

  private rowsToObjects<T>(result: { columns: string[]; values: unknown[][] }): T[] {
    return result.values.map((row) => {
      const obj: Record<string, unknown> = {}
      result.columns.forEach((col, i) => { obj[col] = row[i] })
      return obj as T
    })
  }

  private queryAll<T>(sql: string, params: unknown[] = []): T[] {
    const result = this.db.exec(sql, params)
    if (!result.length) return []
    return this.rowsToObjects<T>(result[0])
  }

  private queryOne<T>(sql: string, params: unknown[] = []): T | null {
    const rows = this.queryAll<T>(sql, params)
    return rows[0] || null
  }

  private queryScalar<T>(sql: string, params: unknown[] = []): T | null {
    const result = this.db.exec(sql, params)
    if (!result.length || !result[0].values.length) return null
    return result[0].values[0][0] as T
  }

  // Media sources
  upsertMediaSource(sourceId: string, sourceType: string, displayName: string): void {
    this.db.run(
      `INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
       VALUES (?, ?, ?, '{}')
       ON CONFLICT(source_id) DO UPDATE SET display_name = excluded.display_name`,
      [sourceId, sourceType, displayName]
    )
  }

  // Media items
  insertMediaItem(item: {
    source_id: string; title: string; type: string;
    year?: number; series_title?: string; season_number?: number;
    episode_number?: string | number; library_id?: string;
    resolution?: string; width?: number; height?: number;
    video_codec?: string; video_bitrate?: number;
    audio_codec?: string; audio_channels?: number; audio_bitrate?: number;
    tmdb_id?: string; imdb_id?: string; poster_url?: string;
    sort_title?: string; series_tmdb_id?: string;
  }): number {
    this.db.run(
      `INSERT INTO media_items (
        source_id, source_type, library_id, plex_id, type, title, sort_title, year,
        series_title, season_number, episode_number, series_tmdb_id,
        file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate,
        tmdb_id, imdb_id, poster_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.source_id, 'plex', item.library_id || 'lib-1',
        `item-${++this.itemCounter}`, item.type, item.title,
        item.sort_title || null, item.year || null,
        item.series_title || null, item.season_number || null,
        item.episode_number || null, item.series_tmdb_id || null,
        '/fake/path', 0, 0,
        item.resolution || '1080p', item.width || 1920, item.height || 1080,
        item.video_codec || 'h264', item.video_bitrate || 10000,
        item.audio_codec || 'ac3', item.audio_channels || 6, item.audio_bitrate || 448,
        item.tmdb_id || null, item.imdb_id || null, item.poster_url || null,
      ]
    )
    return this.queryScalar<number>('SELECT last_insert_rowid()')!
  }

  getMediaItemById(id: number) {
    return this.queryOne<Record<string, unknown>>('SELECT * FROM media_items WHERE id = ?', [id])
  }

  // TV Show queries (mirrors BetterSQLiteService.getTVShows)
  getTVShows(filters?: {
    sourceId?: string; libraryId?: string; alphabetFilter?: string;
    searchQuery?: string; sortBy?: string; sortOrder?: string;
    limit?: number; offset?: number;
  }) {
    let sql = `
      SELECT
        COALESCE(m.series_title, 'Unknown Series') as series_title,
        MIN(m.sort_title) as sort_title,
        COUNT(*) as episode_count,
        COUNT(DISTINCT m.season_number) as season_count,
        MAX(m.poster_url) as poster_url,
        MIN(m.source_id) as source_id,
        MIN(m.source_type) as source_type
      FROM media_items m
      WHERE m.type = 'episode'
    `
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }
    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    sql += " GROUP BY COALESCE(m.series_title, 'Unknown Series')"

    const sortOrder = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    switch (filters?.sortBy) {
      case 'episode_count':
        sql += ` ORDER BY episode_count ${sortOrder}`
        break
      case 'season_count':
        sql += ` ORDER BY season_count ${sortOrder}`
        break
      default:
        sql += ` ORDER BY COALESCE(sort_title, series_title) ${sortOrder}`
    }

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    return this.queryAll<Record<string, unknown>>(sql, params)
  }

  countTVShows(filters?: { sourceId?: string; searchQuery?: string; alphabetFilter?: string }) {
    let sql = `
      SELECT COUNT(DISTINCT COALESCE(m.series_title, 'Unknown Series')) as count
      FROM media_items m WHERE m.type = 'episode'
    `
    const params: unknown[] = []
    if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }
    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }
    return this.queryScalar<number>(sql, params) || 0
  }

  countTVEpisodes(filters?: { sourceId?: string; searchQuery?: string; alphabetFilter?: string }) {
    let sql = `SELECT COUNT(*) as count FROM media_items m WHERE m.type = 'episode'`
    const params: unknown[] = []
    if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }
    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }
    return this.queryScalar<number>(sql, params) || 0
  }

  // Series completeness
  upsertSeriesCompleteness(data: {
    series_title: string; source_id?: string; library_id?: string;
    total_seasons: number; total_episodes: number;
    owned_seasons: number; owned_episodes: number;
    missing_seasons?: string; missing_episodes?: string;
    completeness_percentage: number;
    tmdb_id?: string; poster_url?: string; backdrop_url?: string; status?: string;
  }): number {
    const sourceId = data.source_id || ''
    const libraryId = data.library_id || ''

    const existing = this.queryOne<{ id: number }>(
      'SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?',
      [data.series_title, sourceId, libraryId]
    )

    if (existing) {
      this.db.run(`
        UPDATE series_completeness SET
          total_seasons = ?, total_episodes = ?, owned_seasons = ?, owned_episodes = ?,
          missing_seasons = ?, missing_episodes = ?, completeness_percentage = ?,
          tmdb_id = ?, poster_url = ?, backdrop_url = ?, status = ?
        WHERE id = ?
      `, [
        data.total_seasons, data.total_episodes, data.owned_seasons, data.owned_episodes,
        data.missing_seasons || '[]', data.missing_episodes || '[]', data.completeness_percentage,
        data.tmdb_id || null, data.poster_url || null, data.backdrop_url || null,
        data.status || null, existing.id,
      ])
      return existing.id
    }

    this.db.run(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, poster_url, backdrop_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.series_title, sourceId, libraryId, data.total_seasons, data.total_episodes,
      data.owned_seasons, data.owned_episodes, data.missing_seasons || '[]',
      data.missing_episodes || '[]', data.completeness_percentage,
      data.tmdb_id || null, data.poster_url || null, data.backdrop_url || null,
      data.status || null,
    ])
    return this.queryScalar<number>('SELECT last_insert_rowid()')!
  }

  getSeriesCompleteness(sourceId?: string) {
    const sourceFilter = sourceId ? ' AND source_id = ?' : ''
    const params: unknown[] = sourceId ? [sourceId, sourceId] : []
    return this.queryAll<Record<string, unknown>>(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE 1=1${sourceFilter}
        GROUP BY series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE 1=1${sourceFilter}
      GROUP BY sc.series_title
      ORDER BY sc.series_title ASC
    `, params)
  }

  getAllSeriesCompleteness(sourceId?: string, libraryId?: string) {
    let sql = 'SELECT * FROM series_completeness WHERE 1=1'
    const params: unknown[] = []
    if (sourceId) { sql += ' AND source_id = ?'; params.push(sourceId) }
    if (libraryId) { sql += ' AND library_id = ?'; params.push(libraryId) }
    return this.queryAll<Record<string, unknown>>(sql, params)
  }

  getSeriesCompletenessByTitle(seriesTitle: string, sourceId?: string, libraryId?: string) {
    let sql = 'SELECT * FROM series_completeness WHERE series_title = ?'
    const params: unknown[] = [seriesTitle]
    if (sourceId) { sql += ' AND source_id = ?'; params.push(sourceId) }
    if (libraryId) { sql += ' AND library_id = ?'; params.push(libraryId) }
    return this.queryOne<Record<string, unknown>>(sql, params)
  }

  getIncompleteSeries(sourceId?: string) {
    const sourceFilter = sourceId ? ' AND source_id = ?' : ''
    const params: unknown[] = sourceId ? [sourceId, sourceId] : []
    return this.queryAll<Record<string, unknown>>(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE tmdb_id IS NOT NULL${sourceFilter}
        GROUP BY series_title
        HAVING max_pct < 100
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL${sourceFilter}
      GROUP BY sc.series_title
      ORDER BY sc.completeness_percentage ASC
    `, params)
  }

  deleteSeriesCompleteness(id: number): boolean {
    this.db.run('DELETE FROM series_completeness WHERE id = ?', [id])
    return true
  }

  // Movie collections
  upsertMovieCollection(data: {
    tmdb_collection_id: string; collection_name: string;
    source_id?: string; library_id?: string;
    total_movies: number; owned_movies: number;
    missing_movies?: string; owned_movie_ids?: string;
    completeness_percentage: number;
    poster_url?: string; backdrop_url?: string;
  }): number {
    const sourceId = data.source_id || ''
    const libraryId = data.library_id || ''

    const existing = this.queryOne<{ id: number }>(
      'SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id = ?',
      [data.tmdb_collection_id, sourceId, libraryId]
    )

    if (existing) {
      this.db.run(`
        UPDATE movie_collections SET
          collection_name = ?, total_movies = ?, owned_movies = ?,
          missing_movies = ?, owned_movie_ids = ?, completeness_percentage = ?,
          poster_url = ?, backdrop_url = ?
        WHERE id = ?
      `, [
        data.collection_name, data.total_movies, data.owned_movies,
        data.missing_movies || '[]', data.owned_movie_ids || '[]', data.completeness_percentage,
        data.poster_url || null, data.backdrop_url || null, existing.id,
      ])
      return existing.id
    }

    this.db.run(`
      INSERT INTO movie_collections (
        tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, owned_movie_ids,
        completeness_percentage, poster_url, backdrop_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.tmdb_collection_id, data.collection_name, sourceId, libraryId,
      data.total_movies, data.owned_movies,
      data.missing_movies || '[]', data.owned_movie_ids || '[]',
      data.completeness_percentage, data.poster_url || null, data.backdrop_url || null,
    ])
    return this.queryScalar<number>('SELECT last_insert_rowid()')!
  }

  getMovieCollections(sourceId?: string) {
    if (sourceId) {
      return this.queryAll<Record<string, unknown>>(
        'SELECT * FROM movie_collections WHERE source_id = ? ORDER BY collection_name ASC', [sourceId]
      )
    }
    return this.queryAll<Record<string, unknown>>('SELECT * FROM movie_collections ORDER BY collection_name ASC')
  }

  getMovieCollectionByTmdbId(tmdbCollectionId: string) {
    return this.queryOne<Record<string, unknown>>(
      'SELECT * FROM movie_collections WHERE tmdb_collection_id = ?', [tmdbCollectionId]
    )
  }

  getIncompleteMovieCollections(sourceId?: string) {
    if (sourceId) {
      return this.queryAll<Record<string, unknown>>(
        'SELECT * FROM movie_collections WHERE completeness_percentage < 100 AND source_id = ? ORDER BY completeness_percentage ASC',
        [sourceId]
      )
    }
    return this.queryAll<Record<string, unknown>>(
      'SELECT * FROM movie_collections WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
  }

  deleteMovieCollection(id: number): boolean {
    this.db.run('DELETE FROM movie_collections WHERE id = ?', [id])
    return true
  }

  clearMovieCollections(sourceId?: string): void {
    if (sourceId) {
      this.db.run('DELETE FROM movie_collections WHERE source_id = ?', [sourceId])
    } else {
      this.db.run('DELETE FROM movie_collections')
    }
  }

  deleteSingleMovieCollections(): number {
    const count = this.queryScalar<number>(
      'SELECT COUNT(*) FROM movie_collections WHERE total_movies <= 1'
    ) || 0
    if (count > 0) {
      this.db.run('DELETE FROM movie_collections WHERE total_movies <= 1')
    }
    return count
  }

  getMovieCollectionStats() {
    const total = this.queryScalar<number>('SELECT COUNT(*) FROM movie_collections') || 0
    const complete = this.queryScalar<number>(
      'SELECT COUNT(*) FROM movie_collections WHERE completeness_percentage = 100'
    ) || 0
    const incomplete = this.queryScalar<number>(
      'SELECT COUNT(*) FROM movie_collections WHERE completeness_percentage < 100'
    ) || 0
    const totalMissing = this.queryScalar<number>(
      "SELECT SUM(json_array_length(missing_movies)) FROM movie_collections WHERE missing_movies IS NOT NULL"
    ) || 0
    const avg = this.queryScalar<number>(
      'SELECT AVG(completeness_percentage) FROM movie_collections'
    ) || 0
    return { total, complete, incomplete, totalMissing, avgCompleteness: Math.round(avg) }
  }

  // Media item versions
  upsertMediaItemVersion(version: {
    media_item_id: number; file_path: string;
    resolution?: string; width?: number; height?: number;
    video_codec?: string; video_bitrate?: number;
    audio_codec?: string; audio_channels?: number; audio_bitrate?: number;
    quality_tier?: string; tier_quality?: string; tier_score?: number;
    is_best?: boolean; edition?: string;
  }): number {
    const existing = this.queryOne<{ id: number }>(
      'SELECT id FROM media_item_versions WHERE media_item_id = ? AND file_path = ?',
      [version.media_item_id, version.file_path]
    )

    if (existing) {
      this.db.run(`
        UPDATE media_item_versions SET
          resolution = ?, video_codec = ?, video_bitrate = ?,
          audio_codec = ?, audio_channels = ?, audio_bitrate = ?,
          quality_tier = ?, tier_quality = ?, tier_score = ?
        WHERE id = ?
      `, [
        version.resolution || '1080p', version.video_codec || 'h264',
        version.video_bitrate || 10000, version.audio_codec || 'ac3',
        version.audio_channels || 6, version.audio_bitrate || 448,
        version.quality_tier || null, version.tier_quality || null,
        version.tier_score || 0, existing.id,
      ])
      return existing.id
    }

    this.db.run(`
      INSERT INTO media_item_versions (
        media_item_id, version_source, edition, file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate,
        quality_tier, tier_quality, tier_score, is_best
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      version.media_item_id, 'primary', version.edition || null, version.file_path,
      0, 0,
      version.resolution || '1080p', version.width || 1920, version.height || 1080,
      version.video_codec || 'h264', version.video_bitrate || 10000,
      version.audio_codec || 'ac3', version.audio_channels || 6, version.audio_bitrate || 448,
      version.quality_tier || null, version.tier_quality || null,
      version.tier_score || 0, version.is_best ? 1 : 0,
    ])
    return this.queryScalar<number>('SELECT last_insert_rowid()')!
  }

  getMediaItemVersions(mediaItemId: number) {
    return this.queryAll<Record<string, unknown>>(
      'SELECT * FROM media_item_versions WHERE media_item_id = ? ORDER BY is_best DESC, tier_score DESC',
      [mediaItemId]
    )
  }

  // updateBestVersion - mirrors BetterSQLiteService logic
  updateBestVersion(mediaItemId: number): void {
    const versions = this.getMediaItemVersions(mediaItemId)
    if (versions.length === 0) return

    const tierRank = (tier?: unknown): number => {
      switch (tier) {
        case '4K': return 4
        case '1080p': return 3
        case '720p': return 2
        default: return 1
      }
    }

    const sorted = [...versions].sort((a, b) => {
      const rankDiff = tierRank(b.quality_tier) - tierRank(a.quality_tier)
      if (rankDiff !== 0) return rankDiff
      return ((b.tier_score as number) || 0) - ((a.tier_score as number) || 0)
    })

    const best = sorted[0]

    this.db.run('UPDATE media_item_versions SET is_best = 0 WHERE media_item_id = ?', [mediaItemId])
    if (best.id) {
      this.db.run('UPDATE media_item_versions SET is_best = 1 WHERE id = ?', [best.id])
    }

    this.db.run(`
      UPDATE media_items SET
        file_path = ?, resolution = ?, video_codec = ?, video_bitrate = ?,
        audio_codec = ?, audio_channels = ?, audio_bitrate = ?
      WHERE id = ?
    `, [
      best.file_path, best.resolution, best.video_codec, best.video_bitrate,
      best.audio_codec, best.audio_channels, best.audio_bitrate, mediaItemId,
    ])
  }

  // Toggle media source
  toggleMediaSource(sourceId: string, enabled: boolean): void {
    this.db.run(
      'UPDATE media_sources SET is_enabled = ? WHERE source_id = ?',
      [enabled ? 1 : 0, sourceId]
    )
  }

  getMediaSource(sourceId: string) {
    return this.queryOne<Record<string, unknown>>(
      'SELECT * FROM media_sources WHERE source_id = ?', [sourceId]
    )
  }

  getMediaItemsCountBySource(sourceId: string): number {
    return this.queryScalar<number>(
      'SELECT COUNT(*) FROM media_items WHERE source_id = ?', [sourceId]
    ) || 0
  }

  // Music data helpers
  insertMusicArtist(data: {
    source_id: string; provider_id: string; name: string;
  }): number {
    this.db.run(
      `INSERT INTO music_artists (source_id, source_type, provider_id, name)
       VALUES (?, 'plex', ?, ?)`,
      [data.source_id, data.provider_id, data.name]
    )
    return this.queryScalar<number>('SELECT last_insert_rowid()')!
  }

  insertMusicAlbum(data: {
    source_id: string; provider_id: string; artist_id?: number;
    artist_name: string; title: string; year?: number;
  }): number {
    this.db.run(
      `INSERT INTO music_albums (source_id, source_type, provider_id, artist_id, artist_name, title, year)
       VALUES (?, 'plex', ?, ?, ?, ?, ?)`,
      [data.source_id, data.provider_id, data.artist_id || null,
       data.artist_name, data.title, data.year || null]
    )
    return this.queryScalar<number>('SELECT last_insert_rowid()')!
  }

  insertMusicTrack(data: {
    source_id: string; provider_id: string; album_id?: number;
    artist_name: string; title: string; audio_codec?: string;
  }): number {
    this.db.run(
      `INSERT INTO music_tracks (source_id, source_type, provider_id, album_id, artist_name, title, audio_codec)
       VALUES (?, 'plex', ?, ?, ?, ?, ?)`,
      [data.source_id, data.provider_id, data.album_id || null,
       data.artist_name, data.title, data.audio_codec || 'mp3']
    )
    return this.queryScalar<number>('SELECT last_insert_rowid()')!
  }

  // globalSearch - mirrors BetterSQLiteService logic
  globalSearch(query: string, maxResults = 5) {
    if (!query) {
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }

    const isShortQuery = query.length <= 2
    const searchQuery = isShortQuery ? query.toLowerCase() : `%${query.toLowerCase()}%`
    const likeOp = isShortQuery ? '=' : 'LIKE'

    const movies = this.queryAll<Record<string, unknown>>(`
      SELECT id, title, year, poster_url FROM media_items
      WHERE type = 'movie' AND LOWER(title) ${likeOp} ?
      ORDER BY title LIMIT ?
    `, [searchQuery, maxResults])

    const tvShows = this.queryAll<Record<string, unknown>>(`
      SELECT MIN(id) as id, series_title as title, MIN(poster_url) as poster_url
      FROM media_items
      WHERE type = 'episode' AND series_title IS NOT NULL AND LOWER(series_title) ${likeOp} ?
      GROUP BY series_title ORDER BY series_title LIMIT ?
    `, [searchQuery, maxResults])

    const episodes = this.queryAll<Record<string, unknown>>(`
      SELECT id, title, series_title, season_number, episode_number,
             episode_thumb_url as poster_url
      FROM media_items
      WHERE type = 'episode' AND (LOWER(title) ${likeOp} ? OR LOWER(series_title) ${likeOp} ?)
      ORDER BY series_title, season_number, episode_number LIMIT ?
    `, [searchQuery, searchQuery, maxResults])

    const artists = this.queryAll<Record<string, unknown>>(`
      SELECT id, name, thumb_url FROM music_artists
      WHERE LOWER(name) ${likeOp} ? ORDER BY name LIMIT ?
    `, [searchQuery, maxResults])

    const albums = this.queryAll<Record<string, unknown>>(`
      SELECT id, title, artist_name, year, thumb_url FROM music_albums
      WHERE LOWER(title) ${likeOp} ? OR LOWER(artist_name) ${likeOp} ?
      ORDER BY title LIMIT ?
    `, [searchQuery, searchQuery, maxResults])

    const tracks = this.queryAll<Record<string, unknown>>(`
      SELECT t.id, t.title, t.album_id, a.title as album_title,
             t.artist_name, a.thumb_url as album_thumb_url
      FROM music_tracks t LEFT JOIN music_albums a ON t.album_id = a.id
      WHERE LOWER(t.title) ${likeOp} ? OR LOWER(t.artist_name) ${likeOp} ?
      ORDER BY t.title LIMIT ?
    `, [searchQuery, searchQuery, maxResults])

    return { movies, tvShows, episodes, artists, albums, tracks }
  }
}

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs()
})

describe('DatabaseService Integration 2', () => {
  let db: Database
  let helper: TestDatabaseHelper2

  beforeEach(() => {
    db = new SQL.Database()
    db.run(DATABASE_SCHEMA)
    try { db.run('ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0') } catch { /* already exists */ }
    try { db.run('ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0') } catch { /* already exists */ }
    try { db.run('ALTER TABLE media_items ADD COLUMN user_fixed_match INTEGER DEFAULT 0') } catch { /* already exists */ }
    try { db.run('ALTER TABLE media_items ADD COLUMN version_count INTEGER NOT NULL DEFAULT 1') } catch { /* already exists */ }
    helper = new TestDatabaseHelper2(db)
  })

  // ============================================================================
  // TV SHOW QUERIES
  // ============================================================================

  describe('TV show queries', () => {
    beforeEach(() => {
      helper.upsertMediaSource('src-1', 'plex', 'Plex')
      helper.upsertMediaSource('src-2', 'jellyfin', 'Jellyfin')

      // Breaking Bad: 3 episodes across 2 seasons
      helper.insertMediaItem({ source_id: 'src-1', title: 'Pilot', type: 'episode', series_title: 'Breaking Bad', season_number: 1, episode_number: '1' })
      helper.insertMediaItem({ source_id: 'src-1', title: 'Cat\'s in the Bag', type: 'episode', series_title: 'Breaking Bad', season_number: 1, episode_number: '2' })
      helper.insertMediaItem({ source_id: 'src-1', title: 'Grilled', type: 'episode', series_title: 'Breaking Bad', season_number: 2, episode_number: '1' })

      // The Wire: 2 episodes in 1 season
      helper.insertMediaItem({ source_id: 'src-1', title: 'The Target', type: 'episode', series_title: 'The Wire', season_number: 1, episode_number: '1' })
      helper.insertMediaItem({ source_id: 'src-1', title: 'The Detail', type: 'episode', series_title: 'The Wire', season_number: 1, episode_number: '2' })

      // 24: 1 episode (numeric-titled show for # filter)
      helper.insertMediaItem({ source_id: 'src-2', title: 'Day 1: 12:00 AM', type: 'episode', series_title: '24', season_number: 1, episode_number: '1' })

      // A movie (should not appear in TV queries)
      helper.insertMediaItem({ source_id: 'src-1', title: 'Inception', type: 'movie' })
    })

    it('should return grouped TV shows with episode and season counts', () => {
      const shows = helper.getTVShows()
      expect(shows).toHaveLength(3)
      const bb = shows.find((s: Record<string, unknown>) => s.series_title === 'Breaking Bad')
      expect(bb).toBeDefined()
      expect(bb!.episode_count).toBe(3)
      expect(bb!.season_count).toBe(2)
    })

    it('should filter by sourceId', () => {
      const shows = helper.getTVShows({ sourceId: 'src-2' })
      expect(shows).toHaveLength(1)
      expect(shows[0].series_title).toBe('24')
    })

    it('should filter by searchQuery', () => {
      const shows = helper.getTVShows({ searchQuery: 'Wire' })
      expect(shows).toHaveLength(1)
      expect(shows[0].series_title).toBe('The Wire')
    })

    it('should filter by alphabetFilter #', () => {
      const shows = helper.getTVShows({ alphabetFilter: '#' })
      expect(shows).toHaveLength(1)
      expect(shows[0].series_title).toBe('24')
    })

    it('should filter by alphabetFilter letter', () => {
      const shows = helper.getTVShows({ alphabetFilter: 'B' })
      expect(shows).toHaveLength(1)
      expect(shows[0].series_title).toBe('Breaking Bad')
    })

    it('should sort by episode_count descending', () => {
      const shows = helper.getTVShows({ sortBy: 'episode_count', sortOrder: 'desc' })
      expect(shows[0].series_title).toBe('Breaking Bad')
      expect(shows[0].episode_count).toBe(3)
    })

    it('should sort by season_count ascending', () => {
      const shows = helper.getTVShows({ sortBy: 'season_count', sortOrder: 'asc' })
      // "24" and "The Wire" both have 1 season, "Breaking Bad" has 2
      expect((shows[shows.length - 1] as Record<string, unknown>).series_title).toBe('Breaking Bad')
    })

    it('should paginate with limit and offset', () => {
      const page1 = helper.getTVShows({ limit: 2, offset: 0 })
      const page2 = helper.getTVShows({ limit: 2, offset: 2 })
      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })

    it('should count distinct TV shows', () => {
      expect(helper.countTVShows()).toBe(3)
      expect(helper.countTVShows({ sourceId: 'src-1' })).toBe(2)
      expect(helper.countTVShows({ searchQuery: 'Break' })).toBe(1)
    })

    it('should count total episodes', () => {
      expect(helper.countTVEpisodes()).toBe(6)
      expect(helper.countTVEpisodes({ sourceId: 'src-1' })).toBe(5)
      expect(helper.countTVEpisodes({ alphabetFilter: '#' })).toBe(1)
    })
  })

  // ============================================================================
  // SERIES COMPLETENESS
  // ============================================================================

  describe('series completeness CRUD', () => {
    it('should insert a new series completeness record', () => {
      const id = helper.upsertSeriesCompleteness({
        series_title: 'Breaking Bad',
        total_seasons: 5, total_episodes: 62,
        owned_seasons: 3, owned_episodes: 30,
        completeness_percentage: 48.4,
        tmdb_id: '1396',
      })
      expect(id).toBeGreaterThan(0)

      const record = helper.getSeriesCompletenessByTitle('Breaking Bad')
      expect(record).not.toBeNull()
      expect(record!.total_episodes).toBe(62)
      expect(record!.completeness_percentage).toBe(48.4)
    })

    it('should update an existing series completeness record', () => {
      const id1 = helper.upsertSeriesCompleteness({
        series_title: 'The Wire',
        total_seasons: 5, total_episodes: 60,
        owned_seasons: 1, owned_episodes: 13,
        completeness_percentage: 21.7,
        tmdb_id: '1438',
      })

      const id2 = helper.upsertSeriesCompleteness({
        series_title: 'The Wire',
        total_seasons: 5, total_episodes: 60,
        owned_seasons: 3, owned_episodes: 37,
        completeness_percentage: 61.7,
        tmdb_id: '1438',
      })

      expect(id2).toBe(id1)
      const record = helper.getSeriesCompletenessByTitle('The Wire')
      expect(record!.owned_episodes).toBe(37)
      expect(record!.completeness_percentage).toBe(61.7)
    })

    it('should get deduplicated series completeness', () => {
      helper.upsertSeriesCompleteness({
        series_title: 'Show A', source_id: 'src-1',
        total_seasons: 3, total_episodes: 30,
        owned_seasons: 1, owned_episodes: 10,
        completeness_percentage: 33.3, tmdb_id: '100',
      })
      helper.upsertSeriesCompleteness({
        series_title: 'Show A', source_id: 'src-2',
        total_seasons: 3, total_episodes: 30,
        owned_seasons: 2, owned_episodes: 20,
        completeness_percentage: 66.7, tmdb_id: '100',
      })

      const result = helper.getSeriesCompleteness()
      // Should return 1 row (deduplicated), picking the one with higher completeness
      expect(result).toHaveLength(1)
      expect(result[0].completeness_percentage).toBe(66.7)
    })

    it('should filter getSeriesCompleteness by sourceId', () => {
      helper.upsertSeriesCompleteness({
        series_title: 'Show A', source_id: 'src-1',
        total_seasons: 1, total_episodes: 10,
        owned_seasons: 1, owned_episodes: 10,
        completeness_percentage: 100, tmdb_id: '100',
      })
      helper.upsertSeriesCompleteness({
        series_title: 'Show B', source_id: 'src-2',
        total_seasons: 1, total_episodes: 10,
        owned_seasons: 0, owned_episodes: 0,
        completeness_percentage: 0, tmdb_id: '200',
      })

      const result = helper.getSeriesCompleteness('src-1')
      expect(result).toHaveLength(1)
      expect(result[0].series_title).toBe('Show A')
    })

    it('should get all series completeness with filters', () => {
      helper.upsertSeriesCompleteness({
        series_title: 'Show A', source_id: 'src-1', library_id: 'lib-1',
        total_seasons: 1, total_episodes: 10,
        owned_seasons: 1, owned_episodes: 10,
        completeness_percentage: 100, tmdb_id: '100',
      })
      helper.upsertSeriesCompleteness({
        series_title: 'Show A', source_id: 'src-1', library_id: 'lib-2',
        total_seasons: 1, total_episodes: 10,
        owned_seasons: 0, owned_episodes: 5,
        completeness_percentage: 50, tmdb_id: '100',
      })

      const all = helper.getAllSeriesCompleteness('src-1')
      expect(all).toHaveLength(2)

      const byLib = helper.getAllSeriesCompleteness('src-1', 'lib-1')
      expect(byLib).toHaveLength(1)
    })

    it('should get incomplete series (with tmdb_id and < 100%)', () => {
      helper.upsertSeriesCompleteness({
        series_title: 'Incomplete Show',
        total_seasons: 5, total_episodes: 50,
        owned_seasons: 2, owned_episodes: 20,
        completeness_percentage: 40, tmdb_id: '100',
      })
      helper.upsertSeriesCompleteness({
        series_title: 'Complete Show',
        total_seasons: 1, total_episodes: 10,
        owned_seasons: 1, owned_episodes: 10,
        completeness_percentage: 100, tmdb_id: '200',
      })
      helper.upsertSeriesCompleteness({
        series_title: 'No TMDB Show',
        total_seasons: 1, total_episodes: 10,
        owned_seasons: 0, owned_episodes: 0,
        completeness_percentage: 0,
      })

      const incomplete = helper.getIncompleteSeries()
      expect(incomplete).toHaveLength(1)
      expect(incomplete[0].series_title).toBe('Incomplete Show')
    })

    it('should delete series completeness by id', () => {
      const id = helper.upsertSeriesCompleteness({
        series_title: 'To Delete',
        total_seasons: 1, total_episodes: 10,
        owned_seasons: 0, owned_episodes: 0,
        completeness_percentage: 0,
      })

      helper.deleteSeriesCompleteness(id)
      expect(helper.getSeriesCompletenessByTitle('To Delete')).toBeNull()
    })
  })

  // ============================================================================
  // MOVIE COLLECTIONS
  // ============================================================================

  describe('movie collections CRUD', () => {
    it('should insert a new movie collection', () => {
      const id = helper.upsertMovieCollection({
        tmdb_collection_id: '119',
        collection_name: 'The Matrix Collection',
        total_movies: 4, owned_movies: 3,
        missing_movies: JSON.stringify([{ tmdb_id: '624860', title: 'The Matrix Resurrections' }]),
        completeness_percentage: 75,
      })
      expect(id).toBeGreaterThan(0)

      const col = helper.getMovieCollectionByTmdbId('119')
      expect(col).not.toBeNull()
      expect(col!.collection_name).toBe('The Matrix Collection')
      expect(col!.completeness_percentage).toBe(75)
    })

    it('should update an existing movie collection', () => {
      const id1 = helper.upsertMovieCollection({
        tmdb_collection_id: '119',
        collection_name: 'The Matrix Collection',
        total_movies: 4, owned_movies: 3,
        completeness_percentage: 75,
      })

      const id2 = helper.upsertMovieCollection({
        tmdb_collection_id: '119',
        collection_name: 'The Matrix Collection',
        total_movies: 4, owned_movies: 4,
        completeness_percentage: 100,
      })

      expect(id2).toBe(id1)
      const col = helper.getMovieCollectionByTmdbId('119')
      expect(col!.owned_movies).toBe(4)
      expect(col!.completeness_percentage).toBe(100)
    })

    it('should get all movie collections', () => {
      helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
      })
      helper.upsertMovieCollection({
        tmdb_collection_id: '10', collection_name: 'Star Wars',
        total_movies: 9, owned_movies: 6, completeness_percentage: 66.7,
      })

      const all = helper.getMovieCollections()
      expect(all).toHaveLength(2)
      // Should be ordered by collection_name ASC
      expect(all[0].collection_name).toBe('Matrix')
      expect(all[1].collection_name).toBe('Star Wars')
    })

    it('should filter getMovieCollections by sourceId', () => {
      helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        source_id: 'src-1',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
      })
      helper.upsertMovieCollection({
        tmdb_collection_id: '10', collection_name: 'Star Wars',
        source_id: 'src-2',
        total_movies: 9, owned_movies: 6, completeness_percentage: 66.7,
      })

      const result = helper.getMovieCollections('src-1')
      expect(result).toHaveLength(1)
      expect(result[0].collection_name).toBe('Matrix')
    })

    it('should get incomplete movie collections', () => {
      helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
      })
      helper.upsertMovieCollection({
        tmdb_collection_id: '10', collection_name: 'Star Wars',
        total_movies: 9, owned_movies: 6, completeness_percentage: 66.7,
      })

      const incomplete = helper.getIncompleteMovieCollections()
      expect(incomplete).toHaveLength(1)
      expect(incomplete[0].collection_name).toBe('Star Wars')
    })

    it('should delete a movie collection by id', () => {
      const id = helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
      })

      helper.deleteMovieCollection(id)
      expect(helper.getMovieCollectionByTmdbId('119')).toBeNull()
    })

    it('should clear all movie collections', () => {
      helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
      })
      helper.upsertMovieCollection({
        tmdb_collection_id: '10', collection_name: 'Star Wars',
        total_movies: 9, owned_movies: 6, completeness_percentage: 66.7,
      })

      helper.clearMovieCollections()
      expect(helper.getMovieCollections()).toHaveLength(0)
    })

    it('should clear movie collections for a specific source', () => {
      helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        source_id: 'src-1',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
      })
      helper.upsertMovieCollection({
        tmdb_collection_id: '10', collection_name: 'Star Wars',
        source_id: 'src-2',
        total_movies: 9, owned_movies: 6, completeness_percentage: 66.7,
      })

      helper.clearMovieCollections('src-1')
      const remaining = helper.getMovieCollections()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].collection_name).toBe('Star Wars')
    })

    it('should delete single-movie collections', () => {
      helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
      })
      helper.upsertMovieCollection({
        tmdb_collection_id: '999', collection_name: 'Standalone',
        total_movies: 1, owned_movies: 1, completeness_percentage: 100,
      })

      const deleted = helper.deleteSingleMovieCollections()
      expect(deleted).toBe(1)
      const remaining = helper.getMovieCollections()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].collection_name).toBe('Matrix')
    })

    it('should return correct movie collection stats', () => {
      helper.upsertMovieCollection({
        tmdb_collection_id: '119', collection_name: 'Matrix',
        total_movies: 4, owned_movies: 4, completeness_percentage: 100,
        missing_movies: '[]',
      })
      helper.upsertMovieCollection({
        tmdb_collection_id: '10', collection_name: 'Star Wars',
        total_movies: 9, owned_movies: 6, completeness_percentage: 66.7,
        missing_movies: JSON.stringify([
          { tmdb_id: '1', title: 'Movie A' },
          { tmdb_id: '2', title: 'Movie B' },
          { tmdb_id: '3', title: 'Movie C' },
        ]),
      })

      const stats = helper.getMovieCollectionStats()
      expect(stats.total).toBe(2)
      expect(stats.complete).toBe(1)
      expect(stats.incomplete).toBe(1)
      expect(stats.totalMissing).toBe(3)
      expect(stats.avgCompleteness).toBe(83) // (100 + 66.7) / 2 = 83.35 -> 83
    })
  })

  // ============================================================================
  // UPDATE BEST VERSION
  // ============================================================================

  describe('updateBestVersion', () => {
    let mediaItemId: number

    beforeEach(() => {
      helper.upsertMediaSource('src-1', 'plex', 'Test Plex')
      mediaItemId = helper.insertMediaItem({
        source_id: 'src-1', title: 'The Matrix', type: 'movie',
        resolution: '720p', video_codec: 'h264', video_bitrate: 5000,
      })
    })

    it('should select 4K version as best over 1080p', () => {
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId, file_path: '/movies/matrix_1080p.mkv',
        resolution: '1080p', quality_tier: '1080p', tier_score: 80,
        video_codec: 'h264', video_bitrate: 15000,
      })
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId, file_path: '/movies/matrix_4k.mkv',
        resolution: '4K', quality_tier: '4K', tier_score: 60,
        video_codec: 'hevc', video_bitrate: 40000,
      })

      helper.updateBestVersion(mediaItemId)

      const versions = helper.getMediaItemVersions(mediaItemId)
      const bestVersion = versions.find(v => v.is_best === 1)
      expect(bestVersion).toBeDefined()
      expect(bestVersion!.quality_tier).toBe('4K')

      // Verify parent media_item was updated
      const item = helper.getMediaItemById(mediaItemId)
      expect(item!.resolution).toBe('4K')
      expect(item!.video_codec).toBe('hevc')
    })

    it('should use tier_score as tiebreaker within same tier', () => {
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId, file_path: '/movies/matrix_low.mkv',
        resolution: '1080p', quality_tier: '1080p', tier_score: 40,
        video_codec: 'h264', video_bitrate: 6000,
      })
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId, file_path: '/movies/matrix_high.mkv',
        resolution: '1080p', quality_tier: '1080p', tier_score: 90,
        video_codec: 'hevc', video_bitrate: 20000,
      })

      helper.updateBestVersion(mediaItemId)

      const versions = helper.getMediaItemVersions(mediaItemId)
      const bestVersion = versions.find(v => v.is_best === 1)
      expect(bestVersion!.tier_score).toBe(90)
      expect(bestVersion!.file_path).toBe('/movies/matrix_high.mkv')
    })

    it('should clear previous best flag', () => {
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId, file_path: '/movies/matrix_sd.mkv',
        resolution: '480p', quality_tier: 'SD', tier_score: 50,
        is_best: true,
      })
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId, file_path: '/movies/matrix_1080p.mkv',
        resolution: '1080p', quality_tier: '1080p', tier_score: 80,
      })

      helper.updateBestVersion(mediaItemId)

      const versions = helper.getMediaItemVersions(mediaItemId)
      const bestVersions = versions.filter(v => v.is_best === 1)
      expect(bestVersions).toHaveLength(1)
      expect(bestVersions[0].quality_tier).toBe('1080p')
    })

    it('should do nothing when no versions exist', () => {
      const itemBefore = helper.getMediaItemById(mediaItemId)
      helper.updateBestVersion(mediaItemId)
      const itemAfter = helper.getMediaItemById(mediaItemId)
      // Should remain unchanged
      expect(itemAfter!.resolution).toBe(itemBefore!.resolution)
    })
  })

  // ============================================================================
  // LIBRARY MANAGEMENT
  // ============================================================================

  describe('library management', () => {
    beforeEach(() => {
      helper.upsertMediaSource('src-1', 'plex', 'My Plex')
      helper.upsertMediaSource('src-2', 'jellyfin', 'My Jellyfin')
    })

    it('should toggle media source enabled/disabled', () => {
      let source = helper.getMediaSource('src-1')
      expect(source!.is_enabled).toBe(1)

      helper.toggleMediaSource('src-1', false)
      source = helper.getMediaSource('src-1')
      expect(source!.is_enabled).toBe(0)

      helper.toggleMediaSource('src-1', true)
      source = helper.getMediaSource('src-1')
      expect(source!.is_enabled).toBe(1)
    })

    it('should not affect other sources when toggling', () => {
      helper.toggleMediaSource('src-1', false)
      const source2 = helper.getMediaSource('src-2')
      expect(source2!.is_enabled).toBe(1)
    })

    it('should count media items by source', () => {
      helper.insertMediaItem({ source_id: 'src-1', title: 'Movie 1', type: 'movie' })
      helper.insertMediaItem({ source_id: 'src-1', title: 'Movie 2', type: 'movie' })
      helper.insertMediaItem({ source_id: 'src-2', title: 'Movie 3', type: 'movie' })

      expect(helper.getMediaItemsCountBySource('src-1')).toBe(2)
      expect(helper.getMediaItemsCountBySource('src-2')).toBe(1)
      expect(helper.getMediaItemsCountBySource('nonexistent')).toBe(0)
    })
  })

  // ============================================================================
  // GLOBAL SEARCH
  // ============================================================================

  describe('globalSearch', () => {
    beforeEach(() => {
      helper.upsertMediaSource('src-1', 'plex', 'Test')

      // Movies
      helper.insertMediaItem({ source_id: 'src-1', title: 'The Matrix', type: 'movie', year: 1999 })
      helper.insertMediaItem({ source_id: 'src-1', title: 'The Dark Knight', type: 'movie', year: 2008 })
      helper.insertMediaItem({ source_id: 'src-1', title: 'Inception', type: 'movie', year: 2010 })

      // TV episodes
      helper.insertMediaItem({
        source_id: 'src-1', title: 'Pilot', type: 'episode',
        series_title: 'Breaking Bad', season_number: 1, episode_number: '1',
      })
      helper.insertMediaItem({
        source_id: 'src-1', title: 'The Dark Knight Returns', type: 'episode',
        series_title: 'Batman: TAS', season_number: 1, episode_number: '1',
      })

      // Music
      const artistId = helper.insertMusicArtist({
        source_id: 'src-1', provider_id: 'artist-1', name: 'Dark Tranquillity',
      })
      const albumId = helper.insertMusicAlbum({
        source_id: 'src-1', provider_id: 'album-1', artist_id: artistId,
        artist_name: 'Dark Tranquillity', title: 'The Gallery', year: 1995,
      })
      helper.insertMusicTrack({
        source_id: 'src-1', provider_id: 'track-1', album_id: albumId,
        artist_name: 'Dark Tranquillity', title: 'Punish My Heaven',
      })
    })

    it('should find movies matching query', () => {
      const results = helper.globalSearch('Matrix')
      expect(results.movies).toHaveLength(1)
      expect(results.movies[0].title).toBe('The Matrix')
    })

    it('should find TV shows by series title', () => {
      const results = helper.globalSearch('Breaking')
      expect(results.tvShows).toHaveLength(1)
      expect(results.tvShows[0].title).toBe('Breaking Bad')
    })

    it('should find episodes by title or series title', () => {
      const results = helper.globalSearch('Dark')
      expect(results.episodes.length).toBeGreaterThanOrEqual(1)
      // "The Dark Knight Returns" matches by title
      const ep = results.episodes.find((e: Record<string, unknown>) => e.title === 'The Dark Knight Returns')
      expect(ep).toBeDefined()
    })

    it('should find music artists by name', () => {
      const results = helper.globalSearch('Dark Tranquillity')
      expect(results.artists).toHaveLength(1)
      expect(results.artists[0].name).toBe('Dark Tranquillity')
    })

    it('should find music albums by title or artist name', () => {
      const results = helper.globalSearch('Gallery')
      expect(results.albums).toHaveLength(1)
      expect(results.albums[0].title).toBe('The Gallery')
    })

    it('should find music tracks', () => {
      const results = helper.globalSearch('Punish')
      expect(results.tracks).toHaveLength(1)
      expect(results.tracks[0].title).toBe('Punish My Heaven')
    })

    it('should return results from multiple categories', () => {
      const results = helper.globalSearch('Dark')
      // Should match: "The Dark Knight" (movie), "Dark Tranquillity" (artist),
      // "The Gallery" by Dark Tranquillity (album via artist_name), episodes, tracks
      expect(results.movies.length).toBeGreaterThanOrEqual(1)
      expect(results.artists.length).toBeGreaterThanOrEqual(1)
    })

    it('should respect maxResults limit', () => {
      const results = helper.globalSearch('The', 1)
      expect(results.movies.length).toBeLessThanOrEqual(1)
      expect(results.tvShows.length).toBeLessThanOrEqual(1)
    })

    it('should return empty results for empty query', () => {
      const results = helper.globalSearch('')
      expect(results.movies).toHaveLength(0)
      expect(results.tvShows).toHaveLength(0)
      expect(results.episodes).toHaveLength(0)
      expect(results.artists).toHaveLength(0)
      expect(results.albums).toHaveLength(0)
      expect(results.tracks).toHaveLength(0)
    })

    it('should use exact match for short queries (<=2 chars)', () => {
      // "Up" should only match exact lowercase title "up", not "Punish"
      helper.insertMediaItem({ source_id: 'src-1', title: 'Up', type: 'movie', year: 2009 })
      const results = helper.globalSearch('up')
      expect(results.movies).toHaveLength(1)
      expect(results.movies[0].title).toBe('Up')
    })
  })
})
