// Database type definitions

// Provider types supported by the application
export type ProviderType = 'plex' | 'jellyfin' | 'emby' | 'kodi' | 'kodi-local' | 'kodi-mysql' | 'local'

// Media source configuration (Plex, Jellyfin, Emby, Kodi servers)
export interface MediaSource {
  id?: number
  source_id: string
  source_type: ProviderType
  display_name: string
  connection_config: string // JSON string containing provider-specific config
  is_enabled: boolean
  last_connected_at?: string
  last_scan_at?: string
  created_at: string
  updated_at: string
}

// Parsed connection config for different providers
export interface PlexConnectionConfig {
  token: string
  serverUrl: string
  serverId: string
}

export interface JellyfinConnectionConfig {
  serverUrl: string
  apiKey: string
  userId?: string
  username?: string
}

export interface EmbyConnectionConfig {
  serverUrl: string
  apiKey: string
  userId?: string
  username?: string
}

export interface KodiConnectionConfig {
  host: string
  port: number
  username?: string
  password?: string
}

export interface KodiLocalConnectionConfig {
  databasePath: string
  databaseVersion?: number
  musicDatabasePath?: string | null
  musicDatabaseVersion?: number | null
  includeVideo?: boolean
  includeMusic?: boolean
}

export interface KodiMySQLConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  videoDatabaseName?: string
  videoDatabaseVersion?: number
  musicDatabaseName?: string
  musicDatabaseVersion?: number
  databasePrefix?: string
  ssl?: boolean
  connectionTimeout?: number
}

export interface LocalFolderConnectionConfig {
  folderPath: string
  mediaType: 'movies' | 'tvshows' | 'music' | 'mixed'
  name?: string
}

export type ConnectionConfig =
  | PlexConnectionConfig
  | JellyfinConnectionConfig
  | EmbyConnectionConfig
  | KodiConnectionConfig
  | KodiLocalConnectionConfig
  | KodiMySQLConnectionConfig
  | LocalFolderConnectionConfig

// Audio track information for multi-track support
export interface AudioTrack {
  index: number
  codec: string
  channels: number
  bitrate: number
  language?: string
  title?: string
  profile?: string
  sampleRate?: number
  isDefault?: boolean
  hasObjectAudio?: boolean
}

export interface MediaItem {
  id?: number

  // Source tracking (for multi-provider support)
  source_id?: string
  source_type?: ProviderType
  library_id?: string // Library ID within the source

  // Provider item ID (was plex_id, now generic but kept for compatibility)
  plex_id: string
  title: string
  year?: number
  type: 'movie' | 'episode'
  series_title?: string
  season_number?: number
  episode_number?: number

  // File information
  file_path: string
  file_size: number
  duration: number

  // Video quality
  resolution: string
  width: number
  height: number
  video_codec: string
  video_bitrate: number

  // Audio quality
  audio_codec: string
  audio_channels: number
  audio_bitrate: number

  // Enhanced video quality metadata
  video_frame_rate?: number      // 23.976, 24, 60 fps
  color_bit_depth?: number        // 8, 10, 12 bits
  hdr_format?: string             // "None", "HDR10", "Dolby Vision", "HLG"
  color_space?: string            // "bt709", "bt2020nc"
  video_profile?: string          // "high", "main 10"
  video_level?: number            // 41, 50, 51

  // Enhanced audio quality metadata
  audio_profile?: string          // "lc", "he", "truehd"
  audio_sample_rate?: number      // 48000, 96000 Hz
  has_object_audio?: boolean      // Atmos/DTS:X flag

  // All audio tracks (JSON string in DB, parsed here)
  audio_tracks?: string           // JSON array of AudioTrack

  // Container metadata
  container?: string              // "mkv", "mp4", "avi"

  // File modification tracking (for skip-unchanged optimization)
  file_mtime?: number             // Unix timestamp of file modification time

  // Metadata
  imdb_id?: string
  tmdb_id?: string
  series_tmdb_id?: string // Show-level TMDB ID for episodes (from Plex show metadata)
  poster_url?: string
  episode_thumb_url?: string
  season_poster_url?: string

  // User override flag (preserves user-selected metadata during rescans)
  user_fixed_match?: boolean

  // Timestamps
  created_at: string
  updated_at: string
}

export interface QualityScore {
  id?: number
  media_item_id: number

  // Tier-based scoring
  quality_tier: 'SD' | '720p' | '1080p' | '4K'
  tier_quality: 'LOW' | 'MEDIUM' | 'HIGH'
  tier_score: number // 0-100 score within tier
  bitrate_tier_score: number // 0-100 bitrate score for tier
  audio_tier_score: number // 0-100 audio score for tier

  // Legacy scores (for backward compatibility)
  overall_score: number // Maps to tier_score
  resolution_score: number // Deprecated
  bitrate_score: number // Maps to bitrate_tier_score
  audio_score: number // Maps to audio_tier_score

  // Quality flags
  is_low_quality: boolean // Deprecated, use tier_quality === 'LOW'
  needs_upgrade: boolean // Maps to tier_quality === 'LOW'

  // Analysis details
  issues: string // JSON array of issues

  created_at: string
  updated_at: string
}

export interface AppSettings {
  id?: number
  key: string
  value: string

  updated_at: string
}

export interface SeriesCompleteness {
  id?: number
  series_title: string

  // Source/library scoping
  source_id?: string
  library_id?: string

  total_seasons: number
  total_episodes: number
  owned_seasons: number
  owned_episodes: number

  missing_seasons: string // JSON array of numbers
  missing_episodes: string // JSON array of MissingEpisode

  completeness_percentage: number

  // TMDB metadata
  tmdb_id?: string
  poster_url?: string
  backdrop_url?: string
  status?: string // "Returning Series", "Ended", "Canceled"

  created_at: string
  updated_at: string
}

export interface MovieCollection {
  id?: number
  tmdb_collection_id: string
  collection_name: string

  // Source/library scoping
  source_id?: string
  library_id?: string

  total_movies: number
  owned_movies: number

  missing_movies: string // JSON array of MissingMovie
  owned_movie_ids: string // JSON array of tmdb_ids (strings)

  completeness_percentage: number

  poster_url?: string
  backdrop_url?: string

  created_at: string
  updated_at: string
}

export interface MissingMovie {
  tmdb_id: string
  title: string
  year?: number
  poster_path?: string
}

export interface MissingEpisode {
  season_number: number
  episode_number: number
  title?: string
  air_date?: string
}

// Query filter types
export interface MediaItemFilters {
  type?: 'movie' | 'episode'
  minQualityScore?: number
  maxQualityScore?: number
  needsUpgrade?: boolean
  searchQuery?: string
  limit?: number
  offset?: number
  // Multi-source filters
  sourceId?: string
  sourceType?: ProviderType
  libraryId?: string
  // Sorting
  sortBy?: 'title' | 'year' | 'updated_at' | 'created_at' | 'tier_score' | 'overall_score'
  sortOrder?: 'asc' | 'desc'
  // Server-side filtering
  alphabetFilter?: string
  qualityTier?: string
  tierQuality?: string
}

// ============================================================================
// MUSIC TYPES
// ============================================================================

export type MusicQualityTier = 'LOSSY_LOW' | 'LOSSY_MID' | 'LOSSY_HIGH' | 'LOSSLESS' | 'HI_RES'
export type AlbumType = 'album' | 'ep' | 'single' | 'compilation' | 'live' | 'soundtrack' | 'unknown'

export interface MusicArtist {
  id?: number
  source_id: string
  source_type: ProviderType
  library_id?: string
  provider_id: string

  name: string
  sort_name?: string

  // Metadata
  musicbrainz_id?: string
  genres?: string // JSON array
  country?: string
  biography?: string

  // Artwork
  thumb_url?: string
  art_url?: string

  // Stats
  album_count?: number
  track_count?: number

  // User override flag
  user_fixed_match?: boolean

  created_at: string
  updated_at: string
}

export interface MusicAlbum {
  id?: number
  source_id: string
  source_type: ProviderType
  library_id?: string
  provider_id: string

  // Artist reference
  artist_id?: number
  artist_name: string

  title: string
  sort_title?: string
  year?: number

  // Metadata
  musicbrainz_id?: string
  musicbrainz_release_group_id?: string
  genres?: string // JSON array
  studio?: string // Record label

  // Album type
  album_type?: AlbumType

  // Quality info
  track_count?: number
  total_duration?: number
  total_size?: number

  // Audio quality (best track)
  best_audio_codec?: string
  best_audio_bitrate?: number
  best_sample_rate?: number
  best_bit_depth?: number

  // Average quality
  avg_audio_bitrate?: number

  // Artwork
  thumb_url?: string
  art_url?: string

  // Timestamps
  release_date?: string
  added_at?: string

  // User override flag
  user_fixed_match?: boolean

  created_at: string
  updated_at: string
}

export interface MusicTrack {
  id?: number
  source_id: string
  source_type: ProviderType
  library_id?: string
  provider_id: string

  // Album and artist references
  album_id?: number
  artist_id?: number
  album_name?: string
  artist_name: string

  title: string

  // Track info
  track_number?: number
  disc_number?: number
  duration?: number // Duration in ms

  // File information
  file_path?: string
  file_size?: number
  container?: string
  file_mtime?: number // File modification time (ms since epoch) for delta scanning

  // Audio quality
  audio_codec: string
  audio_bitrate?: number
  sample_rate?: number
  bit_depth?: number
  channels?: number

  // Quality flags
  is_lossless?: boolean
  is_hi_res?: boolean

  // Metadata
  musicbrainz_id?: string
  genres?: string // JSON array

  // Timestamps
  added_at?: string
  created_at: string
  updated_at: string
}

export interface MusicQualityScore {
  id?: number
  album_id: number

  quality_tier: MusicQualityTier
  tier_quality: 'LOW' | 'MEDIUM' | 'HIGH'
  tier_score: number

  codec_score: number
  bitrate_score: number

  needs_upgrade: boolean

  issues: string // JSON array

  created_at: string
  updated_at: string
}

export interface ArtistCompleteness {
  id?: number
  artist_name: string

  musicbrainz_id?: string

  // Completeness stats
  total_albums: number
  owned_albums: number
  total_singles: number
  owned_singles: number
  total_eps: number
  owned_eps: number

  // Missing items (JSON arrays)
  missing_albums: string
  missing_singles: string
  missing_eps: string

  completeness_percentage: number

  // Metadata
  country?: string
  active_years?: string // JSON: { begin: '1990', end: '2020' }
  artist_type?: string

  thumb_url?: string

  last_sync_at?: string

  created_at: string
  updated_at: string
}

export interface MissingAlbum {
  musicbrainz_id: string
  title: string
  year?: number
  album_type?: AlbumType
}

export interface MissingTrack {
  musicbrainz_id?: string
  title: string
  track_number?: number
  disc_number?: number
  duration_ms?: number
}

export interface AlbumCompleteness {
  id?: number
  album_id: number // Reference to music_albums.id
  artist_name: string
  album_title: string
  musicbrainz_release_id?: string
  musicbrainz_release_group_id?: string

  // Track counts
  total_tracks: number
  owned_tracks: number

  // Missing tracks (JSON array of MissingTrack)
  missing_tracks: string

  completeness_percentage: number

  last_sync_at?: string
  created_at: string
  updated_at: string
}

// Music query filters
export interface MusicFilters {
  artistId?: number
  albumId?: number
  qualityTier?: MusicQualityTier
  needsUpgrade?: boolean
  searchQuery?: string
  limit?: number
  offset?: number
  sourceId?: string
  sourceType?: ProviderType
  libraryId?: string
  // Sorting
  sortBy?: 'title' | 'artist' | 'album' | 'codec' | 'duration' | 'added_at' | 'name' | 'year'
  sortOrder?: 'asc' | 'desc'
  // Alphabet filter
  alphabetFilter?: string
}

// ============================================================================
// WISHLIST / SHOPPING LIST
// ============================================================================

export type WishlistMediaType = 'movie' | 'episode' | 'season' | 'album' | 'track'
export type WishlistPriority = 1 | 2 | 3 | 4 | 5
export type WishlistReason = 'missing' | 'upgrade'
export type WishlistStatus = 'active' | 'completed'

export interface WishlistItem {
  id?: number

  // Item identification
  media_type: WishlistMediaType
  title: string
  subtitle?: string
  year?: number

  // Wishlist reason
  reason: WishlistReason

  // External IDs for store linking
  tmdb_id?: string
  imdb_id?: string
  musicbrainz_id?: string

  // Series/Collection context (for TV)
  series_title?: string
  season_number?: number
  episode_number?: number
  collection_name?: string

  // Artist context (for music)
  artist_name?: string
  album_title?: string

  // Artwork
  poster_url?: string

  // User data
  priority: WishlistPriority
  notes?: string

  // Status tracking
  status: WishlistStatus
  completed_at?: string

  // Upgrade-specific fields (only used when reason='upgrade')
  current_quality_tier?: string
  current_quality_level?: string
  current_resolution?: string
  current_video_codec?: string
  current_audio_codec?: string
  media_item_id?: number

  // Timestamps
  added_at: string
  updated_at: string
}

export interface WishlistFilters {
  media_type?: WishlistMediaType
  priority?: WishlistPriority
  reason?: WishlistReason
  status?: WishlistStatus
  searchQuery?: string
  series_title?: string
  artist_name?: string
  sortBy?: 'added_at' | 'priority' | 'title' | 'year' | 'completed_at'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

