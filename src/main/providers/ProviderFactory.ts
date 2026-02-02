/**
 * ProviderFactory
 *
 * Factory for creating MediaProvider instances based on provider type.
 */

import type { MediaProvider, ProviderType, SourceConfig } from './base/MediaProvider'
import { PlexProvider } from './plex/PlexProvider'
import { JellyfinProvider } from './jellyfin-emby/JellyfinProvider'
import { EmbyProvider } from './jellyfin-emby/EmbyProvider'
import { KodiProvider } from './kodi/KodiProvider'
import { KodiLocalProvider } from './kodi/KodiLocalProvider'
import { KodiMySQLProvider } from './kodi/KodiMySQLProvider'
import { LocalFolderProvider } from './local/LocalFolderProvider'

/**
 * Create a MediaProvider instance based on the provider type
 */
export function createProvider(type: ProviderType, config: SourceConfig): MediaProvider {
  switch (type) {
    case 'plex':
      return new PlexProvider(config)

    case 'jellyfin':
      return new JellyfinProvider(config)

    case 'emby':
      return new EmbyProvider(config)

    case 'kodi':
      return new KodiProvider(config)

    case 'kodi-local':
      return new KodiLocalProvider(config)

    case 'kodi-mysql':
      return new KodiMySQLProvider(config)

    case 'local':
      return new LocalFolderProvider(config)

    default:
      throw new Error(`Unknown provider type: ${type}`)
  }
}

/**
 * Check if a provider type is supported
 */
export function isProviderSupported(type: ProviderType): boolean {
  const supportedProviders: ProviderType[] = ['plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'kodi-mysql', 'local']
  return supportedProviders.includes(type)
}

/**
 * Get list of all supported provider types
 */
export function getSupportedProviders(): ProviderType[] {
  return ['plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'kodi-mysql', 'local']
}

/**
 * Get display name for a provider type
 */
export function getProviderDisplayName(type: ProviderType): string {
  const names: Record<ProviderType, string> = {
    plex: 'Plex',
    jellyfin: 'Jellyfin',
    emby: 'Emby',
    kodi: 'Kodi',
    'kodi-local': 'Kodi (Local)',
    'kodi-mysql': 'Kodi (MySQL)',
    local: 'Local Folder',
  }
  return names[type] || type
}

/**
 * Get icon name for a provider type (for UI)
 */
export function getProviderIcon(type: ProviderType): string {
  const icons: Record<ProviderType, string> = {
    plex: 'plex',
    jellyfin: 'jellyfin',
    emby: 'emby',
    kodi: 'kodi',
    'kodi-local': 'kodi',
    'kodi-mysql': 'kodi',
    local: 'folder',
  }
  return icons[type] || 'server'
}

export { PlexProvider }
