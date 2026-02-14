/**
 * Media Browser Type Definitions
 *
 * Shared types used across media browser components.
 */

import type { ProviderType } from '../../contexts/SourceContext'
import type { MediaSourceResponse } from '@preload/index'

// Re-export for convenience
export type { ProviderType }

// Alias for MediaSourceResponse used in hooks
export type MediaSource = MediaSourceResponse

// ============================================================================
// Music Types
// ============================================================================

export interface MusicArtist {
  id: number
  source_id: string
  source_type: ProviderType
  provider_id: string
  name: string
  sort_name?: string
  musicbrainz_id?: string
  genres?: string
  country?: string
  biography?: string
  thumb_url?: string
  art_url?: string
  album_count?: number
  track_count?: number
}

export interface MusicAlbum {
  id: number
  source_id: string
  source_type: ProviderType
  provider_id: string
  artist_id?: number
  artist_name: string
  title: string
  sort_title?: string
  year?: number
  musicbrainz_id?: string
  genres?: string
  album_type?: string
  track_count?: number
  duration_ms?: number
  thumb_url?: string
  is_lossless?: boolean
  is_hi_res?: boolean
  best_audio_codec?: string
  best_bitrate?: number
  best_sample_rate?: number
  best_bit_depth?: number
}

export interface MusicTrack {
  id: number
  source_id: string
  source_type: ProviderType
  provider_id: string
  library_id?: string
  album_id?: number
  artist_id?: number
  title: string
  track_number?: number
  disc_number?: number
  duration?: number // Duration in ms
  file_path?: string
  audio_codec?: string
  audio_bitrate?: number
  sample_rate?: number
  bit_depth?: number
  channels?: number
  is_lossless?: boolean
  is_hi_res?: boolean
}

export interface MusicStats {
  totalArtists: number
  totalAlbums: number
  totalTracks: number
  losslessAlbums: number
  hiResAlbums: number
  avgBitrate: number
}

// ============================================================================
// Media Item Types
// ============================================================================

export interface MediaItem {
  id: number
  title: string
  year?: number
  type: string
  series_title?: string
  season_number?: number
  episode_number?: number
  resolution: string
  video_bitrate: number
  audio_channels: number
  poster_url?: string
  episode_thumb_url?: string
  season_poster_url?: string
  overall_score?: number
  needs_upgrade?: boolean
  quality_tier?: 'SD' | '720p' | '1080p' | '4K'
  tier_quality?: 'LOW' | 'MEDIUM' | 'HIGH'
  tier_score?: number
  tmdb_id?: string
  issues?: string

  // File information
  file_path?: string

  // Enhanced quality metadata
  hdr_format?: string
  color_bit_depth?: number
  has_object_audio?: boolean
  video_frame_rate?: number

  // Multi-version
  version_count?: number

  // Source tracking
  source_id?: string
  source_type?: ProviderType
  library_id?: string
}

// ============================================================================
// TV Show Types
// ============================================================================

export interface TVShow {
  title: string
  poster_url?: string
  seasons: Map<number, TVSeason>
}

export interface SeasonInfo {
  seasonNumber: number
  episodes: MediaItem[]
  posterUrl?: string
}

export interface TVSeason {
  seasonNumber: number
  episodes: MediaItem[]
  posterUrl?: string
}

export interface TVShowSummary {
  series_title: string
  episode_count: number
  season_count: number
  poster_url?: string
  source_id?: string
  source_type?: string
}

export interface MissingEpisode {
  season_number: number
  episode_number: number
  title?: string
  air_date?: string
}

// ============================================================================
// Library Stats Types
// ============================================================================

export interface LibraryStats {
  totalItems: number
  totalMovies: number
  totalEpisodes: number
  totalShows: number
  needsUpgradeCount: number
  averageQualityScore: number
  // Movie-specific stats
  movieNeedsUpgradeCount: number
  movieAverageQualityScore: number
  // TV-specific stats
  tvNeedsUpgradeCount: number
  tvAverageQualityScore: number
}

// ============================================================================
// Completeness Types
// ============================================================================

export interface SeriesCompletenessData {
  id: number
  series_title: string
  total_seasons: number
  total_episodes: number
  owned_seasons: number
  owned_episodes: number
  missing_seasons: string
  missing_episodes: string
  completeness_percentage: number
  tmdb_id?: string
  poster_url?: string
  status?: string
}

export interface MovieCollectionData {
  id: number
  tmdb_collection_id: string
  collection_name: string
  total_movies: number
  owned_movies: number
  missing_movies: string
  owned_movie_ids: string
  completeness_percentage: number
  poster_url?: string
}

export interface SeriesStats {
  totalSeries: number
  completeSeries: number
  incompleteSeries: number
  totalMissingEpisodes: number
  averageCompleteness: number
}

export interface CollectionStats {
  total: number
  complete: number
  incomplete: number
  totalMissing: number
  avgCompleteness: number
}

export interface MusicCompletenessStats {
  totalArtists: number
  analyzedArtists: number
  completeArtists: number
  incompleteArtists: number
  totalMissingAlbums: number
  averageCompleteness: number
}

export interface ArtistCompletenessData {
  id?: number
  artist_name: string
  musicbrainz_id?: string
  total_albums: number
  owned_albums: number
  total_singles: number
  owned_singles: number
  total_eps: number
  owned_eps: number
  missing_albums: string
  missing_singles: string
  missing_eps: string
  completeness_percentage: number
  thumb_url?: string
}

export interface MissingAlbum {
  musicbrainz_id: string
  title: string
  year?: number
  album_type: 'album' | 'ep' | 'single'
}

export interface MissingTrack {
  musicbrainz_id?: string
  title: string
  track_number?: number
  disc_number?: number
  duration_ms?: number
}

export interface AlbumCompletenessData {
  id?: number
  album_id: number
  artist_name: string
  album_title: string
  musicbrainz_release_id?: string
  musicbrainz_release_group_id?: string
  total_tracks: number
  owned_tracks: number
  missing_tracks: string
  completeness_percentage: number
}

// ============================================================================
// Analysis Types
// ============================================================================

export interface AnalysisProgress {
  current: number
  total: number
  currentItem: string
  phase: string
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface MediaBrowserProps {
  onAddSource?: () => void
  onOpenSettings?: (initialTab?: string) => void
  sidebarCollapsed?: boolean
  onNavigateHome?: () => void
  initialTab?: MediaViewType
  // When true, don't render the header (it's rendered at app level)
  hideHeader?: boolean
  // External panel state control
  showCompletenessPanel?: boolean
  showWishlistPanel?: boolean
  onToggleCompleteness?: () => void
  onToggleWishlist?: () => void
  // External view tab control
  libraryTab?: MediaViewType
  onLibraryTabChange?: (tab: MediaViewType) => void
  // Notify parent of auto-refresh state
  onAutoRefreshChange?: (isRefreshing: boolean) => void
}

export interface MissingItemPopupData {
  type: 'episode' | 'season' | 'movie'
  title: string
  year?: number
  airDate?: string
  seasonNumber?: number
  episodeNumber?: number
  posterUrl?: string
  tmdbId?: string
  imdbId?: string
  seriesTitle?: string
}

export interface MatchFixModalData {
  isOpen: boolean
  type: 'series' | 'movie' | 'artist' | 'album'
  title: string
  year?: number
  filePath?: string
  artistName?: string
  sourceId?: string
  mediaItemId?: number
  artistId?: number
  albumId?: number
}

// ============================================================================
// Filter Types
// ============================================================================

export type TierFilter = 'all' | 'SD' | '720p' | '1080p' | '4K'
export type QualityFilter = 'all' | 'low' | 'medium' | 'high'
export type ViewType = 'grid' | 'list'
export type MediaViewType = 'movies' | 'tv' | 'music'
export type MusicViewMode = 'artists' | 'albums' | 'tracks'
