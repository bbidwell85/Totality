/**
 * Typed database interface — both BetterSQLiteService and DatabaseService must implement this.
 *
 * Replaces the `[key: string]: any` catch-all in DatabaseFactory.ts.
 * TypeScript will now catch method signature mismatches at compile time.
 *
 * Write operations use `void | Promise<void>` because BetterSQLiteService is synchronous
 * while DatabaseService (SQL.js) wraps writes in async save() calls. Callers should
 * always `await` write operations to be safe with both backends.
 */

import type {
  MediaItem, MediaItemVersion, MediaSource,
  QualityScore,
  SeriesCompleteness, MovieCollection,
  MusicArtist, MusicAlbum, MusicTrack, MusicFilters,
  ArtistCompleteness, AlbumCompleteness,
  WishlistItem,
  TVShowFilters,
} from '../types/database'
import type {
  Notification, NotificationCountResult,
} from '../types/monitoring'

export interface DatabaseServiceInterface {
  // --- Lifecycle ---
  isInitialized: boolean
  initialize(): Promise<void> | void
  close(): Promise<void> | void
  forceSave(): Promise<void> | void
  startBatch(): void
  endBatch(): Promise<void>
  isInBatchMode(): boolean
  getDbPath(): string

  // --- Settings ---
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void | Promise<void>
  deleteSetting(key: string): void | Promise<void>
  getAllSettings(): Record<string, string>
  getSettingsByPrefix(prefix: string): Record<string, string>

  // --- TMDB Cache ---
  getTmdbCache(key: string): { data: string; cached_at: number } | null
  setTmdbCache(key: string, data: string): void | Promise<void>

  // --- Media Items ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMediaItems(filters?: any): any[]
  getMediaItem(id: number): MediaItem | null
  getMediaItemByPath(filePath: string): MediaItem | null
  getMediaItemByProviderId(providerId: string, sourceId?: string): MediaItem | null
  getMediaItemsByTmdbIds(tmdbIds: string[]): Map<string, MediaItem>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  countMediaItems(filters?: any): number
  getMediaItemsCountBySource(sourceId: string): number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertMediaItem(item: any): number | Promise<number>
  deleteMediaItem(id: number): void | Promise<void>
  deleteMediaItemsForSource(sourceId: string): void | Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMediaItemArtwork(sourceId: string, providerId: string, artwork: any): void | Promise<void>
  cleanupOrphanedMediaData(): number

  // --- Media Item Versions ---
  upsertMediaItemVersion(version: MediaItemVersion): number
  getMediaItemVersions(mediaItemId: number): MediaItemVersion[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMediaItemVersionQuality(versionId: number, scores: any): void
  deleteMediaItemVersions(mediaItemId: number): void
  syncMediaItemVersions(mediaItemId: number, versions: MediaItemVersion[]): void
  updateBestVersion(mediaItemId: number): void

  // --- Quality Scores ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertQualityScore(score: any): void | Promise<void>
  getQualityScore(mediaItemId: number): QualityScore | null
  getQualityScoreByMediaId(mediaItemId: number): QualityScore | null
  getQualityScores(): QualityScore[]
  getQualityDistribution(): Record<string, unknown>

  // --- Media Sources ---
  getMediaSources(type?: string): MediaSource[]
  getEnabledMediaSources(): MediaSource[]
  getMediaSource(sourceId: string): MediaSource | null
  getMediaSourceById(sourceId: string): MediaSource | null
  upsertMediaSource(source: Partial<MediaSource> & { source_id: string; source_type: string; display_name: string }): void | Promise<void>
  deleteMediaSource(sourceId: string): void | Promise<void>
  updateSourceConnectionTime(sourceId: string): void | Promise<void>
  updateSourceScanTime(sourceId: string): void | Promise<void>

  // --- Library Scans ---
  updateLibraryScanTime(sourceId: string, libraryId: string, libraryName: string, libraryType: string, itemsScanned?: number): void
  getLibraryScanTime(sourceId: string, libraryId: string): string | null
  getLibraryScanTimes(sourceId: string): Map<string, { lastScanAt: string; itemsScanned: number }>
  deleteLibraryScanTimes(sourceId: string): void | Promise<void>
  isLibraryEnabled(sourceId: string, libraryId: string): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSourceLibraries(sourceId: string): any[]
  toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): void | Promise<void>
  setLibraryEnabled(sourceId: string, libraryId: string, enabled: boolean): void | Promise<void>
  setLibrariesEnabled(sourceId: string, libraries: Array<{ id: string; name: string; type: string; enabled: boolean }>): void | Promise<void>
  setLibraryUpgradeTier(sourceId: string, libraryId: string, minTier: string | null): void | Promise<void>
  getEnabledLibraryIds(sourceId: string): string[]

  // --- Library Stats ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLibraryStats(sourceId?: string): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStorageAnalytics(): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDuplicateMedia(): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLibraryHealthScores(): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRecentlyAdded(days?: number, limit?: number): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRecentlyUpgraded(days?: number): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRecentlyUpgradedMusic(days?: number): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAggregatedSourceStats(): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getQualityDistribution(): any

  // --- TV Shows ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTVShows(filters?: any): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  countTVShows(filters?: any): number
  countTVEpisodes(filters?: TVShowFilters): number
  getLetterOffset(schema: string, letter: string, filters?: Record<string, unknown>): number
  getEpisodesForSeries(seriesTitle: string, sourceId?: string, libraryId?: string): MediaItem[]
  getEpisodeCountBySeriesTmdbId(tmdbId: string | number): number

  // --- Series Completeness ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertSeriesCompleteness(data: any): number | Promise<number>
  getSeriesCompleteness(sourceId?: string): SeriesCompleteness[]
  getAllSeriesCompleteness(sourceId?: string, libraryId?: string): SeriesCompleteness[]
  getSeriesCompletenessByTitle(seriesTitle: string, sourceId?: string, libraryId?: string): SeriesCompleteness | null
  getIncompleteSeries(sourceId?: string): SeriesCompleteness[]
  deleteSeriesCompleteness(id: number): boolean | Promise<boolean>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSeriesCompletenessStats(): any
  invalidateStaleSeriesCompleteness(sourceId?: string): number

  // --- Movie Collections ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertMovieCollection(data: any): void | Promise<void>
  getMovieCollections(sourceId?: string): MovieCollection[]
  getMovieCollectionByTmdbId(tmdbCollectionId: string): MovieCollection | null
  getIncompleteMovieCollections(sourceId?: string): MovieCollection[]
  deleteMovieCollection(id: number): boolean | Promise<boolean>
  clearMovieCollections(sourceId?: string): void | Promise<void>
  deleteSingleMovieCollections(): number | Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMovieCollectionStats(): any
  updateCollectionsAfterDeletion(deletedTmdbIds: string[], sourceId: string): void | Promise<void>

  // --- Music Artists ---
  upsertMusicArtist(artist: Partial<MusicArtist> & { name: string; source_id: string; provider_id: string }): number | Promise<number>
  getMusicArtists(filters?: MusicFilters): MusicArtist[]
  countMusicArtists(filters?: MusicFilters): number
  getMusicArtistById(id: number): MusicArtist | null
  getMusicArtistByName(name: string, sourceId: string): MusicArtist | null
  getMusicAlbumsByArtistName(artistName: string, limit?: number): MusicAlbum[]
  updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): void | Promise<void>
  updateMusicArtistMbid(artistId: number, musicbrainzId: string): void | Promise<void>
  updateMusicArtistArtwork(sourceId: string, providerId: string, artwork: { thumbUrl?: string; artUrl?: string }): void | Promise<void>

  // --- Music Albums ---
  upsertMusicAlbum(album: Partial<MusicAlbum> & { title: string; source_id: string; provider_id: string }): number | Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMusicAlbums(filters?: any): MusicAlbum[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  countMusicAlbums(filters?: any): number
  getMusicAlbumById(id: number): MusicAlbum | null
  getMusicAlbumByName(title: string, artistId: number): MusicAlbum | null
  updateMusicAlbumMbid(albumId: number, musicbrainzId: string): void | Promise<void>
  updateMusicAlbumArtwork(albumId: number, artworkUrl: string): void | Promise<void>

  // --- Music Tracks ---
  upsertMusicTrack(track: Partial<MusicTrack> & { title: string; source_id: string; provider_id: string }): number | Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMusicTracks(filters?: any): any[]
  countMusicTracks(filters?: MusicFilters): number
  getMusicTrackById(id: number): MusicTrack | null
  getMusicTrackByPath(filePath: string): MusicTrack | null
  getMusicTrackByMusicbrainzId(id: string): MusicTrack | null
  deleteMusicTrack(id: number): void | Promise<void>
  updateMusicTrackMood(trackId: number, mood: string): void | Promise<void>
  updateMusicTrackTag(trackId: number, field: 'mood' | 'genre', value: string): void | Promise<void>

  // --- Music Quality ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertMusicQualityScore(score: any): void | Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMusicQualityScore(albumId: number): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAlbumsNeedingUpgrade(limit?: number, sourceId?: string): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMusicStats(sourceId?: string): any

  // --- Music Completeness ---
  upsertArtistCompleteness(data: Partial<ArtistCompleteness> & { artist_name: string }): void | Promise<void>
  getArtistCompleteness(artistName: string): ArtistCompleteness | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAllArtistCompleteness(sourceId?: string): any[]
  upsertAlbumCompleteness(data: Partial<AlbumCompleteness> & { album_id: number }): void | Promise<void>
  getAlbumCompleteness(albumId: number): AlbumCompleteness | null
  getAllAlbumCompleteness(): AlbumCompleteness[]
  getAlbumCompletenessByArtist(artistName: string): AlbumCompleteness[]
  getIncompleteAlbums(): AlbumCompleteness[]

  // --- Wishlist ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addWishlistItem(item: any): number | Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addWishlistItemsBulk(items: any[]): number | Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateWishlistItem(id: number, updates: any): void | Promise<void>
  removeWishlistItem(id: number): void | Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWishlistItems(filters?: any): WishlistItem[]
  getWishlistItemById(id: number): WishlistItem | null
  getWishlistCount(): number
  getWishlistCountsByReason(): Record<string, number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActiveWishlistItems(): any[]
  wishlistItemExists(tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): boolean

  // --- Notifications ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createNotification(notification: any): number | Promise<number>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createNotifications(notifications: any[]): number[] | Promise<number[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getNotifications(options: any): Notification[]
  getUnreadNotifications(): Notification[]
  getNotificationCount(): NotificationCountResult
  markNotificationRead(id: number): void | Promise<void>
  markNotificationsRead(ids: number[]): void | Promise<void>
  markAllNotificationsRead(): void | Promise<void>
  deleteNotifications(ids: number[]): void | Promise<void>
  clearAllNotifications(): void | Promise<void>

  // --- Exclusions ---
  addExclusion(exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string, title?: string): number
  removeExclusion(id: number): void
  getExclusions(exclusionType?: string, parentKey?: string): Array<Record<string, unknown>>
  isExcluded(exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string): boolean

  // --- Task History & Monitoring ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveTaskHistory(task: any): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTaskHistory(limit?: number, offset?: number): any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveActivityLogEntry(entry: any): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActivityLog(entryType?: string, limit?: number, offset?: number): any[]
  clearTaskHistory(): void
  clearActivityLog(entryType?: string): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  savePendingTasks(tasks: any[]): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPendingTasks(): any[]
  clearPendingTasks(): void

  // --- Person Completeness ---
  upsertPersonCompleteness(data: Record<string, unknown>): void | Promise<void>
  getPersonCompleteness(personType?: string): Array<Record<string, unknown>>
  deletePersonCompleteness(id: number): void | Promise<void>

  // --- Metadata Matching ---
  updateSeriesMatch(seriesTitle: string, newTmdbId: string, sourceId: string, newTitle?: string, posterUrl?: string): void | Promise<void>
  updateMovieMatch(mediaItemId: number, tmdbId: string, posterUrl?: string, title?: string, year?: number): void | Promise<void>
  updateArtistMatch(artistId: number, musicbrainzId: string): void | Promise<void>
  updateAlbumMatch(albumId: number, musicbrainzReleaseGroupId: string): void | Promise<void>

  // --- Data Export/Import ---
  exportData(): Record<string, unknown[]>
  exportWorkingCSV(options: Record<string, boolean>): Promise<Buffer>
  importData(data: Record<string, unknown[]>): { imported: number; errors: string[] }

  // --- Database Management ---
  resetDatabase(): void | Promise<void>
  resetLibraryData(): void | Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalSearch(query: string, limitOrSourceId?: number | string): any

  // --- Aliases ---
  getMediaItemById(id: number): MediaItem | null
  toggleMediaSource(sourceId: string, enabled: boolean): void | Promise<void>
  syncArtistCompletenessAfterScan(sourceId: string): number
  syncAlbumCompletenessAfterScan(sourceId: string): number
  getEpisodeCountForSeason(seriesTmdbId: string, seasonNumber: number): number
  getEpisodeCountForSeasonEpisode(seriesTmdbId: string, seasonNumber: number, episodeNumber: number): number
  getMusicAlbumsByMusicbrainzIds(ids: string[]): Map<string, MusicAlbum>
  getQualityScoresByMediaItemIds(ids: number[]): Map<number, QualityScore>

  // Catch-all for remaining untyped methods — gradually remove as methods are typed above
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}
