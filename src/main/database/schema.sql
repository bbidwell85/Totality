-- Totality Database Schema
-- SQLite database for storing media library analysis and recommendations

-- Media items table (movies and TV episodes from Plex)
CREATE TABLE IF NOT EXISTS media_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plex_id TEXT NOT NULL UNIQUE,
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

  -- Metadata
  imdb_id TEXT,
  tmdb_id TEXT,
  poster_url TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quality scores for each media item
CREATE TABLE IF NOT EXISTS quality_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL,

  -- Scores (0-100 scale)
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

-- Purchase recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL,

  -- Product information
  retailer TEXT NOT NULL,
  product_url TEXT NOT NULL,
  product_title TEXT NOT NULL,
  format TEXT NOT NULL,

  -- Pricing
  current_price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',

  -- Quality improvement
  target_resolution TEXT NOT NULL,
  target_bitrate INTEGER NOT NULL,
  improvement_score INTEGER NOT NULL,

  -- Availability
  in_stock INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- Price history for recommendations
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER NOT NULL,

  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  in_stock INTEGER NOT NULL DEFAULT 1,

  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE
);

-- Price alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER NOT NULL,

  target_price REAL NOT NULL,
  threshold_percentage INTEGER NOT NULL DEFAULT 20,

  is_active INTEGER NOT NULL DEFAULT 1,
  triggered_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE
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
  series_title TEXT NOT NULL UNIQUE,

  total_seasons INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  owned_seasons INTEGER NOT NULL,
  owned_episodes INTEGER NOT NULL,

  -- JSON arrays
  missing_seasons TEXT NOT NULL DEFAULT '[]',
  missing_episodes TEXT NOT NULL DEFAULT '[]',

  completeness_percentage REAL NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_items_plex_id ON media_items(plex_id);
CREATE INDEX IF NOT EXISTS idx_media_items_series ON media_items(series_title) WHERE type = 'episode';
CREATE INDEX IF NOT EXISTS idx_quality_scores_media ON quality_scores(media_item_id);
CREATE INDEX IF NOT EXISTS idx_quality_scores_needs_upgrade ON quality_scores(needs_upgrade) WHERE needs_upgrade = 1;
CREATE INDEX IF NOT EXISTS idx_recommendations_media ON recommendations(media_item_id);
CREATE INDEX IF NOT EXISTS idx_price_history_recommendation ON price_history(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_recommendation ON price_alerts(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_series_completeness_title ON series_completeness(series_title);

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

CREATE TRIGGER IF NOT EXISTS update_recommendations_timestamp
AFTER UPDATE ON recommendations
BEGIN
  UPDATE recommendations SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_price_alerts_timestamp
AFTER UPDATE ON price_alerts
BEGIN
  UPDATE price_alerts SET updated_at = datetime('now') WHERE id = NEW.id;
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
  ('price_check_frequency', 'daily'),
  ('price_alert_threshold', '20'),
  ('preferred_retailers', '["Amazon", "Best Buy"]'),
  ('theme', 'light');
