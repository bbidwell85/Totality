/**
 * MediaMonkey Database Schema
 *
 * Defines types and SQL queries for reading MediaMonkey's SQLite database.
 * Supports both MM4 (MM.DB) and MM5 (MM5.DB).
 *
 * Key differences from Kodi:
 * - Custom IUNICODE collation (requires registration)
 * - Mood stored both as Songs.Mood column AND via Lists/ListsSongs junction table
 * - Artists linked via ArtistsSongs junction table with PersonType field
 * - Albums linked via Songs.IDAlbum FK
 */

// ============================================================================
// TYPES
// ============================================================================

export interface MMDbSong {
  ID: number
  SongTitle: string
  Artist: string
  AlbumArtist: string
  Album: string
  IDAlbum: number
  TrackNumber: string   // TEXT — may contain "3/12" format
  DiscNumber: string    // TEXT — may contain "1/2" format
  Year: number
  Genre: string
  Mood: string
  SongLength: number    // Duration in ms
  FileLength: number    // File size in bytes
  SongPath: string      // Full file path
  Bitrate: number       // In kbps
  SamplingFrequency: number
  BPS: number           // Bits per sample (bit depth)
  Stereo: number        // Channel count (despite the name)
  VBR: number           // 0 = CBR, 1 = VBR
}

export interface MMDbAlbum {
  ID: number
  Album: string
  Artist: string        // Album artist
  Year: number
}

export interface MMDbArtist {
  ID: number
  Artist: string
}

export interface MMDbMoodEntry {
  IDSong: number
  MoodName: string
}

// ============================================================================
// SQL QUERIES
// ============================================================================

/**
 * Get all distinct album artists from Songs table
 * MediaMonkey stores AlbumArtist directly on the Songs table
 */
export const QUERY_MM_ARTISTS = `
  SELECT DISTINCT
    AlbumArtist as Artist
  FROM Songs
  WHERE AlbumArtist COLLATE NOCASE != '' AND AlbumArtist IS NOT NULL
  ORDER BY AlbumArtist COLLATE NOCASE
`

/**
 * Get all albums with their album artist
 */
export const QUERY_MM_ALBUMS = `
  SELECT DISTINCT
    IDAlbum as ID,
    Album,
    AlbumArtist as Artist,
    Year
  FROM Songs
  WHERE Album COLLATE NOCASE != '' AND Album IS NOT NULL
  GROUP BY IDAlbum
  ORDER BY Album COLLATE NOCASE
`

/**
 * Get albums by album artist name
 */
export const QUERY_MM_ALBUMS_BY_ARTIST = `
  SELECT DISTINCT
    IDAlbum as ID,
    Album,
    AlbumArtist as Artist,
    Year
  FROM Songs
  WHERE AlbumArtist COLLATE NOCASE = ? AND Album COLLATE NOCASE != '' AND Album IS NOT NULL
  GROUP BY IDAlbum
  ORDER BY Year, Album COLLATE NOCASE
`

/**
 * Get songs by album ID
 */
export const QUERY_MM_SONGS_BY_ALBUM = `
  SELECT
    ID,
    SongTitle,
    Artist,
    AlbumArtist,
    Album,
    IDAlbum,
    TrackNumber,
    DiscNumber,
    Year,
    Genre,
    Mood,
    SongLength,
    FileLength,
    SongPath,
    Bitrate,
    SamplingFrequency,
    BPS,
    Stereo,
    VBR
  FROM Songs
  WHERE IDAlbum = ? AND SongTitle COLLATE NOCASE != '' AND SongTitle IS NOT NULL
  ORDER BY DiscNumber COLLATE NOCASE, TrackNumber COLLATE NOCASE
`

/**
 * Get all songs (for counting / full scan)
 */
export const QUERY_MM_ALL_SONGS = `
  SELECT
    ID,
    SongTitle,
    Artist,
    AlbumArtist,
    Album,
    IDAlbum,
    TrackNumber,
    DiscNumber,
    Year,
    Genre,
    Mood,
    SongLength,
    FileLength,
    SongPath,
    Bitrate,
    SamplingFrequency,
    BPS,
    Stereo,
    VBR
  FROM Songs
  WHERE SongTitle COLLATE NOCASE != '' AND SongTitle IS NOT NULL
  ORDER BY AlbumArtist COLLATE NOCASE, Album COLLATE NOCASE, DiscNumber, TrackNumber
`

/**
 * Get song count
 */
export const QUERY_MM_SONG_COUNT = `
  SELECT COUNT(*) as count FROM Songs WHERE SongTitle COLLATE NOCASE != '' AND SongTitle IS NOT NULL
`

/**
 * Get mood entries from the Lists/ListsSongs junction table
 * IDListType = 2 is mood in MediaMonkey
 * Returns all moods for all songs (join with songs to filter)
 */
export const QUERY_MM_MOODS_BY_SONG = `
  SELECT
    ls.IDSong,
    l.TextData as MoodName
  FROM ListsSongs ls
  INNER JOIN Lists l ON ls.IDList = l.ID
  WHERE l.IDListType = 2 AND ls.IDSong = ?
  ORDER BY l.SortOrder
`

/**
 * Get all mood entries for batch loading
 */
export const QUERY_MM_ALL_MOODS = `
  SELECT
    ls.IDSong,
    l.TextData as MoodName
  FROM ListsSongs ls
  INNER JOIN Lists l ON ls.IDList = l.ID
  WHERE l.IDListType = 2
  ORDER BY ls.IDSong, l.SortOrder
`

/**
 * Get album cover art paths for all songs (external file covers only).
 * CoverStorage: 0 = embedded in audio file, 1 = external file
 * CoverOrder: 0 = primary cover
 * Returns song ID → cover file path (relative to song's folder)
 */
export const QUERY_MM_ALBUM_COVERS = `
  SELECT
    c.IDSong,
    c.CoverPath
  FROM Covers c
  WHERE c.CoverStorage = 1 AND c.CoverPath != '' AND c.CoverOrder = 0
`

export interface MMDbCover {
  IDSong: number
  CoverPath: string
}

// ============================================================================
// WRITE QUERIES (for mood sync to MediaMonkey)
// ============================================================================

/**
 * Update the Songs.Mood column for a track.
 * MediaMonkey stores moods as semicolon-separated text.
 */
export const QUERY_MM_UPDATE_SONG_MOOD = `
  UPDATE Songs SET Mood = ? WHERE ID = ?
`

/**
 * Delete all mood associations for a song from the junction table.
 */
export const QUERY_MM_DELETE_SONG_MOODS = `
  DELETE FROM ListsSongs WHERE IDSong = ? AND IDListType = 2
`

/**
 * Get or find an existing mood entry in the Lists table.
 */
export const QUERY_MM_FIND_MOOD = `
  SELECT ID FROM Lists WHERE IDListType = 2 AND TextData COLLATE NOCASE = ?
`

/**
 * Insert a new mood entry into the Lists table.
 */
export const QUERY_MM_INSERT_MOOD = `
  INSERT INTO Lists (IDListType, TextData, SortOrder) VALUES (2, ?, 0)
`

/**
 * Link a song to a mood in the junction table.
 */
export const QUERY_MM_INSERT_SONG_MOOD = `
  INSERT INTO ListsSongs (IDSong, IDListType, IDList) VALUES (?, 2, ?)
`



