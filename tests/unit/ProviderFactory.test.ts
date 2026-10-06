/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'

// Mock all provider constructors with proper class stubs
function makeStub(type: string) {
  return class { providerType = type }
}

vi.mock('../../src/main/providers/plex/PlexProvider', () => ({
  PlexProvider: makeStub('plex'),
}))
vi.mock('../../src/main/providers/jellyfin-emby/JellyfinProvider', () => ({
  JellyfinProvider: makeStub('jellyfin'),
}))
vi.mock('../../src/main/providers/jellyfin-emby/EmbyProvider', () => ({
  EmbyProvider: makeStub('emby'),
}))
vi.mock('../../src/main/providers/kodi/KodiProvider', () => ({
  KodiProvider: makeStub('kodi'),
}))
vi.mock('../../src/main/providers/kodi/KodiLocalProvider', () => ({
  KodiLocalProvider: makeStub('kodi-local'),
}))
vi.mock('../../src/main/providers/kodi/KodiMySQLProvider', () => ({
  KodiMySQLProvider: makeStub('kodi-mysql'),
}))
vi.mock('../../src/main/providers/local/LocalFolderProvider', () => ({
  LocalFolderProvider: makeStub('local'),
  isExtrasContent: vi.fn(),
}))
vi.mock('../../src/main/providers/mediamonkey/MediaMonkeyProvider', () => ({
  MediaMonkeyProvider: makeStub('mediamonkey'),
}))

import {
  createProvider,
  isProviderSupported,
  getSupportedProviders,
  getProviderDisplayName,
  getProviderIcon,
} from '@main/providers/ProviderFactory'

const mockConfig = { sourceId: 'test-1', connectionConfig: {} } as any

describe('ProviderFactory', () => {
  describe('isProviderSupported', () => {
    it.each([
      'plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'kodi-mysql', 'local', 'mediamonkey',
    ] as const)('returns true for %s', (type) => {
      expect(isProviderSupported(type)).toBe(true)
    })

    it('returns false for unknown type', () => {
      expect(isProviderSupported('invalid' as any)).toBe(false)
    })
  })

  describe('getSupportedProviders', () => {
    it('returns all 8 provider types', () => {
      const providers = getSupportedProviders()
      expect(providers).toHaveLength(8)
      expect(providers).toContain('plex')
      expect(providers).toContain('mediamonkey')
    })
  })

  describe('getProviderDisplayName', () => {
    it('maps known types to display names', () => {
      expect(getProviderDisplayName('plex')).toBe('Plex')
      expect(getProviderDisplayName('jellyfin')).toBe('Jellyfin')
      expect(getProviderDisplayName('kodi-local')).toBe('Kodi (Local)')
      expect(getProviderDisplayName('kodi-mysql')).toBe('Kodi (MySQL)')
      expect(getProviderDisplayName('local')).toBe('Local Folder')
      expect(getProviderDisplayName('mediamonkey')).toBe('MediaMonkey')
    })

    it('returns type string for unknown type', () => {
      expect(getProviderDisplayName('unknown' as any)).toBe('unknown')
    })
  })

  describe('getProviderIcon', () => {
    it('maps known types to icon names', () => {
      expect(getProviderIcon('plex')).toBe('plex')
      expect(getProviderIcon('kodi-local')).toBe('kodi')
      expect(getProviderIcon('local')).toBe('folder')
      expect(getProviderIcon('mediamonkey')).toBe('music')
    })

    it('returns server for unknown type', () => {
      expect(getProviderIcon('unknown' as any)).toBe('server')
    })
  })

  describe('createProvider', () => {
    it.each([
      ['plex', 'plex'],
      ['jellyfin', 'jellyfin'],
      ['emby', 'emby'],
      ['kodi', 'kodi'],
      ['kodi-local', 'kodi-local'],
      ['kodi-mysql', 'kodi-mysql'],
      ['local', 'local'],
      ['mediamonkey', 'mediamonkey'],
    ] as const)('creates %s provider', (type, expectedType) => {
      const provider = createProvider(type, mockConfig)
      expect(provider.providerType).toBe(expectedType)
    })

    it('throws for unknown type', () => {
      expect(() => createProvider('invalid' as any, mockConfig)).toThrow('Unknown provider type')
    })
  })
})
