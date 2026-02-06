import { contextBridge, ipcRenderer } from 'electron'
// Import shared types from main process (type-only, no runtime code)
import type { ConnectionTestResult } from '@main/types/ipc'

// Re-export for consumers of this module
export type { ConnectionTestResult } from '@main/types/ipc'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App lifecycle
  appReady: () => ipcRenderer.send('app:ready'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // ============================================================================
  // MEDIA SOURCES (Multi-Provider Support)
  // ============================================================================

  // Source CRUD
  sourcesAdd: (config: {
    sourceType: string
    displayName: string
    connectionConfig: Record<string, unknown>
    isEnabled?: boolean
  }) => ipcRenderer.invoke('sources:add', config),
  sourcesUpdate: (sourceId: string, updates: {
    displayName?: string
    connectionConfig?: Record<string, unknown>
    isEnabled?: boolean
  }) => ipcRenderer.invoke('sources:update', sourceId, updates),
  sourcesRemove: (sourceId: string) => ipcRenderer.invoke('sources:remove', sourceId),
  sourcesList: (type?: string) => ipcRenderer.invoke('sources:list', type),
  sourcesGet: (sourceId: string) => ipcRenderer.invoke('sources:get', sourceId),
  sourcesGetEnabled: () => ipcRenderer.invoke('sources:getEnabled'),
  sourcesToggle: (sourceId: string, enabled: boolean) =>
    ipcRenderer.invoke('sources:toggle', sourceId, enabled),

  // Connection Testing
  sourcesTestConnection: (sourceId: string) =>
    ipcRenderer.invoke('sources:testConnection', sourceId),

  // Plex-specific Auth (new flow for multi-source)
  plexStartAuth: () => ipcRenderer.invoke('plex:startAuth'),
  plexCheckAuth: (pinId: number) => ipcRenderer.invoke('plex:checkAuth', pinId),
  plexAuthenticateAndDiscover: (token: string, displayName: string) =>
    ipcRenderer.invoke('plex:authenticateAndDiscover', token, displayName),
  plexSelectServerForSource: (sourceId: string, serverId: string) =>
    ipcRenderer.invoke('plex:selectServer', sourceId, serverId),
  plexGetServersForSource: (sourceId: string) =>
    ipcRenderer.invoke('plex:getServers', sourceId),

  // Library Operations
  sourcesGetLibraries: (sourceId: string) =>
    ipcRenderer.invoke('sources:getLibraries', sourceId),
  sourcesGetLibrariesWithStatus: (sourceId: string) =>
    ipcRenderer.invoke('sources:getLibrariesWithStatus', sourceId),
  sourcesToggleLibrary: (sourceId: string, libraryId: string, enabled: boolean) =>
    ipcRenderer.invoke('sources:toggleLibrary', sourceId, libraryId, enabled),
  sourcesSetLibrariesEnabled: (sourceId: string, libraries: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>) => ipcRenderer.invoke('sources:setLibrariesEnabled', sourceId, libraries),
  sourcesGetEnabledLibraryIds: (sourceId: string) =>
    ipcRenderer.invoke('sources:getEnabledLibraryIds', sourceId),
  sourcesScanLibrary: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke('sources:scanLibrary', sourceId, libraryId),
  sourcesScanAll: () => ipcRenderer.invoke('sources:scanAll'),
  sourcesStopScan: () => ipcRenderer.invoke('sources:stopScan'),

  // Incremental Scanning (only new/changed items since last scan)
  sourcesScanLibraryIncremental: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke('sources:scanLibraryIncremental', sourceId, libraryId),
  sourcesScanAllIncremental: () => ipcRenderer.invoke('sources:scanAllIncremental'),

  // Single Item Scan (rescan a specific file)
  sourcesScanItem: (sourceId: string, libraryId: string | null, filePath: string) =>
    ipcRenderer.invoke('sources:scanItem', sourceId, libraryId, filePath),

  // Statistics
  sourcesGetStats: () => ipcRenderer.invoke('sources:getStats'),
  sourcesGetSupportedProviders: () => ipcRenderer.invoke('sources:getSupportedProviders'),

  // Source Events
  onSourcesScanProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: any, progress: unknown) => callback(progress)
    ipcRenderer.on('sources:scanProgress', handler)
    return () => ipcRenderer.removeListener('sources:scanProgress', handler)
  },

  // Library Update Events - fired when media items are updated during scans/analysis
  onLibraryUpdated: (callback: (data: { type: 'media' | 'music'; count?: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('library:updated', handler)
    return () => ipcRenderer.removeListener('library:updated', handler)
  },

  // Auto-refresh Events - fired during incremental scan on app start
  onAutoRefreshStarted: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('scan:autoRefreshStarted', handler)
    return () => ipcRenderer.removeListener('scan:autoRefreshStarted', handler)
  },
  onAutoRefreshComplete: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('scan:autoRefreshComplete', handler)
    return () => ipcRenderer.removeListener('scan:autoRefreshComplete', handler)
  },

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  // Detect local Kodi installation
  kodiDetectLocal: () => ipcRenderer.invoke('kodi:detectLocal'),
  kodiIsRunning: () => ipcRenderer.invoke('kodi:isRunning'),

  // Kodi Collections
  kodiImportCollections: (sourceId: string) => ipcRenderer.invoke('kodi:importCollections', sourceId),
  kodiGetCollections: (sourceId: string) => ipcRenderer.invoke('kodi:getCollections', sourceId),
  onKodiCollectionProgress: (callback: (progress: { current: number; total: number; currentItem: string }) => void) => {
    const handler = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('kodi:collectionProgress', handler)
    return () => ipcRenderer.removeListener('kodi:collectionProgress', handler)
  },

  // Kodi MySQL/MariaDB Connection
  kodiTestMySQLConnection: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
    ssl?: boolean
    connectionTimeout?: number
  }) => ipcRenderer.invoke('kodi:testMySQLConnection', config),

  kodiDetectMySQLDatabases: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
  }) => ipcRenderer.invoke('kodi:detectMySQLDatabases', config),

  kodiAuthenticateMySQL: (config: {
    host: string
    port?: number
    username: string
    password: string
    displayName: string
    videoDatabaseName?: string
    musicDatabaseName?: string
    databasePrefix?: string
    ssl?: boolean
  }) => ipcRenderer.invoke('kodi:authenticateMySQL', config),

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  // Check if FFprobe is available on the system
  ffprobeIsAvailable: () => ipcRenderer.invoke('ffprobe:isAvailable'),

  // Get FFprobe version string
  ffprobeGetVersion: () => ipcRenderer.invoke('ffprobe:getVersion'),

  // Analyze a media file with FFprobe
  ffprobeAnalyzeFile: (filePath: string) => ipcRenderer.invoke('ffprobe:analyzeFile', filePath),

  // Enable/disable FFprobe analysis for a source
  ffprobeSetEnabled: (sourceId: string, enabled: boolean) =>
    ipcRenderer.invoke('ffprobe:setEnabled', sourceId, enabled),

  // Check if FFprobe analysis is enabled for a source
  ffprobeIsEnabled: (sourceId: string) => ipcRenderer.invoke('ffprobe:isEnabled', sourceId),

  // Check if FFprobe is available for a specific source (with reason)
  ffprobeIsAvailableForSource: (sourceId: string) =>
    ipcRenderer.invoke('ffprobe:isAvailableForSource', sourceId),

  // Check if FFprobe can be auto-installed on this platform
  ffprobeCanInstall: () => ipcRenderer.invoke('ffprobe:canInstall'),

  // Install FFprobe automatically
  ffprobeInstall: () => ipcRenderer.invoke('ffprobe:install'),

  // Uninstall bundled FFprobe
  ffprobeUninstall: () => ipcRenderer.invoke('ffprobe:uninstall'),

  // Check if current FFprobe is the bundled version
  ffprobeIsBundled: () => ipcRenderer.invoke('ffprobe:isBundled'),

  // Check for FFprobe updates
  ffprobeCheckForUpdate: () => ipcRenderer.invoke('ffprobe:checkForUpdate'),

  // Listen for FFprobe install progress
  onFFprobeInstallProgress: (callback: (progress: { stage: string; percent: number }) => void) => {
    const handler = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('ffprobe:installProgress', handler)
    return () => ipcRenderer.removeListener('ffprobe:installProgress', handler)
  },

  // ============================================================================
  // LOCAL FOLDER SOURCE
  // ============================================================================

  // Open folder picker dialog
  localSelectFolder: () => ipcRenderer.invoke('local:selectFolder'),

  // Detect subfolders and their media types
  localDetectSubfolders: (folderPath: string) => ipcRenderer.invoke('local:detectSubfolders', folderPath),

  // Add a local folder as a media source
  localAddSource: (config: { folderPath: string; displayName: string; mediaType: 'movies' | 'tvshows' | 'music' | 'mixed' }) =>
    ipcRenderer.invoke('local:addSource', config),

  // Add a local folder with custom library configurations
  localAddSourceWithLibraries: (config: {
    folderPath: string
    displayName: string
    libraries: Array<{
      name: string
      path: string
      mediaType: 'movies' | 'tvshows' | 'music'
      enabled: boolean
    }>
  }) => ipcRenderer.invoke('local:addSourceWithLibraries', config),

  // ============================================================================
  // JELLYFIN (Discovery & Quick Connect)
  // ============================================================================

  // Server Discovery
  jellyfinDiscoverServers: () => ipcRenderer.invoke('jellyfin:discoverServers'),
  jellyfinTestServerUrl: (url: string) => ipcRenderer.invoke('jellyfin:testServerUrl', url),

  // API Key Authentication
  jellyfinAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) =>
    ipcRenderer.invoke('jellyfin:authenticateApiKey', serverUrl, apiKey, displayName),

  // Quick Connect
  jellyfinIsQuickConnectEnabled: (serverUrl: string) =>
    ipcRenderer.invoke('jellyfin:isQuickConnectEnabled', serverUrl),
  jellyfinInitiateQuickConnect: (serverUrl: string) =>
    ipcRenderer.invoke('jellyfin:initiateQuickConnect', serverUrl),
  jellyfinCheckQuickConnectStatus: (serverUrl: string, secret: string) =>
    ipcRenderer.invoke('jellyfin:checkQuickConnectStatus', serverUrl, secret),
  jellyfinCompleteQuickConnect: (serverUrl: string, secret: string, displayName: string) =>
    ipcRenderer.invoke('jellyfin:completeQuickConnect', serverUrl, secret, displayName),
  jellyfinAuthenticateCredentials: (
    serverUrl: string,
    username: string,
    password: string,
    displayName: string,
    isEmby: boolean = false
  ) =>
    ipcRenderer.invoke('jellyfin:authenticateCredentials', serverUrl, username, password, displayName, isEmby),

  // ============================================================================
  // EMBY (Discovery)
  // ============================================================================

  // Server Discovery
  embyDiscoverServers: () => ipcRenderer.invoke('emby:discoverServers'),
  embyTestServerUrl: (url: string) => ipcRenderer.invoke('emby:testServerUrl', url),

  // API Key Authentication
  embyAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) =>
    ipcRenderer.invoke('emby:authenticateApiKey', serverUrl, apiKey, displayName),

  // Quality Analysis
  qualityAnalyzeAll: () => ipcRenderer.invoke('quality:analyzeAll'),
  qualityGetDistribution: () => ipcRenderer.invoke('quality:getDistribution'),
  qualityGetRecommendedFormat: (mediaItemId: number) =>
    ipcRenderer.invoke('quality:getRecommendedFormat', mediaItemId),
  onQualityAnalysisProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('quality:analysisProgress', handler)
    return () => ipcRenderer.removeListener('quality:analysisProgress', handler)
  },

  // Database - Media Items
  getMediaItems: (filters?: unknown) => ipcRenderer.invoke('db:getMediaItems', filters),
  countMediaItems: (filters?: unknown) => ipcRenderer.invoke('db:countMediaItems', filters),
  getMediaItemById: (id: number) => ipcRenderer.invoke('db:getMediaItemById', id),
  upsertMediaItem: (item: unknown) => ipcRenderer.invoke('db:upsertMediaItem', item),
  deleteMediaItem: (id: number) => ipcRenderer.invoke('db:deleteMediaItem', id),

  // Database - Quality Scores
  getQualityScores: () => ipcRenderer.invoke('db:getQualityScores'),
  getQualityScoreByMediaId: (mediaItemId: number) =>
    ipcRenderer.invoke('db:getQualityScoreByMediaId', mediaItemId),
  upsertQualityScore: (score: unknown) => ipcRenderer.invoke('db:upsertQualityScore', score),

  // Database - Settings
  getSetting: (key: string) => ipcRenderer.invoke('db:getSetting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('db:setSetting', key, value),
  getAllSettings: () => ipcRenderer.invoke('db:getAllSettings'),

  // NFS Mount Mappings (for Kodi)
  getNfsMappings: () => ipcRenderer.invoke('settings:getNfsMappings'),
  setNfsMappings: (mappings: Record<string, string>) => ipcRenderer.invoke('settings:setNfsMappings', mappings),
  testNfsMapping: (nfsPath: string, localPath: string) => ipcRenderer.invoke('settings:testNfsMapping', nfsPath, localPath),

  // Settings Change Events
  onSettingsChanged: (callback: (data: { key: string; hasValue: boolean }) => void) => {
    const handler = (_event: any, data: { key: string; hasValue: boolean }) => callback(data)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },

  // Database - Data Management
  dbGetPath: () => ipcRenderer.invoke('db:getPath'),
  dbExport: () => ipcRenderer.invoke('db:export'),
  dbExportCSV: (options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }) => ipcRenderer.invoke('db:exportCSV', options),
  dbImport: () => ipcRenderer.invoke('db:import'),
  dbReset: () => ipcRenderer.invoke('db:reset'),

  // Series Completeness
  seriesAnalyzeAll: (sourceId?: string, libraryId?: string) => ipcRenderer.invoke('series:analyzeAll', sourceId, libraryId),
  seriesAnalyze: (seriesTitle: string) => ipcRenderer.invoke('series:analyze', seriesTitle),
  seriesGetAll: () => ipcRenderer.invoke('series:getAll'),
  seriesGetIncomplete: () => ipcRenderer.invoke('series:getIncomplete'),
  seriesGetStats: () => ipcRenderer.invoke('series:getStats'),
  seriesGetEpisodes: (seriesTitle: string) => ipcRenderer.invoke('series:getEpisodes', seriesTitle),
  seriesDelete: (id: number) => ipcRenderer.invoke('series:delete', id),
  seriesGetSeasonPoster: (tmdbId: string, seasonNumber: number) =>
    ipcRenderer.invoke('series:getSeasonPoster', tmdbId, seasonNumber),
  seriesGetEpisodeStill: (tmdbId: string, seasonNumber: number, episodeNumber: number) =>
    ipcRenderer.invoke('series:getEpisodeStill', tmdbId, seasonNumber, episodeNumber),
  seriesCancelAnalysis: () => ipcRenderer.invoke('series:cancelAnalysis'),
  onSeriesProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: any, progress: unknown) => callback(progress)
    ipcRenderer.on('series:progress', handler)
    return () => ipcRenderer.removeListener('series:progress', handler)
  },

  // Series Match Fixing
  seriesSearchTMDB: (query: string) => ipcRenderer.invoke('series:searchTMDB', query),
  seriesFixMatch: (seriesTitle: string, sourceId: string, tmdbId: number) =>
    ipcRenderer.invoke('series:fixMatch', seriesTitle, sourceId, tmdbId),

  // Movie Match Fixing
  movieSearchTMDB: (query: string, year?: number) => ipcRenderer.invoke('movie:searchTMDB', query, year),
  movieFixMatch: (mediaItemId: number, tmdbId: number) =>
    ipcRenderer.invoke('movie:fixMatch', mediaItemId, tmdbId),

  // Movie Collections
  collectionsAnalyzeAll: (sourceId?: string, libraryId?: string) => ipcRenderer.invoke('collections:analyzeAll', sourceId, libraryId),
  collectionsGetAll: () => ipcRenderer.invoke('collections:getAll'),
  collectionsGetIncomplete: () => ipcRenderer.invoke('collections:getIncomplete'),
  collectionsGetStats: () => ipcRenderer.invoke('collections:getStats'),
  collectionsDelete: (id: number) => ipcRenderer.invoke('collections:delete', id),
  collectionsCancelAnalysis: () => ipcRenderer.invoke('collections:cancelAnalysis'),
  onCollectionsProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: any, progress: unknown) => callback(progress)
    ipcRenderer.on('collections:progress', handler)
    return () => ipcRenderer.removeListener('collections:progress', handler)
  },

  // ============================================================================
  // MUSIC LIBRARY
  // ============================================================================

  // Music Library Scanning
  musicScanLibrary: (sourceId: string, libraryId: string) =>
    ipcRenderer.invoke('music:scanLibrary', sourceId, libraryId),
  onMusicScanProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: any, progress: unknown) => callback(progress)
    ipcRenderer.on('music:scanProgress', handler)
    return () => ipcRenderer.removeListener('music:scanProgress', handler)
  },

  // Music Data Retrieval
  musicGetArtists: (filters?: unknown) => ipcRenderer.invoke('music:getArtists', filters),
  musicGetArtistById: (id: number) => ipcRenderer.invoke('music:getArtistById', id),
  musicGetAlbums: (filters?: unknown) => ipcRenderer.invoke('music:getAlbums', filters),
  musicGetAlbumsByArtist: (artistId: number) => ipcRenderer.invoke('music:getAlbumsByArtist', artistId),
  musicGetAlbumById: (id: number) => ipcRenderer.invoke('music:getAlbumById', id),
  musicGetTracks: (filters?: unknown) => ipcRenderer.invoke('music:getTracks', filters),
  musicGetTracksByAlbum: (albumId: number) => ipcRenderer.invoke('music:getTracksByAlbum', albumId),
  musicGetStats: (sourceId?: string) => ipcRenderer.invoke('music:getStats', sourceId),

  // Music Quality Analysis
  musicGetAlbumQuality: (albumId: number) => ipcRenderer.invoke('music:getAlbumQuality', albumId),
  musicGetAlbumsNeedingUpgrade: (limit?: number) => ipcRenderer.invoke('music:getAlbumsNeedingUpgrade', limit),
  musicAnalyzeAllQuality: (sourceId?: string) => ipcRenderer.invoke('music:analyzeAllQuality', sourceId),
  onMusicQualityProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: any, progress: unknown) => callback(progress)
    ipcRenderer.on('music:qualityProgress', handler)
    return () => ipcRenderer.removeListener('music:qualityProgress', handler)
  },

  // MusicBrainz Completeness - Unified Analysis (artists + albums)
  musicAnalyzeAll: (sourceId?: string) => ipcRenderer.invoke('music:analyzeAll', sourceId),
  musicCancelAnalysis: () => ipcRenderer.invoke('music:cancelAnalysis'),
  onMusicAnalysisProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: any, progress: unknown) => callback(progress)
    ipcRenderer.on('music:analysisProgress', handler)
    return () => ipcRenderer.removeListener('music:analysisProgress', handler)
  },
  musicSearchMusicBrainzArtist: (name: string) =>
    ipcRenderer.invoke('music:searchMusicBrainzArtist', name),
  musicAnalyzeArtistCompleteness: (artistId: number) =>
    ipcRenderer.invoke('music:analyzeArtistCompleteness', artistId),
  musicGetArtistCompleteness: (artistName: string) =>
    ipcRenderer.invoke('music:getArtistCompleteness', artistName),
  musicGetAllArtistCompleteness: () => ipcRenderer.invoke('music:getAllArtistCompleteness'),

  // Music - Album Track Completeness
  musicAnalyzeAlbumTrackCompleteness: (albumId: number) =>
    ipcRenderer.invoke('music:analyzeAlbumTrackCompleteness', albumId),
  musicGetAlbumCompleteness: (albumId: number) =>
    ipcRenderer.invoke('music:getAlbumCompleteness', albumId),
  musicGetAllAlbumCompleteness: () => ipcRenderer.invoke('music:getAllAlbumCompleteness'),
  musicGetIncompleteAlbums: () => ipcRenderer.invoke('music:getIncompleteAlbums'),

  // Music - Match Fixing
  musicFixArtistMatch: (artistId: number, musicbrainzId: string) =>
    ipcRenderer.invoke('music:fixArtistMatch', artistId, musicbrainzId),
  musicSearchMusicBrainzRelease: (artistName: string, albumTitle: string) =>
    ipcRenderer.invoke('music:searchMusicBrainzRelease', artistName, albumTitle),
  musicFixAlbumMatch: (albumId: number, musicbrainzReleaseGroupId: string) =>
    ipcRenderer.invoke('music:fixAlbumMatch', albumId, musicbrainzReleaseGroupId),

  // Music - Cancellation
  musicCancelScan: (sourceId: string) => ipcRenderer.invoke('music:cancelScan', sourceId),

  // Database - Statistics
  getLibraryStats: (sourceId?: string) => ipcRenderer.invoke('db:getLibraryStats', sourceId),

  // Database - Global Search
  mediaSearch: (query: string) => ipcRenderer.invoke('media:search', query),

  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  // Wishlist CRUD
  wishlistAdd: (item: unknown) => ipcRenderer.invoke('wishlist:add', item),
  wishlistUpdate: (id: number, updates: unknown) => ipcRenderer.invoke('wishlist:update', id, updates),
  wishlistRemove: (id: number) => ipcRenderer.invoke('wishlist:remove', id),
  wishlistGetAll: (filters?: unknown) => ipcRenderer.invoke('wishlist:getAll', filters),
  wishlistGetById: (id: number) => ipcRenderer.invoke('wishlist:getById', id),
  wishlistGetCount: () => ipcRenderer.invoke('wishlist:getCount'),
  wishlistCheckExists: (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) =>
    ipcRenderer.invoke('wishlist:checkExists', tmdbId, musicbrainzId, mediaItemId),
  wishlistAddBulk: (items: unknown[]) => ipcRenderer.invoke('wishlist:addBulk', items),
  wishlistGetCountsByReason: () => ipcRenderer.invoke('wishlist:getCountsByReason'),

  // Store Search
  wishlistGetStoreLinks: (item: unknown) => ipcRenderer.invoke('wishlist:getStoreLinks', item),
  wishlistOpenStoreLink: (url: string) => ipcRenderer.invoke('wishlist:openStoreLink', url),
  wishlistSetRegion: (region: string) => ipcRenderer.invoke('wishlist:setRegion', region),
  wishlistGetRegion: () => ipcRenderer.invoke('wishlist:getRegion'),
  wishlistExportCsv: () => ipcRenderer.invoke('wishlist:exportCsv'),

  // Notifications (legacy simple notification)
  onNotification: (callback: (message: string) => void) => {
    const handler = (_event: any, message: string) => callback(message)
    ipcRenderer.on('notification', handler)
    return () => ipcRenderer.removeListener('notification', handler)
  },

  // ============================================================================
  // LIVE MONITORING
  // ============================================================================

  // Monitoring Control
  monitoringGetConfig: () => ipcRenderer.invoke('monitoring:getConfig'),
  monitoringSetConfig: (config: {
    enabled?: boolean
    startOnLaunch?: boolean
    pauseDuringManualScan?: boolean
    pollingIntervals?: Record<string, number>
  }) => ipcRenderer.invoke('monitoring:setConfig', config),
  monitoringStart: () => ipcRenderer.invoke('monitoring:start'),
  monitoringStop: () => ipcRenderer.invoke('monitoring:stop'),
  monitoringIsActive: () => ipcRenderer.invoke('monitoring:isActive'),
  monitoringForceCheck: (sourceId: string) => ipcRenderer.invoke('monitoring:forceCheck', sourceId),

  // Monitoring Events
  onMonitoringStatusChanged: (callback: (status: { isActive: boolean; lastCheck?: string }) => void) => {
    const handler = (_event: any, status: any) => callback(status)
    ipcRenderer.on('monitoring:statusChanged', handler)
    return () => ipcRenderer.removeListener('monitoring:statusChanged', handler)
  },
  onMonitoringSourceChecked: (callback: (data: { sourceId: string; hasChanges: boolean }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('monitoring:sourceChecked', handler)
    return () => ipcRenderer.removeListener('monitoring:sourceChecked', handler)
  },
  onMonitoringStatus: (callback: (status: { isActive: boolean }) => void) => {
    const handler = (_event: any, status: any) => callback(status)
    ipcRenderer.on('monitoring:status', handler)
    return () => ipcRenderer.removeListener('monitoring:status', handler)
  },
  onMonitoringEvent: (callback: (event: { type: string; message: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('monitoring:event', handler)
    return () => ipcRenderer.removeListener('monitoring:event', handler)
  },
  getMonitoringStatus: () => ipcRenderer.invoke('monitoring:getStatus'),

  // ============================================================================
  // TASK QUEUE
  // ============================================================================

  // Queue State
  taskQueueGetState: () => ipcRenderer.invoke('taskQueue:getState'),

  // Task Management
  taskQueueAddTask: (definition: {
    type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
    label: string
    sourceId?: string
    libraryId?: string
  }) => ipcRenderer.invoke('taskQueue:addTask', definition),
  taskQueueRemoveTask: (taskId: string) => ipcRenderer.invoke('taskQueue:removeTask', taskId),
  taskQueueReorderQueue: (taskIds: string[]) => ipcRenderer.invoke('taskQueue:reorderQueue', taskIds),
  taskQueueClearQueue: () => ipcRenderer.invoke('taskQueue:clearQueue'),

  // Queue Control
  taskQueuePause: () => ipcRenderer.invoke('taskQueue:pause'),
  taskQueueResume: () => ipcRenderer.invoke('taskQueue:resume'),
  taskQueueCancelCurrent: () => ipcRenderer.invoke('taskQueue:cancelCurrent'),

  // History
  taskQueueGetTaskHistory: () => ipcRenderer.invoke('taskQueue:getTaskHistory'),
  taskQueueGetMonitoringHistory: () => ipcRenderer.invoke('taskQueue:getMonitoringHistory'),
  taskQueueClearTaskHistory: () => ipcRenderer.invoke('taskQueue:clearTaskHistory'),
  taskQueueClearMonitoringHistory: () => ipcRenderer.invoke('taskQueue:clearMonitoringHistory'),

  // Task Queue Events
  onTaskQueueUpdated: (callback: (state: unknown) => void) => {
    const handler = (_event: any, state: unknown) => callback(state)
    ipcRenderer.on('taskQueue:updated', handler)
    return () => ipcRenderer.removeListener('taskQueue:updated', handler)
  },
  onTaskQueueTaskComplete: (callback: (task: unknown) => void) => {
    const handler = (_event: any, task: unknown) => callback(task)
    ipcRenderer.on('taskQueue:taskComplete', handler)
    return () => ipcRenderer.removeListener('taskQueue:taskComplete', handler)
  },
  onScanCompleted: (callback: (data: {
    sourceId?: string
    libraryId?: string
    libraryName: string
    itemsAdded: number
    itemsUpdated: number
    itemsScanned: number
    isFirstScan: boolean
  }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('scan:completed', handler)
    return () => ipcRenderer.removeListener('scan:completed', handler)
  },
  onTaskQueueHistoryUpdated: (callback: (history: { taskHistory: unknown[]; monitoringHistory: unknown[] }) => void) => {
    const handler = (_event: any, history: any) => callback(history)
    ipcRenderer.on('taskQueue:historyUpdated', handler)
    return () => ipcRenderer.removeListener('taskQueue:historyUpdated', handler)
  },

  // General
  onMessage: (callback: (message: string) => void) => {
    const handler = (_event: any, message: string) => callback(message)
    ipcRenderer.on('main-process-message', handler)
    return () => ipcRenderer.removeListener('main-process-message', handler)
  },

  // ============================================================================
  // LOGGING
  // ============================================================================
  getLogs: (limit?: number) => ipcRenderer.invoke('logs:getAll', limit),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('logs:setVerbose', enabled),
  isVerboseLogging: () => ipcRenderer.invoke('logs:isVerbose'),
  onNewLog: (callback: (entry: any) => void) => {
    const handler = (_event: any, entry: any) => callback(entry)
    ipcRenderer.on('logs:new', handler)
    return () => ipcRenderer.removeListener('logs:new', handler)
  },
})

// Type definitions for multi-source support
export interface MediaSourceResponse {
  id?: number
  source_id: string
  source_type: string
  display_name: string
  connection_config: string
  is_enabled: boolean
  last_connected_at?: string
  last_scan_at?: string
  created_at: string
  updated_at: string
}

// ConnectionTestResult - imported from shared types above

export interface ServerInstanceResponse {
  id: string
  name: string
  address: string
  port: number
  version?: string
  isLocal?: boolean
  isOwned?: boolean
  protocol?: string
}

export interface MediaLibraryResponse {
  id: string
  name: string
  type: 'movie' | 'show' | 'music' | 'unknown'
  itemCount?: number
  scannedAt?: string
}

export interface ScanResultResponse {
  success: boolean
  itemsScanned: number
  itemsAdded: number
  itemsUpdated: number
  itemsRemoved: number
  errors: string[]
  durationMs: number
}

export interface DiscoveredServerResponse {
  id: string
  name: string
  address: string
  endpointAddress?: string
  localAddress?: string
}

// Type definitions for window object
export interface ElectronAPI {
  // App lifecycle
  appReady: () => void
  getAppVersion: () => Promise<string>

  // ============================================================================
  // MEDIA SOURCES (Multi-Provider Support)
  // ============================================================================

  // Source CRUD
  sourcesAdd: (config: {
    sourceType: string
    displayName: string
    connectionConfig: Record<string, unknown>
    isEnabled?: boolean
  }) => Promise<MediaSourceResponse>
  sourcesUpdate: (sourceId: string, updates: {
    displayName?: string
    connectionConfig?: Record<string, unknown>
    isEnabled?: boolean
  }) => Promise<void>
  sourcesRemove: (sourceId: string) => Promise<void>
  sourcesList: (type?: string) => Promise<MediaSourceResponse[]>
  sourcesGet: (sourceId: string) => Promise<MediaSourceResponse | null>
  sourcesGetEnabled: () => Promise<MediaSourceResponse[]>
  sourcesToggle: (sourceId: string, enabled: boolean) => Promise<void>

  // Connection Testing
  sourcesTestConnection: (sourceId: string) => Promise<ConnectionTestResult>

  // Plex-specific Auth (new flow for multi-source)
  plexStartAuth: () => Promise<{ pinId: number; code: string; authUrl: string }>
  plexCheckAuth: (pinId: number) => Promise<string | null>
  plexAuthenticateAndDiscover: (token: string, displayName: string) => Promise<{
    source: MediaSourceResponse
    servers: ServerInstanceResponse[]
  }>
  plexSelectServerForSource: (sourceId: string, serverId: string) => Promise<{
    success: boolean
    libraries?: MediaLibraryResponse[]
  }>
  plexGetServersForSource: (sourceId: string) => Promise<ServerInstanceResponse[]>

  // Library Operations
  sourcesGetLibraries: (sourceId: string) => Promise<MediaLibraryResponse[]>
  sourcesGetLibrariesWithStatus: (sourceId: string) => Promise<Array<MediaLibraryResponse & {
    isEnabled: boolean
    lastScanAt: string | null
    itemsScanned: number
  }>>
  sourcesToggleLibrary: (sourceId: string, libraryId: string, enabled: boolean) => Promise<{ success: boolean }>
  sourcesSetLibrariesEnabled: (sourceId: string, libraries: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>) => Promise<{ success: boolean }>
  sourcesGetEnabledLibraryIds: (sourceId: string) => Promise<string[]>
  sourcesScanLibrary: (sourceId: string, libraryId: string) => Promise<ScanResultResponse>
  sourcesScanAll: () => Promise<Array<{ key: string } & ScanResultResponse>>
  sourcesStopScan: () => Promise<{ success: boolean; error?: string }>

  // Incremental Scanning
  sourcesScanLibraryIncremental: (sourceId: string, libraryId: string) => Promise<ScanResultResponse>
  sourcesScanAllIncremental: () => Promise<Array<{ key: string } & ScanResultResponse>>

  // Single Item Scan
  sourcesScanItem: (sourceId: string, libraryId: string | null, filePath: string) => Promise<ScanResultResponse>

  // Statistics
  sourcesGetStats: () => Promise<{
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
  }>
  sourcesGetSupportedProviders: () => Promise<string[]>

  // Source Events
  onSourcesScanProgress: (callback: (progress: unknown) => void) => () => void

  // Library Update Events
  onLibraryUpdated: (callback: (data: { type: 'media' | 'music'; count?: number }) => void) => () => void

  // Auto-refresh Events
  onAutoRefreshStarted: (callback: () => void) => () => void
  onAutoRefreshComplete: (callback: () => void) => () => void

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  // Detect local Kodi installation
  kodiDetectLocal: () => Promise<{
    path: string
    databasePath: string
    databaseVersion: number
    musicDatabasePath: string | null
    musicDatabaseVersion: number | null
    kodiRunning: boolean
  } | null>
  kodiIsRunning: () => Promise<boolean>

  // Kodi Collections
  kodiImportCollections: (sourceId: string) => Promise<{ imported: number; skipped: number }>
  kodiGetCollections: (sourceId: string) => Promise<Array<{
    idSet: number
    name: string
    overview: string | null
    movieCount: number
    posterUrl: string | null
    fanartUrl: string | null
  }>>
  onKodiCollectionProgress: (callback: (progress: { current: number; total: number; currentItem: string }) => void) => () => void

  // Kodi MySQL/MariaDB Connection
  kodiTestMySQLConnection: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
    ssl?: boolean
    connectionTimeout?: number
  }) => Promise<{
    success: boolean
    error?: string
    serverVersion?: string
    videoDatabaseName?: string
    videoDatabaseVersion?: number
    musicDatabaseName?: string
    musicDatabaseVersion?: number
    latencyMs?: number
  }>
  kodiDetectMySQLDatabases: (config: {
    host: string
    port?: number
    username: string
    password: string
    databasePrefix?: string
  }) => Promise<{
    videoDatabase: string | null
    videoVersion: number | null
    musicDatabase: string | null
    musicVersion: number | null
  }>
  kodiAuthenticateMySQL: (config: {
    host: string
    port?: number
    username: string
    password: string
    displayName: string
    videoDatabaseName?: string
    musicDatabaseName?: string
    databasePrefix?: string
    ssl?: boolean
  }) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    serverName?: string
    serverVersion?: string
    error?: string
  }>

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  // Check if FFprobe is available on the system
  ffprobeIsAvailable: () => Promise<boolean>

  // Get FFprobe version string
  ffprobeGetVersion: () => Promise<string | null>

  // Analyze a media file with FFprobe
  ffprobeAnalyzeFile: (filePath: string) => Promise<{
    success: boolean
    error?: string
    filePath: string
    container?: string
    duration?: number
    fileSize?: number
    overallBitrate?: number
    video?: {
      index: number
      codec: string
      profile?: string
      level?: number
      width: number
      height: number
      bitrate?: number
      frameRate?: number
      bitDepth?: number
      pixelFormat?: string
      colorSpace?: string
      colorTransfer?: string
      colorPrimaries?: string
      hdrFormat?: string
    }
    audioTracks: Array<{
      index: number
      codec: string
      profile?: string
      channels: number
      channelLayout?: string
      bitrate?: number
      sampleRate?: number
      bitDepth?: number
      language?: string
      title?: string
      isDefault: boolean
      hasObjectAudio: boolean
    }>
    subtitleTracks: Array<{
      index: number
      codec: string
      language?: string
      title?: string
      isDefault: boolean
      isForced: boolean
    }>
  }>

  // Enable/disable FFprobe analysis for a source
  ffprobeSetEnabled: (sourceId: string, enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>

  // Check if FFprobe analysis is enabled for a source
  ffprobeIsEnabled: (sourceId: string) => Promise<boolean>

  // Check if FFprobe is available for a specific source (with reason)
  ffprobeIsAvailableForSource: (sourceId: string) => Promise<{
    available: boolean
    version?: string | null
    reason?: string | null
  }>

  // Check if FFprobe can be auto-installed on this platform
  ffprobeCanInstall: () => Promise<boolean>

  // Install FFprobe automatically
  ffprobeInstall: () => Promise<{
    success: boolean
    error?: string
    path?: string
  }>

  // Uninstall bundled FFprobe
  ffprobeUninstall: () => Promise<{ success: boolean; error?: string }>

  // Check if current FFprobe is the bundled version
  ffprobeIsBundled: () => Promise<boolean>

  // Check for FFprobe updates
  ffprobeCheckForUpdate: () => Promise<{
    currentVersion: string | null
    latestVersion: string | null
    updateAvailable: boolean
    error?: string
  }>

  // Listen for FFprobe install progress
  onFFprobeInstallProgress: (callback: (progress: { stage: string; percent: number }) => void) => () => void

  // ============================================================================
  // LOCAL FOLDER SOURCE
  // ============================================================================

  // Open folder picker dialog
  localSelectFolder: () => Promise<{ cancelled: boolean; folderPath?: string; error?: string }>

  // Detect subfolders and their media types
  localDetectSubfolders: (folderPath: string) => Promise<{
    subfolders: Array<{
      name: string
      path: string
      suggestedType: 'movies' | 'tvshows' | 'music' | 'unknown'
    }>
    error?: string
  }>

  // Add a local folder as a media source
  localAddSource: (config: {
    folderPath: string
    displayName: string
    mediaType: 'movies' | 'tvshows' | 'music' | 'mixed'
  }) => Promise<MediaSourceResponse>

  // Add a local folder with custom library configurations
  localAddSourceWithLibraries: (config: {
    folderPath: string
    displayName: string
    libraries: Array<{
      name: string
      path: string
      mediaType: 'movies' | 'tvshows' | 'music'
      enabled: boolean
    }>
  }) => Promise<MediaSourceResponse>

  // ============================================================================
  // JELLYFIN (Discovery & Quick Connect)
  // ============================================================================

  // Server Discovery
  jellyfinDiscoverServers: () => Promise<DiscoveredServerResponse[]>
  jellyfinTestServerUrl: (url: string) => Promise<{
    success: boolean
    serverName?: string
    serverId?: string
    version?: string
    error?: string
  }>

  // API Key Authentication
  jellyfinAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    serverName?: string
    error?: string
  }>

  // Quick Connect
  jellyfinIsQuickConnectEnabled: (serverUrl: string) => Promise<boolean>
  jellyfinInitiateQuickConnect: (serverUrl: string) => Promise<{
    secret: string
    code: string
  } | null>
  jellyfinCheckQuickConnectStatus: (serverUrl: string, secret: string) => Promise<{
    authenticated: boolean
    error?: string
  }>
  jellyfinCompleteQuickConnect: (serverUrl: string, secret: string, displayName: string) => Promise<{
    success: boolean
    source: MediaSourceResponse
    userName?: string
  }>
  jellyfinAuthenticateCredentials: (
    serverUrl: string,
    username: string,
    password: string,
    displayName: string,
    isEmby?: boolean
  ) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    userName?: string
    error?: string
  }>

  // ============================================================================
  // EMBY (Discovery)
  // ============================================================================

  // Server Discovery
  embyDiscoverServers: () => Promise<DiscoveredServerResponse[]>
  embyTestServerUrl: (url: string) => Promise<{
    success: boolean
    serverName?: string
    serverId?: string
    version?: string
    error?: string
  }>

  // API Key Authentication
  embyAuthenticateApiKey: (serverUrl: string, apiKey: string, displayName: string) => Promise<{
    success: boolean
    source?: MediaSourceResponse
    serverName?: string
    error?: string
  }>

  // Quality Analysis
  qualityAnalyzeAll: () => Promise<number>
  qualityGetDistribution: () => Promise<{
    byTier: {
      [tier: string]: { low: number; medium: number; high: number }
    }
    byQuality: {
      low: number
      medium: number
      high: number
    }
  }>
  qualityGetRecommendedFormat: (mediaItemId: number) => Promise<string>
  onQualityAnalysisProgress: (callback: (progress: unknown) => void) => () => void

  // Database - Media Items
  getMediaItems: (filters?: unknown) => Promise<unknown[]>
  countMediaItems: (filters?: unknown) => Promise<number>
  getMediaItemById: (id: number) => Promise<unknown | null>
  upsertMediaItem: (item: unknown) => Promise<number>
  deleteMediaItem: (id: number) => Promise<boolean>

  // Database - Quality Scores
  getQualityScores: () => Promise<unknown[]>
  getQualityScoreByMediaId: (mediaItemId: number) => Promise<unknown | null>
  upsertQualityScore: (score: unknown) => Promise<number>

  // Database - Settings
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<boolean>
  getAllSettings: () => Promise<Record<string, string>>

  // NFS Mount Mappings (for Kodi)
  getNfsMappings: () => Promise<Record<string, string>>
  setNfsMappings: (mappings: Record<string, string>) => Promise<boolean>
  testNfsMapping: (nfsPath: string, localPath: string) => Promise<{
    success: boolean
    error?: string
    folderCount?: number
    fileCount?: number
    message?: string
  }>

  // Settings Change Events
  onSettingsChanged: (callback: (data: { key: string; hasValue: boolean }) => void) => () => void

  // Database - Data Management
  dbGetPath: () => Promise<string>
  dbExport: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
  dbExportCSV: (options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }) => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
  dbImport: () => Promise<{ success: boolean; imported?: number; errors?: string[]; cancelled?: boolean }>
  dbReset: () => Promise<{ success: boolean }>

  // Series Completeness
  seriesAnalyzeAll: (sourceId?: string, libraryId?: string) => Promise<{ completed: boolean; analyzed: number }>
  seriesAnalyze: (seriesTitle: string) => Promise<unknown | null>
  seriesGetAll: () => Promise<unknown[]>
  seriesGetIncomplete: () => Promise<unknown[]>
  seriesGetStats: () => Promise<{
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  }>
  seriesGetEpisodes: (seriesTitle: string) => Promise<unknown[]>
  seriesDelete: (id: number) => Promise<boolean>
  seriesGetSeasonPoster: (tmdbId: string, seasonNumber: number) => Promise<string | null>
  seriesGetEpisodeStill: (tmdbId: string, seasonNumber: number, episodeNumber: number) => Promise<string | null>
  seriesCancelAnalysis: () => Promise<{ success: boolean }>
  onSeriesProgress: (callback: (progress: unknown) => void) => () => void

  // Series Match Fixing
  seriesSearchTMDB: (query: string) => Promise<Array<{
    id: number
    name: string
    first_air_date: string
    overview: string
    poster_url: string | null
    vote_average: number
  }>>
  seriesFixMatch: (seriesTitle: string, sourceId: string, tmdbId: number) => Promise<{
    success: boolean
    updatedEpisodes: number
    completeness: unknown
  }>

  // Movie Match Fixing
  movieSearchTMDB: (query: string, year?: number) => Promise<Array<{
    id: number
    title: string
    release_date: string
    overview: string
    poster_url: string | null
    vote_average: number
  }>>
  movieFixMatch: (mediaItemId: number, tmdbId: number) => Promise<{
    success: boolean
    tmdbId: number
    posterUrl?: string
    title: string
  }>

  // Movie Collections
  collectionsAnalyzeAll: (sourceId?: string, libraryId?: string) => Promise<{ success: boolean; completed: boolean; analyzed: number }>
  collectionsGetAll: () => Promise<unknown[]>
  collectionsGetIncomplete: () => Promise<unknown[]>
  collectionsGetStats: () => Promise<{
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  }>
  collectionsDelete: (id: number) => Promise<boolean>
  collectionsCancelAnalysis: () => Promise<{ success: boolean }>
  onCollectionsProgress: (callback: (progress: unknown) => void) => () => void

  // ============================================================================
  // MUSIC LIBRARY
  // ============================================================================

  // Music Library Scanning
  musicScanLibrary: (sourceId: string, libraryId: string) => Promise<{
    success: boolean
    itemsScanned: number
    itemsAdded: number
    itemsUpdated: number
    itemsRemoved: number
    errors: string[]
    durationMs: number
  }>
  onMusicScanProgress: (callback: (progress: unknown) => void) => () => void

  // Music Data Retrieval
  musicGetArtists: (filters?: unknown) => Promise<unknown[]>
  musicGetArtistById: (id: number) => Promise<unknown | null>
  musicGetAlbums: (filters?: unknown) => Promise<unknown[]>
  musicGetAlbumsByArtist: (artistId: number) => Promise<unknown[]>
  musicGetAlbumById: (id: number) => Promise<unknown | null>
  musicGetTracks: (filters?: unknown) => Promise<unknown[]>
  musicGetTracksByAlbum: (albumId: number) => Promise<unknown[]>
  musicGetStats: (sourceId?: string) => Promise<{
    totalArtists: number
    totalAlbums: number
    totalTracks: number
    losslessAlbums: number
    hiResAlbums: number
    avgBitrate: number
  }>

  // Music Quality Analysis
  musicGetAlbumQuality: (albumId: number) => Promise<unknown | null>
  musicGetAlbumsNeedingUpgrade: (limit?: number) => Promise<unknown[]>
  musicAnalyzeAllQuality: (sourceId?: string) => Promise<{ success: boolean; analyzed: number }>
  onMusicQualityProgress: (callback: (progress: unknown) => void) => () => void

  // MusicBrainz Completeness - Unified Analysis
  musicAnalyzeAll: (sourceId?: string) => Promise<{ success: boolean }>
  musicCancelAnalysis: () => Promise<{ success: boolean }>
  onMusicAnalysisProgress: (callback: (progress: unknown) => void) => () => void

  // MusicBrainz Completeness
  musicConfigureMusicBrainzApi: (apiUrl: string, apiToken: string) => Promise<{ success: boolean }>
  musicUsePublicMusicBrainzApi: () => Promise<{ success: boolean }>
  musicSearchMusicBrainzArtist: (name: string) => Promise<unknown[]>
  musicAnalyzeArtistCompleteness: (artistId: number) => Promise<unknown>
  musicAnalyzeAllArtistsCompleteness: () => Promise<{ success: boolean }>
  musicGetArtistCompleteness: (artistName: string) => Promise<unknown | null>
  musicGetAllArtistCompleteness: () => Promise<unknown[]>
  onMusicCompletenessProgress: (callback: (progress: unknown) => void) => void

  // Album Track Completeness
  musicAnalyzeAlbumTrackCompleteness: (albumId: number) => Promise<unknown | null>
  musicAnalyzeAllAlbumsTrackCompleteness: () => Promise<{ success: boolean }>
  musicGetAlbumCompleteness: (albumId: number) => Promise<unknown | null>
  musicGetAllAlbumCompleteness: () => Promise<unknown[]>
  musicGetIncompleteAlbums: () => Promise<unknown[]>
  onMusicTrackCompletenessProgress: (callback: (progress: unknown) => void) => void

  // Music - Match Fixing
  musicFixArtistMatch: (artistId: number, musicbrainzId: string) => Promise<{
    success: boolean
    completeness: unknown
  }>
  musicSearchMusicBrainzRelease: (artistName: string, albumTitle: string) => Promise<unknown[]>
  musicFixAlbumMatch: (albumId: number, musicbrainzReleaseGroupId: string) => Promise<{
    success: boolean
    completeness: unknown
  }>

  // Music - Cancellation
  musicCancelScan: (sourceId: string) => Promise<{ success: boolean }>
  musicCancelArtistAnalysis: () => Promise<{ success: boolean }>
  musicCancelTrackAnalysis: () => Promise<{ success: boolean }>

  // Database - Statistics
  getLibraryStats: (sourceId?: string) => Promise<{
    totalItems: number
    totalMovies: number
    totalEpisodes: number
    totalShows: number
    lowQualityCount: number
    needsUpgradeCount: number
    averageQualityScore: number
    movieNeedsUpgradeCount: number
    movieAverageQualityScore: number
    tvNeedsUpgradeCount: number
    tvAverageQualityScore: number
  }>

  // Database - Global Search
  mediaSearch: (query: string) => Promise<{
    movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
    artists: Array<{ id: number; name: string; thumb_url?: string }>
    albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
    tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string }>
  }>

  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  // Wishlist CRUD
  wishlistAdd: (item: {
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    reason?: 'missing' | 'upgrade'
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority?: 1 | 2 | 3 | 4 | 5
    notes?: string
    current_quality_tier?: string
    current_quality_level?: string
    current_resolution?: string
    current_video_codec?: string
    current_audio_codec?: string
    media_item_id?: number
  }) => Promise<number>
  wishlistUpdate: (id: number, updates: {
    priority?: 1 | 2 | 3 | 4 | 5
    notes?: string
    poster_url?: string
    status?: 'active' | 'completed'
  }) => Promise<{ success: boolean }>
  wishlistRemove: (id: number) => Promise<{ success: boolean }>
  wishlistGetAll: (filters?: {
    media_type?: 'movie' | 'episode' | 'season' | 'album' | 'track'
    priority?: 1 | 2 | 3 | 4 | 5
    reason?: 'missing' | 'upgrade'
    status?: 'active' | 'completed'
    searchQuery?: string
    series_title?: string
    artist_name?: string
    sortBy?: 'added_at' | 'priority' | 'title' | 'year' | 'completed_at'
    sortOrder?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) => Promise<Array<{
    id: number
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    reason: 'missing' | 'upgrade'
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority: 1 | 2 | 3 | 4 | 5
    notes?: string
    current_quality_tier?: string
    current_quality_level?: string
    current_resolution?: string
    current_video_codec?: string
    current_audio_codec?: string
    media_item_id?: number
    added_at: string
    updated_at: string
  }>>
  wishlistGetById: (id: number) => Promise<{
    id: number
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    reason: 'missing' | 'upgrade'
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority: 1 | 2 | 3 | 4 | 5
    notes?: string
    current_quality_tier?: string
    current_quality_level?: string
    current_resolution?: string
    current_video_codec?: string
    current_audio_codec?: string
    media_item_id?: number
    added_at: string
    updated_at: string
  } | null>
  wishlistGetCount: () => Promise<number>
  wishlistGetCountsByReason: () => Promise<{ missing: number; upgrade: number; active: number; completed: number; total: number }>
  wishlistCheckExists: (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) => Promise<boolean>
  wishlistAddBulk: (items: Array<{
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority?: 1 | 2 | 3 | 4 | 5
    notes?: string
  }>) => Promise<{ success: boolean; added: number }>

  // Store Search
  wishlistGetStoreLinks: (item: {
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    year?: number
    series_title?: string
    season_number?: number
    artist_name?: string
    album_title?: string
  }) => Promise<Array<{
    name: string
    url: string
    icon: string
    category: 'aggregator' | 'digital' | 'physical'
  }>>
  wishlistOpenStoreLink: (url: string) => Promise<{ success: boolean }>
  wishlistSetRegion: (region: 'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au') => Promise<{ success: boolean }>
  wishlistGetRegion: () => Promise<'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au'>
  wishlistExportCsv: () => Promise<{ success: boolean; path?: string; count?: number; cancelled?: boolean }>

  // Notifications (legacy)
  onNotification: (callback: (message: string) => void) => () => void

  // ============================================================================
  // LIVE MONITORING
  // ============================================================================

  // Monitoring Control
  monitoringGetConfig: () => Promise<{
    enabled: boolean
    startOnLaunch: boolean
    pauseDuringManualScan: boolean
    pollingIntervals: Record<string, number>
  }>
  monitoringSetConfig: (config: {
    enabled?: boolean
    startOnLaunch?: boolean
    pauseDuringManualScan?: boolean
    pollingIntervals?: Record<string, number>
  }) => Promise<{ success: boolean }>
  monitoringStart: () => Promise<{ success: boolean }>
  monitoringStop: () => Promise<{ success: boolean }>
  monitoringIsActive: () => Promise<boolean>
  monitoringForceCheck: (sourceId: string) => Promise<Array<{
    sourceId: string
    sourceName: string
    sourceType: string
    libraryId: string
    libraryName: string
    changeType: 'added' | 'updated' | 'removed'
    itemCount: number
    items: Array<{
      id: string
      title: string
      type: 'movie' | 'episode' | 'album' | 'track' | 'artist'
      year?: number
      posterUrl?: string
      seriesTitle?: string
      artistName?: string
    }>
    detectedAt: string
  }>>

  // Monitoring Events
  onMonitoringStatusChanged: (callback: (status: { isActive: boolean; lastCheck?: string }) => void) => () => void
  onMonitoringSourceChecked: (callback: (data: { sourceId: string; hasChanges: boolean }) => void) => () => void
  onMonitoringStatus: (callback: (status: { isActive: boolean }) => void) => () => void
  onMonitoringEvent: (callback: (event: { type: string; message: string }) => void) => () => void
  getMonitoringStatus: () => Promise<{ isActive: boolean }>

  // ============================================================================
  // TASK QUEUE
  // ============================================================================

  // Queue State
  taskQueueGetState: () => Promise<{
    currentTask: {
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    } | null
    queue: Array<{
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    }>
    isPaused: boolean
    completedTasks: Array<{
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    }>
  }>

  // Task Management
  taskQueueAddTask: (definition: {
    type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
    label: string
    sourceId?: string
    libraryId?: string
  }) => Promise<{ success: boolean; taskId: string }>
  taskQueueRemoveTask: (taskId: string) => Promise<{ success: boolean }>
  taskQueueReorderQueue: (taskIds: string[]) => Promise<{ success: boolean }>
  taskQueueClearQueue: () => Promise<{ success: boolean }>

  // Queue Control
  taskQueuePause: () => Promise<{ success: boolean }>
  taskQueueResume: () => Promise<{ success: boolean }>
  taskQueueCancelCurrent: () => Promise<{ success: boolean }>

  // History
  taskQueueGetTaskHistory: () => Promise<Array<{
    id: string
    timestamp: string
    type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
    message: string
    taskId?: string
    taskType?: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
  }>>
  taskQueueGetMonitoringHistory: () => Promise<Array<{
    id: string
    timestamp: string
    type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
    message: string
    taskId?: string
    taskType?: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
  }>>
  taskQueueClearTaskHistory: () => Promise<{ success: boolean }>
  taskQueueClearMonitoringHistory: () => Promise<{ success: boolean }>

  // Task Queue Events
  onTaskQueueUpdated: (callback: (state: {
    currentTask: {
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    } | null
    queue: unknown[]
    isPaused: boolean
    completedTasks: unknown[]
  }) => void) => () => void
  onTaskQueueTaskComplete: (callback: (task: {
    id: string
    type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
    label: string
    status: 'completed' | 'failed' | 'cancelled'
    completedAt: string
    error?: string
    result?: {
      itemsScanned?: number
      itemsAdded?: number
      itemsUpdated?: number
      itemsRemoved?: number
    }
  }) => void) => () => void
  onScanCompleted: (callback: (data: {
    sourceId?: string
    libraryId?: string
    libraryName: string
    itemsAdded: number
    itemsUpdated: number
    itemsScanned: number
    isFirstScan: boolean
  }) => void) => () => void
  onTaskQueueHistoryUpdated: (callback: (history: {
    taskHistory: Array<{
      id: string
      timestamp: string
      type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
      message: string
      taskId?: string
      taskType?: string
    }>
    monitoringHistory: Array<{
      id: string
      timestamp: string
      type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
      message: string
      taskId?: string
      taskType?: string
    }>
  }) => void) => () => void

  // General
  onMessage: (callback: (message: string) => void) => () => void

  // ============================================================================
  // LOGGING
  // ============================================================================
  getLogs: (limit?: number) => Promise<any[]>
  clearLogs: () => Promise<void>
  exportLogs: () => Promise<{
    success: boolean
    filePath?: string
    error?: string
    canceled?: boolean
  }>
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>
  isVerboseLogging: () => Promise<boolean>
  onNewLog?: (callback: (entry: any) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
