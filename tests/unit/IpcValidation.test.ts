/**
 * IPC Handler Validation Tests
 *
 * Tests that IPC boundary validation schemas correctly accept valid input
 * and reject invalid input. This covers the security-critical validation
 * layer between renderer and main process.
 */

import { describe, it, expect } from 'vitest'
import {
  validateInput,
  PositiveIntSchema,
  NonEmptyStringSchema,
  SettingKeySchema,
  SettingValueSchema,
  SourceIdSchema,
  LibraryIdSchema,
  FilePathSchema,
  SafeUrlSchema,
  BooleanSchema,
  ProviderTypeSchema,
  QualityTierSchema,
  TierQualitySchema,
  AddSourceSchema,
  UpdateSourceSchema,
  PlexAuthSchema,
  JellyfinApiKeyAuthSchema,
  JellyfinCredentialsAuthSchema,
  LocalFolderConfigSchema,
  LocalFolderWithLibrariesSchema,
  WishlistItemSchema,
  WishlistFiltersSchema,
  StoreRegionSchema,
  TVShowFiltersSchema,
  MusicFiltersSchema,
  TaskDefinitionSchema,
  AddExclusionSchema,
  MonitoringConfigSchema,
} from '../../src/main/validation/schemas'

describe('IPC Validation Schemas', () => {
  // ==========================================================================
  // PRIMITIVE SCHEMAS
  // ==========================================================================

  describe('PositiveIntSchema', () => {
    it('accepts positive integers', () => {
      expect(validateInput(PositiveIntSchema, 1, 'test')).toBe(1)
      expect(validateInput(PositiveIntSchema, 42, 'test')).toBe(42)
    })

    it('rejects zero', () => {
      expect(() => validateInput(PositiveIntSchema, 0, 'test')).toThrow('Validation failed')
    })

    it('rejects negative numbers', () => {
      expect(() => validateInput(PositiveIntSchema, -1, 'test')).toThrow('Validation failed')
    })

    it('rejects non-integers', () => {
      expect(() => validateInput(PositiveIntSchema, 1.5, 'test')).toThrow('Validation failed')
    })

    it('rejects strings', () => {
      expect(() => validateInput(PositiveIntSchema, '1', 'test')).toThrow('Validation failed')
    })

    it('rejects null/undefined', () => {
      expect(() => validateInput(PositiveIntSchema, null, 'test')).toThrow()
      expect(() => validateInput(PositiveIntSchema, undefined, 'test')).toThrow()
    })
  })

  describe('FilePathSchema', () => {
    it('accepts valid file paths', () => {
      expect(validateInput(FilePathSchema, '/home/user/file.mkv', 'test')).toBe('/home/user/file.mkv')
      expect(validateInput(FilePathSchema, 'C:\\Users\\test\\file.mp4', 'test')).toBe('C:\\Users\\test\\file.mp4')
    })

    it('rejects empty paths', () => {
      expect(() => validateInput(FilePathSchema, '', 'test')).toThrow('Validation failed')
    })

    it('rejects paths with null bytes', () => {
      expect(() => validateInput(FilePathSchema, '/path/to\0/file', 'test')).toThrow('null bytes')
    })

    it('rejects paths exceeding max length', () => {
      const longPath = '/' + 'a'.repeat(2001)
      expect(() => validateInput(FilePathSchema, longPath, 'test')).toThrow('Validation failed')
    })
  })

  describe('SafeUrlSchema', () => {
    it('accepts https URLs', () => {
      expect(validateInput(SafeUrlSchema, 'https://example.com', 'test')).toBe('https://example.com')
    })

    it('accepts http URLs', () => {
      expect(validateInput(SafeUrlSchema, 'http://192.168.1.1:8096', 'test')).toBe('http://192.168.1.1:8096')
    })

    it('rejects non-URL strings', () => {
      expect(() => validateInput(SafeUrlSchema, 'not a url', 'test')).toThrow()
    })

    it('rejects empty strings', () => {
      expect(() => validateInput(SafeUrlSchema, '', 'test')).toThrow()
    })
  })

  describe('SettingKeySchema', () => {
    it('accepts valid keys', () => {
      expect(validateInput(SettingKeySchema, 'tmdb_api_key', 'test')).toBe('tmdb_api_key')
    })

    it('rejects empty keys', () => {
      expect(() => validateInput(SettingKeySchema, '', 'test')).toThrow()
    })

    it('rejects keys exceeding max length', () => {
      expect(() => validateInput(SettingKeySchema, 'a'.repeat(201), 'test')).toThrow()
    })
  })

  describe('BooleanSchema', () => {
    it('accepts booleans', () => {
      expect(validateInput(BooleanSchema, true, 'test')).toBe(true)
      expect(validateInput(BooleanSchema, false, 'test')).toBe(false)
    })

    it('rejects strings', () => {
      expect(() => validateInput(BooleanSchema, 'true', 'test')).toThrow()
    })
  })

  // ==========================================================================
  // ENUM SCHEMAS
  // ==========================================================================

  describe('ProviderTypeSchema', () => {
    it('accepts all valid provider types', () => {
      for (const type of ['plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'kodi-mysql', 'local']) {
        expect(validateInput(ProviderTypeSchema, type, 'test')).toBe(type)
      }
    })

    it('rejects invalid provider types', () => {
      expect(() => validateInput(ProviderTypeSchema, 'invalid', 'test')).toThrow()
      expect(() => validateInput(ProviderTypeSchema, '', 'test')).toThrow()
    })
  })

  describe('QualityTierSchema', () => {
    it('accepts valid tiers', () => {
      for (const tier of ['SD', '720p', '1080p', '4K']) {
        expect(validateInput(QualityTierSchema, tier, 'test')).toBe(tier)
      }
    })
  })

  describe('TierQualitySchema', () => {
    it('accepts valid quality levels', () => {
      for (const q of ['LOW', 'MEDIUM', 'HIGH']) {
        expect(validateInput(TierQualitySchema, q, 'test')).toBe(q)
      }
    })
  })

  describe('StoreRegionSchema', () => {
    it('accepts valid regions', () => {
      expect(validateInput(StoreRegionSchema, 'us', 'test')).toBe('us')
      expect(validateInput(StoreRegionSchema, 'uk', 'test')).toBe('uk')
    })

    it('rejects invalid regions', () => {
      expect(() => validateInput(StoreRegionSchema, 'xx', 'test')).toThrow()
    })
  })

  // ==========================================================================
  // SOURCE SCHEMAS
  // ==========================================================================

  describe('AddSourceSchema', () => {
    it('accepts valid source config', () => {
      const config = {
        sourceType: 'plex',
        displayName: 'My Plex',
        connectionConfig: { token: 'abc123' },
      }
      const result = validateInput(AddSourceSchema, config, 'test')
      expect(result.sourceType).toBe('plex')
      expect(result.displayName).toBe('My Plex')
    })

    it('rejects missing sourceType', () => {
      expect(() => validateInput(AddSourceSchema, {
        displayName: 'Test',
        connectionConfig: {},
      }, 'test')).toThrow()
    })

    it('rejects empty displayName', () => {
      expect(() => validateInput(AddSourceSchema, {
        sourceType: 'plex',
        displayName: '',
        connectionConfig: {},
      }, 'test')).toThrow()
    })

    it('rejects displayName exceeding max length', () => {
      expect(() => validateInput(AddSourceSchema, {
        sourceType: 'plex',
        displayName: 'a'.repeat(101),
        connectionConfig: {},
      }, 'test')).toThrow()
    })

    it('trims whitespace from displayName', () => {
      const result = validateInput(AddSourceSchema, {
        sourceType: 'plex',
        displayName: '  My Server  ',
        connectionConfig: {},
      }, 'test')
      expect(result.displayName).toBe('My Server')
    })

    it('defaults isEnabled to true', () => {
      const result = validateInput(AddSourceSchema, {
        sourceType: 'plex',
        displayName: 'Test',
        connectionConfig: {},
      }, 'test')
      expect(result.isEnabled).toBe(true)
    })
  })

  describe('UpdateSourceSchema', () => {
    it('accepts partial updates', () => {
      const result = validateInput(UpdateSourceSchema, { displayName: 'New Name' }, 'test')
      expect(result.displayName).toBe('New Name')
    })

    it('accepts empty object (no updates)', () => {
      const result = validateInput(UpdateSourceSchema, {}, 'test')
      expect(result).toEqual({})
    })
  })

  // ==========================================================================
  // AUTH SCHEMAS
  // ==========================================================================

  describe('PlexAuthSchema', () => {
    it('accepts valid Plex auth', () => {
      const result = validateInput(PlexAuthSchema, {
        token: 'my-plex-token',
        displayName: 'Plex Server',
      }, 'test')
      expect(result.token).toBe('my-plex-token')
    })

    it('rejects empty token', () => {
      expect(() => validateInput(PlexAuthSchema, {
        token: '',
        displayName: 'Test',
      }, 'test')).toThrow()
    })
  })

  describe('JellyfinApiKeyAuthSchema', () => {
    it('accepts valid Jellyfin auth', () => {
      const result = validateInput(JellyfinApiKeyAuthSchema, {
        serverUrl: 'http://192.168.1.100:8096',
        apiKey: 'my-api-key',
        displayName: 'Jellyfin',
      }, 'test')
      expect(result.serverUrl).toBe('http://192.168.1.100:8096')
    })

    it('rejects invalid server URL', () => {
      expect(() => validateInput(JellyfinApiKeyAuthSchema, {
        serverUrl: 'not-a-url',
        apiKey: 'key',
        displayName: 'Test',
      }, 'test')).toThrow()
    })

    it('rejects empty API key', () => {
      expect(() => validateInput(JellyfinApiKeyAuthSchema, {
        serverUrl: 'http://localhost:8096',
        apiKey: '',
        displayName: 'Test',
      }, 'test')).toThrow()
    })
  })

  describe('JellyfinCredentialsAuthSchema', () => {
    it('accepts valid credentials', () => {
      const result = validateInput(JellyfinCredentialsAuthSchema, {
        serverUrl: 'http://localhost:8096',
        username: 'admin',
        password: 'pass',
        displayName: 'Jellyfin',
      }, 'test')
      expect(result.username).toBe('admin')
      expect(result.isEmby).toBe(false)
    })
  })

  // ==========================================================================
  // LOCAL FOLDER SCHEMAS
  // ==========================================================================

  describe('LocalFolderConfigSchema', () => {
    it('accepts valid config', () => {
      const result = validateInput(LocalFolderConfigSchema, {
        folderPath: '/media/movies',
        displayName: 'Movies',
        mediaType: 'movies',
      }, 'test')
      expect(result.folderPath).toBe('/media/movies')
    })

    it('rejects paths with null bytes', () => {
      expect(() => validateInput(LocalFolderConfigSchema, {
        folderPath: '/media/\0/evil',
        displayName: 'Test',
        mediaType: 'movies',
      }, 'test')).toThrow('null bytes')
    })

    it('rejects invalid media types', () => {
      expect(() => validateInput(LocalFolderConfigSchema, {
        folderPath: '/media',
        displayName: 'Test',
        mediaType: 'invalid',
      }, 'test')).toThrow()
    })
  })

  describe('LocalFolderWithLibrariesSchema', () => {
    it('accepts valid config with libraries', () => {
      const result = validateInput(LocalFolderWithLibrariesSchema, {
        folderPath: '/media',
        displayName: 'Media',
        libraries: [{
          name: 'Movies',
          path: '/media/movies',
          mediaType: 'movies',
          enabled: true,
        }],
      }, 'test')
      expect(result.libraries).toHaveLength(1)
    })

    it('rejects libraries with null byte paths', () => {
      expect(() => validateInput(LocalFolderWithLibrariesSchema, {
        folderPath: '/media',
        displayName: 'Test',
        libraries: [{
          name: 'Evil',
          path: '/media/\0/evil',
          mediaType: 'movies',
          enabled: true,
        }],
      }, 'test')).toThrow('null bytes')
    })

    it('rejects too many libraries', () => {
      const libraries = Array(51).fill({
        name: 'Lib',
        path: '/media/lib',
        mediaType: 'movies',
        enabled: true,
      })
      expect(() => validateInput(LocalFolderWithLibrariesSchema, {
        folderPath: '/media',
        displayName: 'Test',
        libraries,
      }, 'test')).toThrow()
    })
  })

  // ==========================================================================
  // FILTER SCHEMAS
  // ==========================================================================

  describe('TVShowFiltersSchema', () => {
    it('accepts valid filters', () => {
      const result = validateInput(TVShowFiltersSchema, {
        searchQuery: 'breaking',
        sortBy: 'title',
        sortOrder: 'asc',
        limit: 20,
      }, 'test')
      expect(result?.searchQuery).toBe('breaking')
    })

    it('accepts undefined (optional schema)', () => {
      const result = validateInput(TVShowFiltersSchema, undefined, 'test')
      expect(result).toBeUndefined()
    })

    it('rejects invalid sortBy', () => {
      expect(() => validateInput(TVShowFiltersSchema, {
        sortBy: 'invalid_column',
      }, 'test')).toThrow()
    })

    it('rejects negative limit', () => {
      expect(() => validateInput(TVShowFiltersSchema, {
        limit: -1,
      }, 'test')).toThrow()
    })

    it('rejects limit exceeding max', () => {
      expect(() => validateInput(TVShowFiltersSchema, {
        limit: 10001,
      }, 'test')).toThrow()
    })
  })

  describe('MusicFiltersSchema', () => {
    it('accepts valid music filters', () => {
      const result = validateInput(MusicFiltersSchema, {
        qualityTier: 'LOSSLESS',
        sortBy: 'artist',
        limit: 50,
      }, 'test')
      expect(result?.qualityTier).toBe('LOSSLESS')
    })
  })

  describe('WishlistFiltersSchema', () => {
    it('accepts valid filters', () => {
      const result = validateInput(WishlistFiltersSchema, {
        status: 'active',
        priority: 3,
        reason: 'missing',
      }, 'test')
      expect(result?.status).toBe('active')
    })

    it('rejects invalid priority', () => {
      expect(() => validateInput(WishlistFiltersSchema, {
        priority: 6,
      }, 'test')).toThrow()
    })
  })

  // ==========================================================================
  // COMPLEX OBJECT SCHEMAS
  // ==========================================================================

  describe('TaskDefinitionSchema', () => {
    it('accepts valid task', () => {
      const result = validateInput(TaskDefinitionSchema, {
        type: 'library-scan',
        label: 'Scan Movies',
        sourceId: 'plex_123',
        libraryId: 'lib_1',
      }, 'test')
      expect(result.type).toBe('library-scan')
    })

    it('rejects invalid task type', () => {
      expect(() => validateInput(TaskDefinitionSchema, {
        type: 'invalid-type',
        label: 'Test',
      }, 'test')).toThrow()
    })

    it('rejects empty label', () => {
      expect(() => validateInput(TaskDefinitionSchema, {
        type: 'library-scan',
        label: '',
      }, 'test')).toThrow()
    })
  })

  describe('AddExclusionSchema', () => {
    it('accepts valid exclusion', () => {
      const result = validateInput(AddExclusionSchema, {
        exclusionType: 'series',
        referenceId: 42,
        title: 'Some Show',
      }, 'test')
      expect(result.exclusionType).toBe('series')
    })

    it('rejects empty exclusionType', () => {
      expect(() => validateInput(AddExclusionSchema, {
        exclusionType: '',
      }, 'test')).toThrow()
    })
  })

  describe('MonitoringConfigSchema', () => {
    it('accepts valid config', () => {
      const result = validateInput(MonitoringConfigSchema, {
        enabled: true,
        startOnLaunch: false,
      }, 'test')
      expect(result.enabled).toBe(true)
    })

    it('accepts empty config', () => {
      const result = validateInput(MonitoringConfigSchema, {}, 'test')
      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // ERROR MESSAGE FORMAT
  // ==========================================================================

  describe('validateInput error formatting', () => {
    it('includes context in error message', () => {
      try {
        validateInput(PositiveIntSchema, 'not a number', 'db:getMediaItemById')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).toContain('[db:getMediaItemById]')
        expect((error as Error).message).toContain('Validation failed')
      }
    })

    it('works without context', () => {
      try {
        validateInput(PositiveIntSchema, 'bad')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).toContain('Validation failed')
      }
    })
  })
})
