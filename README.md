# Lumen

A desktop application for analyzing and managing your media library quality across multiple media servers.

## Overview

Lumen connects to your media servers (Plex, Jellyfin, Emby, Kodi) and provides detailed quality analysis of your movies, TV shows, and music. It helps you identify items that could be upgraded to higher quality versions and tracks your collection completeness.

## Features

### Multi-Source Support

Connect to multiple media servers simultaneously:
- **Plex** - Full support with OAuth authentication
- **Jellyfin** - Full support with server discovery
- **Emby** - Full support
- **Kodi** - Full support

### Video Quality Analysis

Automatically analyzes your movies and TV shows for:
- **Resolution** - SD, 720p, 1080p, 4K
- **HDR Format** - Dolby Vision, HDR10, HLG
- **Color Depth** - 8-bit, 10-bit, 12-bit
- **Video Bitrate** - With quality tier assessment
- **Audio Format** - Atmos, DTS:X, surround sound detection
- **Quality Issues** - Identifies low bitrate, missing HDR, etc.

### Music Quality Analysis

Analyzes audio tracks with a four-tier quality rating system:

| Tier | Description | Criteria |
|------|-------------|----------|
| **Ultra** | Hi-Res Lossless | Lossless codec (FLAC/ALAC/WAV) with 24-bit+ depth OR >48kHz sample rate |
| **High** | CD-Quality Lossless | Lossless codec at 16-bit / 44.1-48kHz |
| **Medium** | Transparent Lossy | MP3 ≥160 kbps or AAC ≥128 kbps |
| **Low** | Low Bitrate Lossy | MP3 <160 kbps or AAC <128 kbps |

Click on any track to see detailed quality information and scoring explanation.

### Completeness Tracking

#### TV Series
- Integrates with TMDB for episode data
- Shows missing episodes per season
- Displays series status (Returning, Ended, Canceled)
- Tracks overall collection completeness percentage

#### Movie Collections
- Integrates with TMDB for collection data
- Groups movies by franchise
- Shows owned vs missing movies in collections
- Displays collection completion percentage

#### Music (MusicBrainz Integration)
- Analyzes artist discographies
- Shows owned vs missing albums
- Tracks album completeness (missing tracks)
- Filters to digital/CD releases only (excludes vinyl-only releases)
- Supports EPs and singles tracking

### Library Views

#### Grid View
- Poster-based display with hover effects
- Adjustable grid scale (7 levels)
- Quality badges on items

#### List View
- Compact list display
- Quality and status badges
- Sortable columns

#### Alphabet Filter
- Quick navigation by first letter
- Special filter for non-alphabetic characters (#)

### Search
- Real-time search across all media types
- Searches titles, artists, and album names

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/lumen.git
cd lumen

# Install dependencies
npm install

# Start development mode
npm run electron:dev

# Build for production
npm run build
```

### Adding a Media Source

1. Click the **+** button in the sidebar under "Sources"
2. Select your media server type (Plex, Jellyfin, Emby, or Kodi)
3. Follow the authentication flow:
   - **Plex**: Click "Sign in with Plex" to authenticate via browser
   - **Jellyfin/Emby**: Enter server URL and credentials
   - **Kodi**: Enter server URL
4. Select which libraries to scan

### Scanning Libraries

1. Click the refresh icon next to a library in the sidebar
2. Wait for the scan to complete
3. Progress is shown in the sidebar

### Analyzing Completeness

#### For TV Shows and Movies:
1. Click the "Completeness" button in the toolbar
2. Click "Analyze Series" or "Analyze Collections"
3. Wait for the analysis to complete (requires TMDB API)

#### For Music:
1. Navigate to the Music library
2. Select an artist
3. Click "Analyze Completeness" to check against MusicBrainz
4. View missing albums and tracks

### Viewing Quality Details

#### Movies/TV Shows:
- Click on any item to open the details panel
- Quality badges show HDR format, resolution, audio format
- Quality issues are displayed in the header

#### Music Tracks:
- Click on any track in an album view
- A modal shows the quality tier and scoring criteria
- View your track's specs compared to the tier requirements

## Configuration

### TMDB API Key
Required for movie collection analysis:
1. Go to Settings
2. Enter your TMDB API key
3. Save settings

### Database Location
The SQLite database is stored at:
- **Windows**: `%APPDATA%\lumen\lumen.db`
- **macOS**: `~/Library/Application Support/lumen/lumen.db`
- **Linux**: `~/.config/lumen/lumen.db`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + F` | Focus search |
| `Escape` | Close modal/panel |
| `G` | Toggle grid view |
| `L` | Toggle list view |

## Development

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── services/   # Backend services (Database, API clients)
│   ├── providers/  # Media server providers
│   └── ipc/        # IPC handlers
├── preload/        # Preload scripts (IPC bridge)
└── renderer/       # React frontend
    └── src/
        ├── components/  # React components
        ├── contexts/    # React contexts
        └── styles/      # CSS styles
```

### Commands

```bash
npm run dev          # Start Vite dev server only
npm run electron:dev # Start Vite + Electron together
npm run build        # Production build
npm run lint         # Run ESLint
```

### Tech Stack

- **Electron** 27 - Desktop framework
- **React** 18 - UI framework
- **TypeScript** - Type safety
- **Vite** 5 - Build tool
- **Tailwind CSS** - Styling
- **SQL.js** - SQLite database
- **Axios** - HTTP client

## API Integrations

- **Plex API** - Media server
- **Jellyfin API** - Media server
- **Emby API** - Media server
- **TMDB API** - Movie and TV series metadata and collections
- **MusicBrainz API** - Music metadata and discographies

## License

MIT License - See LICENSE file for details.

## Support

For issues and feature requests, please use the GitHub issue tracker.
