/**
 * Zod Validation Schemas
 *
 * Centralized validation schemas for IPC handler inputs.
 * These schemas provide type-safe runtime validation at IPC boundaries.
 */

import { z } from 'zod'

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

/**
 * Provider types supported by the application
 */
export const ProviderTypeSchema = z.enum([
  'plex',
  'jellyfin',
  'emby',
  'kodi',
  'kodi-local',
  'kodi-mysql',
  'local'
])

/**
 * Media types
 */
export const MediaTypeSchema = z.enum(['movie', 'episode'])

/**
 * Quality tier
 */
export const QualityTierSchema = z.enum(['SD', '720p', '1080p', '4K'])

/**
 * Tier quality level
 */
export const TierQualitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])

// ============================================================================
// SOURCE SCHEMAS
// ============================================================================

/**
 * Schema for adding a new media source
 */
export const AddSourceSchema = z.object({
  sourceType: ProviderTypeSchema,
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long').trim(),
  connectionConfig: z.record(z.string(), z.unknown()),
  isEnabled: z.boolean().optional().default(true),
})

/**
 * Schema for updating a media source
 */
export const UpdateSourceSchema = z.object({
  displayName: z.string().min(1).max(100).trim().optional(),
  connectionConfig: z.record(z.string(), z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
})

// ============================================================================
// AUTHENTICATION SCHEMAS
// ============================================================================

/**
 * Plex authentication with token
 */
export const PlexAuthSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  displayName: z.string().min(1).max(100).trim(),
})

/**
 * Jellyfin/Emby API key authentication
 */
export const JellyfinApiKeyAuthSchema = z.object({
  serverUrl: z.string().url('Invalid server URL'),
  apiKey: z.string().min(1, 'API key is required'),
  displayName: z.string().min(1).max(100).trim(),
})

/**
 * Jellyfin/Emby credentials authentication
 */
export const JellyfinCredentialsAuthSchema = z.object({
  serverUrl: z.string().url('Invalid server URL'),
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required'),
  displayName: z.string().min(1).max(100).trim(),
  isEmby: z.boolean().optional().default(false),
})

/**
 * Kodi MySQL connection configuration for authentication
 */
export const KodiMySQLConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().max(256),
  displayName: z.string().min(1, 'Display name is required').max(100).trim(),
  videoDatabaseName: z.string().max(100).optional(),
  musicDatabaseName: z.string().max(100).optional(),
  databasePrefix: z.string().max(50).optional(),
  ssl: z.boolean().optional(),
})

/**
 * Local folder source configuration
 */
export const LocalFolderConfigSchema = z.object({
  folderPath: z.string().min(1, 'Folder path is required'),
  displayName: z.string().min(1).max(100).trim(),
  mediaType: z.enum(['movies', 'tv', 'music']).optional(),
})

// ============================================================================
// MEDIA ITEM SCHEMAS
// ============================================================================

/**
 * Media item for upsert operations
 */
export const MediaItemSchema = z.object({
  id: z.number().int().positive().optional(),
  source_id: z.string().min(1),
  source_type: ProviderTypeSchema,
  library_id: z.string().min(1),
  provider_item_id: z.string().min(1),
  type: MediaTypeSchema,
  title: z.string().min(1).max(500),
  year: z.number().int().min(1800).max(2100).optional().nullable(),
  file_path: z.string().optional().nullable(),
  file_size: z.number().int().nonnegative().optional().nullable(),
  duration: z.number().int().nonnegative().optional().nullable(),
  resolution: z.string().max(20).optional().nullable(),
  video_codec: z.string().max(50).optional().nullable(),
  video_bitrate: z.number().nonnegative().optional().nullable(),
  video_frame_rate: z.number().nonnegative().optional().nullable(),
  audio_codec: z.string().max(50).optional().nullable(),
  audio_channels: z.number().int().min(1).max(32).optional().nullable(),
  audio_bitrate: z.number().nonnegative().optional().nullable(),
  has_object_audio: z.boolean().optional().nullable(),
  hdr_format: z.string().max(50).optional().nullable(),
  container: z.string().max(20).optional().nullable(),
  imdb_id: z.string().max(20).optional().nullable(),
  tmdb_id: z.string().max(20).optional().nullable(),
  poster_url: z.string().url().optional().nullable(),
  series_title: z.string().max(500).optional().nullable(),
  season_number: z.number().int().min(0).optional().nullable(),
  episode_number: z.number().int().min(0).optional().nullable(),
  episode_title: z.string().max(500).optional().nullable(),
  audio_tracks: z.string().optional().nullable(),
  audio_sample_rate: z.number().int().positive().optional().nullable(),
  color_bit_depth: z.number().int().min(8).max(16).optional().nullable(),
  color_space: z.string().max(50).optional().nullable(),
  video_profile: z.string().max(100).optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  episode_thumb_url: z.string().url().optional().nullable(),
  season_poster_url: z.string().url().optional().nullable(),
  user_fixed_match: z.boolean().optional().nullable(),
})

/**
 * Quality score for upsert operations
 */
export const QualityScoreSchema = z.object({
  id: z.number().int().positive().optional(),
  media_item_id: z.number().int().positive(),
  overall_score: z.number().min(0).max(100),
  needs_upgrade: z.boolean(),
  quality_tier: QualityTierSchema.optional(),
  tier_quality: TierQualitySchema.optional(),
  tier_score: z.number().min(0).max(100).optional(),
  issues: z.string().optional().nullable(),
})

// ============================================================================
// FILTER SCHEMAS
// ============================================================================

/**
 * Media item filter options
 */
export const MediaItemFiltersSchema = z.object({
  type: MediaTypeSchema.optional(),
  minQualityScore: z.number().min(0).max(100).optional(),
  maxQualityScore: z.number().min(0).max(100).optional(),
  needsUpgrade: z.boolean().optional(),
  searchQuery: z.string().max(500).optional(),
  limit: z.number().int().positive().max(10000).optional(),
  offset: z.number().int().nonnegative().optional(),
  sourceId: z.string().optional(),
  sourceType: ProviderTypeSchema.optional(),
  libraryId: z.string().optional(),
  sortBy: z.enum(['title', 'year', 'updated_at', 'created_at', 'tier_score', 'overall_score']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  includeDisabledLibraries: z.boolean().optional(),
})

// ============================================================================
// WISHLIST SCHEMAS
// ============================================================================

/**
 * Wishlist item media types
 */
export const WishlistMediaTypeSchema = z.enum(['movie', 'episode', 'season', 'album', 'track'])

/**
 * Wishlist item schema
 */
export const WishlistItemSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1, 'Title is required').max(500).trim(),
  media_type: WishlistMediaTypeSchema,
  priority: z.number().int().min(1).max(5).optional().default(3),
  reason: z.enum(['missing', 'upgrade']).optional(),
  notes: z.string().max(1000).trim().optional(),
  year: z.number().int().min(1800).max(2100).optional().nullable(),
  series_title: z.string().max(500).optional().nullable(),
  season_number: z.number().int().min(0).optional().nullable(),
  artist_name: z.string().max(500).optional().nullable(),
  tmdb_id: z.string().max(20).optional().nullable(),
  imdb_id: z.string().max(20).optional().nullable(),
  poster_url: z.string().url().optional().nullable(),
})

// ============================================================================
// URL VALIDATION
// ============================================================================

/**
 * Safe URL schema (only http/https)
 */
export const SafeUrlSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  },
  { message: 'URL must use http or https protocol' }
)

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate and parse input, throwing a descriptive error on failure
 */
export function validateInput<T>(schema: z.ZodSchema<T>, input: unknown, context?: string): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
    throw new Error(`${context ? `[${context}] ` : ''}Validation failed: ${errors}`)
  }
  return result.data
}

/**
 * Safely validate input, returning null on failure instead of throwing
 */
export function safeValidateInput<T>(schema: z.ZodSchema<T>, input: unknown): T | null {
  const result = schema.safeParse(input)
  return result.success ? result.data : null
}
