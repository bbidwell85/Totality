// Database schema as a TypeScript constant
// This ensures it's bundled correctly by Vite

export const DATABASE_SCHEMA = `
-- Totality Database Schema
-- SQLite database for storing media library analysis and recommendations

-- Media sources table (Plex, Jellyfin, Emby, Kodi servers)
CREATE TABLE IF NOT EXISTS media_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'local')),
  display_name TEXT NOT NULL,

  -- Connection details (JSON for flexibility)
  connection_config TEXT NOT NULL DEFAULT '{}',

  -- Status
  is_enabled INTEGER NOT NULL DEFAULT 1,
  last_connected_at TEXT,
  last_scan_at TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Media items table (movies and TV episodes from any provider)
CREATE TABLE IF NOT EXISTS media_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Source tracking (for multi-provider support)
  source_id TEXT NOT NULL DEFAULT 'legacy',
  source_type TEXT NOT NULL DEFAULT 'plex' CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'local')),
  library_id TEXT, -- Library ID within the source (e.g., Plex library key)

  -- Provider item ID (was plex_id, now generic)
  plex_id TEXT NOT NULL,

  title TEXT NOT NULL,
  year INTEGER,
  type TEXT NOT NULL CHECK(type IN ('movie', 'episode')),
  series_title TEXT,
  season_number INTEGER,
  episode_number INTEGER,

  -- File information
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  duration INTEGER NOT NULL,

  -- Video quality
  resolution TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  video_codec TEXT NOT NULL,
  video_bitrate INTEGER NOT NULL,

  -- Audio quality
  audio_codec TEXT NOT NULL,
  audio_channels INTEGER NOT NULL,
  audio_bitrate INTEGER NOT NULL,

  -- Enhanced video quality metadata
  video_frame_rate REAL,
  color_bit_depth INTEGER,
  hdr_format TEXT,
  color_space TEXT,
  video_profile TEXT,
  video_level INTEGER,

  -- Enhanced audio quality metadata
  audio_profile TEXT,
  audio_sample_rate INTEGER,
  has_object_audio INTEGER DEFAULT 0,

  -- All audio tracks (JSON array)
  audio_tracks TEXT,

  -- All subtitle tracks (JSON array)
  subtitle_tracks TEXT,

  -- Container metadata
  container TEXT,

  -- File modification tracking (for skip-unchanged optimization)
  file_mtime INTEGER,

  -- Metadata
  imdb_id TEXT,
  tmdb_id TEXT,
  series_tmdb_id TEXT,
  poster_url TEXT,
  episode_thumb_url TEXT,
  season_poster_url TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multiple versions/editions per media item (e.g., 4K HDR + 1080p theatrical)
CREATE TABLE IF NOT EXISTS media_item_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL,

  -- Version identification
  version_source TEXT NOT NULL DEFAULT 'primary',
  edition TEXT,
  label TEXT,

  -- File information
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  duration INTEGER NOT NULL,

  -- Video quality
  resolution TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  video_codec TEXT NOT NULL,
  video_bitrate INTEGER NOT NULL,

  -- Audio quality (best audio track)
  audio_codec TEXT NOT NULL,
  audio_channels INTEGER NOT NULL,
  audio_bitrate INTEGER NOT NULL,

  -- Enhanced video quality metadata
  video_frame_rate REAL,
  color_bit_depth INTEGER,
  hdr_format TEXT,
  color_space TEXT,
  video_profile TEXT,
  video_level INTEGER,

  -- Enhanced audio quality metadata
  audio_profile TEXT,
  audio_sample_rate INTEGER,
  has_object_audio INTEGER DEFAULT 0,

  -- All tracks (JSON arrays)
  audio_tracks TEXT,
  subtitle_tracks TEXT,

  -- Container metadata
  container TEXT,
  file_mtime INTEGER,

  -- Quality scores (denormalized for fast access)
  quality_tier TEXT,
  tier_quality TEXT,
  tier_score INTEGER DEFAULT 0,

  -- Best version flag (only one per media_item should be 1)
  is_best INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- Quality scores for each media item
CREATE TABLE IF NOT EXISTS quality_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL UNIQUE,

  -- Tier-based scoring
  quality_tier TEXT NOT NULL DEFAULT 'SD',
  tier_quality TEXT NOT NULL DEFAULT 'MEDIUM',
  tier_score INTEGER NOT NULL DEFAULT 0,
  bitrate_tier_score INTEGER NOT NULL DEFAULT 0,
  audio_tier_score INTEGER NOT NULL DEFAULT 0,

  -- Legacy scores (0-100 scale) - kept for backward compatibility
  overall_score INTEGER NOT NULL,
  resolution_score INTEGER NOT NULL,
  bitrate_score INTEGER NOT NULL,
  audio_score INTEGER NOT NULL,

  -- Quality flags
  is_low_quality INTEGER NOT NULL DEFAULT 0,
  needs_upgrade INTEGER NOT NULL DEFAULT 0,

  -- Analysis details (JSON)
  issues TEXT NOT NULL DEFAULT '[]',

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- Application settings
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- TV series completeness tracking
CREATE TABLE IF NOT EXISTS series_completeness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_title TEXT NOT NULL,

  -- Source/library scoping
  source_id TEXT,
  library_id TEXT,

  total_seasons INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  owned_seasons INTEGER NOT NULL,
  owned_episodes INTEGER NOT NULL,

  -- JSON arrays
  missing_seasons TEXT NOT NULL DEFAULT '[]',
  missing_episodes TEXT NOT NULL DEFAULT '[]',

  completeness_percentage REAL NOT NULL,

  -- TMDB metadata
  tmdb_id TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  status TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Movie collections metadata (TMDB Collections)
CREATE TABLE IF NOT EXISTS movie_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_collection_id TEXT NOT NULL,
  collection_name TEXT NOT NULL,

  -- Source/library scoping
  source_id TEXT,
  library_id TEXT,

  total_movies INTEGER NOT NULL,
  owned_movies INTEGER NOT NULL,

  -- JSON arrays
  missing_movies TEXT NOT NULL DEFAULT '[]',
  owned_movie_ids TEXT NOT NULL DEFAULT '[]',

  completeness_percentage REAL NOT NULL,

  poster_url TEXT,
  backdrop_url TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many relationship between media items and collections
CREATE TABLE IF NOT EXISTS media_item_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL,
  collection_id INTEGER NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES movie_collections(id) ON DELETE CASCADE,
  UNIQUE(media_item_id, collection_id)
);

-- ============================================================================
-- MUSIC LIBRARY SUPPORT
-- ============================================================================

-- Music artists table
CREATE TABLE IF NOT EXISTS music_artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Source tracking
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'local')),
  library_id TEXT, -- Library ID within the source

  -- Provider item ID
  provider_id TEXT NOT NULL,

  name TEXT NOT NULL,
  sort_name TEXT,

  -- Metadata
  musicbrainz_id TEXT,
  genres TEXT, -- JSON array
  country TEXT,
  biography TEXT,

  -- Artwork
  thumb_url TEXT,
  art_url TEXT,

  -- Stats (cached)
  album_count INTEGER DEFAULT 0,
  track_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Music albums table
CREATE TABLE IF NOT EXISTS music_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Source tracking
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'local')),
  library_id TEXT, -- Library ID within the source

  -- Provider item ID
  provider_id TEXT NOT NULL,

  -- Artist reference
  artist_id INTEGER,
  artist_name TEXT NOT NULL,

  title TEXT NOT NULL,
  sort_title TEXT,
  year INTEGER,

  -- Metadata
  musicbrainz_id TEXT,
  musicbrainz_release_group_id TEXT,
  genres TEXT, -- JSON array
  studio TEXT, -- Record label

  -- Album type
  album_type TEXT, -- 'album', 'ep', 'single', 'compilation', 'live', 'soundtrack'

  -- Quality info (aggregate of tracks)
  track_count INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0, -- Total duration in ms
  total_size INTEGER DEFAULT 0, -- Total file size in bytes

  -- Audio quality (best track quality)
  best_audio_codec TEXT,
  best_audio_bitrate INTEGER,
  best_sample_rate INTEGER,
  best_bit_depth INTEGER,

  -- Average quality
  avg_audio_bitrate INTEGER,

  -- Artwork
  thumb_url TEXT,
  art_url TEXT,

  -- Timestamps
  release_date TEXT,
  added_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE SET NULL
);

-- Music tracks table
CREATE TABLE IF NOT EXISTS music_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Source tracking
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'local')),
  library_id TEXT, -- Library ID within the source

  -- Provider item ID
  provider_id TEXT NOT NULL,

  -- Album and artist references
  album_id INTEGER,
  artist_id INTEGER,
  album_name TEXT,
  artist_name TEXT NOT NULL,

  title TEXT NOT NULL,

  -- Track info
  track_number INTEGER,
  disc_number INTEGER DEFAULT 1,
  duration INTEGER, -- Duration in ms

  -- File information
  file_path TEXT,
  file_size INTEGER,
  container TEXT, -- 'flac', 'mp3', 'aac', 'm4a', etc.
  file_mtime INTEGER, -- File modification time (ms since epoch) for delta scanning

  -- Audio quality
  audio_codec TEXT NOT NULL,
  audio_bitrate INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER DEFAULT 2,

  -- Quality flags
  is_lossless INTEGER DEFAULT 0,
  is_hi_res INTEGER DEFAULT 0, -- > 44.1kHz or > 16-bit

  -- Metadata
  musicbrainz_id TEXT,
  genres TEXT, -- JSON array

  -- Timestamps
  added_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL,
  FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE SET NULL
);

-- Music quality scores (per album)
CREATE TABLE IF NOT EXISTS music_quality_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL UNIQUE,

  -- Quality tier: 'LOSSY_LOW', 'LOSSY_MID', 'LOSSY_HIGH', 'LOSSLESS', 'HI_RES'
  quality_tier TEXT NOT NULL DEFAULT 'LOSSY_MID',
  tier_quality TEXT NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH' within tier
  tier_score INTEGER NOT NULL DEFAULT 0, -- 0-100 score within tier

  -- Component scores
  codec_score INTEGER NOT NULL DEFAULT 0,
  bitrate_score INTEGER NOT NULL DEFAULT 0,

  -- Quality flags
  needs_upgrade INTEGER NOT NULL DEFAULT 0,

  -- Analysis details (JSON)
  issues TEXT NOT NULL DEFAULT '[]',

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE CASCADE
);

-- Artist discography completeness (MusicBrainz integration)
CREATE TABLE IF NOT EXISTS artist_completeness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_name TEXT NOT NULL UNIQUE,

  -- MusicBrainz data
  musicbrainz_id TEXT,

  -- Completeness stats
  total_albums INTEGER NOT NULL DEFAULT 0,
  owned_albums INTEGER NOT NULL DEFAULT 0,
  total_singles INTEGER NOT NULL DEFAULT 0,
  owned_singles INTEGER NOT NULL DEFAULT 0,
  total_eps INTEGER NOT NULL DEFAULT 0,
  owned_eps INTEGER NOT NULL DEFAULT 0,

  -- Missing items (JSON arrays)
  missing_albums TEXT NOT NULL DEFAULT '[]',
  missing_singles TEXT NOT NULL DEFAULT '[]',
  missing_eps TEXT NOT NULL DEFAULT '[]',

  completeness_percentage REAL NOT NULL DEFAULT 0,

  -- Metadata from MusicBrainz
  country TEXT,
  active_years TEXT, -- JSON: { begin: '1990', end: '2020' }
  artist_type TEXT, -- 'person', 'group', 'orchestra', 'choir', etc.

  -- Artwork
  thumb_url TEXT,

  -- Last sync
  last_sync_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Album track completeness (MusicBrainz integration)
CREATE TABLE IF NOT EXISTS album_completeness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL UNIQUE,
  artist_name TEXT NOT NULL,
  album_title TEXT NOT NULL,

  -- MusicBrainz data
  musicbrainz_release_id TEXT,
  musicbrainz_release_group_id TEXT,

  -- Track counts
  total_tracks INTEGER NOT NULL DEFAULT 0,
  owned_tracks INTEGER NOT NULL DEFAULT 0,

  -- Missing tracks (JSON array)
  missing_tracks TEXT NOT NULL DEFAULT '[]',

  completeness_percentage REAL NOT NULL DEFAULT 0,

  -- Last sync
  last_sync_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE CASCADE
);

-- ============================================================================
-- WISHLIST / SHOPPING LIST
-- ============================================================================

-- Wishlist items for missing media the user wants to purchase
CREATE TABLE IF NOT EXISTS wishlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Item identification
  media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'episode', 'season', 'album', 'track')),
  title TEXT NOT NULL,
  subtitle TEXT,  -- "S2 E5" or "Artist Name" or year
  year INTEGER,

  -- Wishlist reason: 'missing' for collection completion, 'upgrade' for quality upgrade
  reason TEXT NOT NULL DEFAULT 'missing' CHECK(reason IN ('missing', 'upgrade')),

  -- External IDs for store linking
  tmdb_id TEXT,
  imdb_id TEXT,
  musicbrainz_id TEXT,

  -- Series/Collection context (for TV)
  series_title TEXT,
  season_number INTEGER,
  episode_number INTEGER,
  collection_name TEXT,

  -- Artist context (for music)
  artist_name TEXT,
  album_title TEXT,

  -- Artwork
  poster_url TEXT,

  -- User data
  priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),  -- 1-5 stars
  notes TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed')),
  completed_at TEXT,  -- When item was marked as purchased/upgraded

  -- Upgrade-specific fields (only used when reason='upgrade')
  current_quality_tier TEXT,  -- 'SD', '720p', '1080p', '4K'
  current_quality_level TEXT, -- 'LOW', 'MEDIUM', 'HIGH'
  current_resolution TEXT,    -- e.g., '1920x1080'
  current_video_codec TEXT,   -- e.g., 'h264', 'hevc'
  current_audio_codec TEXT,   -- e.g., 'aac', 'dts'
  media_item_id INTEGER,      -- Reference to owned media_items.id

  -- Timestamps
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Library scan timestamps (per-library tracking)
CREATE TABLE IF NOT EXISTS library_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_name TEXT NOT NULL,
  library_type TEXT NOT NULL,
  last_scan_at TEXT NOT NULL,
  items_scanned INTEGER DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(source_id, library_id)
);

-- Notifications for live monitoring system
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('source_change', 'scan_complete', 'error', 'info')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_id TEXT,
  source_name TEXT,
  item_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);

-- ============================================================================
-- EXCLUSIONS (dismiss items from dashboard recommendations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exclusion_type TEXT NOT NULL CHECK(exclusion_type IN (
    'media_upgrade',
    'collection_movie',
    'series_episode',
    'artist_album'
  )),
  reference_id INTEGER,
  reference_key TEXT,
  parent_key TEXT,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exclusions_type_ref ON exclusions(exclusion_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_exclusions_type_key ON exclusions(exclusion_type, reference_key, parent_key);

-- ============================================================================
-- TASK QUEUE HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  source_id TEXT,
  library_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('completed', 'failed', 'cancelled', 'interrupted')),
  error TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type TEXT NOT NULL,
  message TEXT NOT NULL,
  task_id TEXT,
  task_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history(status);
CREATE INDEX IF NOT EXISTS idx_task_history_recorded ON task_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_history_source ON task_history(source_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(entry_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_library_scans_source ON library_scans(source_id);
CREATE INDEX IF NOT EXISTS idx_library_scans_lookup ON library_scans(source_id, library_id);
CREATE INDEX IF NOT EXISTS idx_media_sources_type ON media_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_media_sources_enabled ON media_sources(is_enabled);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source_id);
CREATE INDEX IF NOT EXISTS idx_media_items_source_type ON media_items(source_type);
CREATE INDEX IF NOT EXISTS idx_media_items_library ON media_items(source_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_source_provider_id ON media_items(source_id, plex_id);
CREATE INDEX IF NOT EXISTS idx_media_items_series ON media_items(series_title) WHERE type = 'episode';
CREATE INDEX IF NOT EXISTS idx_versions_media_item ON media_item_versions(media_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_unique_file ON media_item_versions(media_item_id, file_path);
CREATE INDEX IF NOT EXISTS idx_versions_best ON media_item_versions(media_item_id, is_best);
CREATE INDEX IF NOT EXISTS idx_quality_scores_media ON quality_scores(media_item_id);
CREATE INDEX IF NOT EXISTS idx_quality_scores_needs_upgrade ON quality_scores(needs_upgrade) WHERE needs_upgrade = 1;
CREATE INDEX IF NOT EXISTS idx_quality_scores_tier ON quality_scores(quality_tier);
CREATE INDEX IF NOT EXISTS idx_quality_scores_tier_quality ON quality_scores(tier_quality);
CREATE INDEX IF NOT EXISTS idx_quality_scores_tier_both ON quality_scores(quality_tier, tier_quality);
CREATE INDEX IF NOT EXISTS idx_media_items_type_series ON media_items(type, series_title) WHERE type = 'episode';
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_series_completeness_title ON series_completeness(series_title);
CREATE INDEX IF NOT EXISTS idx_series_completeness_library ON series_completeness(source_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_completeness_unique ON series_completeness(series_title, source_id, library_id);
CREATE INDEX IF NOT EXISTS idx_series_completeness_title_pct ON series_completeness(series_title, completeness_percentage);
CREATE INDEX IF NOT EXISTS idx_series_completeness_incomplete ON series_completeness(completeness_percentage) WHERE tmdb_id IS NOT NULL AND completeness_percentage < 100;
CREATE INDEX IF NOT EXISTS idx_movie_collections_tmdb_id ON movie_collections(tmdb_collection_id);
CREATE INDEX IF NOT EXISTS idx_movie_collections_library ON movie_collections(source_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_movie_collections_unique ON movie_collections(tmdb_collection_id, source_id, library_id);
CREATE INDEX IF NOT EXISTS idx_media_item_collections_media ON media_item_collections(media_item_id);
CREATE INDEX IF NOT EXISTS idx_media_item_collections_collection ON media_item_collections(collection_id);

-- Music indexes
CREATE INDEX IF NOT EXISTS idx_music_artists_source ON music_artists(source_id);
CREATE INDEX IF NOT EXISTS idx_music_artists_library ON music_artists(source_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_music_artists_source_provider ON music_artists(source_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_music_artists_name ON music_artists(name);
CREATE INDEX IF NOT EXISTS idx_music_artists_musicbrainz ON music_artists(musicbrainz_id);

CREATE INDEX IF NOT EXISTS idx_music_albums_source ON music_albums(source_id);
CREATE INDEX IF NOT EXISTS idx_music_albums_library ON music_albums(source_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_music_albums_source_provider ON music_albums(source_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_music_albums_artist ON music_albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_music_albums_artist_name ON music_albums(artist_name);
CREATE INDEX IF NOT EXISTS idx_music_albums_musicbrainz ON music_albums(musicbrainz_id);
CREATE INDEX IF NOT EXISTS idx_music_albums_year ON music_albums(year);

CREATE INDEX IF NOT EXISTS idx_music_tracks_source ON music_tracks(source_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_library ON music_tracks(source_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_music_tracks_source_provider ON music_tracks(source_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_album ON music_tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_artist ON music_tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_quality ON music_tracks(is_lossless, is_hi_res);

CREATE INDEX IF NOT EXISTS idx_music_quality_scores_album ON music_quality_scores(album_id);
CREATE INDEX IF NOT EXISTS idx_music_quality_scores_tier ON music_quality_scores(quality_tier);
CREATE INDEX IF NOT EXISTS idx_music_quality_scores_upgrade ON music_quality_scores(needs_upgrade);

CREATE INDEX IF NOT EXISTS idx_artist_completeness_name ON artist_completeness(artist_name);
CREATE INDEX IF NOT EXISTS idx_artist_completeness_musicbrainz ON artist_completeness(musicbrainz_id);

CREATE INDEX IF NOT EXISTS idx_album_completeness_album ON album_completeness(album_id);
CREATE INDEX IF NOT EXISTS idx_album_completeness_musicbrainz ON album_completeness(musicbrainz_release_group_id);

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read) WHERE is_read = 0;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_source ON notifications(source_id);

-- Wishlist indexes
CREATE INDEX IF NOT EXISTS idx_wishlist_items_priority ON wishlist_items(priority DESC);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_added ON wishlist_items(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_media_type ON wishlist_items(media_type);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_tmdb ON wishlist_items(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_musicbrainz ON wishlist_items(musicbrainz_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_reason ON wishlist_items(reason);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_media_item ON wishlist_items(media_item_id);

-- Create triggers for automatic updated_at timestamps
CREATE TRIGGER IF NOT EXISTS update_media_items_timestamp
AFTER UPDATE ON media_items
BEGIN
  UPDATE media_items SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_quality_scores_timestamp
AFTER UPDATE ON quality_scores
BEGIN
  UPDATE quality_scores SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_settings_timestamp
AFTER UPDATE ON settings
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_series_completeness_timestamp
AFTER UPDATE ON series_completeness
BEGIN
  UPDATE series_completeness SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_movie_collections_timestamp
AFTER UPDATE ON movie_collections
BEGIN
  UPDATE movie_collections SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_media_sources_timestamp
AFTER UPDATE ON media_sources
BEGIN
  UPDATE media_sources SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Music table triggers
CREATE TRIGGER IF NOT EXISTS update_music_artists_timestamp
AFTER UPDATE ON music_artists
BEGIN
  UPDATE music_artists SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_music_albums_timestamp
AFTER UPDATE ON music_albums
BEGIN
  UPDATE music_albums SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_music_tracks_timestamp
AFTER UPDATE ON music_tracks
BEGIN
  UPDATE music_tracks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_music_quality_scores_timestamp
AFTER UPDATE ON music_quality_scores
BEGIN
  UPDATE music_quality_scores SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_artist_completeness_timestamp
AFTER UPDATE ON artist_completeness
BEGIN
  UPDATE artist_completeness SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_album_completeness_timestamp
AFTER UPDATE ON album_completeness
BEGIN
  UPDATE album_completeness SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_library_scans_timestamp
AFTER UPDATE ON library_scans
BEGIN
  UPDATE library_scans SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_wishlist_items_timestamp
AFTER UPDATE ON wishlist_items
BEGIN
  UPDATE wishlist_items SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_notifications_read_timestamp
AFTER UPDATE ON notifications
WHEN NEW.is_read = 1 AND OLD.is_read = 0
BEGIN
  UPDATE notifications SET read_at = datetime('now') WHERE id = NEW.id;
END;

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('plex_token', ''),
  ('plex_server_url', ''),
  ('last_scan_time', ''),
  ('quality_threshold_resolution', '720'),
  ('quality_threshold_bitrate_sd', '2000'),
  ('quality_threshold_bitrate_720p', '5000'),
  ('quality_threshold_bitrate_1080p', '10000'),
  ('quality_threshold_audio', '192'),
  ('theme', 'dark'),
  ('theme_mode', 'dark'),
  ('tmdb_api_key', ''),

  -- Video bitrate thresholds (kbps) - MEDIUM and HIGH thresholds per tier
  -- Below MEDIUM = LOW quality, MEDIUM to HIGH = MEDIUM quality, above HIGH = HIGH quality
  ('quality_video_sd_medium', '1500'),
  ('quality_video_sd_high', '3500'),
  ('quality_video_720p_medium', '3000'),
  ('quality_video_720p_high', '8000'),
  ('quality_video_1080p_medium', '6000'),
  ('quality_video_1080p_high', '15000'),
  ('quality_video_4k_medium', '15000'),
  ('quality_video_4k_high', '40000'),

  -- Audio bitrate thresholds (kbps) - MEDIUM and HIGH thresholds per tier
  ('quality_audio_sd_medium', '128'),
  ('quality_audio_sd_high', '192'),
  ('quality_audio_720p_medium', '192'),
  ('quality_audio_720p_high', '320'),
  ('quality_audio_1080p_medium', '256'),
  ('quality_audio_1080p_high', '640'),
  ('quality_audio_4k_medium', '320'),
  ('quality_audio_4k_high', '1000'),

  -- Codec efficiency multipliers (effective bitrate = actual * multiplier)
  ('quality_codec_h264', '1.0'),
  ('quality_codec_h265', '2.0'),
  ('quality_codec_av1', '2.5'),
  ('quality_codec_vp9', '1.8'),

  -- Music quality thresholds
  ('quality_music_low_bitrate', '192'),
  ('quality_music_high_bitrate', '256'),
  ('quality_music_hires_samplerate', '44100'),
  ('quality_music_hires_bitdepth', '16'),

  -- Window behavior
  ('minimize_to_tray', 'false'),
  ('start_minimized_to_tray', 'false'),

  -- File logging
  ('file_logging_enabled', 'true'),
  ('file_logging_min_level', 'info'),
  ('log_retention_days', '7');
`
