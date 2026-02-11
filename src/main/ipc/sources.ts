/**
 * IPC Handlers for Source Management
 *
 * Handles all source-related IPC calls from the renderer process.
 */

import { ipcMain, dialog } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getSourceManager } from '../services/SourceManager'
import { getDatabase } from '../database/getDatabase'
import { getPlexService } from '../services/PlexService'
import { getKodiLocalDiscoveryService } from '../services/KodiLocalDiscoveryService'
import { getKodiMySQLConnectionService, type KodiMySQLConfig } from '../services/KodiMySQLConnectionService'
import { getMediaFileAnalyzer } from '../services/MediaFileAnalyzer'
import type { ProviderType } from '../providers/base/MediaProvider'
import type { KodiLocalProvider } from '../providers/kodi/KodiLocalProvider'
import { KodiMySQLProvider } from '../providers/kodi/KodiMySQLProvider'
import { safeSend, getWindowFromEvent } from './utils/safeSend'
import { getErrorMessage } from './utils'
import { createProgressUpdater } from './utils/progressUpdater'
import {
  validateInput,
  AddSourceSchema,
  UpdateSourceSchema,
  KodiMySQLConfigSchema,
} from '../validation/schemas'

/**
 * Register all source-related IPC handlers
 */
export function registerSourceHandlers(): void {
  const manager = getSourceManager()

  // ============================================================================
  // SOURCE CRUD
  // ============================================================================

  /**
   * Add a new media source
   */
  ipcMain.handle('sources:add', async (_event, config: unknown) => {
    try {
      const validatedConfig = validateInput(AddSourceSchema, config, 'sources:add')
      return await manager.addSource(validatedConfig)
    } catch (error: unknown) {
      console.error('Error adding source:', error)
      throw error
    }
  })

  /**
   * Update an existing media source
   */
  ipcMain.handle('sources:update', async (_event, sourceId: unknown, updates: unknown) => {
    try {
      if (typeof sourceId !== 'string' || !sourceId) {
        throw new Error('Invalid source ID')
      }
      const validatedUpdates = validateInput(UpdateSourceSchema, updates, 'sources:update')
      await manager.updateSource(sourceId, validatedUpdates)
    } catch (error: unknown) {
      console.error('Error updating source:', error)
      throw error
    }
  })

  /**
   * Remove a media source
   */
  ipcMain.handle('sources:remove', async (_event, sourceId: string) => {
    try {
      await manager.removeSource(sourceId)
    } catch (error: unknown) {
      console.error('Error removing source:', error)
      throw error
    }
  })

  /**
   * Get all sources (optionally filtered by type)
   */
  ipcMain.handle('sources:list', async (_event, type?: ProviderType) => {
    try {
      return await manager.getSources(type)
    } catch (error: unknown) {
      console.error('Error listing sources:', error)
      throw error
    }
  })

  /**
   * Get a single source by ID
   */
  ipcMain.handle('sources:get', async (_event, sourceId: string) => {
    try {
      return await manager.getSource(sourceId)
    } catch (error: unknown) {
      console.error('Error getting source:', error)
      throw error
    }
  })

  /**
   * Get enabled sources only
   */
  ipcMain.handle('sources:getEnabled', async () => {
    try {
      return await manager.getEnabledSources()
    } catch (error: unknown) {
      console.error('Error getting enabled sources:', error)
      throw error
    }
  })

  /**
   * Toggle source enabled status
   */
  ipcMain.handle('sources:toggle', async (_event, sourceId: string, enabled: boolean) => {
    try {
      await manager.toggleSource(sourceId, enabled)
    } catch (error: unknown) {
      console.error('Error toggling source:', error)
      throw error
    }
  })

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  /**
   * Test connection for a source
   */
  ipcMain.handle('sources:testConnection', async (_event, sourceId: string) => {
    try {
      return await manager.testConnection(sourceId)
    } catch (error: unknown) {
      console.error('Error testing connection:', error)
      throw error
    }
  })

  // ============================================================================
  // PLEX-SPECIFIC AUTH
  // ============================================================================

  /**
   * Start Plex OAuth flow
   */
  ipcMain.handle('plex:startAuth', async () => {
    try {
      return await manager.plexStartAuth()
    } catch (error: unknown) {
      console.error('Error starting Plex auth:', error)
      throw error
    }
  })

  /**
   * Check Plex auth PIN (poll for completion)
   */
  ipcMain.handle('plex:checkAuth', async (_event, pinId: number) => {
    try {
      return await manager.plexCompleteAuth(pinId)
    } catch (error: unknown) {
      console.error('Error checking Plex auth:', error)
      throw error
    }
  })

  /**
   * Authenticate with token and discover servers
   */
  ipcMain.handle('plex:authenticateAndDiscover', async (_event, token: string, displayName: string) => {
    try {
      return await manager.plexAuthenticateAndDiscover(token, displayName)
    } catch (error: unknown) {
      console.error('Error authenticating Plex:', error)
      throw error
    }
  })

  /**
   * Select a Plex server for a source
   * Supports both:
   *   - Legacy: (serverId) - uses first Plex source or PlexService
   *   - New: (sourceId, serverId) - uses specified source
   */
  ipcMain.handle('plex:selectServer', async (_event, sourceIdOrServerId: string, serverId?: string) => {
    // New API: both sourceId and serverId provided
    if (serverId) {
      return await manager.plexSelectServer(sourceIdOrServerId, serverId)
    }

    // Legacy API: only serverId provided
    const resolvedServerId = sourceIdOrServerId

    // Try to find first Plex source
    const plexSources = await manager.getSources('plex')
    if (plexSources.length > 0) {
      const resolvedSourceId = plexSources[0].source_id
      console.log(`[plex:selectServer] Using first Plex source: ${resolvedSourceId}`)
      return await manager.plexSelectServer(resolvedSourceId, resolvedServerId)
    }

    // Fallback to legacy PlexService for old auth flow
    console.log('[plex:selectServer] No sources found, using legacy PlexService')
    const plex = getPlexService()
    const success = await plex.selectServer(resolvedServerId)
    return { success }
  })

  /**
   * Get Plex servers for a source
   * If no sourceId is provided, falls back to:
   *   1. The first Plex source in SourceManager
   *   2. The legacy PlexService (for backward compatibility)
   */
  ipcMain.handle('plex:getServers', async (_event, sourceId?: string) => {
    try {
      // If sourceId provided, use SourceManager
      if (sourceId) {
        return await manager.plexGetServers(sourceId)
      }

      // Try to find first Plex source
      const plexSources = await manager.getSources('plex')
      if (plexSources.length > 0) {
        const resolvedSourceId = plexSources[0].source_id
        console.log(`[plex:getServers] Using first Plex source: ${resolvedSourceId}`)
        return await manager.plexGetServers(resolvedSourceId)
      }

      // Fallback to legacy PlexService for old auth flow
      console.log('[plex:getServers] No sources found, using legacy PlexService')
      const plex = getPlexService()
      return await plex.getServers()
    } catch (error: unknown) {
      console.error('Error getting Plex servers:', error)
      throw error
    }
  })

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  /**
   * Get libraries for a source
   */
  ipcMain.handle('sources:getLibraries', async (_event, sourceId: string) => {
    try {
      return await manager.getLibraries(sourceId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[IPC] sources:getLibraries failed for ${sourceId}: ${msg}`)
      return []
    }
  })

  /**
   * Get libraries for a source with enabled status from database
   */
  ipcMain.handle('sources:getLibrariesWithStatus', async (_event, sourceId: string) => {
    try {
      const db = getDatabase()
      const manager = getSourceManager()

      // Get libraries from the provider
      const libraries = await manager.getLibraries(sourceId)

      // Get stored library settings from database
      const storedLibraries = db.getSourceLibraries(sourceId) as Array<{
        libraryId: string
        libraryName: string
        libraryType: string
        isEnabled: boolean
        lastScanAt: string | null
        itemsScanned: number
      }>
      const storedMap = new Map(storedLibraries.map(l => [l.libraryId, l]))

      // Merge: libraries from provider + enabled status from DB
      return libraries.map(lib => {
        const stored = storedMap.get(lib.id)
        return {
          ...lib,
          isEnabled: stored ? stored.isEnabled : true, // Default to enabled
          lastScanAt: stored?.lastScanAt || null,
          itemsScanned: stored?.itemsScanned || 0,
        }
      })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[IPC] sources:getLibrariesWithStatus failed for ${sourceId}: ${msg}`)
      return []
    }
  })

  /**
   * Toggle a library's enabled status
   */
  ipcMain.handle('sources:toggleLibrary', async (event, sourceId: string, libraryId: string, enabled: boolean) => {
    try {
      const db = getDatabase()
      await db.toggleLibrary(sourceId, libraryId, enabled)

      // Notify renderer that library settings changed
      const win = getWindowFromEvent(event)
      safeSend(win, 'library:updated', { type: 'libraryToggle', sourceId, libraryId, enabled })

      return { success: true }
    } catch (error: unknown) {
      console.error('Error toggling library:', error)
      throw error
    }
  })

  /**
   * Set multiple libraries' enabled status at once (used during source setup)
   */
  ipcMain.handle('sources:setLibrariesEnabled', async (_event, sourceId: string, libraries: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>) => {
    try {
      const db = getDatabase()
      await db.setLibrariesEnabled(sourceId, libraries)
      return { success: true }
    } catch (error: unknown) {
      console.error('Error setting libraries enabled:', error)
      throw error
    }
  })

  /**
   * Get only enabled library IDs for a source
   */
  ipcMain.handle('sources:getEnabledLibraryIds', async (_event, sourceId: string) => {
    try {
      const db = getDatabase()
      return db.getEnabledLibraryIds(sourceId)
    } catch (error: unknown) {
      console.error('Error getting enabled library IDs:', error)
      throw error
    }
  })

  /**
   * Stop current scan
   */
  ipcMain.handle('sources:stopScan', async () => {
    try {
      console.log('[IPC] Stopping scan...')
      manager.stopScan()
      return { success: true }
    } catch (error: unknown) {
      console.error('Error stopping scan:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Scan a library
   */
  ipcMain.handle('sources:scanLibrary', async (event, sourceId: string, libraryId: string) => {
    try {
      const win = getWindowFromEvent(event)
      console.log(`[IPC sources:scanLibrary] Starting scan for ${sourceId}/${libraryId}, win exists: ${!!win}`)

      const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
      let progressCount = 0

      const result = await manager.scanLibrary(sourceId, libraryId, (progress) => {
        progressCount++
        if (progressCount <= 3 || progressCount % 50 === 0) {
          console.log(`[IPC sources:scanLibrary] Progress #${progressCount}: ${progress.percentage?.toFixed(1)}% - ${progress.currentItem}`)
        }
        onProgress(progress, { sourceId, libraryId })
      })

      console.log(`[IPC sources:scanLibrary] Scan complete, sent ${progressCount} progress events`)

      // Send final update when scan completes
      flush()

      return result
    } catch (error: unknown) {
      console.error('Error scanning library:', error)
      throw error
    }
  })

  /**
   * Scan all enabled sources
   */
  ipcMain.handle('sources:scanAll', async (event) => {
    try {
      const win = getWindowFromEvent(event)
      const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

      const results = await manager.scanAllSources((sourceId, sourceName, progress) => {
        onProgress(progress, { sourceId, sourceName })
      })

      // Send final update when scan completes
      flush()

      // Convert Map to array for IPC
      return Array.from(results.entries()).map(([key, value]) => ({
        key,
        ...value,
      }))
    } catch (error: unknown) {
      console.error('Error scanning all sources:', error)
      throw error
    }
  })

  // ============================================================================
  // INCREMENTAL SCANNING
  // ============================================================================

  /**
   * Scan a single media item by file path
   * If libraryId is not provided, attempts to auto-detect from file path
   */
  ipcMain.handle('sources:scanItem', async (event, sourceId: string, libraryId: string | null, filePath: string) => {
    try {
      const win = getWindowFromEvent(event)
      console.log(`[IPC sources:scanItem] Starting single item scan for ${path.basename(filePath)}`)

      // If libraryId not provided, determine the appropriate default based on provider type
      let resolvedLibraryId = libraryId
      if (!resolvedLibraryId) {
        // Get the provider to determine its type
        const provider = manager.getProvider(sourceId)
        if (provider?.providerType === 'kodi-local' || provider?.providerType === 'kodi-mysql') {
          // Kodi uses 'movies' and 'tvshows' as library IDs
          resolvedLibraryId = 'movies'
        } else {
          // LocalFolderProvider uses 'movie' and 'tvshows'
          resolvedLibraryId = 'movie'
        }
        console.log(`[IPC sources:scanItem] No libraryId provided, using default for ${provider?.providerType || 'unknown'}: ${resolvedLibraryId}`)
      }

      const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

      const result = await manager.scanTargetedFiles(sourceId, resolvedLibraryId, [filePath], (progress) => {
        onProgress(progress, { sourceId, libraryId: resolvedLibraryId })
      })

      console.log(`[IPC sources:scanItem] Scan complete: ${result.itemsScanned} items`)
      flush()

      return result
    } catch (error: unknown) {
      console.error('Error scanning single item:', error)
      throw error
    }
  })

  /**
   * Incremental scan of a single library (only new/changed items since last scan)
   */
  ipcMain.handle('sources:scanLibraryIncremental', async (event, sourceId: string, libraryId: string) => {
    try {
      const win = getWindowFromEvent(event)
      console.log(`[IPC sources:scanLibraryIncremental] Starting incremental scan for ${sourceId}/${libraryId}`)

      const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

      const result = await manager.scanLibraryIncremental(sourceId, libraryId, (progress) => {
        onProgress(progress, { sourceId, libraryId })
      })

      console.log(`[IPC sources:scanLibraryIncremental] Scan complete: ${result.itemsScanned} items`)
      flush()

      return result
    } catch (error: unknown) {
      console.error('Error in incremental library scan:', error)
      throw error
    }
  })

  /**
   * Incremental scan of all enabled sources (only new/changed items since last scan)
   */
  ipcMain.handle('sources:scanAllIncremental', async (event) => {
    try {
      const win = getWindowFromEvent(event)
      console.log('[IPC sources:scanAllIncremental] Starting incremental scan of all sources')

      const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

      const results = await manager.scanAllIncremental((sourceId, sourceName, progress) => {
        onProgress(progress, { sourceId, sourceName })
      })

      // Send final updates
      flush()

      console.log('[IPC sources:scanAllIncremental] Incremental scan complete')

      // Convert Map to array for IPC
      return Array.from(results.entries()).map(([key, value]) => ({
        key,
        ...value,
      }))
    } catch (error: unknown) {
      console.error('Error in incremental scan all:', error)
      throw error
    }
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get aggregated stats across all sources
   */
  ipcMain.handle('sources:getStats', async () => {
    try {
      return await manager.getAggregatedStats()
    } catch (error: unknown) {
      console.error('Error getting stats:', error)
      throw error
    }
  })

  /**
   * Get supported provider types
   */
  ipcMain.handle('sources:getSupportedProviders', async () => {
    try {
      return manager.getSupportedProviders()
    } catch (error: unknown) {
      console.error('Error getting supported providers:', error)
      throw error
    }
  })

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  /**
   * Detect local Kodi installation
   * Returns installation info or null if not found
   */
  ipcMain.handle('kodi:detectLocal', async () => {
    try {
      const discovery = getKodiLocalDiscoveryService()
      return await discovery.detectLocalInstallation()
    } catch (error: unknown) {
      console.error('Error detecting local Kodi:', error)
      return null
    }
  })

  /**
   * Check if Kodi process is currently running
   */
  ipcMain.handle('kodi:isRunning', async () => {
    try {
      const discovery = getKodiLocalDiscoveryService()
      return await discovery.isKodiRunning()
    } catch (error: unknown) {
      console.error('Error checking if Kodi is running:', error)
      return false
    }
  })

  /**
   * Import collections from Kodi local database
   */
  ipcMain.handle('kodi:importCollections', async (event, sourceId: string) => {
    try {
      const provider = manager.getProvider(sourceId)
      if (!provider) {
        throw new Error(`Source not found: ${sourceId}`)
      }

      // Check if it's a Kodi local provider
      if (provider.providerType !== 'kodi-local') {
        throw new Error('Collection import is only supported for Kodi local sources')
      }

      const win = getWindowFromEvent(event)
      const { onProgress, flush } = createProgressUpdater(win, 'kodi:collectionProgress', 'media')

      // Import collections
      const kodiProvider = provider as KodiLocalProvider
      const result = await kodiProvider.importCollections((progress: { current: number; total: number; currentItem: string }) => {
        onProgress(progress)
      })

      // Send final update when import completes
      flush()

      return result
    } catch (error: unknown) {
      console.error('Error importing Kodi collections:', error)
      throw error
    }
  })

  /**
   * Get collections from Kodi local database (without importing)
   */
  ipcMain.handle('kodi:getCollections', async (_event, sourceId: string) => {
    try {
      const provider = manager.getProvider(sourceId)
      if (!provider) {
        throw new Error(`Source not found: ${sourceId}`)
      }

      if (provider.providerType !== 'kodi-local') {
        throw new Error('This operation is only supported for Kodi local sources')
      }

      const kodiProvider = provider as KodiLocalProvider
      return await kodiProvider.getCollections()
    } catch (error: unknown) {
      console.error('Error getting Kodi collections:', error)
      throw error
    }
  })

  // ============================================================================
  // KODI MYSQL/MARIADB CONNECTION
  // ============================================================================

  /**
   * Test MySQL/MariaDB connection and detect Kodi databases
   */
  ipcMain.handle('kodi:testMySQLConnection', async (_event, config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
    ssl?: boolean
    connectionTimeout?: number
  }) => {
    try {
      const connectionService = getKodiMySQLConnectionService()
      const mysqlConfig: KodiMySQLConfig = {
        host: config.host,
        port: config.port || 3306,
        username: config.username,
        password: config.password,
        databasePrefix: config.databasePrefix || 'kodi_',
        ssl: config.ssl,
        connectionTimeout: config.connectionTimeout || 10000,
      }
      return await connectionService.testConnection(mysqlConfig)
    } catch (error: unknown) {
      console.error('Error testing MySQL connection:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Connection test failed',
      }
    }
  })

  /**
   * Detect Kodi databases on MySQL server
   */
  ipcMain.handle('kodi:detectMySQLDatabases', async (_event, config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
  }) => {
    try {
      const connectionService = getKodiMySQLConnectionService()
      const mysqlConfig: KodiMySQLConfig = {
        host: config.host,
        port: config.port || 3306,
        username: config.username,
        password: config.password,
        databasePrefix: config.databasePrefix || 'kodi_',
      }
      return await connectionService.detectDatabases(mysqlConfig)
    } catch (error: unknown) {
      console.error('Error detecting MySQL databases:', error)
      return {
        videoDatabase: null,
        videoVersion: null,
        musicDatabase: null,
        musicVersion: null,
      }
    }
  })

  /**
   * Add a Kodi MySQL source with authentication
   */
  ipcMain.handle('kodi:authenticateMySQL', async (_event, config: unknown) => {
    try {
      const validatedConfig = validateInput(KodiMySQLConfigSchema, config, 'kodi:authenticateMySQL')

      const provider = new KodiMySQLProvider({
        sourceType: 'kodi-mysql' as ProviderType,
        displayName: validatedConfig.displayName,
        connectionConfig: {},
      })

      const authResult = await provider.authenticate({
        host: validatedConfig.host,
        port: validatedConfig.port || 3306,
        username: validatedConfig.username,
        password: validatedConfig.password,
        videoDatabaseName: validatedConfig.videoDatabaseName,
        musicDatabaseName: validatedConfig.musicDatabaseName,
        databasePrefix: validatedConfig.databasePrefix || 'kodi_',
        ssl: validatedConfig.ssl,
      })

      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error,
        }
      }

      // Add the source to the database
      const manager = getSourceManager()
      const source = await manager.addSource({
        sourceType: 'kodi-mysql' as ProviderType,
        displayName: validatedConfig.displayName,
        connectionConfig: provider.getConnectionConfig(),
        isEnabled: true,
      })

      return {
        success: true,
        source,
        serverName: authResult.serverName,
        serverVersion: authResult.serverVersion,
      }
    } catch (error: unknown) {
      console.error('Error authenticating Kodi MySQL:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  })

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  /**
   * Check if FFprobe is available on the system
   */
  ipcMain.handle('ffprobe:isAvailable', async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.isAvailable()
    } catch (error: unknown) {
      console.error('Error checking FFprobe availability:', error)
      return false
    }
  })

  /**
   * Get FFprobe version
   */
  ipcMain.handle('ffprobe:getVersion', async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.getVersion()
    } catch (error: unknown) {
      console.error('Error getting FFprobe version:', error)
      return null
    }
  })

  /**
   * Analyze a media file with FFprobe
   */
  ipcMain.handle('ffprobe:analyzeFile', async (_event, filePath: string) => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.analyzeFile(filePath)
    } catch (error: unknown) {
      console.error('Error analyzing file:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Failed to analyze file',
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }
  })

  /**
   * Enable/disable FFprobe analysis for a Kodi source
   */
  ipcMain.handle('ffprobe:setEnabled', async (_event, sourceId: string, enabled: boolean) => {
    try {
      const provider = manager.getProvider(sourceId)
      if (!provider) {
        throw new Error(`Source not found: ${sourceId}`)
      }

      if (provider.providerType !== 'kodi-local') {
        throw new Error('FFprobe analysis is only supported for Kodi local sources')
      }

      const kodiProvider = provider as KodiLocalProvider
      kodiProvider.setFFprobeAnalysis(enabled)
      return { success: true, enabled }
    } catch (error: unknown) {
      console.error('Error setting FFprobe analysis:', error)
      throw error
    }
  })

  /**
   * Check if FFprobe analysis is enabled for a source
   */
  ipcMain.handle('ffprobe:isEnabled', async (_event, sourceId: string) => {
    try {
      const provider = manager.getProvider(sourceId)
      if (!provider) {
        return false
      }

      if (provider.providerType !== 'kodi-local') {
        return false
      }

      const kodiProvider = provider as KodiLocalProvider
      return kodiProvider.isFFprobeAnalysisEnabled()
    } catch (error: unknown) {
      console.error('Error checking FFprobe status:', error)
      return false
    }
  })

  /**
   * Check if FFprobe is available for a specific Kodi source
   * (combines system check with provider support)
   */
  ipcMain.handle('ffprobe:isAvailableForSource', async (_event, sourceId: string) => {
    try {
      const provider = manager.getProvider(sourceId)
      if (!provider || provider.providerType !== 'kodi-local') {
        return { available: false, reason: 'Source is not a Kodi local source' }
      }

      const kodiProvider = provider as KodiLocalProvider
      const isAvailable = await kodiProvider.isFFprobeAvailable()
      const version = isAvailable ? await kodiProvider.getFFprobeVersion() : null

      return {
        available: isAvailable,
        version,
        reason: isAvailable ? null : 'FFprobe not found on system. Install FFmpeg to enable file analysis.',
      }
    } catch (error: unknown) {
      console.error('Error checking FFprobe for source:', error)
      return { available: false, reason: getErrorMessage(error) }
    }
  })

  /**
   * Check if FFprobe can be auto-installed on this platform
   */
  ipcMain.handle('ffprobe:canInstall', async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return analyzer.canInstall()
    } catch (error: unknown) {
      console.error('Error checking FFprobe install capability:', error)
      return false
    }
  })

  /**
   * Install FFprobe automatically
   */
  ipcMain.handle('ffprobe:install', async (event) => {
    try {
      const analyzer = getMediaFileAnalyzer()
      const win = getWindowFromEvent(event)

      const result = await analyzer.installFFprobe((progress) => {
        // Send progress updates to renderer
        safeSend(win, 'ffprobe:installProgress', progress)
      })

      return result
    } catch (error: unknown) {
      console.error('Error installing FFprobe:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Installation failed',
      }
    }
  })

  /**
   * Uninstall bundled FFprobe
   */
  ipcMain.handle('ffprobe:uninstall', async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      const success = await analyzer.uninstallFFprobe()
      return { success }
    } catch (error: unknown) {
      console.error('Error uninstalling FFprobe:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Check for FFprobe updates
   */
  ipcMain.handle('ffprobe:checkForUpdate', async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.checkForUpdate()
    } catch (error: unknown) {
      console.error('Error checking for FFprobe update:', error)
      return {
        currentVersion: null,
        latestVersion: null,
        updateAvailable: false,
        error: getErrorMessage(error),
      }
    }
  })

  /**
   * Check if current FFprobe is the bundled version
   */
  ipcMain.handle('ffprobe:isBundled', async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.isBundledVersion()
    } catch (error: unknown) {
      console.error('Error checking FFprobe bundle status:', error)
      return false
    }
  })

  // ============================================================================
  // LOCAL FOLDER SOURCE
  // ============================================================================

  /**
   * Open folder picker dialog for selecting a local media folder
   */
  ipcMain.handle('local:selectFolder', async (event) => {
    try {
      const win = getWindowFromEvent(event)
      if (!win) {
        return { cancelled: true }
      }

      const result = await dialog.showOpenDialog(win, {
        title: 'Select Media Folder',
        properties: ['openDirectory'],
        buttonLabel: 'Select Folder',
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true }
      }

      return {
        cancelled: false,
        folderPath: result.filePaths[0],
      }
    } catch (error: unknown) {
      console.error('Error opening folder dialog:', error)
      return { cancelled: true, error: getErrorMessage(error) }
    }
  })

  /**
   * Detect subfolders in a local folder and guess their media type
   */
  ipcMain.handle('local:detectSubfolders', async (_event, folderPath: string) => {
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true })
      const subfolders: Array<{
        name: string
        path: string
        suggestedType: 'movies' | 'tvshows' | 'music' | 'unknown'
      }> = []

      // Known folder name patterns
      const moviePatterns = ['movies', 'films', 'movie', 'film']
      const tvPatterns = ['tv shows', 'tv', 'shows', 'series', 'television', 'tvshows']
      const musicPatterns = ['music', 'audio', 'songs', 'albums', 'artists']

      // System folders to skip
      const skipFolders = ['@eadir', '.ds_store', 'thumbs', 'metadata', '$recycle.bin', 'system volume information']

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const folderName = entry.name.toLowerCase()

        // Skip system/hidden folders
        if (skipFolders.includes(folderName) || folderName.startsWith('.')) continue

        // Detect media type from folder name
        let suggestedType: 'movies' | 'tvshows' | 'music' | 'unknown' = 'unknown'

        if (moviePatterns.includes(folderName)) {
          suggestedType = 'movies'
        } else if (tvPatterns.includes(folderName)) {
          suggestedType = 'tvshows'
        } else if (musicPatterns.includes(folderName)) {
          suggestedType = 'music'
        }

        subfolders.push({
          name: entry.name,
          path: path.join(folderPath, entry.name),
          suggestedType,
        })
      }

      // Sort: known types first, then alphabetically
      subfolders.sort((a, b) => {
        if (a.suggestedType !== 'unknown' && b.suggestedType === 'unknown') return -1
        if (a.suggestedType === 'unknown' && b.suggestedType !== 'unknown') return 1
        return a.name.localeCompare(b.name)
      })

      return { subfolders }
    } catch (error: unknown) {
      console.error('Error detecting subfolders:', error)
      return { subfolders: [], error: getErrorMessage(error) }
    }
  })

  /**
   * Add a local folder as a media source with specific library configurations
   */
  ipcMain.handle('local:addSourceWithLibraries', async (_event, config: {
    folderPath: string
    displayName: string
    libraries: Array<{
      name: string
      path: string
      mediaType: 'movies' | 'tvshows' | 'music'
      enabled: boolean
    }>
  }) => {
    try {
      // Create the source with 'mixed' type - we'll handle library creation manually
      const source = await manager.addSource({
        sourceType: 'local',
        displayName: config.displayName,
        connectionConfig: {
          folderPath: config.folderPath,
          mediaType: 'mixed',
          name: config.displayName,
          // Store the custom library config
          customLibraries: config.libraries,
        },
        isEnabled: true,
      })

      return source
    } catch (error: unknown) {
      console.error('Error adding local folder source with libraries:', error)
      throw error
    }
  })

  /**
   * Add a local folder as a media source
   */
  ipcMain.handle('local:addSource', async (_event, config: {
    folderPath: string
    displayName: string
    mediaType: 'movies' | 'tvshows' | 'mixed'
  }) => {
    try {
      return await manager.addSource({
        sourceType: 'local',
        displayName: config.displayName,
        connectionConfig: {
          folderPath: config.folderPath,
          mediaType: config.mediaType,
          name: config.displayName,
        },
        isEnabled: true,
      })
    } catch (error: unknown) {
      console.error('Error adding local folder source:', error)
      throw error
    }
  })

  console.log('[IPC] Source handlers registered')
}
