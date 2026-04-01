/**
 * Shared setting key constants used across main and renderer processes.
 * Prevents typos and enables IDE autocompletion for setting keys.
 */
export const SETTING_KEYS = {
  // Completeness settings
  completeness_include_eps: 'completeness_include_eps',
  completeness_include_singles: 'completeness_include_singles',

  // API keys & services
  tmdb_api_key: 'tmdb_api_key',
  gemini_api_key: 'gemini_api_key',
  gemini_model: 'gemini_model',
  ai_enabled: 'ai_enabled',
  musicbrainz_api_token: 'musicbrainz_api_token',
  musicbrainz_name_correction: 'musicbrainz_name_correction',
  plex_token: 'plex_token',
  plex_server_id: 'plex_server_id',
  plex_server_url: 'plex_server_url',

  // Dashboard sort preferences
  dashboard_upgrade_sort: 'dashboard_upgrade_sort',
  dashboard_collection_sort: 'dashboard_collection_sort',
  dashboard_series_sort: 'dashboard_series_sort',
  dashboard_artist_sort: 'dashboard_artist_sort',

  // Quality settings
  quality_video_weight: 'quality_video_weight',
  quality_video_sd_medium: 'quality_video_sd_medium',
  quality_video_sd_high: 'quality_video_sd_high',
  quality_video_720p_medium: 'quality_video_720p_medium',
  quality_video_720p_high: 'quality_video_720p_high',
  quality_video_1080p_medium: 'quality_video_1080p_medium',
  quality_video_1080p_high: 'quality_video_1080p_high',
  quality_video_4k_medium: 'quality_video_4k_medium',
  quality_video_4k_high: 'quality_video_4k_high',
  quality_audio_sd_medium: 'quality_audio_sd_medium',
  quality_audio_sd_high: 'quality_audio_sd_high',
  quality_audio_720p_medium: 'quality_audio_720p_medium',
  quality_audio_720p_high: 'quality_audio_720p_high',
  quality_audio_1080p_medium: 'quality_audio_1080p_medium',
  quality_audio_1080p_high: 'quality_audio_1080p_high',
  quality_audio_4k_medium: 'quality_audio_4k_medium',
  quality_audio_4k_high: 'quality_audio_4k_high',
  quality_music_low_bitrate: 'quality_music_low_bitrate',
  quality_music_high_bitrate: 'quality_music_high_bitrate',
  quality_music_hires_samplerate: 'quality_music_hires_samplerate',
  quality_music_hires_bitdepth: 'quality_music_hires_bitdepth',
  quality_codec_h264: 'quality_codec_h264',
  quality_codec_h265: 'quality_codec_h265',
  quality_codec_av1: 'quality_codec_av1',
  quality_codec_vp9: 'quality_codec_vp9',

  // FFprobe settings
  ffprobe_enabled: 'ffprobe_enabled',
  ffprobe_parallel_enabled: 'ffprobe_parallel_enabled',
  ffprobe_batch_size: 'ffprobe_batch_size',

  // Library view preferences
  library_view_prefs: 'library_view_prefs',

  // Monitoring settings
  monitoring_enabled: 'monitoring_enabled',
  monitoring_start_on_launch: 'monitoring_start_on_launch',
  monitoring_pause_during_scan: 'monitoring_pause_during_scan',

  // App settings
  minimize_to_tray: 'minimize_to_tray',
  start_minimized_to_tray: 'start_minimized_to_tray',
  onboarding_completed: 'onboarding_completed',
  auto_update_enabled: 'auto_update_enabled',
  theme: 'theme',
  theme_mode: 'theme_mode',
  mood_source_of_truth: 'mood_source_of_truth',
  store_region: 'store_region',
  nfs_mount_mappings: 'nfs_mount_mappings',
  last_scan_time: 'last_scan_time',

  // Logging settings
  verbose_logging_enabled: 'verbose_logging_enabled',
  file_logging_enabled: 'file_logging_enabled',
  file_logging_min_level: 'file_logging_min_level',
  log_retention_days: 'log_retention_days',
} as const

export type SettingKey = typeof SETTING_KEYS[keyof typeof SETTING_KEYS]
