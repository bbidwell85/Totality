/**
 * JellyfinProvider
 *
 * Implements the MediaProvider interface for Jellyfin Media Server.
 * Extends JellyfinEmbyBase since Jellyfin forked from Emby and shares a similar API.
 */

import { JellyfinEmbyBase } from './JellyfinEmbyBase'
import type { SourceConfig } from '../base/MediaProvider'

export class JellyfinProvider extends JellyfinEmbyBase {
  readonly providerType = 'jellyfin' as const
  // Jellyfin uses standard Authorization header (X-Emby-Authorization is for Emby)
  protected authHeaderName = 'Authorization'
  protected clientName = 'Totality'
  protected clientVersion = '1.0.0'

  constructor(config: SourceConfig) {
    super(config)
  }
}
