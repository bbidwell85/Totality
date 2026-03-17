import type { GeminiToolDefinition } from './GeminiService'
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { getTMDBService } from './TMDBService'
import { getMusicBrainzService } from './MusicBrainzService'

/** Actionable item from tool results — not-owned titles the user can add to wishlist */
export interface ActionableItem {
  title: string
  year?: number
  tmdb_id?: string
  media_type: 'movie' | 'tv'
}

/** Push a not-owned item to the collector, deduplicating by tmdb_id */
function collectItem(collector: ActionableItem[] | undefined, item: ActionableItem): void {
  if (!collector || !item.tmdb_id) return
  if (collector.some((c) => c.tmdb_id === item.tmdb_id)) return
  collector.push(item)
}

/** Strip null/undefined/empty fields to reduce token usage */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') result[k] = v
  }
  return result
}

/**
 * Tool definitions for Gemini AI library chat assistant.
 * Each tool maps to existing DatabaseService / QualityAnalyzer methods.
 */

export const LIBRARY_TOOLS: GeminiToolDefinition[] = [
  {
    name: 'search_library',
    description: 'Search the media library by title. Returns movies, TV shows, episodes, artists, albums, and tracks matching the query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (title, artist name, etc.)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_media_items',
    description: 'Get movies or TV episodes from the library with optional filters. Use this to find items by quality tier, type, or to list upgrades needed.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['movie', 'episode'], description: 'Filter by media type' },
        quality_tier: { type: 'string', enum: ['SD', '720p', '1080p', '4K'], description: 'Filter by resolution tier' },
        tier_quality: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], description: 'Filter by quality level within tier' },
        needs_upgrade: { type: 'boolean', description: 'Only return items that need quality upgrades' },
        search_query: { type: 'string', description: 'Search by title' },
        sort_by: { type: 'string', enum: ['title', 'year', 'tier_score', 'overall_score', 'updated_at'], description: 'Sort field' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_tv_shows',
    description: 'Get a list of TV shows in the library. Returns series titles with episode/season counts.',
    parameters: {
      type: 'object',
      properties: {
        search_query: { type: 'string', description: 'Search by show title' },
        sort_by: { type: 'string', enum: ['title', 'episode_count', 'season_count'] },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_library_stats',
    description: 'Get overall library statistics: total items, quality breakdowns, upgrade counts, and average quality scores for movies and TV separately.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Optional: limit stats to a specific source' },
      },
    },
  },
  {
    name: 'get_quality_distribution',
    description: 'Get the quality distribution across the entire library. Shows counts by tier (SD/720p/1080p/4K) and quality level (LOW/MEDIUM/HIGH).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_series_completeness',
    description: 'Get TV series completeness data. Shows which series are complete/incomplete with missing episode details.',
    parameters: {
      type: 'object',
      properties: {
        series_title: { type: 'string', description: 'Optional: filter to a specific series by title' },
        incomplete_only: { type: 'boolean', description: 'Only return incomplete series (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_collection_completeness',
    description: 'Get movie collection (franchise) completeness. Shows which collections are complete/incomplete with missing movie details.',
    parameters: {
      type: 'object',
      properties: {
        incomplete_only: { type: 'boolean', description: 'Only return incomplete collections (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_music_stats',
    description: 'Get music library statistics: total artists, albums, tracks.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Optional: limit stats to a specific source' },
      },
    },
  },
  {
    name: 'get_music_albums',
    description: 'Get music albums from the library with optional filters. Use to browse albums by artist, quality tier, or find albums needing upgrades.',
    parameters: {
      type: 'object',
      properties: {
        artist_name: { type: 'string', description: 'Filter albums by artist name' },
        quality_tier: { type: 'string', enum: ['LOSSY_LOW', 'LOSSY_MID', 'LOSSY_HIGH', 'LOSSLESS', 'HI_RES'], description: 'Filter by audio quality tier' },
        needs_upgrade: { type: 'boolean', description: 'Only return albums that need quality upgrades' },
        search_query: { type: 'string', description: 'Search by album title' },
        sort_by: { type: 'string', enum: ['title', 'artist', 'year', 'added_at'], description: 'Sort field' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_music_quality_distribution',
    description: 'Get music quality distribution across the library. Shows counts by audio quality tier (Hi-Res, Lossless, Lossy High/Mid/Low) and lists albums needing upgrades.',
    parameters: {
      type: 'object',
      properties: {
        include_upgrades: { type: 'boolean', description: 'Include list of albums needing upgrade (default false)' },
        upgrade_limit: { type: 'number', description: 'Max upgrade albums to return (default 10)' },
      },
    },
  },
  {
    name: 'get_artist_completeness',
    description: 'Get artist discography completeness from MusicBrainz. Shows which artists have incomplete discographies with missing album details. Use for "which artists am I missing albums from?" queries.',
    parameters: {
      type: 'object',
      properties: {
        artist_name: { type: 'string', description: 'Optional: check completeness for a specific artist' },
        incomplete_only: { type: 'boolean', description: 'Only return artists with missing albums (default false)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_album_details',
    description: 'Get detailed information about a specific album: tracks, audio quality (codec, bitrate, sample rate, bit depth), quality score, and completeness.',
    parameters: {
      type: 'object',
      properties: {
        album_id: { type: 'number', description: 'Album ID (from prior tool calls)' },
        album_title: { type: 'string', description: 'Album title to search for (used if album_id not provided)' },
        artist_name: { type: 'string', description: 'Artist name to help disambiguation when searching by title' },
      },
    },
  },
  {
    name: 'check_music_ownership',
    description: 'Check if the user owns music by specific artists. Use after recommending artists to verify which are already in the library.',
    parameters: {
      type: 'object',
      properties: {
        artists: {
          type: 'array',
          items: { type: 'string', description: 'Artist name' },
          description: 'List of artist names to check (max 20)',
        },
      },
      required: ['artists'],
    },
  },
  {
    name: 'get_source_list',
    description: 'List all configured media sources (Plex, Jellyfin, Emby, Kodi, Local Folders) with their status.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_wishlist',
    description: 'Get the user\'s wishlist/shopping list items. Shows items they want to acquire or upgrade.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['missing', 'upgrade'], description: 'Filter by reason' },
        media_type: { type: 'string', enum: ['movie', 'episode', 'season', 'album', 'track'], description: 'Filter by media type' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'search_tmdb',
    description: 'Search TMDB (The Movie Database) for movies, TV shows, or movie franchises and cross-reference with the user\'s library. Use this when users ask about specific franchises, or want to know if they own something or what they\'re missing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (franchise name, movie title, TV show name)' },
        search_type: { type: 'string', enum: ['movie', 'tv', 'collection'], description: 'Type of search. Use "collection" for franchises (e.g., Star Wars, Marvel, Harry Potter) — searches both official TMDB collections AND standalone movies matching the query. Use "movie" for specific movies. Use "tv" for TV shows.' },
      },
      required: ['query', 'search_type'],
    },
  },
  {
    name: 'discover_titles',
    description: 'Discover movies or TV shows by genre, year range, and rating. Great for "best sci-fi movies", "top rated horror from 2020-2024", "popular comedies" queries.',
    parameters: {
      type: 'object',
      properties: {
        media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media to discover' },
        genre: { type: 'string', description: 'Genre name (e.g., "sci-fi", "horror", "action", "comedy", "drama", "thriller", "animation", "documentary", "fantasy", "romance")' },
        year_min: { type: 'number', description: 'Minimum release year' },
        year_max: { type: 'number', description: 'Maximum release year' },
        sort_by: { type: 'string', enum: ['popularity', 'rating'], description: 'Sort by popularity (default) or rating' },
        min_rating: { type: 'number', description: 'Minimum TMDB rating (0-10)' },
        limit: { type: 'number', description: 'Max results (default 20, max 30)' },
      },
      required: ['media_type'],
    },
  },
  {
    name: 'get_similar_titles',
    description: 'Find movies or TV shows similar to a given title. Combines TMDB "similar" and "recommendations" endpoints for best results. Use for "movies like X" or "shows similar to X" queries. Always provide year when known to ensure correct title match.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title to find similar content for' },
        year: { type: 'number', description: 'Release year (important for disambiguation, especially short titles)' },
        media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
        limit: { type: 'number', description: 'Max results (default 20, max 30)' },
      },
      required: ['title', 'media_type'],
    },
  },
  {
    name: 'check_ownership',
    description: 'Check if the user owns specific movies or TV shows. Use after making recommendations to verify ownership status. For music artists, use check_music_ownership instead.',
    parameters: {
      type: 'object',
      properties: {
        titles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title to check' },
              year: { type: 'number', description: 'Release year (helps disambiguation)' },
              media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
            },
            required: ['title', 'media_type'],
          },
          description: 'List of titles to check (max 20)',
        },
      },
      required: ['titles'],
    },
  },
  {
    name: 'get_item_details',
    description: 'Get full technical details for a specific media item by title or ID. Returns video/audio specs, all audio tracks, subtitle tracks, file info, versions, and quality scores. Use for in-depth quality breakdowns.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title to search for (used if id not provided)' },
        id: { type: 'number', description: 'Media item ID (if known from prior tool calls)' },
        type: { type: 'string', enum: ['movie', 'episode'], description: 'Filter by type when searching by title' },
      },
    },
  },
  {
    name: 'add_to_wishlist',
    description: 'Add movies, TV shows, or music albums to the user\'s wishlist/shopping list. Use when the user asks to save titles for later acquisition. Always confirm what you\'re adding before calling this tool.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title of the movie, TV show, or album' },
              media_type: { type: 'string', enum: ['movie', 'tv', 'album', 'track'], description: 'Type of media' },
              year: { type: 'number', description: 'Release year (helps disambiguation)' },
              tmdb_id: { type: 'number', description: 'TMDB ID if known (movies/TV only)' },
              artist_name: { type: 'string', description: 'Artist name (music only)' },
              reason: { type: 'string', enum: ['missing', 'upgrade'], description: 'Why it\'s on the list (default: missing)' },
              priority: { type: 'number', description: 'Priority 1-5 (1=highest, 5=lowest, default: 3)' },
              notes: { type: 'string', description: 'Optional context (e.g., "Part of Marvel franchise", "Need lossless version")' },
            },
            required: ['title', 'media_type'],
          },
          description: 'List of titles to add (max 20)',
        },
      },
      required: ['items'],
    },
  },
]

/** Genre name aliases → TMDB canonical names */
const GENRE_ALIASES: Record<string, string> = {
  'sci-fi': 'Science Fiction',
  'scifi': 'Science Fiction',
  'science fiction': 'Science Fiction',
  'animated': 'Animation',
  'cartoons': 'Animation',
  'scary': 'Horror',
  'suspense': 'Thriller',
  'romantic': 'Romance',
  'romcom': 'Comedy',
  'war': 'War',
  'docs': 'Documentary',
  'adventure': 'Adventure',
  'action': 'Action',
  'comedy': 'Comedy',
  'drama': 'Drama',
  'horror': 'Horror',
  'thriller': 'Thriller',
  'animation': 'Animation',
  'documentary': 'Documentary',
  'fantasy': 'Fantasy',
  'romance': 'Romance',
  'mystery': 'Mystery',
  'crime': 'Crime',
  'family': 'Family',
  'western': 'Western',
  'music': 'Music',
  'history': 'History',
}

/** Resolve a user-friendly genre name to a TMDB genre ID */
async function resolveGenreId(
  genreName: string,
  mediaType: 'movie' | 'tv',
): Promise<number | null> {
  const tmdb = getTMDBService()
  const genres = mediaType === 'movie'
    ? await tmdb.getMovieGenres()
    : await tmdb.getTVGenres()

  // Try alias mapping first
  const canonical = GENRE_ALIASES[genreName.toLowerCase()] || genreName
  const match = genres.find(
    (g) => g.name.toLowerCase() === canonical.toLowerCase(),
  )
  return match?.id || null
}

/** Check TV show ownership by series TMDB ID, with title fallback */
function checkTVShowOwnership(
  db: ReturnType<typeof getDatabase>,
  tmdbId: string,
  title: string,
): { owned: boolean; episode_count: number } {
  // Primary: check by series_tmdb_id (accurate)
  const count = db.getEpisodeCountBySeriesTmdbId(tmdbId)
  if (count > 0) return { owned: true, episode_count: count }

  // Fallback: title-based search
  const tvShows = db.getTVShows({ searchQuery: title, limit: 1 })
  if (tvShows.length > 0) {
    const show = tvShows[0] as Record<string, unknown>
    return { owned: true, episode_count: (show.episode_count as number) || 0 }
  }

  return { owned: false, episode_count: 0 }
}

/** Sanitize and validate a string tool input */
function toolString(input: Record<string, unknown>, key: string, maxLen = 500): string {
  const val = input[key]
  if (typeof val !== 'string') return ''
  return val.slice(0, maxLen).trim()
}

/** Sanitize and validate a numeric tool input */
function toolNumber(input: Record<string, unknown>, key: string, min = 0, max = 10000): number | undefined {
  const val = input[key]
  if (val === undefined || val === null) return undefined
  const num = typeof val === 'number' ? val : Number(val)
  if (isNaN(num)) return undefined
  return Math.max(min, Math.min(max, Math.floor(num)))
}

/** Sanitize and validate a boolean tool input */
function toolBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const val = input[key]
  if (typeof val === 'boolean') return val
  return undefined
}

/**
 * Execute a tool by name with the given input.
 * Returns a JSON string result for Gemini to process.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  collector?: ActionableItem[],
): Promise<string> {
  const db = getDatabase()

  switch (name) {
    case 'search_library': {
      const query = toolString(input, 'query', 200)
      if (!query) return JSON.stringify({ error: 'query is required' })
      const results = db.globalSearch(query, 10)
      const hasResults = results.movies.length > 0 || results.tvShows.length > 0 ||
        results.episodes.length > 0 || results.artists.length > 0 ||
        results.albums.length > 0 || results.tracks.length > 0

      // Fallback: if no local results, try TMDB lookup + ownership check
      if (!hasResults) {
        try {
          const tmdb = getTMDBService()
          const movieResults = await tmdb.searchMovie(query)
          if (movieResults.results.length > 0) {
            const tmdbIds = movieResults.results.slice(0, 5).map((m: { id: number }) => String(m.id))
            const ownedMap = db.getMediaItemsByTmdbIds(tmdbIds)
            const found = movieResults.results.slice(0, 5).map((m: { id: number; title: string; release_date?: string }) => {
              const owned = ownedMap.get(String(m.id)) as Record<string, unknown> | undefined
              return compact({
                title: m.title,
                year: m.release_date?.substring(0, 4),
                tmdb_id: m.id,
                owned: !!owned,
                quality: owned ? `${owned.quality_tier} ${owned.tier_quality}` : null,
                id: owned ? owned.id : null,
              })
            })
            return JSON.stringify({ tmdb_matches: found })
          }
        } catch {
          // TMDB fallback failed, return empty results
        }
      }

      return JSON.stringify(results)
    }

    case 'get_media_items': {
      const limit = toolNumber(input, 'limit', 1, 50) || 20
      const items = db.getMediaItems({
        type: toolString(input, 'type') as 'movie' | 'episode' | undefined || undefined,
        qualityTier: toolString(input, 'quality_tier') || undefined,
        tierQuality: toolString(input, 'tier_quality') || undefined,
        needsUpgrade: toolBoolean(input, 'needs_upgrade'),
        searchQuery: toolString(input, 'search_query', 200) || undefined,
        sortBy: toolString(input, 'sort_by') || 'title',
        sortOrder: (toolString(input, 'sort_order') as 'asc' | 'desc') || 'asc',
        limit,
      })
      const simplified = items.map((item: Record<string, unknown>) => compact({
        title: item.title,
        year: item.year,
        type: item.type,
        series_title: item.series_title,
        season_number: item.season_number,
        episode_number: item.episode_number,
        resolution: item.resolution,
        video_codec: item.video_codec,
        video_bitrate: item.video_bitrate,
        audio_codec: item.audio_codec,
        quality_tier: item.quality_tier,
        tier_quality: item.tier_quality,
        tier_score: item.tier_score,
        needs_upgrade: item.needs_upgrade,
      }))
      return JSON.stringify({ count: items.length, items: simplified })
    }

    case 'get_tv_shows': {
      const limit = toolNumber(input, 'limit', 1, 50) || 20
      const shows = db.getTVShows({
        searchQuery: toolString(input, 'search_query', 200) || undefined,
        sortBy: (toolString(input, 'sort_by') as 'title' | 'episode_count' | 'season_count') || 'title',
        limit,
      })
      const simplified = shows.map((s: Record<string, unknown>) => compact({
        series_title: s.series_title,
        episode_count: s.episode_count,
        season_count: s.season_count,
      }))
      return JSON.stringify({ count: shows.length, shows: simplified })
    }

    case 'get_library_stats': {
      const stats = db.getLibraryStats(toolString(input, 'source_id') || undefined)
      return JSON.stringify(stats)
    }

    case 'get_quality_distribution': {
      const distribution = getQualityAnalyzer().getQualityDistribution()
      return JSON.stringify(distribution)
    }

    case 'get_series_completeness': {
      let series
      const seriesTitle = toolString(input, 'series_title', 300)
      if (seriesTitle) {
        const single = db.getSeriesCompletenessByTitle(seriesTitle)
        series = single ? [single] : []
      } else if (toolBoolean(input, 'incomplete_only')) {
        series = db.getIncompleteSeries()
      } else {
        series = db.getAllSeriesCompleteness()
      }
      const seriesLimit = toolNumber(input, 'limit', 1, 50) || 20
      const limited = series.slice(0, seriesLimit)
      const simplified = limited.map((s: Record<string, unknown>) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((s.missing_episodes as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((e: Record<string, unknown>) =>
            `S${e.season_number}E${e.episode_number}`,
          )
        } catch { /* empty */ }
        return compact({
          series_title: s.series_title,
          total_seasons: s.total_seasons,
          total_episodes: s.total_episodes,
          owned_episodes: s.owned_episodes,
          completeness_percentage: s.completeness_percentage,
          status: s.status,
          missing_count: missingCount,
          missing_sample: missingSample.length > 0 ? missingSample : undefined,
        })
      })
      return JSON.stringify({ count: series.length, shown: limited.length, series: simplified })
    }

    case 'get_collection_completeness': {
      let collections
      if (toolBoolean(input, 'incomplete_only')) {
        collections = db.getIncompleteMovieCollections()
      } else {
        collections = db.getMovieCollections()
      }
      const collLimit = toolNumber(input, 'limit', 1, 50) || 20
      const limited = collections.slice(0, collLimit)
      const simplified = limited.map((c: Record<string, unknown>) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((c.missing_movies as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((m: Record<string, unknown>) =>
            m.year ? `${m.title} (${m.year})` : `${m.title}`,
          )
        } catch { /* empty */ }
        return compact({
          collection_name: c.collection_name,
          total_movies: c.total_movies,
          owned_movies: c.owned_movies,
          completeness_percentage: c.completeness_percentage,
          missing_count: missingCount,
          missing_sample: missingSample.length > 0 ? missingSample : undefined,
        })
      })
      return JSON.stringify({ count: collections.length, shown: limited.length, collections: simplified })
    }

    case 'get_music_stats': {
      const stats = db.getMusicStats(toolString(input, 'source_id') || undefined)
      return JSON.stringify(stats)
    }

    case 'get_source_list': {
      const stats = db.getAggregatedSourceStats()
      return JSON.stringify(stats)
    }

    case 'get_wishlist': {
      const wlLimit = toolNumber(input, 'limit', 1, 50) || 20
      const items = db.getWishlistItems({
        reason: (toolString(input, 'reason') as 'missing' | 'upgrade') || undefined,
        media_type: toolString(input, 'media_type') || undefined,
        limit: wlLimit,
        status: 'active',
      })
      const simplified = items.map((item: Record<string, unknown>) => compact({
        media_type: item.media_type,
        title: item.title,
        year: item.year,
        reason: item.reason,
        priority: item.priority,
        series_title: item.series_title,
        collection_name: item.collection_name,
        artist_name: item.artist_name,
        current_quality_tier: item.current_quality_tier,
        current_quality_level: item.current_quality_level,
      }))
      return JSON.stringify({ count: items.length, items: simplified })
    }

    case 'search_tmdb': {
      const query = toolString(input, 'query', 200)
      if (!query) return JSON.stringify({ error: 'query is required' })
      const searchType = toolString(input, 'search_type') || 'movie'
      const tmdb = getTMDBService()

      if (searchType === 'collection') {
        // Search both collections AND general movies to catch standalone franchise films
        const [collectionResults, movieResults] = await Promise.all([
          tmdb.searchCollection(query),
          tmdb.searchMovie(query),
        ])
        const collections = collectionResults.results.slice(0, 3)

        // Track all TMDB IDs we've already included from collections to avoid duplicates
        const seenTmdbIds = new Set<string>()
        const collectionData = []

        for (const col of collections) {
          const details = await tmdb.getCollectionDetails(String(col.id))
          const tmdbIds = details.parts.map((p) => String(p.id))
          tmdbIds.forEach((id) => seenTmdbIds.add(id))

          // Cross-reference with owned media
          const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

          const movies = details.parts
            .filter((p) => p.release_date && new Date(p.release_date) <= new Date())
            .map((p) => {
              const ownedItem = ownedByTmdbId.get(String(p.id)) as Record<string, unknown> | undefined
              if (!ownedItem) {
                collectItem(collector, { title: p.title, year: parseInt(p.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(p.id), media_type: 'movie' })
              }
              return {
                title: p.title,
                year: p.release_date?.substring(0, 4) || null,
                tmdb_id: p.id,
                owned: !!ownedItem,
                quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
              }
            })

          collectionData.push({
            collection_name: details.name,
            total_movies: movies.length,
            owned_count: movies.filter((m) => m.owned).length,
            missing_count: movies.filter((m) => !m.owned).length,
            movies,
          })
        }

        // Find standalone movies matching the query that aren't in any collection
        const standaloneMovies = movieResults.results
          .filter((m) => !seenTmdbIds.has(String(m.id)))
          .slice(0, 10)

        let standaloneData = null
        if (standaloneMovies.length > 0) {
          const tmdbIds = standaloneMovies.map((m) => String(m.id))
          const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

          const movies = standaloneMovies
            .filter((m) => m.release_date && new Date(m.release_date) <= new Date())
            .map((m) => {
              const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
              if (!ownedItem) {
                collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
              }
              return {
                title: m.title,
                year: m.release_date?.substring(0, 4) || null,
                tmdb_id: m.id,
                owned: !!ownedItem,
                quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
              }
            })

          standaloneData = {
            label: `Other "${query}" movies (not in a collection)`,
            total_movies: movies.length,
            owned_count: movies.filter((m) => m.owned).length,
            missing_count: movies.filter((m) => !m.owned).length,
            movies,
          }
        }

        if (collectionData.length === 0 && !standaloneData) {
          return JSON.stringify({ message: `No movies or collections found matching "${query}"` })
        }

        return JSON.stringify({
          collections_found: collectionData.length,
          collections: collectionData,
          standalone_movies: standaloneData,
        })
      }

      if (searchType === 'movie') {
        const searchResults = await tmdb.searchMovie(query)
        const movies = searchResults.results.slice(0, 10)

        if (movies.length === 0) {
          return JSON.stringify({ message: `No movies found matching "${query}"` })
        }

        const tmdbIds = movies.map((m) => String(m.id))
        const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

        const results = movies.map((m) => {
          const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
          if (!ownedItem) {
            collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
          }
          return {
            title: m.title,
            year: m.release_date?.substring(0, 4) || null,
            tmdb_id: m.id,
            owned: !!ownedItem,
            quality: ownedItem ? {
              resolution: ownedItem.resolution,
              video_codec: ownedItem.video_codec,
              video_bitrate: ownedItem.video_bitrate,
              audio_codec: ownedItem.audio_codec,
              quality_tier: ownedItem.quality_tier,
              tier_quality: ownedItem.tier_quality,
            } : null,
          }
        })

        return JSON.stringify({ movies_found: results.length, results })
      }

      if (searchType === 'tv') {
        const searchResults = await tmdb.searchTVShow(query)
        const shows = searchResults.results.slice(0, 10)

        if (shows.length === 0) {
          return JSON.stringify({ message: `No TV shows found matching "${query}"` })
        }

        // Cross-reference with owned TV shows by title
        const results = shows.map((s) => {
          const tvShows = db.getTVShows({ searchQuery: s.name, limit: 1 })
          const match = tvShows.length > 0 ? tvShows[0] : null

          if (!match) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }

          return {
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            overview: s.overview?.substring(0, 150) || null,
            owned_episodes: match ? (match as Record<string, unknown>).episode_count : 0,
            in_library: !!match,
          }
        })

        return JSON.stringify({ shows_found: results.length, results })
      }

      return JSON.stringify({ error: `Unknown search_type: ${searchType}` })
    }

    case 'discover_titles': {
      const mediaType = (toolString(input, 'media_type') || 'movie') as 'movie' | 'tv'
      const genre = toolString(input, 'genre', 100) || undefined
      const yearMin = toolNumber(input, 'year_min', 1900, 2100)
      const yearMax = toolNumber(input, 'year_max', 1900, 2100)
      const sortBy = toolString(input, 'sort_by') || undefined
      const minRating = toolNumber(input, 'min_rating', 0, 10)
      const limit = toolNumber(input, 'limit', 1, 30) || 20

      const tmdb = getTMDBService()

      // Resolve genre name to ID
      let genreId: number | null = null
      if (genre) {
        genreId = await resolveGenreId(genre, mediaType)
        if (!genreId) {
          return JSON.stringify({ error: `Unknown genre: "${genre}". Try: action, comedy, drama, horror, sci-fi, thriller, animation, documentary, fantasy, romance, mystery, crime, family, western.` })
        }
      }

      // Map sort_by to TMDB sort parameter
      const tmdbSortBy = sortBy === 'rating' ? 'vote_average.desc' : 'popularity.desc'
      const minVoteCount = sortBy === 'rating' ? 200 : 50

      if (mediaType === 'movie') {
        const response = await tmdb.discoverMovies({
          genreId: genreId || undefined,
          yearMin,
          yearMax,
          sortBy: tmdbSortBy,
          minRating,
          minVoteCount,
        })

        const movies = response.results.slice(0, limit)
        const tmdbIds = movies.map((m) => String(m.id))
        const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

        const results = movies.map((m) => {
          const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
          if (!ownedItem) {
            collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
          }
          return compact({
            title: m.title,
            year: m.release_date?.substring(0, 4) || null,
            tmdb_id: m.id,
            rating: m.vote_average,
            owned: !!ownedItem,
            quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
          })
        })

        return JSON.stringify({
          media_type: 'movie',
          genre: genre || 'all',
          total_found: response.total_results,
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      } else {
        const response = await tmdb.discoverTV({
          genreId: genreId || undefined,
          yearMin,
          yearMax,
          sortBy: tmdbSortBy,
          minRating,
          minVoteCount,
        })

        const shows = response.results.slice(0, limit)
        const results = shows.map((s) => {
          const ownership = checkTVShowOwnership(db, String(s.id), s.name)
          if (!ownership.owned) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }
          return compact({
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            rating: s.vote_average,
            owned: ownership.owned,
            owned_episodes: ownership.owned ? ownership.episode_count : null,
          })
        })

        return JSON.stringify({
          media_type: 'tv',
          genre: genre || 'all',
          total_found: response.total_results,
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      }
    }

    case 'get_similar_titles': {
      const title = toolString(input, 'title', 300)
      if (!title) return JSON.stringify({ error: 'title is required' })
      const year = toolNumber(input, 'year', 1900, 2100)
      const mediaType = (toolString(input, 'media_type') || 'movie') as 'movie' | 'tv'
      const limit = toolNumber(input, 'limit', 1, 30) || 20
      const tmdb = getTMDBService()

      if (mediaType === 'movie') {
        // Search for the movie first (with year for disambiguation)
        const searchResults = await tmdb.searchMovie(title, year)
        if (searchResults.results.length === 0) {
          return JSON.stringify({ error: `Could not find movie "${title}" on TMDB` })
        }
        const sourceTmdbId = String(searchResults.results[0].id)
        const sourceTitle = searchResults.results[0].title

        // Fetch both similar and recommendations, deduplicate
        const [similar, recommendations] = await Promise.all([
          tmdb.getSimilarMovies(sourceTmdbId),
          tmdb.getMovieRecommendations(sourceTmdbId),
        ])

        const seen = new Set<number>()
        const combined: typeof similar.results = []
        // Recommendations first (higher quality suggestions)
        for (const m of recommendations.results) {
          if (!seen.has(m.id)) { seen.add(m.id); combined.push(m) }
        }
        for (const m of similar.results) {
          if (!seen.has(m.id)) { seen.add(m.id); combined.push(m) }
        }

        const limited = combined.slice(0, limit)
        const tmdbIds = limited.map((m) => String(m.id))
        const ownedByTmdbId = db.getMediaItemsByTmdbIds(tmdbIds)

        const results = limited.map((m) => {
          const ownedItem = ownedByTmdbId.get(String(m.id)) as Record<string, unknown> | undefined
          if (!ownedItem) {
            collectItem(collector, { title: m.title, year: parseInt(m.release_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(m.id), media_type: 'movie' })
          }
          return compact({
            title: m.title,
            year: m.release_date?.substring(0, 4) || null,
            tmdb_id: m.id,
            rating: m.vote_average,
            owned: !!ownedItem,
            quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
          })
        })

        return JSON.stringify({
          similar_to: sourceTitle,
          media_type: 'movie',
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      } else {
        // TV show
        const searchResults = await tmdb.searchTVShow(title)
        if (searchResults.results.length === 0) {
          return JSON.stringify({ error: `Could not find TV show "${title}" on TMDB` })
        }
        const sourceTmdbId = String(searchResults.results[0].id)
        const sourceTitle = searchResults.results[0].name

        const [similar, recommendations] = await Promise.all([
          tmdb.getSimilarTV(sourceTmdbId),
          tmdb.getTVRecommendations(sourceTmdbId),
        ])

        const seen = new Set<number>()
        const combined: typeof similar.results = []
        for (const s of recommendations.results) {
          if (!seen.has(s.id)) { seen.add(s.id); combined.push(s) }
        }
        for (const s of similar.results) {
          if (!seen.has(s.id)) { seen.add(s.id); combined.push(s) }
        }

        const limited = combined.slice(0, limit)
        const results = limited.map((s) => {
          const ownership = checkTVShowOwnership(db, String(s.id), s.name)
          if (!ownership.owned) {
            collectItem(collector, { title: s.name, year: parseInt(s.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(s.id), media_type: 'tv' })
          }
          return compact({
            title: s.name,
            first_air_date: s.first_air_date,
            tmdb_id: s.id,
            rating: s.vote_average,
            owned: ownership.owned,
            owned_episodes: ownership.owned ? ownership.episode_count : null,
          })
        })

        return JSON.stringify({
          similar_to: sourceTitle,
          media_type: 'tv',
          shown: results.length,
          owned_count: results.filter((r) => r.owned).length,
          results,
        })
      }
    }

    case 'check_ownership': {
      const rawTitles = Array.isArray(input.titles) ? input.titles : []
      const titles = rawTitles.slice(0, 20).map((t: Record<string, unknown>) => ({
        title: String(t.title || '').slice(0, 300),
        year: typeof t.year === 'number' ? t.year : undefined,
        media_type: String(t.media_type || 'movie'),
      })).filter(t => t.title)
      const tmdb = getTMDBService()

      const results = []
      for (const item of titles) {
        try {
          if (item.media_type === 'movie') {
            const searchResults = await tmdb.searchMovie(item.title, item.year)
            if (searchResults.results.length === 0) {
              results.push({ title: item.title, year: item.year, media_type: 'movie', found: false })
              continue
            }
            const movie = searchResults.results[0]
            const ownedMap = db.getMediaItemsByTmdbIds([String(movie.id)])
            const ownedItem = ownedMap.get(String(movie.id)) as Record<string, unknown> | undefined

            if (!ownedItem) {
              collectItem(collector, { title: movie.title, year: parseInt(movie.release_date?.substring(0, 4) || '0') || item.year, tmdb_id: String(movie.id), media_type: 'movie' })
            }
            results.push(compact({
              title: movie.title,
              year: movie.release_date?.substring(0, 4) || item.year,
              media_type: 'movie',
              found: true,
              owned: !!ownedItem,
              quality: ownedItem ? `${ownedItem.quality_tier} ${ownedItem.tier_quality}` : null,
            }))
          } else {
            const searchResults = await tmdb.searchTVShow(item.title)
            if (searchResults.results.length === 0) {
              results.push({ title: item.title, media_type: 'tv', found: false })
              continue
            }
            const show = searchResults.results[0]
            const ownership = checkTVShowOwnership(db, String(show.id), show.name)

            if (!ownership.owned) {
              collectItem(collector, { title: show.name, year: parseInt(show.first_air_date?.substring(0, 4) || '0') || undefined, tmdb_id: String(show.id), media_type: 'tv' })
            }
            results.push(compact({
              title: show.name,
              first_air_date: show.first_air_date,
              media_type: 'tv',
              found: true,
              owned: ownership.owned,
              owned_episodes: ownership.owned ? ownership.episode_count : null,
            }))
          }
        } catch {
          results.push({ title: item.title, media_type: item.media_type, error: 'lookup failed' })
        }
      }

      return JSON.stringify({
        checked: results.length,
        owned_count: results.filter((r) => (r as Record<string, unknown>).owned).length,
        results,
      })
    }

    case 'check_music_ownership': {
      const rawArtists = Array.isArray(input.artists) ? input.artists : []
      const artists = rawArtists.slice(0, 20).map((a: Record<string, unknown>) =>
        String(a.name || a || '').slice(0, 300)
      ).filter(Boolean)

      const results = artists.map((name: string) => {
        const searchResults = db.globalSearch(name, 5)
        const artistResults = (searchResults as Record<string, unknown>).artists as Array<Record<string, unknown>> | undefined
        const match = artistResults?.find(a =>
          String(a.name).toLowerCase() === name.toLowerCase()
        ) || (artistResults && artistResults.length > 0 ? artistResults[0] : null)

        if (match) {
          const albums = db.getMusicAlbumsByArtistName(String(match.name), 100)
          return compact({
            artist: match.name,
            owned: true,
            album_count: albums.length,
            albums: albums.slice(0, 5).map((a: Record<string, unknown>) => a.title),
          })
        }
        return { artist: name, owned: false, album_count: 0 }
      })

      return JSON.stringify({
        checked: results.length,
        owned_count: results.filter(r => r.owned).length,
        results,
      })
    }

    case 'get_item_details': {
      let item: Record<string, unknown> | null = null
      const itemId = toolNumber(input, 'id', 1)
      const itemTitle = toolString(input, 'title', 300)

      if (itemId) {
        item = db.getMediaItemById(itemId) as Record<string, unknown> | null
      } else if (itemTitle) {
        const results = db.globalSearch(itemTitle, 5)
        const mediaResults = (results as Record<string, unknown>).media_items as Array<Record<string, unknown>> | undefined
        if (mediaResults && mediaResults.length > 0) {
          const typeFilter = toolString(input, 'type') || undefined
          const match = typeFilter
            ? mediaResults.find((r) => r.type === typeFilter) || mediaResults[0]
            : mediaResults[0]
          item = db.getMediaItemById(match.id as number) as Record<string, unknown> | null
        }
      }

      if (!item) {
        return JSON.stringify({ error: 'Item not found' })
      }

      // Parse audio tracks
      let audioTracks: Array<Record<string, unknown>> = []
      try {
        if (item.audio_tracks) {
          audioTracks = JSON.parse(item.audio_tracks as string).map((t: Record<string, unknown>) => compact({
            codec: t.codec,
            channels: t.channels,
            language: t.language,
            bitrate: t.bitrate,
            sample_rate: t.sample_rate,
            profile: t.profile,
            object_audio: t.has_object_audio || undefined,
          }))
        }
      } catch { /* empty */ }

      // Parse subtitle tracks
      let subtitleTracks: string[] = []
      try {
        if (item.subtitle_tracks) {
          subtitleTracks = JSON.parse(item.subtitle_tracks as string).map(
            (t: Record<string, unknown>) => t.language || t.title || 'Unknown',
          )
        }
      } catch { /* empty */ }

      // Get quality score
      const qualityScore = db.getQualityScoreByMediaId(item.id as number) as Record<string, unknown> | null

      // Get versions
      const versions = db.getMediaItemVersions(item.id as number) as Array<Record<string, unknown>>
      const versionData = versions.length > 1 ? versions.map((v) => compact({
        edition: v.edition,
        label: v.label,
        resolution: v.resolution,
        video_codec: v.video_codec,
        video_bitrate: v.video_bitrate,
        audio_codec: v.audio_codec,
        audio_channels: v.audio_channels,
        hdr_format: v.hdr_format,
        file_size: v.file_size,
        quality_tier: v.quality_tier,
        tier_quality: v.tier_quality,
        is_best: v.is_best,
      })) : undefined

      const fileSizeMB = item.file_size ? Math.round((item.file_size as number) / 1024 / 1024) : null
      const durationMin = item.duration ? Math.round((item.duration as number) / 60) : null

      const details = compact({
        title: item.title,
        year: item.year,
        type: item.type,
        series_title: item.series_title,
        season_number: item.season_number,
        episode_number: item.episode_number,
        // Video
        resolution: item.resolution,
        video_codec: item.video_codec,
        video_bitrate: item.video_bitrate,
        video_frame_rate: item.video_frame_rate,
        hdr_format: item.hdr_format,
        color_bit_depth: item.color_bit_depth,
        color_space: item.color_space,
        // Audio (primary)
        audio_codec: item.audio_codec,
        audio_channels: item.audio_channels,
        audio_bitrate: item.audio_bitrate,
        has_object_audio: item.has_object_audio,
        // All tracks
        audio_tracks: audioTracks.length > 0 ? audioTracks : undefined,
        subtitle_languages: subtitleTracks.length > 0 ? subtitleTracks : undefined,
        // File
        container: item.container,
        file_size_mb: fileSizeMB,
        duration_min: durationMin,
        // Quality
        quality_tier: qualityScore?.quality_tier || item.quality_tier,
        tier_quality: qualityScore?.tier_quality || item.tier_quality,
        tier_score: qualityScore?.tier_score || item.tier_score,
        bitrate_score: qualityScore?.bitrate_tier_score,
        audio_score: qualityScore?.audio_tier_score,
        needs_upgrade: qualityScore?.needs_upgrade,
        // Versions
        version_count: (item.version_count as number) || 1,
        versions: versionData,
      })

      return JSON.stringify(details)
    }

    case 'add_to_wishlist': {
      const rawItems = Array.isArray(input.items) ? input.items : []
      const items = rawItems.slice(0, 20).map((i: Record<string, unknown>) => ({
        title: String(i.title || '').slice(0, 300),
        media_type: String(i.media_type || 'movie'),
        year: typeof i.year === 'number' ? i.year : undefined,
        tmdb_id: typeof i.tmdb_id === 'number' ? i.tmdb_id : undefined,
        artist_name: typeof i.artist_name === 'string' ? i.artist_name.slice(0, 300) : undefined,
        reason: typeof i.reason === 'string' ? i.reason.slice(0, 100) : undefined,
        priority: typeof i.priority === 'number' ? Math.max(1, Math.min(5, i.priority)) : undefined,
        notes: typeof i.notes === 'string' ? i.notes.slice(0, 500) : undefined,
      })).filter(i => i.title)
      const tmdb = getTMDBService()

      const wishlistItems: Array<Record<string, unknown>> = []
      for (const item of items) {
        let tmdbId = item.tmdb_id ? String(item.tmdb_id) : undefined
        let resolvedTitle = item.title
        let posterUrl: string | null = null

        if (item.media_type === 'album' || item.media_type === 'track') {
          // Music: look up MusicBrainz for album art
          try {
            const mb = getMusicBrainzService()
            const artistName = item.artist_name || ''
            if (artistName && item.title) {
              const releases = await mb.searchRelease(artistName, item.title)
              if (releases.length > 0) {
                const releaseGroupId = releases[0].id
                const artUrl = await mb.getCoverArtUrl(releaseGroupId)
                if (artUrl) posterUrl = artUrl
                resolvedTitle = releases[0].title || resolvedTitle
              }
            }
          } catch { /* continue without MusicBrainz data */ }
        } else {
          // Movie/TV: look up TMDB for poster
          try {
            if (tmdbId) {
              if (item.media_type === 'movie') {
                const details = await tmdb.getMovieDetails(tmdbId)
                posterUrl = tmdb.buildImageUrl(details.poster_path, 'w300')
                resolvedTitle = details.title || resolvedTitle
              } else {
                const details = await tmdb.getTVShowDetails(tmdbId)
                posterUrl = tmdb.buildImageUrl(details.poster_path, 'w300')
                resolvedTitle = details.name || resolvedTitle
              }
            } else {
              if (item.media_type === 'movie') {
                const results = await tmdb.searchMovie(item.title, item.year)
                if (results.results.length > 0) {
                  const match = results.results[0]
                  tmdbId = String(match.id)
                  resolvedTitle = match.title
                  posterUrl = tmdb.buildImageUrl(match.poster_path, 'w300')
                }
              } else {
                const results = await tmdb.searchTVShow(item.title)
                if (results.results.length > 0) {
                  const match = results.results[0]
                  tmdbId = String(match.id)
                  resolvedTitle = match.name
                  posterUrl = tmdb.buildImageUrl(match.poster_path, 'w300')
                }
              }
            }
          } catch { /* continue without TMDB data */ }
        }

        // Map chat media types to wishlist media types
        const wishlistMediaType = item.media_type === 'tv' ? 'season'
          : item.media_type === 'album' ? 'album'
          : item.media_type === 'track' ? 'track'
          : 'movie'

        wishlistItems.push({
          media_type: wishlistMediaType,
          title: resolvedTitle,
          year: item.year,
          tmdb_id: tmdbId,
          poster_url: posterUrl,
          artist_name: item.artist_name,
          reason: item.reason || 'missing',
          priority: Math.max(1, Math.min(5, item.priority || 3)),
          notes: item.notes,
          status: 'active',
        })
      }

      const added = db.addWishlistItemsBulk(wishlistItems as never[])
      const skipped = wishlistItems.length - added

      return JSON.stringify({
        added,
        skipped_duplicates: skipped,
        items: wishlistItems.map((w) => compact({
          title: w.title,
          media_type: w.media_type,
          year: w.year,
          reason: w.reason,
          priority: w.priority,
        })),
      })
    }

    // ========================================================================
    // MUSIC TOOLS
    // ========================================================================

    case 'get_music_albums': {
      const limit = toolNumber(input, 'limit', 1, 50) || 20
      const artistName = toolString(input, 'artist_name', 300) || undefined
      const qualityTier = toolString(input, 'quality_tier') || undefined
      const needsUpgrade = toolBoolean(input, 'needs_upgrade')
      const searchQuery = toolString(input, 'search_query', 200) || undefined

      if (needsUpgrade) {
        // Use dedicated upgrade method
        const albums = db.getAlbumsNeedingUpgrade(limit)
        const simplified = albums.map((a: Record<string, unknown>) => compact({
          id: a.id,
          title: a.title,
          artist_name: a.artist_name,
          year: a.year,
          best_audio_codec: a.best_audio_codec,
          avg_audio_bitrate: a.avg_audio_bitrate,
          best_bit_depth: a.best_bit_depth,
          best_sample_rate: a.best_sample_rate,
          track_count: a.track_count,
        }))
        return JSON.stringify({ count: simplified.length, albums: simplified })
      }

      // Build filters
      const filters: Record<string, unknown> = { limit }
      if (searchQuery) filters.searchQuery = searchQuery
      if (qualityTier) filters.qualityTier = qualityTier
      if (input.sort_by) filters.sortBy = toolString(input, 'sort_by')
      if (input.sort_order) filters.sortOrder = toolString(input, 'sort_order')

      let albums: Record<string, unknown>[]
      if (artistName) {
        albums = db.getMusicAlbumsByArtistName(artistName, limit) as Record<string, unknown>[]
      } else {
        albums = db.getMusicAlbums(filters) as Record<string, unknown>[]
      }

      // Enrich with quality scores
      const simplified = albums.map((a: Record<string, unknown>) => {
        const quality = db.getMusicQualityScore(a.id as number)
        return compact({
          id: a.id,
          title: a.title,
          artist_name: a.artist_name,
          year: a.year,
          album_type: a.album_type,
          track_count: a.track_count,
          best_audio_codec: a.best_audio_codec,
          avg_audio_bitrate: a.avg_audio_bitrate,
          best_bit_depth: a.best_bit_depth,
          best_sample_rate: a.best_sample_rate,
          quality_tier: quality?.quality_tier,
          tier_quality: quality?.tier_quality,
          tier_score: quality?.tier_score,
          needs_upgrade: quality?.needs_upgrade,
        })
      })
      return JSON.stringify({ count: simplified.length, albums: simplified })
    }

    case 'get_music_quality_distribution': {
      const includeUpgrades = toolBoolean(input, 'include_upgrades') || false
      const upgradeLimit = toolNumber(input, 'upgrade_limit', 1, 50) || 10

      // Get all albums and their quality scores
      const allAlbums = db.getMusicAlbums({ limit: 10000 }) as Record<string, unknown>[]
      const tiers: Record<string, number> = {
        HI_RES: 0, LOSSLESS: 0, LOSSY_HIGH: 0, LOSSY_MID: 0, LOSSY_LOW: 0, UNSCORED: 0,
      }

      for (const album of allAlbums) {
        const quality = db.getMusicQualityScore(album.id as number)
        if (quality) {
          const tier = (quality as Record<string, unknown>).quality_tier as string
          if (tier in tiers) tiers[tier]++
          else tiers.UNSCORED++
        } else {
          tiers.UNSCORED++
        }
      }

      const result: Record<string, unknown> = {
        total_albums: allAlbums.length,
        distribution: tiers,
        lossless_percentage: allAlbums.length > 0
          ? Math.round(((tiers.LOSSLESS + tiers.HI_RES) / allAlbums.length) * 100)
          : 0,
      }

      if (includeUpgrades) {
        const upgradeAlbums = db.getAlbumsNeedingUpgrade(upgradeLimit)
        result.albums_needing_upgrade = upgradeAlbums.map((a: Record<string, unknown>) => compact({
          title: a.title,
          artist_name: a.artist_name,
          best_audio_codec: a.best_audio_codec,
          avg_audio_bitrate: a.avg_audio_bitrate,
        }))
      }

      return JSON.stringify(result)
    }

    case 'get_artist_completeness': {
      const artistName = toolString(input, 'artist_name', 300)
      const incompleteOnly = toolBoolean(input, 'incomplete_only') || false
      const limit = toolNumber(input, 'limit', 1, 50) || 20

      let artists: Record<string, unknown>[]
      if (artistName) {
        const single = db.getArtistCompleteness(artistName)
        artists = single ? [single as Record<string, unknown>] : []
      } else {
        const all = db.getAllArtistCompleteness() as Record<string, unknown>[]
        artists = incompleteOnly
          ? all.filter(a => (a.completeness_percentage as number) < 100)
          : all
      }

      const limited = artists.slice(0, limit)
      const simplified = limited.map((a: Record<string, unknown>) => {
        let missingCount = 0
        let missingSample: string[] = []
        try {
          const parsed = JSON.parse((a.missing_albums as string) || '[]')
          missingCount = parsed.length
          missingSample = parsed.slice(0, 5).map((m: Record<string, unknown>) =>
            m.year ? `${m.title} (${m.year})` : `${m.title}`,
          )
        } catch { /* empty */ }
        return compact({
          artist_name: a.artist_name,
          total_albums: a.total_albums,
          owned_albums: a.owned_albums,
          completeness_percentage: a.completeness_percentage,
          country: a.country,
          missing_album_count: missingCount,
          missing_sample: missingSample.length > 0 ? missingSample : undefined,
        })
      })
      return JSON.stringify({ count: artists.length, shown: limited.length, artists: simplified })
    }

    case 'get_album_details': {
      const albumId = toolNumber(input, 'album_id', 1)
      const albumTitle = toolString(input, 'album_title', 300)
      const artistHint = toolString(input, 'artist_name', 300)

      let album: Record<string, unknown> | null = null

      if (albumId) {
        album = db.getMusicAlbumById(albumId) as Record<string, unknown> | null
      } else if (albumTitle) {
        // Search for the album
        const results = db.globalSearch(albumTitle, 10)
        const albumResults = (results as Record<string, unknown>).albums as Array<Record<string, unknown>> | undefined
        if (albumResults && albumResults.length > 0) {
          // Try to match by artist hint if provided
          const match = artistHint
            ? albumResults.find(a => String(a.artist_name).toLowerCase().includes(artistHint.toLowerCase())) || albumResults[0]
            : albumResults[0]
          album = db.getMusicAlbumById(match.id as number) as Record<string, unknown> | null
        }
      }

      if (!album) {
        return JSON.stringify({ error: 'Album not found' })
      }

      // Get tracks
      const tracks = db.getMusicTracks({ albumId: album.id as number, limit: 200 }) as Record<string, unknown>[]
      const trackData = tracks.map((t: Record<string, unknown>) => compact({
        track_number: t.track_number,
        disc_number: t.disc_number,
        title: t.title,
        duration_sec: t.duration ? Math.round((t.duration as number) / 1000) : undefined,
        codec: t.audio_codec,
        bitrate: t.audio_bitrate,
        sample_rate: t.sample_rate,
        bit_depth: t.bit_depth,
        is_lossless: t.is_lossless,
        is_hi_res: t.is_hi_res,
      }))

      // Get quality score
      const quality = db.getMusicQualityScore(album.id as number)

      // Get album completeness
      const completeness = db.getAlbumCompleteness(album.id as number)

      const details = compact({
        title: album.title,
        artist_name: album.artist_name,
        year: album.year,
        album_type: album.album_type,
        track_count: tracks.length,
        total_duration_min: album.total_duration ? Math.round((album.total_duration as number) / 60000) : undefined,
        best_audio_codec: album.best_audio_codec,
        avg_audio_bitrate: album.avg_audio_bitrate,
        best_sample_rate: album.best_sample_rate,
        best_bit_depth: album.best_bit_depth,
        quality_tier: quality ? (quality as Record<string, unknown>).quality_tier : undefined,
        tier_quality: quality ? (quality as Record<string, unknown>).tier_quality : undefined,
        tier_score: quality ? (quality as Record<string, unknown>).tier_score : undefined,
        needs_upgrade: quality ? (quality as Record<string, unknown>).needs_upgrade : undefined,
        completeness_percentage: completeness ? (completeness as Record<string, unknown>).completeness_percentage : undefined,
        tracks: trackData,
      })

      return JSON.stringify(details)
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
