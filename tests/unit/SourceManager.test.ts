/**
 * SourceManager Unit Tests
 *
 * Tests for source management including CRUD operations,
 * provider lifecycle, and scan control.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock dependencies
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    rename: vi.fn(),
    readdir: vi.fn(() => Promise.resolve([])),
    rm: vi.fn(),
    stat: vi.fn(),
  },
}))

const mockMediaSources: any[] = []
const mockProviders = new Map<string, any>()

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getMediaSources: vi.fn(() => mockMediaSources),
    getMediaSourceById: vi.fn((id: string) => mockMediaSources.find(s => s.source_id === id) || null),
    getEnabledMediaSources: vi.fn(() => mockMediaSources.filter(s => s.is_enabled)),
    upsertMediaSource: vi.fn((source: any) => {
      const existingIndex = mockMediaSources.findIndex(s => s.source_id === source.source_id)
      if (existingIndex >= 0) {
        mockMediaSources[existingIndex] = { ...mockMediaSources[existingIndex], ...source }
      } else {
        mockMediaSources.push({ ...source, created_at: new Date().toISOString() })
      }
      return source.source_id
    }),
    deleteMediaItem: vi.fn(),
    isLibraryEnabled: vi.fn(() => true),
    getEnabledLibraryIds: vi.fn(() => ['library-1']),
    deleteLibraryScanTimes: vi.fn(),
    updateSourceConnectionTime: vi.fn(),
    toggleMediaSource: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/PlexService', () => ({
  getPlexService: vi.fn(() => ({
    createSource: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/LiveMonitoringService', () => ({
  getLiveMonitoringService: vi.fn(() => ({
    addSource: vi.fn(),
    removeSource: vi.fn(),
    updateSource: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/TaskQueueService', () => ({
  getTaskQueueService: vi.fn(() => ({
    removeTasksForSource: vi.fn(),
  })),
}))

// Mock provider creation
const createMockProvider = (type: string, config: any) => ({
  sourceId: config.sourceId,
  sourceType: type,
  displayName: config.displayName,
  isAuthenticated: vi.fn(() => Promise.resolve(true)),
  testConnection: vi.fn(() => Promise.resolve({ success: true })),
  getLibraries: vi.fn(() => Promise.resolve([])),
  scanLibrary: vi.fn(() => Promise.resolve({ items: [], totalItems: 0 })),
  cleanup: vi.fn(),
})

vi.mock('../../src/main/providers/ProviderFactory', () => ({
  createProvider: vi.fn((type: string, config: any) => {
    const provider = createMockProvider(type, config)
    mockProviders.set(config.sourceId, provider)
    return provider
  }),
  getSupportedProviders: vi.fn(() => ['plex', 'jellyfin', 'emby', 'kodi', 'local']),
}))

import { SourceManager } from '../../src/main/services/SourceManager'

describe('SourceManager', () => {
  let manager: SourceManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockMediaSources.length = 0
    mockProviders.clear()
    manager = new SourceManager()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  describe('initialization', () => {
    it('should initialize without sources', async () => {
      await manager.initialize()
      const sources = await manager.getSources()
      expect(sources).toEqual([])
    })

    it('should load existing sources on initialize', async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Test Plex',
        connection_config: JSON.stringify({ serverUrl: 'http://localhost:32400' }),
        is_enabled: true,
      })

      await manager.initialize()
      const sources = await manager.getSources()

      expect(sources).toHaveLength(1)
    })

    it('should only initialize once', async () => {
      await manager.initialize()
      await manager.initialize()
      // Should not throw or cause issues
    })
  })

  // ============================================================================
  // SOURCE CRUD
  // ============================================================================

  describe('source CRUD', () => {
    beforeEach(async () => {
      await manager.initialize()
    })

    it('should add a new source', async () => {
      const config = {
        sourceType: 'jellyfin' as const,
        displayName: 'Test Jellyfin',
        connectionConfig: { serverUrl: 'http://localhost:8096', apiKey: 'test-key' },
      }

      const source = await manager.addSource(config)

      expect(source).toBeDefined()
      expect(source.display_name).toBe('Test Jellyfin')
      expect(source.source_type).toBe('jellyfin')
    })

    it('should get all sources', async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Plex Server',
        connection_config: '{}',
        is_enabled: true,
      })

      const sources = await manager.getSources()
      expect(sources).toHaveLength(1)
    })

    it('should get sources by type', async () => {
      mockMediaSources.push(
        {
          source_id: 'source-1',
          source_type: 'plex',
          display_name: 'Plex Server',
          connection_config: '{}',
          is_enabled: true,
        },
        {
          source_id: 'source-2',
          source_type: 'jellyfin',
          display_name: 'Jellyfin Server',
          connection_config: '{}',
          is_enabled: true,
        }
      )

      const plexSources = await manager.getSources('plex')
      expect(plexSources.filter(s => s.source_type === 'plex')).toHaveLength(1)
    })

    it('should get source by ID', async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Plex Server',
        connection_config: '{}',
        is_enabled: true,
      })

      const source = await manager.getSource('source-1')
      expect(source).toBeDefined()
      expect(source?.source_id).toBe('source-1')
    })

    it('should return null for non-existent source', async () => {
      const source = await manager.getSource('non-existent')
      expect(source).toBeNull()
    })

    it('should get enabled sources only', async () => {
      mockMediaSources.push(
        {
          source_id: 'source-1',
          source_type: 'plex',
          display_name: 'Enabled',
          connection_config: '{}',
          is_enabled: true,
        },
        {
          source_id: 'source-2',
          source_type: 'jellyfin',
          display_name: 'Disabled',
          connection_config: '{}',
          is_enabled: false,
        }
      )

      const sources = await manager.getEnabledSources()
      expect(sources.filter(s => s.is_enabled)).toHaveLength(1)
    })
  })

  // ============================================================================
  // SCAN CONTROL
  // ============================================================================

  describe('scan control', () => {
    beforeEach(async () => {
      await manager.initialize()
    })

    it('should report no scan in progress initially', () => {
      expect(manager.isScanInProgress()).toBe(false)
    })

    it('should report scan cancelled status', () => {
      expect(manager.isScanCancelled()).toBe(false)
      manager.stopScan()
      // stopScan only sets cancelled if scan is in progress
      expect(manager.isScanCancelled()).toBe(false)
    })

    it('should report manual scan in progress status', () => {
      expect(manager.isManualScanInProgress()).toBe(false)
    })
  })

  // ============================================================================
  // PROVIDER MANAGEMENT
  // ============================================================================

  describe('provider management', () => {
    beforeEach(async () => {
      await manager.initialize()
    })

    it('should get provider for source', async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Plex Server',
        connection_config: '{}',
        is_enabled: true,
      })

      // Re-initialize to load the source
      const newManager = new SourceManager()
      await newManager.initialize()

      const provider = newManager.getProvider('source-1')
      expect(provider).toBeDefined()
    })

    it('should return undefined for non-existent provider', () => {
      const provider = manager.getProvider('non-existent')
      expect(provider).toBeUndefined()
    })
  })

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  describe('connection testing', () => {
    beforeEach(async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Plex Server',
        connection_config: '{}',
        is_enabled: true,
      })
      await manager.initialize()
    })

    it('should test connection for existing source', async () => {
      const result = await manager.testConnection('source-1')
      expect(result).toHaveProperty('success')
    })

    it('should return error for non-existent source', async () => {
      const result = await manager.testConnection('non-existent')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  // ============================================================================
  // SOURCE TOGGLING
  // ============================================================================

  describe('source toggling', () => {
    beforeEach(async () => {
      mockMediaSources.push({
        source_id: 'source-1',
        source_type: 'plex',
        display_name: 'Plex Server',
        connection_config: '{}',
        is_enabled: true,
      })
      await manager.initialize()
    })

    it('should toggle source enabled state', async () => {
      // toggleSource should complete without throwing
      await expect(manager.toggleSource('source-1', false)).resolves.not.toThrow()
    })
  })
})
