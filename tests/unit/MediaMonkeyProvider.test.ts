/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}))
vi.mock('fs', () => ({
  default: { readFileSync: vi.fn(), existsSync: vi.fn(() => true) },
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}))
vi.mock('sql.js', () => ({
  default: vi.fn(() => Promise.resolve({
    Database: vi.fn().mockImplementation(() => ({
      exec: vi.fn(() => []),
      close: vi.fn(),
    })),
  })),
}))
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
    upsertMusicArtist: vi.fn(() => 1),
    upsertMusicAlbum: vi.fn(() => 1),
    upsertMusicTrack: vi.fn(() => 1),
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    getLibraryScan: vi.fn(() => null),
    upsertLibraryScan: vi.fn(),
  })),
}))
vi.mock('../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))
vi.mock('../../src/main/providers/mediamonkey/MediaMonkeyDiscoveryService', () => ({
  MediaMonkeyDiscoveryService: vi.fn().mockImplementation(() => ({
    detectInstallations: vi.fn(() => []),
    validateDatabasePath: vi.fn(() => ({ valid: true, version: 5 })),
  })),
}))

import { MediaMonkeyProvider } from '@main/providers/mediamonkey/MediaMonkeyProvider'

describe('MediaMonkeyProvider', () => {
  let provider: MediaMonkeyProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new MediaMonkeyProvider({
      sourceId: 'mm-test',
      connectionConfig: {
        mediamonkeyDatabasePath: 'C:\\Users\\test\\AppData\\Roaming\\MediaMonkey5\\MM5.DB',
        mediamonkeyVersion: 5,
      },
    } as any)
  })

  describe('constructor', () => {
    it('sets sourceId', () => {
      expect(provider.sourceId).toBe('mm-test')
    })

    it('sets provider type to mediamonkey', () => {
      expect(provider.providerType).toBe('mediamonkey')
    })
  })

  describe('getLibraries', () => {
    it('returns a single Music library', async () => {
      const libraries = await provider.getLibraries()
      expect(libraries).toHaveLength(1)
      expect(libraries[0].name).toContain('Music')
      expect(libraries[0].type).toBe('music')
    })
  })

  describe('isAuthenticated', () => {
    it('returns false when no database path configured', async () => {
      const p = new MediaMonkeyProvider({
        sourceId: 'test',
        connectionConfig: {},
      } as any)
      const result = await p.isAuthenticated()
      expect(result).toBe(false)
    })
  })

  describe('disconnect', () => {
    it('succeeds without error', async () => {
      await expect(provider.disconnect()).resolves.not.toThrow()
    })
  })
})
