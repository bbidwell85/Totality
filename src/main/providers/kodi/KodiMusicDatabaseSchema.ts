/**
 * KodiMusicDatabaseSchema
 *
 * Defines types and SQL queries for reading Kodi's MyMusic SQLite database directly.
 * Supports MyMusic database versions 82+ (Kodi 19 Nexus and later).
 *
 * Key tables:
 * - artist: Artists with basic info
 * - album: Albums with release info
 * - song: Individual tracks
 * - path: File paths for songs
 * - art: Artwork URLs (thumbnails, fanart)
 * - album_artist: Many-to-many relationship between albums and artists
 * - song_artist: Many-to-many relationship between songs and artists
 */

import { convertKodiPathToLocal } from './KodiDatabaseSchema'

// ============================================================================
// KODI MUSIC DATABASE TYPES
// ============================================================================

export interface KodiDbArtist {
  idArtist: number
  strArtist: string
  strMusicBrainzArtistID?: string
  strSortName?: string
  strGenres?: string
  strBiography?: string
  strBorn?: string
  strFormed?: string
  strDied?: string
  strDisbanded?: string
  // Note: strCountry exists in newer Kodi versions but omitted for compatibility
}

export interface KodiDbAlbum {
  idAlbum: number
  strAlbum: string
  strArtistDisp?: string
  strReleaseGroupMBID?: string
  strMusicBrainzAlbumID?: string
  strGenres?: string
  strType?: string
  strLabel?: string
  strReleaseType?: string
  bCompilation?: number
  fRating?: number
  iUserrating?: number
  lastScraped?: string
  // Note: iYear exists in newer Kodi versions but omitted for compatibility
}

export interface KodiDbSong {
  idSong: number
  idAlbum: number
  idPath: number
  strTitle: string
  iTrack: number  // Contains both disc and track: (discNum * 65536) + trackNum
  iDuration: number  // Duration in seconds
  strFileName: string
  strMusicBrainzTrackID?: string
  iTimesPlayed?: number
  lastplayed?: string
  iStartOffset?: number
  iEndOffset?: number
  rating?: number
  userrating?: number
  comment?: string
  mood?: string
}

export interface KodiDbPath {
  idPath: number
  strPath: string
}

export interface KodiDbArt {
  art_id: number
  media_id: number
  media_type: string  // 'artist', 'album', 'song'
  type: string        // 'thumb', 'fanart', etc.
  url: string
}

// ============================================================================
// RESULT TYPES (with joins)
// ============================================================================

export interface KodiMusicArtistResult {
  idArtist: number
  strArtist: string
  strMusicBrainzArtistID: string | null
  strSortName: string | null
  strGenres: string | null
  strBiography: string | null
  thumbUrl: string | null
}

export interface KodiMusicAlbumResult {
  idAlbum: number
  strAlbum: string
  strArtistDisp: string | null
  strMusicBrainzAlbumID: string | null
  strReleaseGroupMBID: string | null
  strGenres: string | null
  strType: string | null
  strLabel: string | null
  thumbUrl: string | null
  artistId: number | null
  // Note: iYear removed for compatibility with older Kodi database versions
}

export interface KodiMusicSongResult {
  idSong: number
  idAlbum: number
  strTitle: string
  iTrack: number
  iDuration: number
  strFileName: string
  strPath: string
  strMusicBrainzTrackID: string | null
  albumTitle: string | null
  artistDisp: string | null
}

// ============================================================================
// SQL QUERIES
// ============================================================================

/**
 * Get all album artists with their artwork
 * Only returns artists who have at least one album in album_artist table
 * This filters out track-level collaborators and featured artists
 * Tries all Kodi artist art types in order: thumb, fanart, clearlogo, banner, landscape, clearart
 * Note: strCountry column removed for compatibility with older Kodi music database versions
 */
export const QUERY_MUSIC_ARTISTS = `
  SELECT
    a.idArtist,
    a.strArtist,
    a.strMusicBrainzArtistID,
    a.strSortName,
    a.strGenres,
    a.strBiography,
    COALESCE(
      (SELECT url FROM art WHERE media_id = a.idArtist AND media_type = 'artist' AND type = 'thumb' LIMIT 1),
      (SELECT url FROM art WHERE media_id = a.idArtist AND media_type = 'artist' AND type = 'fanart' LIMIT 1),
      (SELECT url FROM art WHERE media_id = a.idArtist AND media_type = 'artist' AND type = 'clearlogo' LIMIT 1),
      (SELECT url FROM art WHERE media_id = a.idArtist AND media_type = 'artist' AND type = 'banner' LIMIT 1),
      (SELECT url FROM art WHERE media_id = a.idArtist AND media_type = 'artist' AND type = 'landscape' LIMIT 1),
      (SELECT url FROM art WHERE media_id = a.idArtist AND media_type = 'artist' AND type = 'clearart' LIMIT 1)
    ) as thumbUrl
  FROM artist a
  WHERE a.idArtist IN (SELECT DISTINCT idArtist FROM album_artist)
    AND a.strArtist != '' AND a.strArtist != '[Missing Tag]'
  ORDER BY a.strSortName, a.strArtist
`

/**
 * Get all albums with their artwork and primary artist
 * Note: iYear column removed for compatibility with older Kodi database versions
 */
export const QUERY_MUSIC_ALBUMS = `
  SELECT
    al.idAlbum,
    al.strAlbum,
    al.strArtistDisp,
    al.strMusicBrainzAlbumID,
    al.strReleaseGroupMBID,
    al.strGenres,
    al.strType,
    al.strLabel,
    art.url as thumbUrl,
    aa.idArtist as artistId
  FROM album al
  LEFT JOIN art ON art.media_id = al.idAlbum AND art.media_type = 'album' AND art.type = 'thumb'
  LEFT JOIN album_artist aa ON aa.idAlbum = al.idAlbum AND aa.iOrder = 0
  WHERE al.strAlbum != '' AND al.strAlbum != '[Missing Tag]'
  ORDER BY al.strAlbum
`

/**
 * Get albums by artist ID
 * Note: iYear column removed for compatibility with older Kodi database versions
 */
export const QUERY_MUSIC_ALBUMS_BY_ARTIST = `
  SELECT
    al.idAlbum,
    al.strAlbum,
    al.strArtistDisp,
    al.strMusicBrainzAlbumID,
    al.strReleaseGroupMBID,
    al.strGenres,
    al.strType,
    al.strLabel,
    art.url as thumbUrl,
    aa.idArtist as artistId
  FROM album al
  INNER JOIN album_artist aa ON aa.idAlbum = al.idAlbum AND aa.idArtist = ?
  LEFT JOIN art ON art.media_id = al.idAlbum AND art.media_type = 'album' AND art.type = 'thumb'
  WHERE al.strAlbum != '' AND al.strAlbum != '[Missing Tag]'
  ORDER BY al.strAlbum
`

/**
 * Get all songs with path and album info
 */
export const QUERY_MUSIC_SONGS = `
  SELECT
    s.idSong,
    s.idAlbum,
    s.strTitle,
    s.iTrack,
    s.iDuration,
    s.strFileName,
    p.strPath,
    s.strMusicBrainzTrackID,
    al.strAlbum as albumTitle,
    al.strArtistDisp as artistDisp
  FROM song s
  INNER JOIN path p ON s.idPath = p.idPath
  LEFT JOIN album al ON s.idAlbum = al.idAlbum
  WHERE s.strTitle != '' AND s.strTitle != '[Missing Tag]'
  ORDER BY s.idAlbum, s.iTrack
`

/**
 * Get songs by album ID
 */
export const QUERY_MUSIC_SONGS_BY_ALBUM = `
  SELECT
    s.idSong,
    s.idAlbum,
    s.strTitle,
    s.iTrack,
    s.iDuration,
    s.strFileName,
    p.strPath,
    s.strMusicBrainzTrackID,
    al.strAlbum as albumTitle,
    al.strArtistDisp as artistDisp
  FROM song s
  INNER JOIN path p ON s.idPath = p.idPath
  LEFT JOIN album al ON s.idAlbum = al.idAlbum
  WHERE s.idAlbum = ? AND s.strTitle != '' AND s.strTitle != '[Missing Tag]'
  ORDER BY s.iTrack
`

/**
 * Count total artists
 */
export const QUERY_MUSIC_ARTIST_COUNT = `
  SELECT COUNT(*) as count FROM artist WHERE strArtist != '' AND strArtist != '[Missing Tag]'
`

/**
 * Count total albums
 */
export const QUERY_MUSIC_ALBUM_COUNT = `
  SELECT COUNT(*) as count FROM album WHERE strAlbum != '' AND strAlbum != '[Missing Tag]'
`

/**
 * Count total songs
 */
export const QUERY_MUSIC_SONG_COUNT = `
  SELECT COUNT(*) as count FROM song WHERE strTitle != '' AND strTitle != '[Missing Tag]'
`

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse Kodi's combined track number format
 * Kodi stores track info as: (discNumber * 65536) + trackNumber
 * or sometimes just trackNumber if disc is 1
 */
export function parseTrackNumber(trackInfo: number): { disc: number; track: number } {
  if (trackInfo <= 0) {
    return { disc: 1, track: 0 }
  }

  // Check if it's a combined number (has disc info)
  if (trackInfo > 65535) {
    return {
      disc: Math.floor(trackInfo / 65536) || 1,
      track: trackInfo % 65536,
    }
  }

  // Just a track number, assume disc 1
  return { disc: 1, track: trackInfo }
}

/**
 * Build full file path from Kodi path and filename
 * Converts Kodi network URLs (smb://, nfs://) to local paths
 */
export function buildMusicFilePath(path: string, filename: string): string {
  if (!path) return filename
  if (!filename) return path

  // Convert Kodi URL to local path first (handles smb://, nfs://, etc.)
  const localPath = convertKodiPathToLocal(path)

  // Determine separator based on path format
  const isWindowsPath = localPath.includes('\\') || localPath.startsWith('\\\\')
  const separator = isWindowsPath ? '\\' : '/'
  const cleanPath = localPath.endsWith(separator) || localPath.endsWith('/') ? localPath : localPath + separator

  return cleanPath + filename
}

/**
 * Extract codec from file extension (fallback when Kodi doesn't have stream details)
 */
export function guessCodecFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  const codecMap: Record<string, string> = {
    'flac': 'flac',
    'alac': 'alac',
    'm4a': 'aac',
    'mp3': 'mp3',
    'ogg': 'vorbis',
    'opus': 'opus',
    'wav': 'wav',
    'aiff': 'aiff',
    'aif': 'aiff',
    'wma': 'wma',
    'ape': 'ape',
    'wv': 'wavpack',
    'dsf': 'dsd',
    'dff': 'dsd',
  }

  return codecMap[ext] || ext || 'unknown'
}
