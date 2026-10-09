/**
 * IPC Channel Map
 *
 * Maps ElectronAPI method names to their IPC channel strings.
 * Used by the WebSocket transport proxy to resolve method calls to channels.
 * Source of truth: src/preload/index.ts
 */

/** Request-response channels (ipcRenderer.invoke) */
export const RPC_CHANNEL_MAP: Record<string, string> = {
  // App lifecycle
  appReady: 'app:ready', // Note: this is ipcRenderer.send, not invoke
  getAppVersion: 'app:getVersion',
  openExternal: 'app:openExternal',

  // Media Sources
  sourcesAdd: 'sources:add',
  sourcesUpdate: 'sources:update',
  sourcesRemove: 'sources:remove',
  sourcesList: 'sources:list',
  sourcesGet: 'sources:get',
  sourcesGetEnabled: 'sources:getEnabled',
  sourcesToggle: 'sources:toggle',
  sourcesTestConnection: 'sources:testConnection',
  sourcesGetLibraries: 'sources:getLibraries',
  sourcesGetLibrariesWithStatus: 'sources:getLibrariesWithStatus',
  sourcesToggleLibrary: 'sources:toggleLibrary',
  sourcesSetLibraryUpgradeTier: 'sources:setLibraryUpgradeTier',
  sourcesSetLibrariesEnabled: 'sources:setLibrariesEnabled',
  sourcesGetEnabledLibraryIds: 'sources:getEnabledLibraryIds',
  sourcesScanLibrary: 'sources:scanLibrary',
  sourcesScanAll: 'sources:scanAll',
  sourcesStopScan: 'sources:stopScan',
  sourcesScanLibraryIncremental: 'sources:scanLibraryIncremental',
  sourcesScanAllIncremental: 'sources:scanAllIncremental',
  sourcesScanItem: 'sources:scanItem',
  sourcesGetStats: 'sources:getStats',
  sourcesGetSupportedProviders: 'sources:getSupportedProviders',

  // Plex Auth
  plexStartAuth: 'plex:startAuth',
  plexCheckAuth: 'plex:checkAuth',
  plexAuthenticateAndDiscover: 'plex:authenticateAndDiscover',
  plexSelectServerForSource: 'plex:selectServer',
  plexGetServersForSource: 'plex:getServers',

  // Kodi
  kodiDetectLocal: 'kodi:detectLocal',
  kodiIsRunning: 'kodi:isRunning',
  kodiImportCollections: 'kodi:importCollections',
  kodiGetCollections: 'kodi:getCollections',
  kodiTestMySQLConnection: 'kodi:testMySQLConnection',
  kodiDetectMySQLDatabases: 'kodi:detectMySQLDatabases',
  kodiAuthenticateMySQL: 'kodi:authenticateMySQL',

  // MediaMonkey
  mediamonkeyDetectLocal: 'mediamonkey:detectLocal',
  mediamonkeySelectDatabase: 'mediamonkey:selectDatabase',
  mediamonkeyIsRunning: 'mediamonkey:isRunning',

  // Mood sync
  moodCheckMediaMonkeyWrite: 'mood:checkMediaMonkeyWrite',
  moodGetSources: 'mood:getSources',
  moodGetComparison: 'mood:getComparison',
  moodSyncToTarget: 'mood:syncToTarget',

  // FFprobe
  ffprobeIsAvailable: 'ffprobe:isAvailable',
  ffprobeGetVersion: 'ffprobe:getVersion',
  ffprobeAnalyzeFile: 'ffprobe:analyzeFile',
  ffprobeSetEnabled: 'ffprobe:setEnabled',
  ffprobeIsEnabled: 'ffprobe:isEnabled',
  ffprobeIsAvailableForSource: 'ffprobe:isAvailableForSource',
  ffprobeCanInstall: 'ffprobe:canInstall',
  ffprobeInstall: 'ffprobe:install',
  ffprobeUninstall: 'ffprobe:uninstall',
  ffprobeIsBundled: 'ffprobe:isBundled',
  ffmpegIsAvailable: 'ffmpeg:isAvailable',
  ffprobeCheckForUpdate: 'ffprobe:checkForUpdate',

  // Local Folder
  localSelectFolder: 'local:selectFolder',
  localDetectSubfolders: 'local:detectSubfolders',
  localAddSource: 'local:addSource',
  localAddSourceWithLibraries: 'local:addSourceWithLibraries',

  // Jellyfin
  jellyfinDiscoverServers: 'jellyfin:discoverServers',
  jellyfinTestServerUrl: 'jellyfin:testServerUrl',
  jellyfinAuthenticateApiKey: 'jellyfin:authenticateApiKey',
  jellyfinIsQuickConnectEnabled: 'jellyfin:isQuickConnectEnabled',
  jellyfinInitiateQuickConnect: 'jellyfin:initiateQuickConnect',
  jellyfinCheckQuickConnectStatus: 'jellyfin:checkQuickConnectStatus',
  jellyfinCompleteQuickConnect: 'jellyfin:completeQuickConnect',
  jellyfinAuthenticateCredentials: 'jellyfin:authenticateCredentials',

  // Emby
  embyDiscoverServers: 'emby:discoverServers',
  embyTestServerUrl: 'emby:testServerUrl',
  embyAuthenticateApiKey: 'emby:authenticateApiKey',

  // Quality
  qualityAnalyzeAll: 'quality:analyzeAll',
  qualityGetDistribution: 'quality:getDistribution',
  qualityGetRecommendedFormat: 'quality:getRecommendedFormat',

  // Database - Media Items
  getMediaItems: 'db:getMediaItems',
  countMediaItems: 'db:countMediaItems',
  getTVShows: 'db:getTVShows',
  countTVShows: 'db:countTVShows',
  countTVEpisodes: 'db:countTVEpisodes',
  getLetterOffset: 'db:getLetterOffset',
  getMediaItemById: 'db:getMediaItemById',
  upsertMediaItem: 'db:upsertMediaItem',
  deleteMediaItem: 'db:deleteMediaItem',
  getMediaItemVersions: 'db:getMediaItemVersions',

  // Database - Quality Scores
  getQualityScores: 'db:getQualityScores',
  getQualityScoreByMediaId: 'db:getQualityScoreByMediaId',
  upsertQualityScore: 'db:upsertQualityScore',

  // Database - Settings
  getSetting: 'db:getSetting',
  setSetting: 'db:setSetting',
  getAllSettings: 'db:getAllSettings',

  // NFS Mappings
  getNfsMappings: 'settings:getNfsMappings',
  setNfsMappings: 'settings:setNfsMappings',
  testNfsMapping: 'settings:testNfsMapping',

  // Database - Data Management
  dbGetPath: 'db:getPath',
  dbOpenFolder: 'db:openFolder',
  dbExport: 'db:export',
  dbExportCSV: 'db:exportCSV',
  dbImport: 'db:import',
  dbReset: 'db:reset',
  dbResetLibraryData: 'db:resetLibraryData',

  // Series Completeness
  seriesAnalyzeAll: 'series:analyzeAll',
  seriesAnalyze: 'series:analyze',
  seriesGetAll: 'series:getAll',
  seriesGetIncomplete: 'series:getIncomplete',
  seriesGetStats: 'series:getStats',
  seriesGetEpisodes: 'series:getEpisodes',
  seriesDelete: 'series:delete',
  tmdbGetMovieDetails: 'tmdb:getMovieDetails',
  tmdbGetTVShowDetails: 'tmdb:getTVShowDetails',
  seriesGetSeasonDetails: 'series:getSeasonDetails',
  seriesGetSeasonPoster: 'series:getSeasonPoster',
  seriesGetEpisodeStill: 'series:getEpisodeStill',
  seriesCancelAnalysis: 'series:cancelAnalysis',
  seriesSearchTMDB: 'series:searchTMDB',
  seriesFixMatch: 'series:fixMatch',

  // Movie Match
  movieSearchTMDB: 'movie:searchTMDB',
  movieFixMatch: 'movie:fixMatch',

  // Collections
  collectionsAnalyzeAll: 'collections:analyzeAll',
  collectionsGetAll: 'collections:getAll',
  collectionsGetIncomplete: 'collections:getIncomplete',
  collectionsGetStats: 'collections:getStats',
  collectionsDelete: 'collections:delete',
  collectionsCancelAnalysis: 'collections:cancelAnalysis',

  // Music
  musicScanLibrary: 'music:scanLibrary',
  musicGetArtists: 'music:getArtists',
  musicGetArtistById: 'music:getArtistById',
  musicGetAlbums: 'music:getAlbums',
  musicGetAlbumsByArtist: 'music:getAlbumsByArtist',
  musicGetAlbumById: 'music:getAlbumById',
  musicGetTracks: 'music:getTracks',
  musicGetTracksByAlbum: 'music:getTracksByAlbum',
  musicGetStats: 'music:getStats',
  musicCountArtists: 'music:countArtists',
  musicCountAlbums: 'music:countAlbums',
  musicCountTracks: 'music:countTracks',
  musicGetAlbumQuality: 'music:getAlbumQuality',
  musicGetAlbumsNeedingUpgrade: 'music:getAlbumsNeedingUpgrade',
  musicAnalyzeAllQuality: 'music:analyzeAllQuality',
  musicAnalyzeAll: 'music:analyzeAll',
  musicCancelAnalysis: 'music:cancelAnalysis',
  musicSearchMusicBrainzArtist: 'music:searchMusicBrainzArtist',
  musicAnalyzeArtistCompleteness: 'music:analyzeArtistCompleteness',
  musicGetArtistCompleteness: 'music:getArtistCompleteness',
  musicGetAllArtistCompleteness: 'music:getAllArtistCompleteness',
  musicAnalyzeAlbumTrackCompleteness: 'music:analyzeAlbumTrackCompleteness',
  musicGetAlbumCompleteness: 'music:getAlbumCompleteness',
  musicGetAllAlbumCompleteness: 'music:getAllAlbumCompleteness',
  musicGetIncompleteAlbums: 'music:getIncompleteAlbums',
  musicFixArtistMatch: 'music:fixArtistMatch',
  musicSearchMusicBrainzRelease: 'music:searchMusicBrainzRelease',
  musicFixAlbumMatch: 'music:fixAlbumMatch',
  musicCancelScan: 'music:cancelScan',

  // Statistics
  getLibraryStats: 'db:getLibraryStats',
  getStorageAnalytics: 'db:getStorageAnalytics',
  getDuplicateMedia: 'db:getDuplicateMedia',
  getLibraryHealthScores: 'db:getLibraryHealthScores',
  getRecentlyUpgraded: 'db:getRecentlyUpgraded',
  getRecentlyAdded: 'db:getRecentlyAdded',

  // Person completeness
  personGetCompleteness: 'person:getCompleteness',
  personSearchTMDB: 'person:searchTMDB',
  personAnalyze: 'person:analyze',
  personDelete: 'person:delete',

  // Watchlist sync
  syncPlexWatchlist: 'sync:plex-watchlist',
  syncTrakt: 'sync:trakt',
  fetchPlexWatchlist: 'sync:fetchPlex',
  fetchTraktWatchlist: 'sync:fetchTrakt',

  // Release alerts
  releaseAlertsCheck: 'release-alerts:check',

  // Search
  mediaSearch: 'media:search',

  // Exclusions
  addExclusion: 'db:addExclusion',
  removeExclusion: 'db:removeExclusion',
  getExclusions: 'db:getExclusions',

  // Wishlist
  wishlistAdd: 'wishlist:add',
  wishlistUpdate: 'wishlist:update',
  wishlistRemove: 'wishlist:remove',
  wishlistGetAll: 'wishlist:getAll',
  wishlistGetById: 'wishlist:getById',
  wishlistGetCount: 'wishlist:getCount',
  wishlistCheckExists: 'wishlist:checkExists',
  wishlistAddBulk: 'wishlist:addBulk',
  wishlistGetCountsByReason: 'wishlist:getCountsByReason',
  wishlistGetStoreLinks: 'wishlist:getStoreLinks',
  wishlistOpenStoreLink: 'wishlist:openStoreLink',
  wishlistSetRegion: 'wishlist:setRegion',
  wishlistGetRegion: 'wishlist:getRegion',
  wishlistExportCsv: 'wishlist:exportCsv',

  // Monitoring
  monitoringGetConfig: 'monitoring:getConfig',
  monitoringSetConfig: 'monitoring:setConfig',
  monitoringStart: 'monitoring:start',
  monitoringStop: 'monitoring:stop',
  monitoringIsActive: 'monitoring:isActive',
  monitoringForceCheck: 'monitoring:forceCheck',
  getMonitoringStatus: 'monitoring:getStatus',

  // Notifications
  notificationsGetAll: 'notifications:getAll',
  notificationsGetCount: 'notifications:getCount',
  notificationsMarkRead: 'notifications:markRead',
  notificationsMarkAllRead: 'notifications:markAllRead',
  notificationsDelete: 'notifications:delete',
  notificationsClear: 'notifications:clear',

  // Task Queue
  taskQueueGetState: 'taskQueue:getState',
  taskQueueAddTask: 'taskQueue:addTask',
  taskQueueRemoveTask: 'taskQueue:removeTask',
  taskQueueReorderQueue: 'taskQueue:reorderQueue',
  taskQueueClearQueue: 'taskQueue:clearQueue',
  taskQueuePause: 'taskQueue:pause',
  taskQueueResume: 'taskQueue:resume',
  taskQueueCancelCurrent: 'taskQueue:cancelCurrent',
  taskQueueGetTaskHistory: 'taskQueue:getTaskHistory',
  taskQueueGetMonitoringHistory: 'taskQueue:getMonitoringHistory',
  taskQueueClearTaskHistory: 'taskQueue:clearTaskHistory',
  taskQueueClearMonitoringHistory: 'taskQueue:clearMonitoringHistory',

  // Auto Update
  autoUpdateGetState: 'autoUpdate:getState',
  autoUpdateCheckForUpdates: 'autoUpdate:checkForUpdates',
  autoUpdateDownloadUpdate: 'autoUpdate:downloadUpdate',
  autoUpdateInstallUpdate: 'autoUpdate:installUpdate',

  // AI
  aiIsConfigured: 'ai:isConfigured',
  aiGetRateLimitInfo: 'ai:getRateLimitInfo',
  aiTestApiKey: 'ai:testApiKey',
  aiSendMessage: 'ai:sendMessage',
  aiStreamMessage: 'ai:streamMessage',
  aiChatMessage: 'ai:chatMessage',
  aiQualityReport: 'ai:qualityReport',
  aiUpgradePriorities: 'ai:upgradePriorities',
  aiCompletenessInsights: 'ai:completenessInsights',
  aiWishlistAdvice: 'ai:wishlistAdvice',
  aiStorageOptimization: 'ai:storageOptimization',
  aiMusicQualityReport: 'ai:musicQualityReport',
  aiExplainQuality: 'ai:explainQuality',

  // Logging
  getLogs: 'logs:getAll',
  clearLogs: 'logs:clear',
  exportLogs: 'logs:export',
  setVerboseLogging: 'logs:setVerbose',
  isVerboseLogging: 'logs:isVerbose',
  getFileLoggingSettings: 'logs:getFileLoggingSettings',
  setFileLoggingSettings: 'logs:setFileLoggingSettings',
  openLogFolder: 'logs:openLogFolder',

  // Web Access
  webAccessGetStatus: 'webAccess:getStatus',
  webAccessStart: 'webAccess:start',
  webAccessStop: 'webAccess:stop',
}

/** Event channels (ipcRenderer.on) — maps listener method name to channel */
export const EVENT_CHANNEL_MAP: Record<string, string> = {
  onSourcesScanProgress: 'sources:scanProgress',
  onLibraryUpdated: 'library:updated',
  onAutoRefreshStarted: 'scan:autoRefreshStarted',
  onAutoRefreshComplete: 'scan:autoRefreshComplete',
  onMoodSyncProgress: 'mood:syncProgress',
  onKodiCollectionProgress: 'kodi:collectionProgress',
  onFFprobeInstallProgress: 'ffprobe:installProgress',
  onQualityAnalysisProgress: 'quality:analysisProgress',
  onSettingsChanged: 'settings:changed',
  onSeriesProgress: 'series:progress',
  onCollectionsProgress: 'collections:progress',
  onMusicScanProgress: 'music:scanProgress',
  onMusicQualityProgress: 'music:qualityProgress',
  onMusicAnalysisProgress: 'music:analysisProgress',
  onMonitoringStatusChanged: 'monitoring:statusChanged',
  onMonitoringSourceChecked: 'monitoring:sourceChecked',
  onMonitoringStatus: 'monitoring:status',
  onMonitoringEvent: 'monitoring:event',
  onNotification: 'notification',
  onNotificationsNew: 'notifications:new',
  onTaskQueueUpdated: 'taskQueue:updated',
  onTaskQueueTaskComplete: 'taskQueue:taskComplete',
  onScanCompleted: 'scan:completed',
  onTaskQueueHistoryUpdated: 'taskQueue:historyUpdated',
  onWishlistAutoCompleted: 'wishlist:autoCompleted',
  onWishlistChanged: 'wishlist:changed',
  onMessage: 'main-process-message',
  onAutoUpdateStateChanged: 'autoUpdate:stateChanged',
  onAiStreamDelta: 'ai:streamDelta',
  onAiStreamComplete: 'ai:streamComplete',
  onAiToolUse: 'ai:toolUse',
  onAiChatStreamDelta: 'ai:chatStreamDelta',
  onAiChatStreamComplete: 'ai:chatStreamComplete',
  onAiAnalysisStreamDelta: 'ai:analysisStreamDelta',
  onAiAnalysisStreamComplete: 'ai:analysisStreamComplete',
  onNewLog: 'logs:new',
}

/** Channels that must NOT be exposed to web clients */
export const WEB_DENIED_CHANNELS = new Set([
  // File system / shell operations
  'app:openExternal',
  'db:openFolder',
  'db:export',
  'db:exportCSV',
  'db:import',
  'db:getPath',
  'sources:scanItem',
  'local:selectFolder',
  'logs:export',
  'logs:openLogFolder',
  'wishlist:openStoreLink',
  'wishlist:exportCsv',
  'mediamonkey:selectDatabase',
  // Auto-update (desktop only)
  'autoUpdate:getState',
  'autoUpdate:checkForUpdates',
  'autoUpdate:downloadUpdate',
  'autoUpdate:installUpdate',
  // Destructive operations
  'db:reset',
  'db:resetLibraryData',
  // db:getAllSettings — handled separately via response filtering (strips sensitive values)
  // Sources with raw credentials (handled separately via response filtering)
  'sources:get',             // Single source with decrypted connection_config
  // Web access control (prevent web clients from modifying their own auth)
  'webAccess:getStatus',
  'webAccess:start',
  'webAccess:stop',
])

/** Settings keys that web clients must NOT read via db:getSetting */
export const WEB_SENSITIVE_SETTINGS = new Set([
  'plex_token',
  'tmdb_api_key',
  'gemini_api_key',
  'musicbrainz_api_token',
  'web_access_pin',
  'web_access_enabled',
  'web_access_port',
  'web_access_session_timeout',
])
