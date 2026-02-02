# Totality Media Source Architecture

This document explains how Totality connects to, scans, and analyzes media from different sources. Each media server and source type requires its own unique approach for authentication, scanning, quality analysis, and completeness tracking.

## Table of Contents

1. [Overview](#overview)
2. [Supported Sources](#supported-sources)
3. [Plex](#plex)
4. [Jellyfin](#jellyfin)
5. [Emby](#emby)
6. [Kodi (JSON-RPC)](#kodi-json-rpc)
7. [Kodi (Local Database)](#kodi-local-database)
8. [Local Folders](#local-folders)
9. [Quality Analysis](#quality-analysis)
10. [Completeness Analysis](#completeness-analysis)
11. [Fallback Mechanisms](#fallback-mechanisms)

---

## Overview

Totality aggregates media libraries from multiple sources and provides unified quality scoring and completeness tracking. The architecture follows a provider pattern where each source type implements a common `MediaProvider` interface while using its native APIs and data structures.

**Data Flow:**
```
Media Source → Provider → Normalizer → Database → Quality Analyzer → UI
                                          ↓
                              Completeness Services (TMDB/MusicBrainz)
```

**Key Principles:**
- Use provider-native metadata when available (most accurate)
- Fall back to FFprobe for file analysis when metadata is incomplete
- Enrich with external APIs (TMDB, MusicBrainz) for completeness tracking
- Encrypt sensitive credentials at rest using OS-level encryption

---

## Supported Sources

| Source | Connection Type | Auth Method | Media Types |
|--------|----------------|-------------|-------------|
| Plex | HTTP API | OAuth PIN | Movies, TV, Music |
| Jellyfin | HTTP API | Username/Password | Movies, TV, Music |
| Emby | HTTP API | Username/Password | Movies, TV, Music |
| Kodi (Remote) | JSON-RPC | Optional Basic Auth | Movies, TV, Music |
| Kodi (Local) | SQLite Direct | None | Movies, TV, Music |
| Local Folders | File System | None | Movies, TV, Music |

---

## Plex

### Connection & Authentication

Plex uses OAuth-based PIN authentication - no passwords are stored.

**Authentication Flow:**
1. Request a PIN from `https://plex.tv/api/v2/pins`
2. User visits `https://app.plex.tv/auth#?clientID={id}&code={code}` to authorize
3. Totality polls the PIN endpoint every 2 seconds for completion
4. On success, receives an auth token valid for the user's account

**Server Discovery:**
- Fetches available servers from `/api/v2/resources`
- Prefers local HTTP connections over remote relay
- User selects which server and libraries to add

**Headers Required:**
```
X-Plex-Client-Identifier: {unique-client-id}
X-Plex-Product: Totality
X-Plex-Token: {auth-token}
```

### Media Scanning

**Movies:**
- Endpoint: `/library/sections/{id}/all`
- Returns full metadata including streaming details
- Uses `ratingKey` as unique identifier

**TV Shows:**
- Fetches show list from library section
- For each show: `/library/metadata/{showId}/allLeaves` returns all episodes
- Extracts series TMDB ID from Plex's GUID field

**Music:**
- Artists: Type 8 in library
- Albums: `/library/metadata/{artistKey}/children`
- Tracks: `/library/metadata/{albumKey}/children`
- MusicBrainz IDs extracted from GUID field

**Metadata Richness:**
Plex provides the most complete metadata of any provider:
- Video: codec, bitrate, width, height, frame rate, profile, level, HDR info
- Audio: multiple tracks with codec, channels, bitrate, sample rate, language
- External IDs: IMDB, TMDB, TVDB from GUID field

**Artwork:**
- Uses Plex server URLs with auth token appended
- Format: `{serverUri}{path}?X-Plex-Token={token}`

### Unique Features
- Incremental scanning via `addedAt` timestamp filtering
- Batch processing with checkpoints (10 items per batch)
- Best audio track selection using codec ranking

---

## Jellyfin

### Connection & Authentication

Jellyfin uses standard username/password authentication.

**Authentication Flow:**
1. POST to `/Users/AuthenticateByName` with credentials
2. Server returns `AccessToken` and `UserId`
3. Token stored (encrypted) for future requests

**Server Discovery:**
- UDP broadcast discovery on port 7359
- Automatic detection of local Jellyfin servers
- Manual URL entry as fallback

**Headers Required:**
```
Authorization: MediaBrowser Token="{token}"
X-Emby-Authorization: MediaBrowser Client="Totality", Device="Totality", DeviceId="{id}", Version="1.0.0"
```

### Media Scanning

**Library Structure:**
- GET `/Items` with parent ID filtering
- Recursive fetching with type filters (Movie, Episode, Audio)

**Movies & TV:**
- MediaStreams array provides codec details
- ProviderIds contains external IDs (IMDB, TMDB)
- ImageTags for artwork references

**Music:**
- Artists: `IncludeItemTypes=MusicArtist`
- Albums: `IncludeItemTypes=MusicAlbum`
- Tracks: Filter by parent AlbumId
- MusicBrainz IDs in ProviderIds

**Quality Data:**
- Video: codec, width, height, bitrate, frameRate, bitDepth, colorSpace
- HDR: VideoRange field indicates HDR type
- Audio: multiple streams with full details

### Unique Features
- Shares codebase with Emby (common base class)
- Open-source server with active development

---

## Emby

### Connection & Authentication

Nearly identical to Jellyfin (Jellyfin forked from Emby).

**Key Differences:**
- Header format: `X-Emby-Authorization` with Emby-specific format
- Optional Emby Connect for remote server discovery
- Some API endpoints have minor variations

**Authentication Flow:**
Same as Jellyfin - username/password to API token exchange.

### Media Scanning

Identical API structure to Jellyfin:
- Same endpoints, same response formats
- Same metadata extraction logic
- Shared provider base class handles both

### Unique Features
- Emby Connect integration for remote access
- Commercial product with additional features

---

## Kodi (JSON-RPC)

### Connection & Authentication

Kodi uses JSON-RPC 2.0 over HTTP.

**Connection Setup:**
- Endpoint: `http://{host}:{port}/jsonrpc`
- Optional HTTP Basic Auth: `http://user:pass@host:port/jsonrpc`
- Requires Kodi to be running with web interface enabled

**No Token System:**
- Stateless requests
- Credentials sent with each request (if configured)

### Media Scanning

**JSON-RPC Methods:**

Movies:
```json
{
  "method": "VideoLibrary.GetMovies",
  "params": {
    "properties": ["title", "file", "year", "runtime", "streamdetails", "art"]
  }
}
```

TV Episodes:
```json
{
  "method": "VideoLibrary.GetEpisodes",
  "params": {
    "properties": ["title", "showtitle", "season", "episode", "streamdetails", "art"]
  }
}
```

Music:
- `AudioLibrary.GetArtists` - artist list with thumbnails
- `AudioLibrary.GetAlbums` - album list with metadata
- `AudioLibrary.GetSongs` - track list with file info

**StreamDetails Object:**
```json
{
  "video": [{ "codec": "h264", "width": 1920, "height": 1080 }],
  "audio": [{ "codec": "aac", "channels": 6, "language": "eng" }],
  "subtitle": [{ "language": "eng" }]
}
```

**MusicBrainz IDs:**
- `musicbrainzartistid`, `musicbrainzalbumid`, `musicbrainztrackid` fields

### Unique Features
- Works with any running Kodi instance
- Network overhead for each request
- Real-time library access

---

## Kodi (Local Database)

### Connection & Authentication

Direct SQLite database access - no network, no authentication.

**Database Discovery:**
- Windows: `%APPDATA%\Kodi\userdata\Database\`
- macOS: `~/Library/Application Support/Kodi/userdata/Database/`
- Linux: `~/.kodi/userdata/Database/`

**Database Files:**
- Video: `MyVideos###.db` (### = schema version, e.g., 121)
- Music: `MyMusic###.db` (separate database)

**Advantages:**
- Kodi doesn't need to be running
- Fastest scanning method
- No network configuration required

### Media Scanning

**SQL Queries:**

Movies with details:
```sql
SELECT m.*, f.strFilename, s.iStreamType, s.strVideoCodec,
       s.iVideoWidth, s.iVideoHeight, s.strAudioCodec, s.iAudioChannels
FROM movie m
JOIN files f ON m.idFile = f.idFile
LEFT JOIN streamdetails s ON f.idFile = s.idFile
```

Episodes with hierarchy:
```sql
SELECT e.*, tv.c00 as series_title, s.idSeason, f.strFilename, sd.*
FROM episode e
JOIN tvshow tv ON e.idShow = tv.idShow
JOIN seasons s ON e.idSeason = s.idSeason
JOIN files f ON e.idFile = f.idFile
LEFT JOIN streamdetails sd ON f.idFile = sd.idFile
```

**File Path Handling:**
- Extracts local file paths for FFprobe analysis
- Supports `smb://`, `nfs://`, and local paths

### Unique Features
- Best performance (direct file access)
- Works offline
- Version-specific schema handling

---

## Local Folders

### Connection & Authentication

Simple folder path selection - no authentication.

**Setup:**
1. User selects folder via native file picker
2. Chooses media type: movies, tvshows, music, or mixed
3. Totality validates path exists and is readable

### Media Scanning

**Directory Traversal:**
- Recursive scanning with depth limit (10 levels)
- Filters by media file extensions (.mkv, .mp4, .avi, .flac, .mp3, etc.)

**Filename Parsing:**
Movies: `Title (Year).ext` or `Title.Year.ext`
```
The Matrix (1999).mkv → Title: "The Matrix", Year: 1999
```

TV Episodes: `Series - SxxEyy - Title.ext` or `Series.SxxEyy.Title.ext`
```
Breaking Bad - S01E01 - Pilot.mkv → Series: "Breaking Bad", S1E1, Title: "Pilot"
```

**FFprobe Analysis:**
Since local folders have no metadata server, FFprobe analyzes each file:
- Video codec, resolution, bitrate, frame rate, HDR info
- Audio streams with codec, channels, sample rate, bit depth
- Duration, container format

**TMDB Enrichment:**
For movies and TV shows, Totality searches TMDB:
1. Search by parsed title + year
2. Fallback to title-only search
3. Fetch poster URLs, external IDs, collection info

**Music Metadata:**
- Reads ID3/Vorbis tags from audio files
- Artist, album, track, year from embedded tags
- MusicBrainz IDs if present in tags

### Artwork

**Movies/TV:**
- Primary: TMDB poster URLs (fetched during scan or completeness analysis)
- Fallback: Local folder images (poster.jpg, folder.jpg)

**Music:**
- Embedded artwork from audio file tags
- Folder artwork: cover.jpg, folder.jpg, front.jpg, album.jpg
- Cover Art Archive via MusicBrainz (disabled for local sources to prefer embedded art)

### Unique Features
- Works with any folder structure
- No server software required
- Full FFprobe analysis for accurate quality data
- TMDB metadata enrichment

---

## Quality Analysis

### Video Quality Tiers

| Tier | Resolution | Bitrate Thresholds |
|------|------------|-------------------|
| SD | < 720p | Low: <1500, Med: 1500-3500, High: >3500 kbps |
| 720p | 720p | Low: <3000, Med: 3000-8000, High: >8000 kbps |
| 1080p | 1080p | Low: <6000, Med: 6000-15000, High: >15000 kbps |
| 4K | >= 2160p | Low: <15000, Med: 15000-40000, High: >40000 kbps |

### Codec Efficiency Multipliers

Modern codecs achieve equivalent quality at lower bitrates:
- H.264/AVC: 1.0x (baseline)
- HEVC/H.265: 2.0x (same quality at half the bitrate)
- AV1: 3.0x (most efficient)
- VP9: 1.8x

### Audio Quality Scoring

Factors considered:
- Codec (lossless > lossy)
- Channels (7.1 > 5.1 > stereo)
- Bitrate
- Sample rate and bit depth (for lossless)

### Music Quality Tiers

| Tier | Criteria |
|------|----------|
| Ultra | Lossless (FLAC/ALAC/WAV) + 24-bit OR >48kHz |
| High | CD-quality lossless (16-bit, 44.1-48kHz) |
| Medium | MP3 >= 160 kbps or AAC >= 128 kbps |
| Low | MP3 < 160 kbps or AAC < 128 kbps |

### Provider-Specific Quality Data

| Provider | Quality Data Source |
|----------|-------------------|
| Plex | MediaStreams (most detailed) |
| Jellyfin/Emby | MediaStreams array |
| Kodi | streamdetails table/object |
| Local Folders | FFprobe analysis |

---

## Completeness Analysis

### Movie Collections (TMDB)

**Process:**
1. For each movie, look up TMDB ID (from provider or via search)
2. Check if movie belongs to a collection
3. Fetch full collection membership from TMDB
4. Compare owned movies vs collection total
5. Track missing movies with poster URLs and release dates

**Cross-Provider Deduplication:**
- Same movie from multiple sources counted once
- Grouped by TMDB ID

### TV Series Completeness (TMDB)

**Process:**
1. Group episodes by series title
2. Find TMDB ID via:
   - Provider metadata (Plex GUID, Jellyfin ProviderIds)
   - IMDB ID lookup on TMDB
   - Title search fallback
3. Fetch all seasons and episodes from TMDB
4. Filter out unaired episodes (future air dates)
5. Compare owned vs total, track missing

**Artwork Updates (Local Sources):**
When analyzing local folder TV shows:
- Fetches show poster from TMDB
- Fetches episode thumbnails (still images)
- Fetches season posters
- Updates database with artwork URLs

### Music Completeness (MusicBrainz)

**Artist Discography:**
1. Look up artist by MusicBrainz ID or name search
2. Fetch release groups (albums, EPs, singles)
3. Filter by type (albums only, include compilations, etc.)
4. Compare owned albums vs discography
5. Track missing albums with release dates

**Album Track Completeness:**
1. Look up album by MusicBrainz ID or search
2. Fetch track listing
3. Compare owned tracks vs album total
4. Track missing tracks

**Rate Limiting:**
- MusicBrainz: 1 request per 1.5 seconds (strict)
- TMDB: 40 requests per 10 seconds

---

## Fallback Mechanisms

### Metadata Fallback Chain

| Need | Primary | Fallback 1 | Fallback 2 |
|------|---------|------------|------------|
| Video quality | Provider streams | FFprobe | Defaults |
| TMDB ID | Provider metadata | IMDB lookup | Title search |
| Artwork (Video) | Provider URLs | TMDB API | Folder images |
| Artwork (Music) | Provider URLs | Embedded tags | Folder images |
| MusicBrainz ID | Provider metadata | Name search | Manual fix |

### FFprobe Integration

FFprobe is used when provider metadata is incomplete:
- Automatically downloaded if not present on system
- Analyzes actual media files for accurate codec/bitrate data
- Essential for local folder sources

**Analyzed Properties:**
- Container format
- Video: codec, profile, level, resolution, bitrate, frame rate, HDR metadata
- Audio: all streams with codec, channels, bitrate, sample rate, bit depth
- Duration

### External API Integration

**TMDB (The Movie Database):**
- Movie/TV metadata and artwork
- Collection membership
- Season/episode details
- Rate limit: 40 requests per 10 seconds

**MusicBrainz:**
- Artist discographies
- Album track listings
- Release group categorization
- Rate limit: 1 request per 1.5 seconds

**Cover Art Archive:**
- Album artwork via MusicBrainz ID
- Disabled for local sources (prefer embedded artwork)

---

## Implementation Files

| Component | File |
|-----------|------|
| Plex Provider | `src/main/providers/plex/PlexProvider.ts` |
| Jellyfin Provider | `src/main/providers/jellyfin-emby/JellyfinProvider.ts` |
| Emby Provider | `src/main/providers/jellyfin-emby/EmbyProvider.ts` |
| Jellyfin/Emby Base | `src/main/providers/jellyfin-emby/JellyfinEmbyBase.ts` |
| Kodi JSON-RPC | `src/main/providers/kodi/KodiProvider.ts` |
| Kodi Local DB | `src/main/providers/kodi/KodiLocalProvider.ts` |
| Local Folders | `src/main/providers/local/LocalFolderProvider.ts` |
| Quality Analyzer | `src/main/services/QualityAnalyzer.ts` |
| TMDB Service | `src/main/services/TMDBService.ts` |
| MusicBrainz Service | `src/main/services/MusicBrainzService.ts` |
| Series Completeness | `src/main/services/SeriesCompletenessService.ts` |
| Movie Collections | `src/main/services/MovieCollectionService.ts` |
| File Analyzer | `src/main/services/MediaFileAnalyzer.ts` |
| Filename Parser | `src/main/services/FileNameParser.ts` |
| Source Manager | `src/main/services/SourceManager.ts` |
