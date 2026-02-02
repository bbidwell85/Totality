/**
 * Shared IPC Types
 *
 * Types shared between main process and preload for IPC communication.
 * Import using `import type` to ensure no runtime code is included.
 */

/**
 * Result of a connection test to a media server.
 * Used by all provider types (Plex, Jellyfin, Emby, Kodi).
 */
export interface ConnectionTestResult {
  success: boolean
  error?: string
  serverName?: string
  serverVersion?: string
  latencyMs?: number
}

/**
 * Generic success/error response for IPC operations.
 */
export interface IPCResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
