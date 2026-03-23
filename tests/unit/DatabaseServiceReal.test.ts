/**
 * DatabaseService Real Integration Tests
 *
 * Calls actual DatabaseService methods with a real in-memory SQL.js database.
 * This provides true Istanbul coverage of DatabaseService.ts code paths.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// Unmock sql.js to get real in-memory database
vi.unmock('sql.js')

// Mock fs/promises so save() doesn't fail trying to write to disk
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockRejectedValue(new Error('ENOENT')),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
  },
}))

// Mock credential encryption to pass through
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

import { DatabaseService } from '../../src/main/services/DatabaseService'
import type { MediaItem } from '../../src/main/types/database'

// Reusable counter for unique IDs
let itemCounter = 0

function makeMediaItem(overrides: Partial<MediaItem> & { source_id: string; title: string; type: 'movie' | 'episode' }): MediaItem {
  return {
    plex_id: `item-${++itemCounter}-${Date.now()}`,
    source_type: 'plex',
    library_id: 'lib-1',
    file_path: '',
    file_size: 0,
    duration: 0,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    video_bitrate: 10000,
    audio_codec: 'ac3',
    audio_channels: 6,
    audio_bitrate: 448,
    ...overrides,
  } as MediaItem
}

describe('DatabaseService (real SQL.js)', () => {
  let db: DatabaseService

  beforeAll(async () => {
    db = new DatabaseService()
    await db.initialize()
  })

  beforeEach(() => {
    itemCounter++
  })

  // ============================================================================
  // SETTINGS
  // ============================================================================

  describe('settings', () => {
    it('should set and get a setting', async () => {
      await db.setSetting('test_key_real', 'test_value')
      expect(db.getSetting('test_key_real')).toBe('test_value')
    })

    it('should return null for non-existent setting', () => {
      expect(db.getSetting('nonexistent_real')).toBeNull()
    })

    it('should update existing setting', async () => {
      await db.setSetting('update_key', 'v1')
      await db.setSetting('update_key', 'v2')
      expect(db.getSetting('update_key')).toBe('v2')
    })

    it('should get all settings', async () => {
      await db.setSetting('all_a', '1')
      await db.setSetting('all_b', '2')
      const all = db.getAllSettings()
      expect(all['all_a']).toBe('1')
      expect(all['all_b']).toBe('2')
    })

    it('should get settings by prefix', async () => {
      await db.setSetting('pfx_alpha', 'a')
      await db.setSetting('pfx_beta', 'b')
      await db.setSetting('other_key', 'c')
      const prefixed = db.getSettingsByPrefix('pfx_')
      expect(prefixed['pfx_alpha']).toBe('a')
      expect(prefixed['pfx_beta']).toBe('b')
      expect(prefixed['other_key']).toBeUndefined()
    })
  })

  // ============================================================================
  // MEDIA SOURCES
  // ============================================================================

  describe('media sources', () => {
    it('should upsert and retrieve a media source', async () => {
      const sourceId = await db.upsertMediaSource({
        source_id: `src-real-${itemCounter}`,
        source_type: 'plex',
        display_name: 'Test Plex',
        connection_config: JSON.stringify({ serverUrl: 'http://localhost:32400' }),
        is_enabled: true,
      })
      expect(sourceId).toBeTruthy()

      const source = db.getMediaSourceById(sourceId)
      expect(source).not.toBeNull()
      expect(source!.display_name).toBe('Test Plex')
    })

    it('should get enabled media sources', async () => {
      const sid = `src-enabled-${itemCounter}`
      await db.upsertMediaSource({
        source_id: sid,
        source_type: 'jellyfin',
        display_name: 'Enabled Source',
        connection_config: '{}',
        is_enabled: true,
      })
      const enabled = db.getEnabledMediaSources()
      expect(enabled.some(s => s.source_id === sid)).toBe(true)
    })

    it('should toggle media source', async () => {
      const sid = `src-toggle-${itemCounter}`
      await db.upsertMediaSource({
        source_id: sid,
        source_type: 'plex',
        display_name: 'Toggle Test',
        connection_config: '{}',
        is_enabled: true,
      })
      await db.toggleMediaSource(sid, false)
      const source = db.getMediaSourceById(sid)
      expect(source!.is_enabled).toBeFalsy()
    })

    it('should get media sources by type', () => {
      const sources = db.getMediaSources('plex')
      expect(Array.isArray(sources)).toBe(true)
    })
  })

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  describe('media items', () => {
    let sourceId: string

    beforeAll(async () => {
      sourceId = 'src-items-test'
      await db.upsertMediaSource({
        source_id: sourceId,
        source_type: 'plex',
        display_name: 'Items Test',
        connection_config: '{}',
        is_enabled: true,
      })
    })

    it('should upsert and retrieve a media item', async () => {
      const id = await db.upsertMediaItem(makeMediaItem({
        source_id: sourceId,
        title: 'The Matrix',
        type: 'movie',
        year: 1999,
      }))
      expect(id).toBeGreaterThan(0)

      const item = db.getMediaItemById(id)
      expect(item).not.toBeNull()
      expect(item!.title).toBe('The Matrix')
    })

    it('should count media items', async () => {
      await db.upsertMediaItem(makeMediaItem({
        source_id: sourceId,
        type: 'movie',
        title: 'Count Test',
      }))
      const count = db.countMediaItems({ sourceId })
      expect(count).toBeGreaterThan(0)
    })

    it('should get media items with filters', () => {
      const items = db.getMediaItems({ type: 'movie', sourceId, limit: 5 })
      expect(Array.isArray(items)).toBe(true)
    })

    it('should get media items with sorting', () => {
      const items = db.getMediaItems({ sortBy: 'title', sortOrder: 'asc', sourceId })
      expect(Array.isArray(items)).toBe(true)
    })

    it('should return null for non-existent media item', () => {
      expect(db.getMediaItemById(999999)).toBeNull()
    })

    it('should get media item by path', async () => {
      await db.upsertMediaItem(makeMediaItem({
        source_id: sourceId,
        type: 'movie',
        title: 'Path Test',
        file_path: '/test/path/movie.mkv',
      }))
      const item = db.getMediaItemByPath('/test/path/movie.mkv')
      expect(item).not.toBeNull()
      expect(item!.title).toBe('Path Test')
    })

    it('should delete a media item', async () => {
      const id = await db.upsertMediaItem(makeMediaItem({
        source_id: sourceId,
        type: 'movie',
        title: 'Delete Me',
      }))
      await db.deleteMediaItem(id)
      expect(db.getMediaItemById(id)).toBeNull()
    })
  })

  // ============================================================================
  // MEDIA ITEM VERSIONS
  // ============================================================================

  describe('media item versions', () => {
    let mediaItemId: number

    beforeAll(async () => {
      mediaItemId = await db.upsertMediaItem(makeMediaItem({
        source_id: 'src-items-test',
        type: 'movie',
        title: 'Version Test Movie',
      }))
    })

    it('should insert a version', () => {
      const id = db.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        version_source: 'primary',
        file_path: '/movies/version1.mkv',
        file_size: 5000000,
        duration: 7200,
        resolution: '1080p',
        width: 1920,
        height: 1080,
        video_codec: 'h264',
        video_bitrate: 10000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_bitrate: 448,
      })
      expect(id).toBeGreaterThan(0)
    })

    it('should update existing version by file_path', () => {
      const id1 = db.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        version_source: 'primary',
        file_path: '/movies/update-test.mkv',
        file_size: 5000000,
        duration: 7200,
        resolution: '1080p',
        width: 1920,
        height: 1080,
        video_codec: 'h264',
        video_bitrate: 10000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_bitrate: 448,
      })

      const id2 = db.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        version_source: 'primary',
        file_path: '/movies/update-test.mkv',
        file_size: 10000000,
        duration: 7200,
        resolution: '4K',
        width: 3840,
        height: 2160,
        video_codec: 'hevc',
        video_bitrate: 40000,
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_bitrate: 5000,
      })

      expect(id2).toBe(id1)
    })

    it('should get versions for media item', () => {
      const versions = db.getMediaItemVersions(mediaItemId)
      expect(versions.length).toBeGreaterThan(0)
    })

    it('should update best version', () => {
      // Add a clearly better version
      db.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        version_source: 'secondary',
        file_path: '/movies/best-version.mkv',
        file_size: 50000000,
        duration: 7200,
        resolution: '4K',
        width: 3840,
        height: 2160,
        video_codec: 'hevc',
        video_bitrate: 60000,
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_bitrate: 5000,
        quality_tier: '4K',
        tier_quality: 'HIGH',
        tier_score: 95,
      })

      db.updateBestVersion(mediaItemId)

      const versions = db.getMediaItemVersions(mediaItemId)
      const best = versions.find(v => v.is_best)
      expect(best).toBeDefined()
      expect(best!.resolution).toBe('4K')
    })

    it('should delete versions', () => {
      db.deleteMediaItemVersions(mediaItemId)
      expect(db.getMediaItemVersions(mediaItemId)).toHaveLength(0)
    })
  })

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  describe('quality scores', () => {
    it('should upsert and retrieve quality score', async () => {
      const mediaId = await db.upsertMediaItem(makeMediaItem({
        source_id: 'src-items-test',
        type: 'movie',
        title: 'Quality Score Test',
      }))

      await db.upsertQualityScore({
        media_item_id: mediaId,
        quality_tier: '1080p',
        tier_quality: 'HIGH',
        tier_score: 85,
        bitrate_tier_score: 90,
        audio_tier_score: 80,
        overall_score: 85,
        resolution_score: 90,
        bitrate_score: 80,
        audio_score: 75,
        is_low_quality: false,
        needs_upgrade: false,
        issues: '[]',
      })

      const score = db.getQualityScoreByMediaId(mediaId)
      expect(score).not.toBeNull()
      expect(score!.tier_quality).toBe('HIGH')
      expect(score!.tier_score).toBe(85)
    })

    it('should get all quality scores', () => {
      const scores = db.getQualityScores()
      expect(Array.isArray(scores)).toBe(true)
    })
  })

  // ============================================================================
  // TV SHOWS
  // ============================================================================

  describe('TV shows', () => {
    beforeAll(async () => {
      // Insert episodes for two shows
      for (let ep = 1; ep <= 3; ep++) {
        await db.upsertMediaItem(makeMediaItem({
          source_id: 'src-items-test',
          type: 'episode',
          title: `Episode ${ep}`,
          series_title: 'Breaking Bad',
          season_number: 1,
          episode_number: ep,
        }))
      }

      await db.upsertMediaItem(makeMediaItem({
        source_id: 'src-items-test',
        type: 'episode',
        title: 'Winter Is Coming',
        series_title: 'Game of Thrones',
        season_number: 1,
        episode_number: 1,
      }))
    })

    it('should get TV shows grouped by series', () => {
      const shows = db.getTVShows()
      expect(shows.length).toBeGreaterThanOrEqual(2)
      const bb = shows.find(s => s.series_title === 'Breaking Bad')
      expect(bb).toBeDefined()
      expect(bb!.episode_count).toBe(3)
    })

    it('should count TV shows', () => {
      const count = db.countTVShows()
      expect(count).toBeGreaterThanOrEqual(2)
    })

    it('should count TV episodes', () => {
      const count = db.countTVEpisodes()
      expect(count).toBeGreaterThanOrEqual(4)
    })

    it('should filter TV shows by search query', () => {
      const shows = db.getTVShows({ searchQuery: 'Breaking' })
      expect(shows).toHaveLength(1)
      expect(shows[0].series_title).toBe('Breaking Bad')
    })

    it('should sort TV shows by episode count', () => {
      const shows = db.getTVShows({ sortBy: 'episode_count', sortOrder: 'desc' })
      expect(shows[0].episode_count).toBeGreaterThanOrEqual(shows[shows.length - 1].episode_count)
    })

    it('should paginate TV shows', () => {
      const page1 = db.getTVShows({ limit: 1 })
      expect(page1).toHaveLength(1)
      const page2 = db.getTVShows({ limit: 1, offset: 1 })
      expect(page2).toHaveLength(1)
      expect(page1[0].series_title).not.toBe(page2[0].series_title)
    })
  })

  // ============================================================================
  // SERIES COMPLETENESS
  // ============================================================================

  describe('series completeness', () => {
    it('should upsert and retrieve series completeness', async () => {
      const id = await db.upsertSeriesCompleteness({
        series_title: 'Breaking Bad',
        source_id: 'src-items-test',
        library_id: 'lib-1',
        total_seasons: 5,
        total_episodes: 62,
        owned_seasons: 3,
        owned_episodes: 30,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 48,
        tmdb_id: '1396',
      })
      expect(id).toBeGreaterThan(0)

      const all = db.getAllSeriesCompleteness('src-items-test')
      expect(all.some(s => s.series_title === 'Breaking Bad')).toBe(true)
    })

    it('should update existing series completeness (same ID)', async () => {
      const id1 = await db.upsertSeriesCompleteness({
        series_title: 'Update Test Series',
        source_id: 'src-items-test',
        library_id: 'lib-1',
        total_seasons: 3,
        total_episodes: 30,
        owned_seasons: 1,
        owned_episodes: 10,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 33,
      })

      const id2 = await db.upsertSeriesCompleteness({
        series_title: 'Update Test Series',
        source_id: 'src-items-test',
        library_id: 'lib-1',
        total_seasons: 3,
        total_episodes: 30,
        owned_seasons: 3,
        owned_episodes: 30,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 100,
      })

      expect(id2).toBe(id1)
    })

    it('should get incomplete series', () => {
      const incomplete = db.getIncompleteSeries('src-items-test')
      expect(incomplete.every(s => s.completeness_percentage < 100)).toBe(true)
    })

    it('should get series completeness by title', () => {
      const result = db.getSeriesCompletenessByTitle('Breaking Bad', 'src-items-test')
      expect(result).not.toBeNull()
      expect(result!.series_title).toBe('Breaking Bad')
    })

    it('should delete series completeness', async () => {
      const id = await db.upsertSeriesCompleteness({
        series_title: 'Delete Me Series',
        source_id: 'src-items-test',
        library_id: 'lib-1',
        total_seasons: 1,
        total_episodes: 10,
        owned_seasons: 0,
        owned_episodes: 0,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 0,
      })
      const deleted = await db.deleteSeriesCompleteness(id)
      expect(deleted).toBe(true)
    })

    it('should get deduplicated series completeness', () => {
      const deduped = db.getSeriesCompleteness('src-items-test')
      const titles = deduped.map(s => s.series_title)
      // No duplicate titles
      expect(new Set(titles).size).toBe(titles.length)
    })
  })

  // ============================================================================
  // MOVIE COLLECTIONS
  // ============================================================================

  describe('movie collections', () => {
    it('should upsert and retrieve movie collection', async () => {
      const id = await db.upsertMovieCollection({
        tmdb_collection_id: '119',
        collection_name: 'The Lord of the Rings Collection',
        source_id: 'src-items-test',
        library_id: 'lib-1',
        total_movies: 3,
        owned_movies: 2,
        missing_movies: '["The Return of the King"]',
        owned_movie_ids: '[1, 2]',
        completeness_percentage: 67,
      })
      expect(id).toBeGreaterThan(0)

      const collection = db.getMovieCollectionByTmdbId('119')
      expect(collection).not.toBeNull()
      expect(collection!.collection_name).toBe('The Lord of the Rings Collection')
    })

    it('should get all movie collections', () => {
      const collections = db.getMovieCollections()
      expect(collections.length).toBeGreaterThan(0)
    })

    it('should get movie collections filtered by source', () => {
      const collections = db.getMovieCollections('src-items-test')
      expect(collections.length).toBeGreaterThan(0)
    })

    it('should get incomplete movie collections', () => {
      const incomplete = db.getIncompleteMovieCollections()
      expect(incomplete.every(c => c.completeness_percentage < 100)).toBe(true)
    })

    it('should get incomplete movie collections by source', () => {
      const incomplete = db.getIncompleteMovieCollections('src-items-test')
      expect(Array.isArray(incomplete)).toBe(true)
    })

    it('should get movie collection stats', () => {
      const stats = db.getMovieCollectionStats()
      expect(stats.total).toBeGreaterThan(0)
      expect(typeof stats.avgCompleteness).toBe('number')
    })

    it('should delete single-movie collections', async () => {
      await db.upsertMovieCollection({
        tmdb_collection_id: 'single-1',
        collection_name: 'Single Movie Collection',
        source_id: 'src-items-test',
        library_id: 'lib-1',
        total_movies: 1,
        owned_movies: 1,
        missing_movies: '[]',
        owned_movie_ids: '[1]',
        completeness_percentage: 100,
      })

      const deleted = await db.deleteSingleMovieCollections()
      expect(deleted).toBeGreaterThanOrEqual(1)
    })

    it('should clear movie collections by source', async () => {
      await db.upsertMovieCollection({
        tmdb_collection_id: 'clear-test',
        collection_name: 'Clear Test',
        source_id: 'src-clear-test',
        library_id: 'lib-1',
        total_movies: 3,
        owned_movies: 1,
        missing_movies: '[]',
        owned_movie_ids: '[]',
        completeness_percentage: 33,
      })

      await db.clearMovieCollections('src-clear-test')
      const remaining = db.getMovieCollections('src-clear-test')
      expect(remaining).toHaveLength(0)
    })

    it('should delete movie collection by ID', async () => {
      const id = await db.upsertMovieCollection({
        tmdb_collection_id: `del-${itemCounter}`,
        collection_name: 'Delete Me',
        source_id: 'src-items-test',
        library_id: 'lib-1',
        total_movies: 2,
        owned_movies: 1,
        missing_movies: '[]',
        owned_movie_ids: '[]',
        completeness_percentage: 50,
      })
      const result = await db.deleteMovieCollection(id)
      expect(result).toBe(true)
    })
  })

  // ============================================================================
  // LIBRARY STATS
  // ============================================================================

  describe('library stats', () => {
    it('should get library stats for all sources', () => {
      const stats = db.getLibraryStats()
      expect(stats).toHaveProperty('totalItems')
      expect(stats).toHaveProperty('totalMovies')
      expect(stats).toHaveProperty('totalEpisodes')
      expect(stats.totalItems).toBeGreaterThan(0)
    })

    it('should get library stats for specific source', () => {
      const stats = db.getLibraryStats('src-items-test')
      expect(stats.totalItems).toBeGreaterThan(0)
    })

    it('should get aggregated source stats', () => {
      const stats = db.getAggregatedSourceStats()
      expect(stats.totalSources).toBeGreaterThan(0)
      expect(stats.totalItems).toBeGreaterThan(0)
      expect(Array.isArray(stats.bySource)).toBe(true)
    })

    it('should count media items by source', () => {
      const count = db.getMediaItemsCountBySource('src-items-test')
      expect(count).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // LIBRARY MANAGEMENT
  // ============================================================================

  describe('library management', () => {
    it('should toggle library enabled state', async () => {
      await db.toggleLibrary('src-items-test', 'lib-toggle', true)
      expect(db.isLibraryEnabled('src-items-test', 'lib-toggle')).toBe(true)

      await db.toggleLibrary('src-items-test', 'lib-toggle', false)
      expect(db.isLibraryEnabled('src-items-test', 'lib-toggle')).toBe(false)
    })

    it('should get source libraries', () => {
      const libraries = db.getSourceLibraries('src-items-test')
      expect(Array.isArray(libraries)).toBe(true)
    })

    it('should get enabled library IDs', () => {
      const ids = db.getEnabledLibraryIds('src-items-test')
      expect(Array.isArray(ids)).toBe(true)
    })
  })

  // ============================================================================
  // LIBRARY SCANS
  // ============================================================================

  describe('library scans', () => {
    it('should update and retrieve library scan time', async () => {
      await db.updateLibraryScanTime('src-items-test', 'lib-scan', 'Scan Library', 'movie', 50)
      const scanTime = db.getLibraryScanTime('src-items-test', 'lib-scan')
      expect(scanTime).not.toBeNull()
    })

    it('should get library scan times for source', () => {
      const scanTimes = db.getLibraryScanTimes('src-items-test')
      expect(scanTimes instanceof Map).toBe(true)
    })

    it('should delete library scan times', async () => {
      await db.deleteLibraryScanTimes('src-items-test')
      const scanTime = db.getLibraryScanTime('src-items-test', 'lib-scan')
      expect(scanTime).toBeFalsy()
    })
  })

  // ============================================================================
  // BATCH MODE
  // ============================================================================

  describe('batch mode', () => {
    it('should defer saves in batch mode', async () => {
      expect(db.isInBatchMode()).toBe(false)
      db.startBatch()
      expect(db.isInBatchMode()).toBe(true)
      await db.endBatch()
      expect(db.isInBatchMode()).toBe(false)
    })
  })

  // ============================================================================
  // DATA EXPORT
  // ============================================================================

  describe('data export', () => {
    it('should export data as object', () => {
      const data = db.exportData()
      expect(typeof data).toBe('object')
      expect(data).toHaveProperty('media_items')
      expect(data).toHaveProperty('quality_scores')
    })

    it('should export CSV', () => {
      const csv = db.exportWorkingCSV({
        includeMovies: true,
        includeEpisodes: true,
      })
      expect(typeof csv).toBe('string')
    })
  })

  // ============================================================================
  // SOURCE DELETION CASCADE
  // ============================================================================

  describe('source deletion cascade', () => {
    it('should delete source and all associated data', async () => {
      const sid = 'src-delete-cascade'
      await db.upsertMediaSource({
        source_id: sid,
        source_type: 'plex',
        display_name: 'Delete Cascade Test',
        connection_config: '{}',
        is_enabled: true,
      })

      await db.upsertMediaItem(makeMediaItem({
        source_id: sid,
        type: 'movie',
        title: 'Cascade Movie',
      }))

      await db.deleteMediaSource(sid)
      expect(db.getMediaSourceById(sid)).toBeNull()
      expect(db.getMediaItemsCountBySource(sid)).toBe(0)
    })
  })

  // ============================================================================
  // GLOBAL SEARCH
  // ============================================================================

  describe('globalSearch', () => {
    it('should search across media items', () => {
      const results = db.globalSearch('Breaking', 10)
      // Should find episodes with series_title 'Breaking Bad'
      expect(results.episodes.length + results.tvShows.length).toBeGreaterThan(0)
    })

    it('should return empty for short queries (< 2 chars)', () => {
      const results = db.globalSearch('x', 10)
      expect(results.movies).toHaveLength(0)
      expect(results.tvShows).toHaveLength(0)
    })

    it('should return empty results for no match', () => {
      const results = db.globalSearch('zzzznonexistentzzzz', 10)
      expect(results.movies).toHaveLength(0)
      expect(results.tvShows).toHaveLength(0)
    })
  })

  // ============================================================================
  // CLOSE
  // ============================================================================

  describe('initialization', () => {
    it('should report as initialized', () => {
      expect(db.isInitialized).toBe(true)
    })

    it('should not re-initialize', async () => {
      await db.initialize() // should be a no-op
      expect(db.isInitialized).toBe(true)
    })

    it('should return database path', () => {
      expect(db.getDbPath()).toContain('totality.db')
    })
  })
})
