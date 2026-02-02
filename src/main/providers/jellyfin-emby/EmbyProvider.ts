/**
 * EmbyProvider
 *
 * Implements the MediaProvider interface for Emby Media Server.
 * Extends JellyfinEmbyBase since Jellyfin forked from Emby and shares a similar API.
 *
 * Note: The main differences from Jellyfin are:
 * - Different auth header format in some cases
 * - Emby Connect support for remote server discovery
 * - Some API response format differences in newer versions
 */

import { JellyfinEmbyBase } from './JellyfinEmbyBase'
import type { SourceConfig } from '../base/MediaProvider'

export class EmbyProvider extends JellyfinEmbyBase {
  readonly providerType = 'emby' as const
  protected authHeaderName = 'X-Emby-Authorization'
  protected clientName = 'Totality'
  protected clientVersion = '1.0.0'

  constructor(config: SourceConfig) {
    super(config)
  }

  // Override auth header for Emby-specific format if needed
  protected buildAuthHeader(): string {
    const parts = [
      `Emby Client="${this.clientName}"`,
      `Device="Totality"`,
      `DeviceId="${this.sourceId}"`,
      `Version="${this.clientVersion}"`,
    ]

    if (this.accessToken) {
      parts.push(`Token="${this.accessToken}"`)
    }

    return parts.join(', ')
  }
}
