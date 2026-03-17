/**
 * IPC Handler Registration & Integration Tests
 *
 * Tests that IPC handlers are registered correctly, validate inputs,
 * and handle errors gracefully. Uses the mocked ipcMain from setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// Track registered handlers
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

// Override ipcMain.handle to capture registrations
vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
  handlers.set(channel, handler)
  return undefined as never
})

// Shared mock database — same instance returned every call
const sharedMockDb = {
  getMediaItems: vi.fn(() => []),
  countMediaItems: vi.fn(() => 0),
  getTVShows: vi.fn(() => []),
  countTVShows: vi.fn(() => 0),
  countTVEpisodes: vi.fn(() => 0),
  getMediaItemById: vi.fn(() => null),
  upsertMediaItem: vi.fn(() => 1),
  deleteMediaItem: vi.fn(),
  getMediaItemVersions: vi.fn(() => []),
  getQualityScores: vi.fn(() => []),
  getQualityScoreByMediaId: vi.fn(() => null),
  upsertQualityScore: vi.fn(() => 1),
  getSetting: vi.fn(() => null),
  setSetting: vi.fn(),
  getMediaSources: vi.fn(() => []),
  getAggregatedSourceStats: vi.fn(() => ({ totalSources: 0, enabledSources: 0, totalItems: 0, bySource: [] })),
  getLetterOffset: vi.fn(() => 0),
  getExclusions: vi.fn(() => []),
  addExclusion: vi.fn(() => 1),
  removeExclusion: vi.fn(),
  exportData: vi.fn(() => ({})),
  importData: vi.fn(() => ({ imported: 0, errors: [] })),
  resetDatabase: vi.fn(),
  getDbSize: vi.fn(() => 1024),
  getDbPath: vi.fn(() => '/mock/path/totality.db'),
}

// Mock all service dependencies
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => sharedMockDb),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    invalidateThresholdsCache: vi.fn(),
    getQualityDistribution: vi.fn(() => ({})),
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    refreshApiKey: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/GeminiService', () => ({
  getGeminiService: vi.fn(() => ({
    refreshApiKey: vi.fn(),
  })),
}))

vi.mock('../../src/main/providers/kodi/KodiDatabaseSchema', () => ({
  invalidateNfsMappingsCache: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(() => ({ size: 1024 })),
  },
}))

// Import AFTER mocks
const { registerDatabaseHandlers } = await import('../../src/main/ipc/database')

describe('IPC Handler Registration', () => {
  beforeEach(() => {
    handlers.clear()
    vi.mocked(ipcMain.handle).mockClear()
  })

  describe('registerDatabaseHandlers', () => {
    beforeEach(() => {
      registerDatabaseHandlers()
    })

    it('registers all expected database handlers', () => {
      const expectedHandlers = [
        'db:getMediaItems',
        'db:countMediaItems',
        'db:getTVShows',
        'db:countTVShows',
        'db:countTVEpisodes',
        'db:getMediaItemById',
        'db:upsertMediaItem',
        'db:deleteMediaItem',
        'db:getMediaItemVersions',
        'db:getQualityScores',
        'db:getQualityScoreByMediaId',
        'db:upsertQualityScore',
        'db:getSetting',
        'db:setSetting',
      ]

      for (const channel of expectedHandlers) {
        expect(handlers.has(channel), `Handler '${channel}' should be registered`).toBe(true)
      }
    })

    it('db:getMediaItemById rejects non-positive integer', async () => {
      const handler = handlers.get('db:getMediaItemById')!
      await expect(handler({} as never, -1)).rejects.toThrow('Validation failed')
      await expect(handler({} as never, 'abc')).rejects.toThrow('Validation failed')
      await expect(handler({} as never, 0)).rejects.toThrow('Validation failed')
    })

    it('db:getMediaItemById accepts valid id', async () => {
      const handler = handlers.get('db:getMediaItemById')!
      const result = await handler({} as never, 42)
      expect(result).toBeNull() // mock returns null
    })

    it('db:getSetting rejects empty key', async () => {
      const handler = handlers.get('db:getSetting')!
      await expect(handler({} as never, '')).rejects.toThrow('Validation failed')
    })

    it('db:getSetting accepts valid key', async () => {
      const handler = handlers.get('db:getSetting')!
      const result = await handler({} as never, 'tmdb_api_key')
      expect(result).toBeNull() // mock returns null
    })

    it('db:setSetting rejects key exceeding max length', async () => {
      const handler = handlers.get('db:setSetting')!
      const mockEvent = { sender: { id: 1 } } as never
      await expect(handler(mockEvent, 'a'.repeat(201), 'value')).rejects.toThrow('Validation failed')
    })

    it('db:deleteMediaItem rejects non-integer id', async () => {
      const handler = handlers.get('db:deleteMediaItem')!
      await expect(handler({} as never, 'not-a-number')).rejects.toThrow('Validation failed')
    })

    it('db:getMediaItems accepts undefined filters', async () => {
      const handler = handlers.get('db:getMediaItems')!
      const result = await handler({} as never, undefined)
      expect(Array.isArray(result)).toBe(true)
    })

    it('db:getTVShows rejects invalid sortBy', async () => {
      const handler = handlers.get('db:getTVShows')!
      await expect(handler({} as never, { sortBy: 'DROP TABLE' })).rejects.toThrow('Validation failed')
    })

    it('db:countMediaItems rejects invalid filter type', async () => {
      const handler = handlers.get('db:countMediaItems')!
      await expect(handler({} as never, { type: 'invalid' })).rejects.toThrow('Validation failed')
    })

    it('db:getLetterOffset validates required params', async () => {
      const handler = handlers.get('db:getLetterOffset')!
      await expect(handler({} as never, {})).rejects.toThrow('Validation failed')
    })
  })
})

describe('IPC Handler Error Handling', () => {
  beforeEach(() => {
    handlers.clear()
    vi.mocked(ipcMain.handle).mockClear()
    registerDatabaseHandlers()
  })

  it('handlers throw errors with context for invalid input', async () => {
    const handler = handlers.get('db:getMediaItemById')!
    try {
      await handler({} as never, 'invalid')
      expect.fail('should throw')
    } catch (error) {
      expect((error as Error).message).toContain('db:getMediaItemById')
    }
  })

  it('handlers propagate service errors', async () => {
    // Temporarily make the shared mock throw
    sharedMockDb.getMediaItemById.mockImplementationOnce(() => {
      throw new Error('Database connection lost')
    })

    const handler = handlers.get('db:getMediaItemById')!
    await expect(handler({} as never, 1)).rejects.toThrow('Database connection lost')
  })
})
