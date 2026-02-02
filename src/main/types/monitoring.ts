/**
 * Types for Live Monitoring and Notification System
 */

export type ProviderType = 'plex' | 'jellyfin' | 'emby' | 'kodi' | 'kodi-local' | 'local'

// =============================================================================
// Monitoring Configuration
// =============================================================================

export interface MonitoringConfig {
  enabled: boolean
  startOnLaunch: boolean
  pauseDuringManualScan: boolean
  pollingIntervals: Record<ProviderType, number>
}

export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  enabled: false,
  startOnLaunch: true,
  pauseDuringManualScan: true,
  pollingIntervals: {
    plex: 300000,      // 5 minutes - remote server
    jellyfin: 300000,  // 5 minutes - remote server
    emby: 300000,      // 5 minutes - remote server
    kodi: 300000,      // 5 minutes - remote server
    'kodi-local': 60000, // 1 minute - local database
    local: 60000,      // 1 minute - local folder
  },
}

// =============================================================================
// Source Change Events
// =============================================================================

export interface ChangedItem {
  id: string
  title: string
  type: 'movie' | 'episode' | 'album' | 'track' | 'artist'
  year?: number
  posterUrl?: string
  seriesTitle?: string
  artistName?: string
}

export interface SourceChangeEvent {
  sourceId: string
  sourceName: string
  sourceType: ProviderType
  libraryId: string
  libraryName: string
  changeType: 'added' | 'updated' | 'removed' | 'mixed'
  itemCount: number
  items: ChangedItem[]
  detectedAt: string
}

// =============================================================================
// Notifications
// =============================================================================

export type NotificationType =
  | 'source_change'
  | 'scan_complete'
  | 'error'
  | 'info'

export interface Notification {
  id?: number
  type: NotificationType
  title: string
  message: string
  sourceId?: string
  sourceName?: string
  itemCount?: number
  metadata?: Record<string, unknown>
  isRead: boolean
  createdAt: string
  readAt?: string
}

export interface NotificationBatch {
  notifications: Notification[]
  totalCount: number
  isSummary: boolean
  summaryMessage?: string
}

export interface NotificationConfig {
  batchWindowMs: number
  maxIndividualNotifications: number
  maxStoredNotifications: number
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  batchWindowMs: 45000,           // 45 seconds
  maxIndividualNotifications: 10, // Summarize if more than 10
  maxStoredNotifications: 100,    // Max notifications in database
}

// =============================================================================
// Database Row Types
// =============================================================================

export interface NotificationRow {
  id: number
  type: NotificationType
  title: string
  message: string
  source_id: string | null
  source_name: string | null
  item_count: number
  metadata: string // JSON string
  is_read: number // 0 or 1
  created_at: string
  read_at: string | null
}

// =============================================================================
// IPC Types
// =============================================================================

export interface NotificationCountResult {
  total: number
  unread: number
}

export interface GetNotificationsOptions {
  limit?: number
  offset?: number
  type?: NotificationType
  unreadOnly?: boolean
}
