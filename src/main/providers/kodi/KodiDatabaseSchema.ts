/**
 * KodiDatabaseSchema
 *
 * Defines types and SQL queries for reading Kodi's SQLite database directly.
 * Supports MyVideos database versions 116+ (Kodi 19 Nexus and later).
 *
 * Key tables:
 * - movie: Movies with basic info (c00=title, c07=year, c09=imdb_id)
 * - tvshow: TV shows
 * - episode: Episodes with season/episode numbers (c12=season, c13=episode)
 * - files: Links media items to stream details
 * - path: File paths
 * - streamdetails: Video/audio codec info (iStreamType: 0=video, 1=audio, 2=subtitle)
 * - art: Artwork URLs (posters, fanart, etc.)
 */

import { getDatabase } from '../../database/getDatabase'

// ============================================================================
// NFS MOUNT MAPPINGS
// ============================================================================

// Cache for NFS mappings to avoid repeated database lookups
let cachedNfsMappings: Record<string, string> | null = null

/**
 * Get NFS mount mappings from database settings
 * Format: { "server/export": "Z:" } where key is NFS path (without nfs://) and value is local path
 */
function getNfsMountMappings(): Record<string, string> {
  if (cachedNfsMappings === null) {
    try {
      const db = getDatabase()
      const mappingsJson = db.getSetting('nfs_mount_mappings')
      cachedNfsMappings = mappingsJson ? JSON.parse(mappingsJson) : {}
    } catch {
      cachedNfsMappings = {}
    }
  }
  return cachedNfsMappings!
}

/**
 * Invalidate the NFS mappings cache (call when settings change)
 */
export function invalidateNfsMappingsCache(): void {
  cachedNfsMappings = null
}

/**
 * Convert NFS URL to local path using configured mount mappings
 * @param nfsUrl NFS URL (e.g., nfs://server/export/path/file.mkv)
 * @returns Local path if mapping found, original URL otherwise
 */
function convertNfsPathToLocal(nfsUrl: string): string {
  const mappings = getNfsMountMappings()

  // Remove nfs:// prefix to get the NFS path
  const nfsPath = nfsUrl.slice(6) // Remove 'nfs://'

  // Find matching mapping using longest prefix match
  let bestMatch = { prefix: '', localPath: '' }
  for (const [nfsPrefix, localMount] of Object.entries(mappings)) {
    // Normalize the prefix (remove nfs:// if present)
    const normalizedPrefix = nfsPrefix.startsWith('nfs://')
      ? nfsPrefix.slice(6)
      : nfsPrefix

    if (nfsPath.startsWith(normalizedPrefix) && normalizedPrefix.length > bestMatch.prefix.length) {
      bestMatch = { prefix: normalizedPrefix, localPath: localMount }
    }
  }

  if (bestMatch.prefix) {
    // Replace NFS prefix with local mount path
    const relativePath = nfsPath.slice(bestMatch.prefix.length)
    // Ensure local path ends correctly and convert slashes for Windows
    let localPath = bestMatch.localPath
    if (!localPath.endsWith('\\') && !localPath.endsWith('/')) {
      localPath += '\\'
    }
    // Convert forward slashes to backslashes for Windows, remove leading slash from relative path
    const cleanRelativePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
    return localPath + cleanRelativePath.replace(/\//g, '\\')
  }

  return nfsUrl
}

// ============================================================================
// KODI DATABASE TYPES
// ============================================================================

export interface KodiDbMovie {
  idMovie: number
  idFile: number
  c00: string        // title
  c01: string        // plot
  c02: string        // plot outline
  c03: string        // tagline
  c04: string        // votes
  c05: string        // rating
  c06: string        // writers
  c07: string        // year
  c08: string        // thumbnails (XML)
  c09: string        // IMDB ID
  c10: string        // sort title
  c11: string        // runtime (minutes)
  c12: string        // MPAA rating
  c14: string        // genres
  c15: string        // directors
  c16: string        // original title
  c18: string        // studios
  c19: string        // trailer
  c20: string        // fanart (XML)
  c21: string        // country
  c22: string        // file path
  c23: string        // base path
  premiered?: string  // premiere date
}

export interface KodiDbTVShow {
  idShow: number
  c00: string        // title
  c01: string        // plot
  c02: string        // status
  c04: string        // votes
  c05: string        // rating
  c06: string        // thumbnails (XML)
  c08: string        // genres
  c09: string        // original title
  c10: string        // episode guide URL
  c11: string        // fanart (XML)
  c12: string        // external ID (varies by scraper)
  c13: string        // content rating
  c14: string        // studios
  c15: string        // sort title
  c16: string        // trailer
  c20: string        // IMDB ID
  c21: string        // external ID (varies by scraper)
}

export interface KodiDbEpisode {
  idEpisode: number
  idFile: number
  idShow: number
  c00: string        // title
  c01: string        // plot
  c03: string        // votes
  c04: string        // rating
  c05: string        // writers
  c06: string        // first aired
  c07: string        // thumbnails (XML)
  c08: string        // has aired
  c09: string        // runtime
  c10: string        // directors
  c11: string        // production code
  c12: string        // season number
  c13: string        // episode number
  c14: string        // original title
  c15: string        // special sort season
  c16: string        // special sort episode
  c17: string        // bookmark
  c18: string        // base path
  c19: string        // file ID
  c20: string        // unique ID
}

export interface KodiDbStreamDetails {
  idFile: number
  iStreamType: number    // 0=video, 1=audio, 2=subtitle
  strVideoCodec?: string
  fVideoAspect?: number
  iVideoWidth?: number
  iVideoHeight?: number
  iVideoDuration?: number
  strHdrType?: string
  strAudioCodec?: string
  iAudioChannels?: number
  strAudioLanguage?: string
  strSubtitleLanguage?: string
}

export interface KodiDbFile {
  idFile: number
  idPath: number
  strFilename: string
  playCount?: number
  lastPlayed?: string
  dateAdded: string
}

export interface KodiDbPath {
  idPath: number
  strPath: string
  strContent?: string
  strScraper?: string
}

export interface KodiDbArt {
  art_id: number
  media_id: number
  media_type: string  // 'movie', 'tvshow', 'episode', 'season', 'set'
  type: string        // 'poster', 'fanart', 'thumb', 'banner'
  url: string
}

export interface KodiDbSet {
  idSet: number
  strSet: string      // Collection/set name
  strOverview?: string // Description
}

export interface KodiSetWithDetails {
  idSet: number
  name: string
  overview: string | null
  movieCount: number
  posterUrl: string | null
  fanartUrl: string | null
}

// ============================================================================
// JOINED QUERY RESULTS
// ============================================================================

export interface KodiMovieWithDetails {
  idMovie: number
  idFile: number
  title: string
  year: number | null
  imdbId: string | null
  tmdbId: string | null   // TMDB ID from uniqueid table
  runtime: number | null  // runtime in minutes from movie table
  filename: string
  filepath: string
  fileSize: number | null
  // Video stream info
  videoCodec: string | null
  videoWidth: number | null
  videoHeight: number | null
  videoDuration: number | null  // duration in seconds from streamdetails
  hdrType: string | null
  videoAspect: number | null
  // Audio stream info
  audioCodec: string | null
  audioChannels: number | null
  audioLanguage: string | null
  // Artwork
  posterUrl: string | null
  fanartUrl: string | null
  // Collection/Set info
  setId: number | null
  setName: string | null
  setPosterUrl: string | null
  // Debug fields (raw values before transformation)
  c07_raw: string | null       // Raw c07 value (year string)
  premiered_raw: string | null // Raw premiered value (full date)
}

export interface KodiEpisodeWithDetails {
  idEpisode: number
  idFile: number
  title: string
  seasonNumber: number
  episodeNumber: number
  showTitle: string
  showImdbId: string | null
  showId: number
  filename: string
  filepath: string
  fileSize: number | null
  // Video stream info
  videoCodec: string | null
  videoWidth: number | null
  videoHeight: number | null
  videoDuration: number | null
  hdrType: string | null
  videoAspect: number | null
  // Audio stream info
  audioCodec: string | null
  audioChannels: number | null
  audioLanguage: string | null
  // Artwork
  thumbUrl: string | null
  showPosterUrl: string | null
  seasonPosterUrl: string | null
}

// ============================================================================
// SQL QUERIES
// ============================================================================

/**
 * Query to fetch all movies with their stream details, artwork, and collection info
 * Uses subqueries to avoid GROUP BY issues with multiple streams
 */
export const QUERY_MOVIES_WITH_DETAILS = `
SELECT
  m.idMovie,
  m.idFile,
  m.c00 AS title,
  COALESCE(CAST(NULLIF(m.c07, '') AS INTEGER), CAST(SUBSTR(m.premiered, 1, 4) AS INTEGER)) AS year,
  m.c07 AS c07_raw,
  m.premiered AS premiered_raw,
  NULLIF(m.c09, '') AS imdbId,
  (SELECT value FROM uniqueid WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'tmdb' LIMIT 1) AS tmdbId,
  CAST(NULLIF(m.c11, '') AS INTEGER) AS runtime,
  f.strFilename AS filename,
  p.strPath AS filepath,
  (SELECT iVideoWidth FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoWidth,
  (SELECT iVideoHeight FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoHeight,
  (SELECT strVideoCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoCodec,
  (SELECT iVideoDuration FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoDuration,
  (SELECT fVideoAspect FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoAspect,
  (SELECT strHdrType FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS hdrType,
  (SELECT strAudioCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioCodec,
  (SELECT iAudioChannels FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioChannels,
  (SELECT strAudioLanguage FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioLanguage,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'poster' LIMIT 1) AS posterUrl,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'fanart' LIMIT 1) AS fanartUrl,
  m.idSet AS setId,
  s.strSet AS setName,
  (SELECT url FROM art WHERE media_id = m.idSet AND media_type = 'set' AND type = 'poster' LIMIT 1) AS setPosterUrl
FROM movie m
JOIN files f ON m.idFile = f.idFile
JOIN path p ON f.idPath = p.idPath
LEFT JOIN sets s ON m.idSet = s.idSet
`

/**
 * Query to fetch all TV shows
 */
export const QUERY_TV_SHOWS = `
SELECT
  idShow,
  c00 AS title,
  NULLIF(c21, '') AS imdbId,
  (SELECT url FROM art WHERE media_id = tvshow.idShow AND media_type = 'tvshow' AND type = 'poster' LIMIT 1) AS posterUrl
FROM tvshow
`

/**
 * Query to fetch all episodes with show info and stream details
 * Joins with seasons table to get season-specific artwork
 */
export const QUERY_EPISODES_WITH_DETAILS = `
SELECT
  e.idEpisode,
  e.idFile,
  e.c00 AS title,
  CAST(NULLIF(e.c12, '') AS INTEGER) AS seasonNumber,
  CAST(NULLIF(e.c13, '') AS INTEGER) AS episodeNumber,
  s.c00 AS showTitle,
  NULLIF(s.c21, '') AS showImdbId,
  s.idShow AS showId,
  f.strFilename AS filename,
  p.strPath AS filepath,
  (SELECT iVideoWidth FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoWidth,
  (SELECT iVideoHeight FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoHeight,
  (SELECT strVideoCodec FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoCodec,
  (SELECT iVideoDuration FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoDuration,
  (SELECT fVideoAspect FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoAspect,
  (SELECT strHdrType FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS hdrType,
  (SELECT strAudioCodec FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioCodec,
  (SELECT iAudioChannels FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioChannels,
  (SELECT strAudioLanguage FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioLanguage,
  (SELECT url FROM art WHERE media_id = e.idEpisode AND media_type = 'episode' AND type = 'thumb' LIMIT 1) AS thumbUrl,
  (SELECT url FROM art WHERE media_id = s.idShow AND media_type = 'tvshow' AND type = 'poster' LIMIT 1) AS showPosterUrl,
  (SELECT url FROM art WHERE media_id = sea.idSeason AND media_type = 'season' AND type = 'poster' LIMIT 1) AS seasonPosterUrl
FROM episode e
JOIN tvshow s ON e.idShow = s.idShow
JOIN files f ON e.idFile = f.idFile
JOIN path p ON f.idPath = p.idPath
LEFT JOIN seasons sea ON sea.idShow = e.idShow AND sea.season = CAST(NULLIF(e.c12, '') AS INTEGER)
`

/**
 * Query to count movies
 */
export const QUERY_MOVIE_COUNT = `SELECT COUNT(*) as count FROM movie`

/**
 * Query to count episodes
 */
export const QUERY_EPISODE_COUNT = `SELECT COUNT(*) as count FROM episode`

/**
 * Query to get a single movie by ID with details
 */
export const QUERY_MOVIE_BY_ID = `
SELECT
  m.idMovie,
  m.idFile,
  m.c00 AS title,
  COALESCE(CAST(NULLIF(m.c07, '') AS INTEGER), CAST(SUBSTR(m.premiered, 1, 4) AS INTEGER)) AS year,
  m.c07 AS c07_raw,
  m.premiered AS premiered_raw,
  NULLIF(m.c09, '') AS imdbId,
  (SELECT value FROM uniqueid WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'tmdb' LIMIT 1) AS tmdbId,
  CAST(NULLIF(m.c11, '') AS INTEGER) AS runtime,
  f.strFilename AS filename,
  p.strPath AS filepath,
  (SELECT iVideoWidth FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoWidth,
  (SELECT iVideoHeight FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoHeight,
  (SELECT strVideoCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoCodec,
  (SELECT iVideoDuration FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoDuration,
  (SELECT fVideoAspect FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoAspect,
  (SELECT strHdrType FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS hdrType,
  (SELECT strAudioCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioCodec,
  (SELECT iAudioChannels FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioChannels,
  (SELECT strAudioLanguage FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioLanguage,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'poster' LIMIT 1) AS posterUrl,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'fanart' LIMIT 1) AS fanartUrl,
  m.idSet AS setId,
  s.strSet AS setName,
  (SELECT url FROM art WHERE media_id = m.idSet AND media_type = 'set' AND type = 'poster' LIMIT 1) AS setPosterUrl
FROM movie m
JOIN files f ON m.idFile = f.idFile
JOIN path p ON f.idPath = p.idPath
LEFT JOIN sets s ON m.idSet = s.idSet
WHERE m.idMovie = ?
`

/**
 * Query to get a single episode by ID with details
 * Joins with seasons table to get season-specific artwork
 */
export const QUERY_EPISODE_BY_ID = `
SELECT
  e.idEpisode,
  e.idFile,
  e.c00 AS title,
  CAST(NULLIF(e.c12, '') AS INTEGER) AS seasonNumber,
  CAST(NULLIF(e.c13, '') AS INTEGER) AS episodeNumber,
  s.c00 AS showTitle,
  NULLIF(s.c21, '') AS showImdbId,
  s.idShow AS showId,
  f.strFilename AS filename,
  p.strPath AS filepath,
  (SELECT iVideoWidth FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoWidth,
  (SELECT iVideoHeight FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoHeight,
  (SELECT strVideoCodec FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoCodec,
  (SELECT iVideoDuration FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoDuration,
  (SELECT fVideoAspect FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS videoAspect,
  (SELECT strHdrType FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 0 LIMIT 1) AS hdrType,
  (SELECT strAudioCodec FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioCodec,
  (SELECT iAudioChannels FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioChannels,
  (SELECT strAudioLanguage FROM streamdetails WHERE idFile = e.idFile AND iStreamType = 1 LIMIT 1) AS audioLanguage,
  (SELECT url FROM art WHERE media_id = e.idEpisode AND media_type = 'episode' AND type = 'thumb' LIMIT 1) AS thumbUrl,
  (SELECT url FROM art WHERE media_id = s.idShow AND media_type = 'tvshow' AND type = 'poster' LIMIT 1) AS showPosterUrl,
  (SELECT url FROM art WHERE media_id = sea.idSeason AND media_type = 'season' AND type = 'poster' LIMIT 1) AS seasonPosterUrl
FROM episode e
JOIN tvshow s ON e.idShow = s.idShow
JOIN files f ON e.idFile = f.idFile
JOIN path p ON f.idPath = p.idPath
LEFT JOIN seasons sea ON sea.idShow = e.idShow AND sea.season = CAST(NULLIF(e.c12, '') AS INTEGER)
WHERE e.idEpisode = ?
`

/**
 * Query to get all audio streams for a file (for multi-track support)
 */
export const QUERY_AUDIO_STREAMS = `
SELECT
  strAudioCodec AS codec,
  iAudioChannels AS channels,
  strAudioLanguage AS language
FROM streamdetails
WHERE idFile = ? AND iStreamType = 1
ORDER BY iAudioChannels DESC
`

/**
 * Query to get all sets/collections with their movie counts and artwork
 */
export const QUERY_ALL_SETS = `
SELECT
  s.idSet,
  s.strSet AS name,
  s.strOverview AS overview,
  COUNT(m.idMovie) AS movieCount,
  (SELECT url FROM art WHERE media_id = s.idSet AND media_type = 'set' AND type = 'poster' LIMIT 1) AS posterUrl,
  (SELECT url FROM art WHERE media_id = s.idSet AND media_type = 'set' AND type = 'fanart' LIMIT 1) AS fanartUrl
FROM sets s
LEFT JOIN movie m ON m.idSet = s.idSet
GROUP BY s.idSet
HAVING movieCount > 0
ORDER BY s.strSet
`

/**
 * Query to get movies in a specific set/collection
 */
export const QUERY_MOVIES_IN_SET = `
SELECT
  m.idMovie,
  m.idFile,
  m.c00 AS title,
  COALESCE(CAST(NULLIF(m.c07, '') AS INTEGER), CAST(SUBSTR(m.premiered, 1, 4) AS INTEGER)) AS year,
  m.c07 AS c07_raw,
  m.premiered AS premiered_raw,
  NULLIF(m.c09, '') AS imdbId,
  (SELECT value FROM uniqueid WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'tmdb' LIMIT 1) AS tmdbId,
  CAST(NULLIF(m.c11, '') AS INTEGER) AS runtime,
  f.strFilename AS filename,
  p.strPath AS filepath,
  (SELECT iVideoWidth FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoWidth,
  (SELECT iVideoHeight FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoHeight,
  (SELECT strVideoCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoCodec,
  (SELECT iVideoDuration FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoDuration,
  (SELECT fVideoAspect FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS videoAspect,
  (SELECT strHdrType FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 0 LIMIT 1) AS hdrType,
  (SELECT strAudioCodec FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioCodec,
  (SELECT iAudioChannels FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioChannels,
  (SELECT strAudioLanguage FROM streamdetails WHERE idFile = m.idFile AND iStreamType = 1 LIMIT 1) AS audioLanguage,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'poster' LIMIT 1) AS posterUrl,
  (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'fanart' LIMIT 1) AS fanartUrl,
  m.idSet AS setId,
  s.strSet AS setName,
  (SELECT url FROM art WHERE media_id = m.idSet AND media_type = 'set' AND type = 'poster' LIMIT 1) AS setPosterUrl
FROM movie m
JOIN files f ON m.idFile = f.idFile
JOIN path p ON f.idPath = p.idPath
LEFT JOIN sets s ON m.idSet = s.idSet
WHERE m.idSet = ?
ORDER BY m.c07, m.c00
`

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse HDR type from Kodi's strHdrType field
 */
export function parseHdrType(hdrType: string | null): string {
  if (!hdrType) return 'None'

  const hdrLower = hdrType.toLowerCase()

  if (hdrLower.includes('dolbyvision') || hdrLower.includes('dolby vision') || hdrLower.includes('dovi')) {
    return 'Dolby Vision'
  }
  if (hdrLower.includes('hdr10+') || hdrLower.includes('hdr10plus')) {
    return 'HDR10+'
  }
  if (hdrLower.includes('hdr10') || hdrLower.includes('hdr')) {
    return 'HDR10'
  }
  if (hdrLower.includes('hlg')) {
    return 'HLG'
  }

  return 'None'
}

/**
 * Normalize resolution string from width/height
 */
export function normalizeResolution(width: number | null, height: number | null): string {
  const w = width || 0
  const h = height || 0

  if (h >= 2160 || w >= 3840) return '4K'
  if (h >= 1080 || w >= 1920) return '1080p'
  if (h >= 720 || w >= 1280) return '720p'
  if (h >= 480 || w >= 720) return '480p'
  return 'SD'
}

/**
 * Convert Kodi's image:// URL format to a local-artwork protocol URL
 * Kodi stores artwork URLs as: image://encoded_path/
 * This decodes them to local-artwork://file?path=... URLs that Electron can serve
 */
export function convertKodiImageUrl(imageUrl: string | null | undefined): string | undefined {
  if (!imageUrl) return undefined

  // If it's already a regular URL (http/https), return as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl
  }

  // If it's already using local-artwork protocol, return as-is
  if (imageUrl.startsWith('local-artwork://')) {
    return imageUrl
  }

  // Handle Kodi's image:// URLs
  if (imageUrl.startsWith('image://')) {
    // Remove 'image://' prefix and trailing '/'
    let encodedPath = imageUrl.slice(8)
    if (encodedPath.endsWith('/')) {
      encodedPath = encodedPath.slice(0, -1)
    }

    // URL-decode the path
    const decodedPath = decodeURIComponent(encodedPath)

    // Convert Kodi paths (smb://, etc.) to local paths
    const localPath = convertKodiPathToLocal(decodedPath)

    // Return using local-artwork protocol with the file path
    return `local-artwork://file?path=${encodeURIComponent(localPath)}`
  }

  // Already a file:// URL - convert to local-artwork protocol
  if (imageUrl.startsWith('file://')) {
    const filePath = imageUrl.replace(/^file:\/\/\/?/, '')
    return `local-artwork://file?path=${encodeURIComponent(filePath)}`
  }

  // Assume it's a local path, use local-artwork protocol
  return `local-artwork://file?path=${encodeURIComponent(imageUrl)}`
}

/**
 * Convert Kodi network URLs to local file system paths
 * Handles SMB (smb://), NFS (nfs://), and other Kodi URL schemes
 */
export function convertKodiPathToLocal(kodiPath: string): string {
  if (!kodiPath) return kodiPath

  // Handle SMB URLs: smb://server/share/path -> \\server\share\path (Windows UNC)
  if (kodiPath.startsWith('smb://')) {
    // Remove smb:// prefix and convert forward slashes to backslashes
    const uncPath = kodiPath.slice(6).replace(/\//g, '\\')
    return '\\\\' + uncPath
  }

  // Handle NFS URLs: nfs://server/export/path -> convert using configured mount mappings
  // Users configure mappings in Settings > Services (e.g., "nas.local/media" -> "Z:")
  if (kodiPath.startsWith('nfs://')) {
    const localPath = convertNfsPathToLocal(kodiPath)
    if (localPath !== kodiPath) {
      return localPath
    }
    // No mapping found - log warning with guidance
    console.warn(`[KodiDatabaseSchema] No NFS mount mapping configured for path with scheme: ${kodiPath.split('://')[0] || 'unknown'}`)
    console.warn('[KodiDatabaseSchema] Configure NFS mappings in Settings > Services > Kodi NFS Mounts')
    return kodiPath
  }

  // Handle other URL schemes that Kodi might use
  if (kodiPath.includes('://') && !kodiPath.startsWith('file://')) {
    // Unknown URL scheme, return as-is
    console.warn(`[KodiDatabaseSchema] Unknown URL scheme for FFprobe: ${kodiPath.split('://')[0] || 'unknown'}`)
    return kodiPath
  }

  // Handle file:// URLs
  if (kodiPath.startsWith('file://')) {
    return kodiPath.slice(7)
  }

  // Already a local path
  return kodiPath
}

/**
 * Build full file path from path and filename
 * Converts Kodi network URLs (smb://, nfs://) to local paths
 */
export function buildFilePath(dirPath: string, filename: string): string {
  // Convert Kodi URL to local path first
  const localDirPath = convertKodiPathToLocal(dirPath)

  // Determine separator based on path format
  const isWindowsPath = localDirPath.includes('\\') || localDirPath.startsWith('\\\\')
  const separator = isWindowsPath ? '\\' : '/'

  // Kodi stores paths with trailing slash/backslash
  if (localDirPath.endsWith('/') || localDirPath.endsWith('\\')) {
    return localDirPath + filename
  }
  return localDirPath + separator + filename
}

/**
 * Normalize video codec name
 */
export function normalizeVideoCodec(codec: string | null): string {
  if (!codec) return ''

  const codecLower = codec.toLowerCase()

  if (codecLower.includes('hevc') || codecLower.includes('h265') || codecLower.includes('x265')) {
    return 'HEVC'
  }
  if (codecLower.includes('avc') || codecLower.includes('h264') || codecLower.includes('x264')) {
    return 'H.264'
  }
  if (codecLower.includes('av1')) {
    return 'AV1'
  }
  if (codecLower.includes('vp9')) {
    return 'VP9'
  }
  if (codecLower.includes('mpeg4') || codecLower.includes('xvid') || codecLower.includes('divx')) {
    return 'MPEG-4'
  }
  if (codecLower.includes('mpeg2')) {
    return 'MPEG-2'
  }
  if (codecLower.includes('vc1') || codecLower.includes('wmv')) {
    return 'VC-1'
  }

  return codec.toUpperCase()
}

/**
 * Normalize audio codec name
 */
export function normalizeAudioCodec(codec: string | null, profile?: string): string {
  if (!codec) return ''

  const codecLower = codec.toLowerCase()
  const profileLower = (profile || '').toLowerCase()

  // Plex/FFprobe sends DTS variants as codec 'dca'/'dts' + profile to distinguish
  if (codecLower === 'dca' || (codecLower === 'dts' && profileLower)) {
    if (profileLower === 'ma' || profileLower.includes('dts-hd ma')) return 'DTS-HD MA'
    if (profileLower === 'hra' || profileLower.includes('dts-hd hra')) return 'DTS-HD'
    if (profileLower.includes('dts:x') || profileLower.includes('dtsx')) return 'DTS:X'
    if (codecLower === 'dca') return 'DTS'
  }

  if (codecLower.includes('truehd')) {
    return 'TrueHD'
  }
  if (codecLower.includes('atmos')) {
    return 'TrueHD Atmos'
  }
  if (codecLower.includes('dts-hd ma') || codecLower.includes('dtshd_ma')) {
    return 'DTS-HD MA'
  }
  if (codecLower.includes('dts-hd') || codecLower.includes('dtshd')) {
    return 'DTS-HD'
  }
  if (codecLower.includes('dts:x') || codecLower.includes('dtsx')) {
    return 'DTS:X'
  }
  if (codecLower.includes('dts')) {
    return 'DTS'
  }
  if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('ec3')) {
    return 'E-AC-3'
  }
  if (codecLower.includes('ac3') || codecLower.includes('ac-3')) {
    return 'AC-3'
  }
  if (codecLower.includes('aac')) {
    return 'AAC'
  }
  if (codecLower.includes('flac')) {
    return 'FLAC'
  }
  if (codecLower.includes('pcm') || codecLower.includes('lpcm')) {
    return 'PCM'
  }
  if (codecLower.includes('mp3')) {
    return 'MP3'
  }
  if (codecLower.includes('opus')) {
    return 'Opus'
  }
  if (codecLower.includes('vorbis')) {
    return 'Vorbis'
  }

  return codec.toUpperCase()
}

/**
 * Estimate bitrate based on resolution and codec (rough estimates when actual bitrate unavailable)
 * Returns estimated bitrate in kbps
 */
export function estimateBitrate(width: number | null, height: number | null, codec: string | null, _duration?: number | null): number {
  // If we have no resolution info, return 0
  if (!width || !height) return 0

  const isHevc = codec?.toLowerCase().includes('hevc') || codec?.toLowerCase().includes('h265')

  // Base bitrate estimates (very rough)
  // These are typical streaming quality bitrates
  let baseBitrate: number

  if (height >= 2160) {
    // 4K: 15-25 Mbps for HEVC, 25-40 Mbps for H.264
    baseBitrate = isHevc ? 18000 : 30000
  } else if (height >= 1080) {
    // 1080p: 5-10 Mbps for HEVC, 8-15 Mbps for H.264
    baseBitrate = isHevc ? 8000 : 12000
  } else if (height >= 720) {
    // 720p: 3-5 Mbps for HEVC, 5-8 Mbps for H.264
    baseBitrate = isHevc ? 4000 : 6000
  } else {
    // SD: 1-3 Mbps
    baseBitrate = isHevc ? 2000 : 3000
  }

  return baseBitrate
}
