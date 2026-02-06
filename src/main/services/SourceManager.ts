/**
 * SourceManager Service
 *
 * Central service for managing media sources (Plex, Jellyfin, Emby, Kodi).
 * Handles source CRUD operations, provider lifecycle, and aggregated scanning.
 */

import { getDatabase } from '../database/getDatabase'
import { getPlexService } from './PlexService'
import { getLiveMonitoringService } from './LiveMonitoringService'
import { getTaskQueueService } from './TaskQueueService'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import { createProvider, getSupportedProviders } from '../providers/ProviderFactory'
import { PlexProvider } from '../providers/plex/PlexProvider'
import type {
  MediaProvider,
  ProviderType,
  SourceConfig,
  ConnectionTestResult,
  ScanResult,
  ProgressCallback,
  ServerInstance,
  MediaLibrary,
} from '../providers/base/MediaProvider'
import type { MediaSource } from '../types/database'

// Progress callback that includes source information
export type AggregateProgressCallback = (
  sourceId: string,
  sourceName: string,
  progress: {
    current: number
    total: number
    phase: 'fetching' | 'processing' | 'analyzing' | 'saving'
    currentItem?: string
    percentage: number
  }
) => void

export class SourceManager {
  private providers: Map<string, MediaProvider> = new Map()
  private initPromise: Promise<void> | null = null
  private scanCancelled: boolean = false
  private isScanning: boolean = false

  constructor() {
    // Initialize will be called explicitly
  }

  /**
   * Check if a scan is currently in progress
   */
  isScanInProgress(): boolean {
    return this.isScanning
  }

  /**
   * Check if a manual scan is in progress
   * Used by LiveMonitoringService to pause during manual scans
   */
  isManualScanInProgress(): boolean {
    return this.isScanning
  }

  /**
   * Check if scan has been cancelled
   */
  isScanCancelled(): boolean {
    return this.scanCancelled
  }

  /**
   * Stop the current scan
   */
  stopScan(): void {
    if (this.isScanning) {
      console.log('[SourceManager] Stopping scan...')
      this.scanCancelled = true
    }
  }

  /**
   * Initialize the source manager - loads all sources from database
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadSources()
    }
    return this.initPromise
  }

  private async loadSources(): Promise<void> {
    const db = getDatabase()
    const sources = db.getMediaSources()

    for (const source of sources) {
      try {
        const connectionConfig = JSON.parse(source.connection_config)
        const config: SourceConfig = {
          sourceId: source.source_id,
          sourceType: source.source_type,
          displayName: source.display_name,
          connectionConfig,
          isEnabled: source.is_enabled,
        }

        const provider = createProvider(source.source_type, config)
        this.providers.set(source.source_id, provider)

        // For Plex providers with saved serverId, restore server selection
        if (source.source_type === 'plex' && connectionConfig.serverId && connectionConfig.token) {
          const plexProvider = provider as PlexProvider
          try {
            // Set token first (should be set in constructor, but ensure it's set)
            if (!await plexProvider.isAuthenticated()) {
              plexProvider.setAuthToken(connectionConfig.token)
            }
            // Restore server selection
            const success = await plexProvider.selectServer(connectionConfig.serverId)
            if (success) {
              const server = plexProvider.getSelectedServer()
              // Update display name to actual server name if it differs
              if (server && server.name && server.name !== source.display_name) {
                await db.upsertMediaSource({
                  ...source,
                  display_name: server.name,
                })
                console.log(`[SourceManager] Restored server selection: ${server.name}`)
              } else {
                console.log(`[SourceManager] Restored server selection for ${source.display_name}`)
              }

              // Sync legacy PlexService for backward compatibility (MovieCollectionService uses it)
              try {
                const plexService = getPlexService()
                // Authenticate PlexService with the token from connection config
                await plexService.authenticateWithToken(connectionConfig.token)
                await plexService.selectServer(connectionConfig.serverId)
                console.log(`[SourceManager] Synced legacy PlexService with server: ${source.display_name}`)
              } catch (syncError) {
                console.warn(`[SourceManager] Could not sync legacy PlexService:`, syncError)
              }
            } else {
              console.warn(`[SourceManager] Failed to restore server selection for ${source.display_name}`)
            }
          } catch (error) {
            console.warn(`[SourceManager] Could not restore server for ${source.display_name}:`, error)
          }
        }

        console.log(`[SourceManager] Loaded provider: ${source.display_name} (${source.source_type})`)
      } catch (error) {
        console.error(`[SourceManager] Failed to load provider ${source.source_id}:`, error)
      }
    }

    console.log(`[SourceManager] Initialized with ${this.providers.size} providers`)
  }

  // ============================================================================
  // SOURCE CRUD
  // ============================================================================

  /**
   * Add a new media source
   */
  async addSource(config: SourceConfig): Promise<MediaSource> {
    await this.initialize()

    const db = getDatabase()
    const sourceId = config.sourceId || this.generateSourceId(config.sourceType)

    // Create the provider instance
    const provider = createProvider(config.sourceType, {
      ...config,
      sourceId,
    })

    // Store in database
    const sourceRecord: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'> = {
      source_id: sourceId,
      source_type: config.sourceType,
      display_name: config.displayName,
      connection_config: JSON.stringify(config.connectionConfig),
      is_enabled: config.isEnabled !== false,
    }

    await db.upsertMediaSource(sourceRecord)

    // Add to active providers
    this.providers.set(sourceId, provider)

    // Return the full source record
    const source = db.getMediaSourceById(sourceId)
    if (!source) {
      throw new Error('Failed to retrieve created source')
    }

    console.log(`[SourceManager] Added source: ${config.displayName} (${sourceId})`)
    return source
  }

  /**
   * Update an existing media source
   */
  async updateSource(sourceId: string, updates: Partial<SourceConfig>): Promise<void> {
    await this.initialize()

    const db = getDatabase()
    const existing = db.getMediaSourceById(sourceId)

    if (!existing) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    const updatedSource: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'> = {
      source_id: sourceId,
      source_type: updates.sourceType || existing.source_type,
      display_name: updates.displayName || existing.display_name,
      connection_config: updates.connectionConfig
        ? JSON.stringify(updates.connectionConfig)
        : existing.connection_config,
      is_enabled: updates.isEnabled !== undefined ? updates.isEnabled : existing.is_enabled,
    }

    await db.upsertMediaSource(updatedSource)

    // If connection config changed, recreate provider
    if (updates.connectionConfig) {
      const config: SourceConfig = {
        sourceId,
        sourceType: updatedSource.source_type,
        displayName: updatedSource.display_name,
        connectionConfig: updates.connectionConfig,
        isEnabled: updatedSource.is_enabled,
      }
      const provider = createProvider(updatedSource.source_type, config)
      this.providers.set(sourceId, provider)
    }

    console.log(`[SourceManager] Updated source: ${sourceId}`)
  }

  /**
   * Remove a media source and all its data
   */
  async removeSource(sourceId: string): Promise<void> {
    await this.initialize()

    const db = getDatabase()

    // 1. Stop live monitoring for this source
    getLiveMonitoringService().removeSource(sourceId)

    // 2. Cancel and remove any queued tasks for this source
    getTaskQueueService().removeTasksForSource(sourceId)

    // 3. Remove from providers map
    this.providers.delete(sourceId)

    // 4. Remove from database (includes notifications cleanup)
    await db.deleteMediaSource(sourceId)

    // 5. Clean up cached artwork files
    await this.cleanupArtworkCache(sourceId)

    console.log(`[SourceManager] Removed source: ${sourceId}`)
  }

  /**
   * Clean up cached artwork files for a deleted source
   */
  private async cleanupArtworkCache(sourceId: string): Promise<void> {
    const artworkPath = path.join(app.getPath('userData'), 'artwork', sourceId)
    try {
      await fs.rm(artworkPath, { recursive: true, force: true })
      console.log(`[SourceManager] Cleaned up artwork cache for ${sourceId}`)
    } catch (error) {
      // Ignore if folder doesn't exist or other errors
      console.log(`[SourceManager] No artwork cache to clean up for ${sourceId}`)
    }
  }

  /**
   * Get all configured sources
   */
  async getSources(type?: ProviderType): Promise<MediaSource[]> {
    await this.initialize()

    const db = getDatabase()
    return db.getMediaSources(type)
  }

  /**
   * Get a specific source by ID
   */
  async getSource(sourceId: string): Promise<MediaSource | null> {
    await this.initialize()

    const db = getDatabase()
    return db.getMediaSourceById(sourceId)
  }

  /**
   * Get enabled sources only
   */
  async getEnabledSources(): Promise<MediaSource[]> {
    await this.initialize()

    const db = getDatabase()
    return db.getEnabledMediaSources()
  }

  /**
   * Toggle source enabled status
   */
  async toggleSource(sourceId: string, enabled: boolean): Promise<void> {
    await this.initialize()

    const db = getDatabase()
    await db.toggleMediaSource(sourceId, enabled)
  }

  // ============================================================================
  // PROVIDER MANAGEMENT
  // ============================================================================

  /**
   * Get a provider instance by source ID
   */
  getProvider(sourceId: string): MediaProvider | undefined {
    return this.providers.get(sourceId)
  }

  /**
   * Get Plex provider (typed version)
   */
  getPlexProvider(sourceId: string): PlexProvider | undefined {
    const provider = this.providers.get(sourceId)
    if (provider?.providerType === 'plex') {
      return provider as PlexProvider
    }
    return undefined
  }

  /**
   * Test connection for a source
   */
  async testConnection(sourceId: string): Promise<ConnectionTestResult> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      return {
        success: false,
        error: `Source not found: ${sourceId}`,
      }
    }

    // For Plex sources, check if a server is selected before testing connection
    if (provider.providerType === 'plex') {
      const plexProvider = provider as PlexProvider
      if (!plexProvider.hasSelectedServer()) {
        return {
          success: false,
          error: 'No server selected - please complete setup',
        }
      }
    }

    const db = getDatabase()

    // For Jellyfin/Emby: authenticate with username/password if no accessToken
    if (provider.providerType === 'jellyfin' || provider.providerType === 'emby') {
      const source = db.getMediaSourceById(sourceId)
      if (source) {
        try {
          const config = JSON.parse(source.connection_config)

          // If we have username/password but no accessToken, authenticate first
          if (config.username && config.password && !config.accessToken) {
            console.log(`[SourceManager] Authenticating ${provider.providerType} with username/password`)

            const authResult = await provider.authenticate({
              serverUrl: config.serverUrl,
              username: config.username,
              password: config.password,
            })

            if (authResult.success && authResult.token) {
              // Save the token back to the database
              const updatedConfig = {
                ...config,
                accessToken: authResult.token,
                userId: authResult.userId,
                // Remove password from stored config for security
                password: undefined,
              }

              await db.upsertMediaSource({
                source_id: sourceId,
                source_type: source.source_type,
                display_name: source.display_name,
                connection_config: JSON.stringify(updatedConfig),
                is_enabled: source.is_enabled,
              })

              // Recreate the provider with the new credentials
              const newConfig: SourceConfig = {
                sourceId,
                sourceType: source.source_type as ProviderType,
                displayName: source.display_name,
                connectionConfig: updatedConfig,
                isEnabled: source.is_enabled,
              }
              const newProvider = createProvider(source.source_type, newConfig)
              this.providers.set(sourceId, newProvider)

              console.log(`[SourceManager] ${provider.providerType} authenticated and credentials saved`)
            } else {
              return {
                success: false,
                error: authResult.error || 'Authentication failed',
              }
            }
          }
        } catch (err: any) {
          console.error(`[SourceManager] Error during ${provider.providerType} authentication:`, err)
          return {
            success: false,
            error: err.message || 'Authentication error',
          }
        }
      }
    }

    // Get the (possibly updated) provider
    const currentProvider = this.providers.get(sourceId) || provider
    const result = await currentProvider.testConnection()

    // Update connection timestamp if successful
    if (result.success) {
      await db.updateSourceConnectionTime(sourceId)
    }

    return result
  }

  // ============================================================================
  // PLEX-SPECIFIC AUTHENTICATION
  // ============================================================================

  /**
   * Start Plex OAuth flow
   */
  async plexStartAuth(): Promise<{ pinId: number; code: string; authUrl: string }> {
    // Create a temporary provider for auth
    const tempProvider = new PlexProvider({
      sourceId: 'temp-auth',
      sourceType: 'plex',
      displayName: 'Temp Auth',
      connectionConfig: {},
    })

    const pin = await tempProvider.requestAuthPin()
    const authUrl = tempProvider.getAuthUrl(pin.id, pin.code)

    return {
      pinId: pin.id,
      code: pin.code,
      authUrl,
    }
  }

  /**
   * Complete Plex OAuth flow
   */
  async plexCompleteAuth(pinId: number): Promise<string | null> {
    const tempProvider = new PlexProvider({
      sourceId: 'temp-auth',
      sourceType: 'plex',
      displayName: 'Temp Auth',
      connectionConfig: {},
    })

    return tempProvider.checkAuthPin(pinId)
  }

  /**
   * Authenticate with Plex token and get servers
   */
  async plexAuthenticateAndDiscover(
    token: string,
    displayName: string
  ): Promise<{ source: MediaSource; servers: ServerInstance[] }> {
    // Create provider with token
    const config: SourceConfig = {
      sourceType: 'plex',
      displayName,
      connectionConfig: { token },
    }

    const provider = new PlexProvider(config) as PlexProvider
    const authResult = await provider.authenticate({ token })

    if (!authResult.success) {
      throw new Error(authResult.error || 'Authentication failed')
    }

    // Discover servers
    const servers = await provider.discoverServers()

    // Add the source
    const source = await this.addSource({
      ...config,
      sourceId: provider.sourceId,
      connectionConfig: { token },
    })

    // Update provider in map
    this.providers.set(source.source_id, provider)

    return { source, servers }
  }

  /**
   * Select a Plex server for a source
   */
  async plexSelectServer(
    sourceId: string,
    serverId: string
  ): Promise<{ success: boolean; libraries?: MediaLibrary[] }> {
    const provider = this.getPlexProvider(sourceId)
    if (!provider) {
      throw new Error(`Plex source not found: ${sourceId}`)
    }

    const success = await provider.selectServer(serverId)
    if (!success) {
      return { success: false }
    }

    // Update connection config and display name with selected server
    const server = provider.getSelectedServer()
    if (server) {
      const db = getDatabase()
      const source = db.getMediaSourceById(sourceId)
      if (source) {
        const config = JSON.parse(source.connection_config)
        config.serverId = server.machineIdentifier
        config.serverUrl = server.uri

        await db.upsertMediaSource({
          ...source,
          display_name: server.name || source.display_name, // Use actual server name
          connection_config: JSON.stringify(config),
        })
      }
    }

    // Get libraries
    const libraries = await provider.getLibraries()

    return { success: true, libraries }
  }

  /**
   * Get Plex servers for a source
   */
  async plexGetServers(sourceId: string): Promise<ServerInstance[]> {
    const provider = this.getPlexProvider(sourceId)
    if (!provider) {
      throw new Error(`Plex source not found: ${sourceId}`)
    }

    if (!provider.discoverServers) {
      throw new Error('Provider does not support server discovery')
    }

    return provider.discoverServers()
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  /**
   * Scan a library for a specific source
   * Updates the library scan timestamp after successful scan
   */
  async scanLibrary(
    sourceId: string,
    libraryId: string,
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    // Set scanning state
    this.isScanning = true
    this.scanCancelled = false

    try {
      // Get library info for timestamp recording
      const libraries = await provider.getLibraries()
      const library = libraries.find(lib => lib.id === libraryId)

      // Wrap progress callback to check for cancellation
      const wrappedProgress: ProgressCallback | undefined = onProgress ? (progress) => {
        if (this.scanCancelled) {
          throw new Error('Scan cancelled by user')
        }
        onProgress(progress)
      } : undefined

      const result = await provider.scanLibrary(libraryId, { onProgress: wrappedProgress })

      // Check if cancelled
      if (this.scanCancelled) {
        return {
          success: false,
          itemsScanned: result.itemsScanned,
          itemsAdded: result.itemsAdded,
          itemsUpdated: result.itemsUpdated,
          itemsRemoved: 0,
          errors: ['Scan cancelled by user'],
          durationMs: result.durationMs,
        }
      }

      // Update library scan timestamp if successful
      if (result.success && library) {
        const db = getDatabase()
        await db.updateLibraryScanTime(
          sourceId,
          libraryId,
          library.name,
          library.type,
          result.itemsScanned
        )
        console.log(`[SourceManager] Updated scan timestamp for library ${library.name}`)
      }

      return result
    } finally {
      this.isScanning = false
      this.scanCancelled = false
    }
  }

  /**
   * Scan all libraries across all enabled sources
   */
  async scanAllSources(onProgress?: AggregateProgressCallback): Promise<Map<string, ScanResult>> {
    await this.initialize()

    // Set scanning state
    this.isScanning = true
    this.scanCancelled = false

    const results = new Map<string, ScanResult>()
    const enabledSources = await this.getEnabledSources()

    try {
      for (const source of enabledSources) {
        // Check for cancellation before each source
        if (this.scanCancelled) {
          console.log('[SourceManager] Scan cancelled by user')
          break
        }

        const provider = this.providers.get(source.source_id)
        if (!provider) {
          console.warn(`[SourceManager] Provider not found for source: ${source.source_id}`)
          continue
        }

        // Skip Plex sources without a server selected
        if (provider.providerType === 'plex') {
          const plexProvider = provider as PlexProvider
          if (!plexProvider.hasSelectedServer()) {
            console.log(`[SourceManager] Skipping Plex source ${source.source_id} - no server selected`)
            continue
          }
        }

        try {
          // Get libraries for this source
          const libraries = await provider.getLibraries()
          const db = getDatabase()

          for (const library of libraries) {
            // Check for cancellation before each library
            if (this.scanCancelled) {
              console.log('[SourceManager] Scan cancelled by user')
              break
            }

            // Music libraries are scanned separately via music:scanLibrary
            if (library.type === 'music') continue

            // Skip disabled libraries
            if (!db.isLibraryEnabled(source.source_id, library.id)) {
              console.log(`[SourceManager] Skipping disabled library: ${library.name}`)
              continue
            }

            const result = await provider.scanLibrary(library.id, {
              onProgress: (progress) => {
                // Check for cancellation during progress
                if (this.scanCancelled) {
                  throw new Error('Scan cancelled by user')
                }
                if (onProgress) {
                  onProgress(source.source_id, source.display_name, progress)
                }
              }
            })

            results.set(`${source.source_id}:${library.id}`, result)
          }
        } catch (error) {
          // If cancelled, just break out
          if (this.scanCancelled) {
            break
          }
          console.error(`[SourceManager] Failed to scan source ${source.source_id}:`, error)
          results.set(source.source_id, {
            success: false,
            itemsScanned: 0,
            itemsAdded: 0,
            itemsUpdated: 0,
            itemsRemoved: 0,
            errors: [(error as Error).message],
            durationMs: 0,
          })
        }
      }

      return results
    } finally {
      this.isScanning = false
      this.scanCancelled = false
    }
  }

  // ============================================================================
  // INCREMENTAL SCANNING
  // ============================================================================

  /**
   * Perform an incremental scan of a library (only items added/modified since last scan)
   * Falls back to full scan if no previous scan timestamp exists
   */
  async scanLibraryIncremental(
    sourceId: string,
    libraryId: string,
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    await this.initialize()

    const db = getDatabase()
    const lastScanTime = db.getLibraryScanTime(sourceId, libraryId)

    // If never scanned, do full scan
    if (!lastScanTime) {
      console.log(`[SourceManager] No previous scan for ${sourceId}:${libraryId}, doing full scan`)
      return this.scanLibrary(sourceId, libraryId, onProgress)
    }

    const sinceTimestamp = new Date(lastScanTime)
    console.log(`[SourceManager] Incremental scan for ${sourceId}:${libraryId} since ${sinceTimestamp.toISOString()}`)

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    // Get library info for updating scan timestamp
    const libraries = await provider.getLibraries()
    const library = libraries.find(l => l.id === libraryId)

    const result = await provider.scanLibrary(libraryId, {
      onProgress,
      sinceTimestamp,
    })

    // Update library scan timestamp if successful
    if (result.success && library) {
      await db.updateLibraryScanTime(
        sourceId,
        libraryId,
        library.name,
        library.type,
        result.itemsScanned
      )
    }

    return result
  }

  /**
   * Scan specific files (for live monitoring when file changes detected)
   * Much faster than full or incremental scan
   */
  async scanTargetedFiles(
    sourceId: string,
    libraryId: string,
    filePaths: string[],
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    console.log(`[SourceManager] Targeted scan of ${filePaths.length} files for ${sourceId}:${libraryId}`)

    const result = await provider.scanLibrary(libraryId, {
      onProgress,
      targetFiles: filePaths,
    })

    return result
  }

  /**
   * Perform incremental scan of all libraries across all enabled sources
   * This is intended for quick refresh on app startup
   */
  async scanAllIncremental(
    onProgress?: AggregateProgressCallback
  ): Promise<Map<string, ScanResult>> {
    await this.initialize()

    const db = getDatabase()
    const enabledSources = db.getEnabledMediaSources()
    const results = new Map<string, ScanResult>()

    console.log(`[SourceManager] Starting incremental scan of ${enabledSources.length} sources`)

    for (const source of enabledSources) {
      const provider = this.providers.get(source.source_id)
      if (!provider) continue

      try {
        const libraries = await provider.getLibraries()

        for (const library of libraries) {
          // Skip music libraries
          if (library.type === 'music') continue

          // Skip disabled libraries
          if (!db.isLibraryEnabled(source.source_id, library.id)) {
            console.log(`[SourceManager] Skipping disabled library: ${source.display_name}/${library.name}`)
            continue
          }

          const lastScanTime = db.getLibraryScanTime(source.source_id, library.id)
          const sinceTimestamp = lastScanTime ? new Date(lastScanTime) : undefined

          if (sinceTimestamp) {
            console.log(`[SourceManager] Incremental scan: ${source.display_name}/${library.name} since ${sinceTimestamp.toISOString()}`)
          } else {
            console.log(`[SourceManager] Full scan (no previous): ${source.display_name}/${library.name}`)
          }

          const result = await provider.scanLibrary(library.id, {
            sinceTimestamp,
            onProgress: onProgress ? (progress) => {
              onProgress(source.source_id, source.display_name, progress)
            } : undefined,
          })

          // Update library scan timestamp if successful
          if (result.success) {
            await db.updateLibraryScanTime(
              source.source_id,
              library.id,
              library.name,
              library.type,
              result.itemsScanned
            )
          }

          results.set(`${source.source_id}:${library.id}`, result)
        }
      } catch (error) {
        console.error(`[SourceManager] Incremental scan failed for ${source.source_id}:`, error)
      }
    }

    console.log(`[SourceManager] Incremental scan complete: ${results.size} libraries processed`)
    return results
  }

  /**
   * Get libraries for a source
   * Libraries are enriched with scan timestamps from the database
   */
  async getLibraries(sourceId: string): Promise<MediaLibrary[]> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      console.error(`[SourceManager] Provider not found: ${sourceId}`)
      console.error(`[SourceManager] Available providers: ${Array.from(this.providers.keys()).join(', ')}`)
      throw new Error(`Source not found: ${sourceId}`)
    }

    // For Plex sources, check if a server is selected before trying to get libraries
    if (provider.providerType === 'plex') {
      const plexProvider = provider as PlexProvider
      if (!plexProvider.hasSelectedServer()) {
        console.log(`[SourceManager] Plex source ${sourceId} has no server selected, returning empty libraries`)
        return []
      }
    }

    console.log(`[SourceManager] Getting libraries for ${sourceId} (${provider.providerType})`)
    const libraries = await provider.getLibraries()

    // Enrich libraries with scan timestamps from database
    const db = getDatabase()
    const scanTimes = db.getLibraryScanTimes(sourceId)

    return libraries.map(lib => ({
      ...lib,
      scannedAt: scanTimes.get(lib.id)?.lastScanAt || lib.scannedAt,
      itemCount: scanTimes.get(lib.id)?.itemsScanned || lib.itemCount,
    }))
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get aggregated stats across all sources
   */
  async getAggregatedStats(): Promise<{
    totalSources: number
    enabledSources: number
    totalItems: number
    bySource: Array<{
      sourceId: string
      displayName: string
      sourceType: string
      itemCount: number
      lastScanAt?: string
    }>
  }> {
    await this.initialize()

    const db = getDatabase()
    return db.getAggregatedSourceStats()
  }

  // ============================================================================
  // UTILITY
  // ============================================================================

  private generateSourceId(type: ProviderType): string {
    return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get supported provider types
   */
  getSupportedProviders(): ProviderType[] {
    return getSupportedProviders()
  }

  /**
   * Reload a provider (e.g., after config change)
   */
  async reloadProvider(sourceId: string): Promise<void> {
    await this.initialize()

    const db = getDatabase()
    const source = db.getMediaSourceById(sourceId)

    if (!source) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    const config: SourceConfig = {
      sourceId: source.source_id,
      sourceType: source.source_type,
      displayName: source.display_name,
      connectionConfig: JSON.parse(source.connection_config),
      isEnabled: source.is_enabled,
    }

    const provider = createProvider(source.source_type, config)
    this.providers.set(sourceId, provider)

    console.log(`[SourceManager] Reloaded provider: ${sourceId}`)
  }
}

// Singleton instance
let sourceManagerInstance: SourceManager | null = null

export function getSourceManager(): SourceManager {
  if (!sourceManagerInstance) {
    sourceManagerInstance = new SourceManager()
  }
  return sourceManagerInstance
}
