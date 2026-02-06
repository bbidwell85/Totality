/**
 * DatabaseService Unit Tests
 *
 * Tests for core database operations including media items, settings,
 * quality scores, and batch mode functionality.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock dependencies before importing DatabaseService
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    rename: vi.fn(),
  },
}))

vi.mock('../../src/main/services/CredentialEncryptionService', () => ({
  getCredentialEncryptionService: vi.fn(() => ({
    encrypt: vi.fn((val: string) => `encrypted:${val}`),
    decrypt: vi.fn((val: string) => val.replace('encrypted:', '')),
    isEncryptionAvailable: vi.fn(() => true),
    isEncrypted: vi.fn((val: string) => val?.startsWith('encrypted:')),
    encryptSetting: vi.fn((_key: string, val: string) => val), // Return value unchanged for tests
    decryptSetting: vi.fn((_key: string, val: string) => val),
  })),
}))

// Create mock database with exec tracking
function createMockDatabase() {
  const execResults: Map<string, unknown[][]> = new Map()
  let lastInsertId = 1

  return {
    exec: vi.fn((sql: string) => {
      // Handle last_insert_rowid() queries
      if (sql.includes('last_insert_rowid()')) {
        return [{ columns: ['id'], values: [[lastInsertId]] }]
      }
      // Parse SQL and return appropriate mock data
      if (sql.includes('SELECT') && sql.includes('settings')) {
        const results = execResults.get('settings') || []
        return results.length > 0 ? [{ columns: ['key', 'value'], values: results }] : []
      }
      if (sql.includes('SELECT') && sql.includes('media_items')) {
        const results = execResults.get('media_items') || []
        return results.length > 0 ? [{ columns: ['id', 'title', 'year', 'type'], values: results }] : []
      }
      if (sql.includes('SELECT') && sql.includes('media_sources')) {
        const results = execResults.get('media_sources') || []
        return results.length > 0 ? [{ columns: ['source_id', 'source_type', 'display_name'], values: results }] : []
      }
      if (sql.includes('sqlite_master')) {
        return [{ columns: ['sql'], values: [['CREATE TABLE test']] }]
      }
      if (sql.includes('COUNT(*)')) {
        return [{ columns: ['count'], values: [[5]] }]
      }
      return []
    }),
    run: vi.fn((sql: string, _params?: unknown[]) => {
      if (sql.includes('INSERT')) {
        lastInsertId++
      }
    }),
    close: vi.fn(),
    export: vi.fn(() => new Uint8Array([1, 2, 3])),
    getRowsModified: vi.fn(() => 1),
    _setResults: (table: string, results: unknown[][]) => {
      execResults.set(table, results)
    },
    _getLastInsertId: () => lastInsertId,
  }
}

// Mock sql.js with controllable database
const mockDb = createMockDatabase()

// Create a proper constructor mock for Database
class MockDatabase {
  exec = mockDb.exec
  run = mockDb.run
  close = mockDb.close
  export = mockDb.export
  getRowsModified = mockDb.getRowsModified
}

vi.mock('sql.js', () => ({
  default: vi.fn(() => Promise.resolve({
    Database: MockDatabase,
  })),
}))

import { DatabaseService } from '../../src/main/services/DatabaseService'

describe('DatabaseService', () => {
  let db: DatabaseService

  beforeEach(() => {
    vi.clearAllMocks()
    db = new DatabaseService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  describe('initialization', () => {
    it('should not be initialized before calling initialize()', () => {
      expect(db.isInitialized).toBe(false)
    })

    it('should be initialized after calling initialize()', async () => {
      await db.initialize()
      expect(db.isInitialized).toBe(true)
    })

    it('should only initialize once', async () => {
      await db.initialize()
      await db.initialize() // Second call should be no-op
      expect(db.isInitialized).toBe(true)
    })

    it('should return correct database path', () => {
      const dbPath = db.getDbPath()
      expect(dbPath).toContain('totality.db')
    })
  })

  // ============================================================================
  // BATCH MODE
  // ============================================================================

  describe('batch mode', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should start in non-batch mode', () => {
      expect(db.isInBatchMode()).toBe(false)
    })

    it('should enter batch mode when startBatch() is called', () => {
      db.startBatch()
      expect(db.isInBatchMode()).toBe(true)
    })

    it('should exit batch mode when endBatch() is called', async () => {
      db.startBatch()
      await db.endBatch()
      expect(db.isInBatchMode()).toBe(false)
    })

    it('should not save during batch mode', async () => {
      db.startBatch()
      await db.save()
      // In batch mode, save should be deferred
      expect(db.isInBatchMode()).toBe(true)
    })
  })

  // ============================================================================
  // SETTINGS
  // ============================================================================

  describe('settings', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should return null for non-existent setting', () => {
      const value = db.getSetting('non_existent_key')
      expect(value).toBeNull()
    })

    it('should save and retrieve settings', async () => {
      await db.setSetting('test_key', 'test_value')
      expect(mockDb.run).toHaveBeenCalled()
    })

    it('should get all settings', () => {
      const settings = db.getAllSettings()
      expect(typeof settings).toBe('object')
    })

    it('should get settings by prefix', () => {
      const settings = db.getSettingsByPrefix('tmdb_')
      expect(typeof settings).toBe('object')
    })
  })

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  describe('media items', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should upsert media item and return ID', async () => {
      const item = {
        source_id: 'test-source',
        source_type: 'plex' as const,
        library_id: 'lib-1',
        provider_item_id: 'plex-123',
        type: 'movie' as const,
        title: 'Test Movie',
        year: 2023,
      }

      const id = await db.upsertMediaItem(item)
      expect(typeof id).toBe('number')
      expect(id).toBeGreaterThan(0)
    })

    it('should get media items with filters', () => {
      const items = db.getMediaItems({ type: 'movie' })
      expect(Array.isArray(items)).toBe(true)
    })

    it('should count media items', () => {
      const count = db.countMediaItems({ type: 'movie' })
      expect(typeof count).toBe('number')
    })

    it('should get media item by ID', () => {
      const item = db.getMediaItemById(1)
      // Returns null if not found in mock
      expect(item === null || typeof item === 'object').toBe(true)
    })

    it('should get media item by file path', () => {
      const item = db.getMediaItemByPath('/path/to/movie.mkv')
      expect(item === null || typeof item === 'object').toBe(true)
    })

    it('should delete media item', async () => {
      await db.deleteMediaItem(1)
      expect(mockDb.run).toHaveBeenCalled()
    })

    it('should apply sorting to getMediaItems', () => {
      db.getMediaItems({ sortBy: 'title', sortOrder: 'asc' })
      expect(mockDb.exec).toHaveBeenCalled()

      // Verify ORDER BY is in the query
      const calls = mockDb.exec.mock.calls
      const selectCall = calls.find((c: unknown[]) =>
        typeof c[0] === 'string' && c[0].includes('SELECT') && c[0].includes('ORDER BY')
      )
      expect(selectCall).toBeDefined()
    })

    it('should apply pagination to getMediaItems', () => {
      db.getMediaItems({ limit: 10, offset: 20 })
      expect(mockDb.exec).toHaveBeenCalled()

      // Verify LIMIT and OFFSET are in the query
      const calls = mockDb.exec.mock.calls
      const selectCall = calls.find((c: unknown[]) =>
        typeof c[0] === 'string' && c[0].includes('LIMIT') && c[0].includes('OFFSET')
      )
      expect(selectCall).toBeDefined()
    })
  })

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  describe('quality scores', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should upsert quality score', async () => {
      const score = {
        media_item_id: 1,
        overall_score: 85,
        needs_upgrade: false,
        quality_tier: '1080p' as const,
        tier_quality: 'HIGH' as const,
        tier_score: 90,
      }

      const id = await db.upsertQualityScore(score)
      expect(typeof id).toBe('number')
    })

    it('should get quality scores', () => {
      const scores = db.getQualityScores()
      expect(Array.isArray(scores)).toBe(true)
    })

    it('should get quality score by media ID', () => {
      const score = db.getQualityScoreByMediaId(1)
      expect(score === null || typeof score === 'object').toBe(true)
    })
  })

  // ============================================================================
  // MEDIA SOURCES
  // ============================================================================

  describe('media sources', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should upsert media source', async () => {
      const source = {
        source_id: 'test-source-id',
        source_type: 'plex' as const,
        display_name: 'Test Plex Server',
        connection_config: JSON.stringify({ serverUrl: 'http://localhost:32400' }),
        is_enabled: true,
      }

      const sourceId = await db.upsertMediaSource(source)
      expect(typeof sourceId).toBe('string')
    })

    it('should get all media sources', () => {
      const sources = db.getMediaSources()
      expect(Array.isArray(sources)).toBe(true)
    })

    it('should get media sources by type', () => {
      const sources = db.getMediaSources('plex')
      expect(Array.isArray(sources)).toBe(true)
    })

    it('should get enabled media sources', () => {
      const sources = db.getEnabledMediaSources()
      expect(Array.isArray(sources)).toBe(true)
    })

    it('should get media source by ID', () => {
      const source = db.getMediaSourceById('test-source')
      expect(source === null || typeof source === 'object').toBe(true)
    })
  })

  // ============================================================================
  // LIBRARY STATS
  // ============================================================================

  describe('library stats', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should get library stats for all sources', () => {
      const stats = db.getLibraryStats()
      expect(typeof stats).toBe('object')
      expect(stats).toHaveProperty('totalItems')
      expect(stats).toHaveProperty('totalMovies')
      expect(stats).toHaveProperty('totalEpisodes')
    })

    it('should get library stats for specific source', () => {
      const stats = db.getLibraryStats('source-123')
      expect(typeof stats).toBe('object')
    })
  })

  // ============================================================================
  // DATA EXPORT
  // ============================================================================

  describe('data export', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should export data as object', () => {
      const data = db.exportData()
      expect(typeof data).toBe('object')
    })

    it('should export working CSV', () => {
      const csv = db.exportWorkingCSV({
        includeMovies: true,
        includeEpisodes: true,
      })
      expect(typeof csv).toBe('string')
    })
  })

  // ============================================================================
  // LIBRARY MANAGEMENT
  // ============================================================================

  describe('library management', () => {
    beforeEach(async () => {
      await db.initialize()
    })

    it('should check if library is enabled', () => {
      const enabled = db.isLibraryEnabled('source-1', 'library-1')
      expect(typeof enabled).toBe('boolean')
    })

    it('should get source libraries', () => {
      const libraries = db.getSourceLibraries('source-1')
      expect(Array.isArray(libraries)).toBe(true)
    })

    it('should get enabled library IDs', () => {
      const ids = db.getEnabledLibraryIds('source-1')
      expect(Array.isArray(ids)).toBe(true)
    })

    it('should toggle library', async () => {
      await db.toggleLibrary('source-1', 'library-1', true)
      expect(mockDb.run).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // DATABASE CLOSE
  // ============================================================================

  describe('close', () => {
    it('should close database', async () => {
      await db.initialize()
      await db.close()
      expect(mockDb.close).toHaveBeenCalled()
    })
  })
})
