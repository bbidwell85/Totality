# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Totality is an Electron desktop application that analyzes media library quality from multiple sources (Plex, Jellyfin, Emby, Kodi) and recommends higher-quality versions. Built with Electron 27, React 18, TypeScript, Vite 5, and Tailwind CSS.

## Development Commands

```bash
npm run electron:dev     # Start Vite + Electron together (recommended for development)
npm run build            # TypeScript compile + Vite build + Electron Builder
npm run lint             # Run ESLint on TS/TSX files
npm run preview          # Preview Vite production build
npm run test             # Run Vitest in watch mode
npm run test:run         # Run all tests once
npm run test:coverage    # Run tests with coverage report
npm run test:ui          # Open Vitest interactive UI in browser
npm run generate-icons   # Generate app icons from source
npm run electron:build   # Same as `npm run build` (alias)
```

**Single test:** `npx vitest run tests/unit/FileNameParser.test.ts` or use `-t` to filter by test name: `npx vitest run -t "parses year"`

DevTools open automatically in development mode (docked to bottom).

**Note:** `npm run dev` and `npm run electron:dev` are equivalent—both run Vite, which automatically starts Electron via `vite-plugin-electron`.

**Build Output:** `dist/` (renderer), `dist-electron/` (main + preload), `release/` (packaged apps)

## Versioning & Releases

Uses [standard-version](https://github.com/conventional-changelog/standard-version) for automatic semantic versioning based on conventional commits.

### Release Commands

```bash
npm run release          # Auto-detect version bump from commits
npm run release:patch    # Force patch bump (0.1.0 → 0.1.1)
npm run release:minor    # Force minor bump (0.1.0 → 0.2.0)
npm run release:major    # Force major bump (0.1.0 → 1.0.0)
npm run release:beta     # Pre-release beta bump (0.1.0 → 0.1.1-beta.0)
```

### How It Works

1. Scans git history for conventional commits since last tag
2. Determines version bump: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` → major
3. Updates `package.json` version
4. Generates/updates `CHANGELOG.md`
5. Creates git commit and tag (e.g., `v0.1.1`)

### Commit Message Format

```
type(scope): description

feat: add new provider support        → minor bump
fix: resolve scan timeout issue       → patch bump
feat!: redesign settings API          → major bump (breaking)
```

**Note:** After running a release command, push with tags: `git push --follow-tags`

### Development Database

Location: `%APPDATA%\totality\totality.db` (SQLite via better-sqlite3 in production, SQL.js as fallback)

Reset database: `del "%APPDATA%\totality\totality.db"`

## Architecture Overview

### Three-Process Model (Electron Standard)

**1. Main Process** (`src/main/`)
- Node.js environment with full system access
- Window management, database operations (better-sqlite3/SQL.js), external API communication
- Entry: `src/main/index.ts` → builds to `dist-electron/main/index.cjs`

**2. Preload Script** (`src/preload/`)
- Secure bridge between main and renderer via `contextBridge`
- Exposes `window.electronAPI` with typed IPC methods
- Entry: `src/preload/index.ts` → builds to `dist-electron/preload/index.cjs`

**3. Renderer Process** (`src/renderer/`)
- React 18 + TypeScript web application
- Chromium environment, no Node.js access (security)
- Entry: `src/renderer/src/main.tsx` → builds to `dist/`

**Worker Threads:**
- FFprobe worker (`src/main/workers/ffprobe-worker.ts`) — separate Vite entry point, builds to `dist-electron/main/ffprobe-worker.cjs`

### Core Services (Singletons in Main Process)

Services use singleton pattern via getter functions:

- **DatabaseService** (`getDatabaseService()`): SQLite operations with dual-backend support (see Database Backend Selection below)
- **CredentialEncryptionService** (`getCredentialEncryptionService()`): Credential encryption using Electron's safeStorage API
- **SourceManager** (`getSourceManager()`): Multi-provider orchestration (Plex, Jellyfin, Emby, Kodi, Local)
- **PlexService** (`getPlexService()`): Plex API authentication and scanning
- **QualityAnalyzer** (`getQualityAnalyzer()`): Tier-based quality scoring (SD/720p/1080p/4K)
- **TMDBService** (`getTMDBService()`): TMDB API for movie collections and TV series data (rate-limited: 40 req/s)
- **SeriesCompletenessService** (`getSeriesCompletenessService()`): TV series completeness tracking
- **MovieCollectionService** (`getMovieCollectionService()`): Movie franchise collection tracking
- **MusicBrainzService** (`getMusicBrainzService()`): MusicBrainz API for artist/album completeness
- **JellyfinDiscoveryService** (`getJellyfinDiscoveryService()`): Jellyfin server discovery (UDP broadcast)
- **EmbyDiscoveryService** (`getEmbyDiscoveryService()`): Emby server discovery
- **KodiLocalDiscoveryService** (`getKodiLocalDiscoveryService()`): Local Kodi installation detection
- **MediaNormalizer** (`getMediaNormalizer()`): Normalizes media data from different providers to common format
- **MediaFileAnalyzer** (`getMediaFileAnalyzer()`): FFprobe wrapper for media file analysis (resolution, codecs, bitrate, HDR); can auto-download FFprobe
- **FileNameParser** (`getFileNameParser()`): Parses media filenames to extract metadata (title, year, season/episode) with smart year detection
- **LiveMonitoringService** (`getLiveMonitoringService()`): Polls sources for changes, detects added/updated/removed items
- **TaskQueueService** (`getTaskQueueService()`): Background task queue with pause/resume/cancel
- **StoreSearchService** (`getStoreSearchService()`): Search external stores (Amazon, iTunes) for wishlist items
- **AudioCodecRanker** (`getAudioCodecRanker()`): Ranks audio codecs by quality (Atmos > DTS:X > TrueHD, etc.)
- **LoggingService** (`getLoggingService()`): Application logging with verbose mode, file logging, and main window event emission
- **KodiMySQLConnectionService** (`getKodiMySQLConnectionService()`): MySQL backend support for Kodi
- **MediaConverter** (`getMediaConverter()`): Converts between media data formats
- **FFprobeWorkerPool** (`getFFprobeWorkerPool()`): Manages concurrent FFprobe worker threads for parallel file analysis
- **AutoUpdateService** (`getAutoUpdateService()`): Electron-updater integration for auto-update checking and installation
- **GeminiService** (`getGeminiService()`): Google Gemini AI wrapper for chat and analysis (see AI Chat & Analysis section)

### Multi-Provider Architecture

**Location:** `src/main/providers/`

The application supports multiple media server providers through a common interface:

- **MediaProvider.ts**: Common interface for all providers (`ProviderType`: plex, jellyfin, emby, kodi, kodi-local, local)
- **ProviderFactory.ts**: Creates provider instances by type
- **PlexProvider.ts**, **JellyfinProvider.ts**, **EmbyProvider.ts**, **KodiProvider.ts**, **KodiLocalProvider.ts**, **KodiMySQLProvider.ts**, **LocalFolderProvider.ts**: Provider implementations
- **JellyfinEmbyBase.ts**: Shared base class for Jellyfin/Emby (similar APIs)
- **KodiDatabaseSchema.ts**: Schema mapping for local Kodi SQLite access
- **LocalFolderProvider.ts**: Scans local folder paths with FFprobe + TMDB metadata lookup
- **VersionNaming.ts**: Smart edition/version naming for multi-version movies (deduplication by TMDB/IMDB ID)

**SourceManager** orchestrates all providers, handling:
- Provider lifecycle (load, initialize, cleanup)
- Aggregated scanning across multiple sources
- Connection testing and server discovery

**Plex Bitrate Gotcha**: Plex sometimes reports incorrect `videoStream.bitrate` values. `PlexProvider.ts` uses `getReliableVideoBitrate()` to validate stream bitrate against the overall container bitrate — if stream bitrate is <30% of container bitrate, it falls back to `container - audio` calculation.

**Scan Reconciliation**: Both full and incremental Plex scans fetch the complete set of current library IDs from Plex (`getPlexLibraryItemIds()`) before removing stale items. This ensures deleted items are cleaned up even if they weren't recently modified.

### Local Folder Provider

**Location:** `src/main/providers/local/LocalFolderProvider.ts`

The LocalFolderProvider acts as a media organizer for local files, combining filename parsing, FFprobe analysis, and TMDB/MusicBrainz metadata lookup.

**Filename Parsing** (`src/main/services/FileNameParser.ts`):
- Smart year extraction: prefers `(2019)` format, handles multiple years (uses last), preserves numeric titles like "1917"
- TV episode patterns: `S01E01`, `1x01`, season folders
- Extracts: resolution, codec, source, edition, release group

**Extras/Featurettes Filtering**:
Files matching common extras patterns (featurettes, trailers, behind the scenes, etc.) are automatically excluded, as are files < 45 minutes in movie libraries. See `EXTRAS_FILENAME_PATTERNS` and `EXTRAS_FOLDER_NAMES` constants in LocalFolderProvider.ts.

**Metadata Priority** (for local files):
1. Embedded file metadata (MKV/MP4 tags via FFprobe)
2. TMDB/MusicBrainz API lookup
3. Filename parsing (fallback)

**TMDB Integration**:
- Movies: Search with year, fallback without year if no match, prefer exact year match from results
- TV Episodes: Cache series TMDB ID to avoid repeated searches, fetch episode titles
- Collections: Trust movie's `belongs_to_collection` field from TMDB

**Embedded Metadata Extraction** (via FFprobe `format.tags`):
- Video: title, year, description, show name, season/episode numbers
- Audio: artist, album, track, year (for music files)

### IPC Communication Pattern

**Registration** (`src/main/index.ts` on `app.whenReady()`):
```typescript
registerDatabaseHandlers()
registerQualityHandlers()
registerSeriesHandlers()
registerCollectionHandlers()
registerSourceHandlers()
registerJellyfinHandlers()
registerMusicHandlers()
registerWishlistHandlers()
registerMonitoringHandlers()
registerTaskQueueHandlers()
registerLoggingHandlers()
registerAutoUpdateHandlers()
registerGeminiHandlers()
```

**Handler Pattern** (`src/main/ipc/*.ts`):
```typescript
ipcMain.handle('namespace:method', async (_event, ...args) => {
  const service = getService()
  return await service.method(...args)
})
```

**Renderer Usage**:
```typescript
const result = await window.electronAPI.namespaceMethod(args)
```

**Progress Events** (main → renderer):
```typescript
// Main: win.webContents.send('event:name', data)
// Renderer: window.electronAPI.onEventName(callback)
```

Events: `sources:scanProgress`, `quality:analysisProgress`, `series:progress`, `collections:progress`, `music:scanProgress`, `music:qualityProgress`, `music:completenessProgress`, `monitoring:statusChanged`, `taskQueue:updated`, `library:updated`, `logging:entry`, `settings:changed`, `scan:completed`, `ai:toolUse`, `ai:chatStreamDelta`, `ai:chatStreamComplete`, `ai:analysisStreamDelta`, `ai:analysisStreamComplete`

**Settings Change Events**: When a setting is updated via `setSetting()`, the main process emits `settings:changed` with `{ key, hasValue }`. Renderer components that depend on settings (e.g., Dashboard, MediaBrowser) listen via `window.electronAPI.onSettingsChanged()` to live-update without requiring a page reload. When reading settings in these handlers, always fetch fresh values from the API rather than relying on React state (which may be stale due to batched updates).

### Database Schema

**Core Tables** (see `src/main/database/schema.ts`):
- `media_sources`: Provider configurations (type, credentials, enabled status)
- `media_items`: Media with video/audio specs (source_id, resolution, codecs, bitrates, summary)
- `quality_scores`: Tier-based scores (quality_tier: SD/720p/1080p/4K, tier_quality: LOW/MEDIUM/HIGH)
- `settings`: Key-value app settings
- `series_completeness`: TV series ownership and missing episodes (JSON)
- `movie_collections`: Movie franchise collections and ownership
- `music_artists`, `music_albums`, `music_tracks`: Music library data
- `music_quality_scores`: Audio quality analysis
- `artist_completeness`, `album_completeness`: MusicBrainz completeness tracking
- `library_scans`: Per-library scan timestamps and item counts
- `notifications`: Event log with read/unread status
- `wishlist`: Shopping list items with priority and notes
- `media_item_versions`: Multi-version tracking per media item (edition, file path, per-version quality scores)
- `media_item_collections`: Movie groupings in collections
- `exclusions`: Dismissed/hidden items (completeness results the user doesn't want to see)
- `task_queue`, `task_events`, `monitoring_events`: Persistent task queue and monitoring history

**Important**: Database uses triggers for `updated_at` timestamps. Schema migrations in `DatabaseService.runMigrations()`.

**Exclusions and Completeness Stats**: The `exclusions` table stores items dismissed by the user from completeness results. Completeness panel stats (Missing, Complete, Incomplete counts) are computed **client-side** from filtered data in `MediaBrowser.tsx:loadCompletenessData()` — the raw server stats don't account for exclusions, so stats are recalculated after filtering out excluded items.

### Quality Analysis System

**Video Quality Scoring** (`src/main/services/QualityAnalyzer.ts`):
1. Resolution tier: SD (<720p), 720p, 1080p, 4K (≥2160p)
2. Within tier: LOW/MEDIUM/HIGH based on bitrate and audio quality
3. Bitrate thresholds vary by tier (e.g., 1080p: 6000-15000 kbps)
4. Codec efficiency multipliers: H.264 (1.0x), HEVC (2.0x), AV1 (2.5x), VP9 (1.8x)

**Music Quality Tiers**:
- **Ultra**: Lossless (FLAC/ALAC/WAV) with 24-bit+ OR >48kHz sample rate
- **High**: CD-quality lossless (16-bit / 44.1-48kHz)
- **Medium**: MP3 ≥160 kbps or AAC ≥128 kbps
- **Low**: MP3 <160 kbps or AAC <128 kbps

### Path Aliases

```typescript
@/*        → src/renderer/src/*
@main/*    → src/main/*
@preload/* → src/preload/*
```

### State Management (Renderer)

**React Contexts** (`src/renderer/src/contexts/`):
- **SourceContext**: Source CRUD, scan progress, provider authentication flows
- **WishlistContext**: Wishlist state management
- **ToastContext**: Toast notification display
- **NavigationContext**: Page/view navigation state
- **KeyboardNavigationContext**: Keyboard shortcut handling
- **ThemeContext**: Theme selection and persistence (`effectiveIsDark` for light/dark detection)

**Key Renderer Libraries**:
- **react-window** + **react-virtualized-auto-sizer**: Virtualized lists/grids for large media libraries
- **lucide-react**: Icon library used throughout the UI
- **@dnd-kit**: Drag-and-drop for task queue reordering

### Task Queue System

**Location:** `src/main/services/TaskQueueService.ts`

Background task execution with queue management:
- Task types: `library-scan`, `source-scan`, `series-completeness`, `collection-completeness`, `music-completeness`, `music-scan`
- Operations: add, remove, reorder, pause, resume, cancel
- Progress tracking per task with events to renderer
- History of completed/failed/cancelled tasks

### Wishlist/Shopping List

**Location:** `src/main/ipc/wishlist.ts`, `src/renderer/src/components/wishlist/`

Track media items to acquire:
- CRUD operations for wishlist items
- Priority levels and notes
- Store search integration (Amazon, iTunes, etc.) via `StoreSearchService`
- Bulk operations support

### Live Monitoring

**Location:** `src/main/services/LiveMonitoringService.ts`

Automatic change detection:
- Polls enabled sources on configurable intervals
- Detects added/updated/removed items
- Pauses during manual scans
- Emits `monitoring:statusChanged` events to renderer

### Logging & Diagnostics

**Location:** `src/main/services/LoggingService.ts`

**In-Memory Logs:**
- Circular buffer (2000 info + 500 important entries)
- Intercepts `console.log/warn/error` globally, emits `logging:entry` events to renderer
- Sanitizes sensitive data (tokens, passwords, API keys) from log output

**Verbose Logging:**
- `getLoggingService().verbose(source, message, details?)` — only emits when verbose mode enabled
- Setting persisted to database (`verbose_logging_enabled`), survives restarts
- Used across key services: SourceManager, LocalFolderProvider, QualityAnalyzer, TMDBService, SeriesCompletenessService, MovieCollectionService, LiveMonitoringService, MusicBrainzService
- Zero overhead when disabled — verbose calls short-circuit immediately

**File Logging:**
- Daily rotation to `%APPDATA%\totality\logs\totality-YYYY-MM-DD.log`
- Configurable: enabled/disabled, min level (verbose/debug/info/warn/error), retention days
- Settings exposed in TroubleshootTab UI with IPC handlers: `logs:getFileLoggingSettings`, `logs:setFileLoggingSettings`, `logs:openLogFolder`
- Database settings: `file_logging_enabled`, `file_logging_min_level`, `log_retention_days`

**TroubleshootTab** (`src/renderer/src/components/settings/tabs/TroubleshootTab.tsx`):
- Virtualized log viewer with level filtering, text search, multi-select, copy to clipboard
- Verbose mode toggle (persisted)
- Collapsible file logging settings (enable/disable, min level, retention, open folder)
- Export with diagnostics (app version, platform, connected sources, FFprobe status, DB size)

### AI Chat & Analysis (Gemini)

**Model:** Google Gemini `gemini-2.5-flash` via `@google/genai` SDK (free tier: 10 RPM, 250 RPD)

**Core Services:**
- **GeminiService** (`src/main/services/GeminiService.ts`): Singleton API wrapper. Constructor reads API key synchronously from DB (must be sync — async init causes race condition where `isConfigured()` returns false). Provides `sendMessage()`, `streamMessage()`, and `sendMessageWithTools()` (agentic tool-use loop, max 10 rounds).
- **GeminiTools** (`src/main/services/GeminiTools.ts`): 21 tool definitions + `executeTool()` dispatcher. Tools: `search_library`, `get_media_items`, `get_tv_shows`, `get_library_stats`, `get_quality_distribution`, `get_series_completeness`, `get_collection_completeness`, `get_music_stats`, `get_music_albums`, `get_music_quality_distribution`, `get_artist_completeness`, `get_album_details`, `check_music_ownership`, `get_source_list`, `get_wishlist`, `search_tmdb`, `discover_titles`, `get_similar_titles`, `check_ownership`, `get_item_details`, `add_to_wishlist`.
- **GeminiAnalysisService** (`src/main/services/GeminiAnalysisService.ts`): 4 streaming report generators (quality, upgrades, completeness, wishlist). Each gathers data upfront and sends as context (not agentic).
- **System Prompts** (`src/main/services/ai-system-prompts.ts`): Chat prompt has film/TV/music enthusiast personality with videophile/audiophile expertise. Separate prompts for each report type.

**IPC Pattern:**
- Chat: `ai:chatMessage` → tool-use loop, emits `ai:toolUse` events per round, then simulated streaming of final response via `ai:chatStreamDelta` / `ai:chatStreamComplete`. Rate limit errors are **returned** (not thrown) to preserve structured data across IPC serialization.
- Reports: `ai:qualityReport` etc. → streams via `ai:analysisStreamDelta` / `ai:analysisStreamComplete`
- Rate limiting: `ai:getRateLimitInfo` returns `{ limited, retryAfterSeconds }`. Retry timing extracted from SDK `Headers` object (`retry-after-ms`, `retry-after`) with 15s fallback.

**Context-Aware Chat:**
- `useChat.ts` accepts a `ViewContext` (current view, library tab, selected item, active source)
- View context is injected as a `[Viewing: movies library]` prefix into the last user message before sending to Gemini
- `ChatPanel.tsx` shows dynamic suggested prompts based on current view/tab

**Renderer:**
- `src/renderer/src/hooks/useChat.ts`: Chat state management with view context and streaming support
- `src/renderer/src/components/chat/ChatPanel.tsx`: Chat UI with tool-use badges, auto-scroll, rate-limit display, dynamic suggested prompts
- `src/renderer/src/components/library/AIInsightsPanel.tsx`: Report UI with streaming markdown

**SDK Gotchas:**
- `.text` and `.functionCalls` are **getter properties**, NOT methods — don't use `()`
- Rate limit detection: checks both HTTP 429 and `RESOURCE_EXHAUSTED` in error messages. SDK auto-retries 429s up to 2 times before throwing.
- Rate limit errors thrown over Electron IPC lose custom properties (serialized as generic Error) — must **return** structured rate limit responses instead of throwing
- API key stored encrypted (`gemini_api_key` setting), refreshed on `settings:changed` event

**Token Optimization:**
- Chat history bounded to 20 messages
- `compact()` utility strips null/undefined fields from all tool responses
- Completeness results limited to 5 samples + total count
- Quality condensed to single string in TMDB cross-reference results

## Code Style

- No semicolons, single quotes, 2-space indent, trailing commas (es5), 100-char line width, `arrowParens: "always"`
- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters` — prefix unused parameters with `_` (ESLint `argsIgnorePattern: '^_'`)
- `@typescript-eslint/no-explicit-any` is `warn` — avoid `any` but it won't block builds
- IPC handlers validate inputs with **Zod v4** schemas (`src/main/validation/schemas.ts`) using `validateInput(schema, input, 'context')` — note Zod v4 has different APIs from v3 (e.g., `z.object()` methods differ)

## Important Patterns

### Service Initialization Lifecycle

Initialization order in `src/main/index.ts` on `app.whenReady()`:
1. Logging (to capture startup logs)
2. Custom protocol registration (`local-artwork://`)
3. Database initialization (via `DatabaseFactory` — selects backend, runs migrations)
4. Load providers from DB (`SourceManager`)
5. Register all IPC handlers
6. Background services (live monitoring)
7. Create window + system tray (minimize to tray support via `minimize_to_tray` setting)
8. Set main window reference on services that emit events to renderer

### Cleanup on Quit

```typescript
app.on('before-quit', async (event) => {
  event.preventDefault()
  await getDatabaseService().close()  // Persist DB
  app.exit()
})
```

### Crash Handlers

The app registers `uncaughtException` and `unhandledRejection` handlers that call `getDatabaseService().forceSave()` to persist the in-memory database before crashing. Uncaught exceptions exit the process; unhandled rejections continue running.

### Database Batch Mode

For bulk operations, use batch mode to defer disk writes:
```typescript
const db = getDatabaseService()
db.startBatch()
// ... many upsert operations ...
await db.endBatch()  // Single write to disk
```

### Singleton Services

```typescript
let serviceInstance: ServiceClass | null = null

export function getService(): ServiceClass {
  if (!serviceInstance) {
    serviceInstance = new ServiceClass()
  }
  return serviceInstance
}
```

**Import Rule**: Always use static `import` for singleton getters, never dynamic `require()`. In the Vite/Rollup CJS bundle, a dynamic `require()` may resolve to a different module instance than a static `import`, creating two separate singletons. This caused a bug where `refreshApiKey()` updated one singleton but `isConfigured()` checked another.

### Database Backend Selection

**Location:** `src/main/database/DatabaseFactory.ts`

The app supports two SQLite backends with automatic migration:
- **better-sqlite3** (`BetterSQLiteService`): Native SQLite with WAL mode, used in production for performance. Writes are synchronous and durable by default.
- **SQL.js** (`DatabaseService`): WASM-based in-memory SQLite. Used as fallback and in tests (`USE_SQLJS=true` env var forces this).

`DatabaseFactory` handles backend selection and auto-migration from SQL.js → better-sqlite3 on first run. If migration fails, it falls back to SQL.js. Override with env vars: `USE_SQLJS=true` or `USE_BETTER_SQLITE3=true`.

**Dual-Backend Gotcha**: `DatabaseServiceInterface` uses `[key: string]: any`, so TypeScript does NOT enforce method signature parity between `BetterSQLiteService` and `DatabaseService`. When adding or modifying database methods, manually verify both implementations have identical signatures. A mismatch will silently fail at runtime (e.g., wrong parameters passed positionally).

**NOT NULL DEFAULT '' Columns**: Several tables use `source_id TEXT NOT NULL DEFAULT ''` and `library_id TEXT NOT NULL DEFAULT ''`. When writing upsert methods, use `data.source_id || ''` (empty string), NOT `data.source_id || null`. Passing `null` to a NOT NULL column causes a `SqliteError: NOT NULL constraint failed` at runtime.

**Upsert Return IDs**: Music upsert methods (`upsertMusicAlbum`, `upsertMusicArtist`, `upsertMusicTrack`, `upsertMediaItem`) always look up the ID by unique key after INSERT/UPDATE. Do NOT use `lastInsertRowid` — it returns stale values after `ON CONFLICT DO UPDATE`, causing child records to link to wrong parents.

### Database Persistence (SQL.js only)

When using SQL.js backend, the database is in-memory. `DatabaseService.save()` writes to disk:
- After each write operation (unless in batch mode)
- On `app.before-quit`

better-sqlite3 writes directly to disk (no explicit save needed).

## Common Development Tasks

### Adding a New IPC Handler

1. Add method to service (`src/main/services/ServiceName.ts`)
2. Register handler (`src/main/ipc/servicename.ts`):
   ```typescript
   ipcMain.handle('service:methodName', async (_event, args) => {
     return await getService().methodName(args)
   })
   ```
3. Expose in preload (`src/preload/index.ts`):
   ```typescript
   serviceMethodName: (args) => ipcRenderer.invoke('service:methodName', args)
   ```
4. Add TypeScript type to `ElectronAPI` interface in `src/preload/index.ts`

### Adding a Database Table

1. Update schema in `src/main/database/schema.ts`
2. Add migration in `DatabaseService.runMigrations()` if altering existing schema
3. Add TypeScript types to `src/main/types/database.ts`
4. Add service methods to `DatabaseService` class
5. Register IPC handlers in `src/main/ipc/database.ts`

### Adding a New Provider

1. Implement `MediaProvider` interface in `src/main/providers/NewProvider.ts`
2. Register in `ProviderFactory.ts`
3. Add provider type to `ProviderType` union and `source_type` CHECK constraint in `src/main/database/schema.ts`
4. Add UI authentication flow in `src/renderer/src/components/sources/`

### Adding a React Component

Components in `src/renderer/src/components/` organized by domain: `dashboard/`, `library/`, `sources/`, `settings/`, `ui/`, `onboarding/`, `wishlist/`.

**Library view structure** (`src/renderer/src/components/library/`):
- `MediaBrowser.tsx`: Main container — manages state, data loading, tab switching, and the completeness panel
- `MoviesView.tsx`: Movie/collection grid and list views (extracted view component)
- `TVShowsView.tsx`: TV show/season/episode views (extracted view component)
- `MusicView.tsx`: Artist/album/track views (extracted view component). Album list `itemSize={104}`, track list `itemSize={40}`
- `hooks/`: Custom hooks for library state (`useLibraryState`, `useLibraryDataLoading`, `useLibraryEventListeners`, etc.)

### Theme-Aware Assets

**Location:** `src/renderer/src/assets/`

Logo and animation assets have light and dark variants, switched via `effectiveIsDark` from `ThemeContext`:

| Asset | Dark Theme | Light Theme |
|-------|-----------|-------------|
| Splash animation | `totality_anim.webm` | `totality_anim_black.webm` |
| About modal logo | `logo.png` | `logo_black.png` |
| Splash static logo | `logo.png` | `logo_black.png` |

Components using theme-aware assets:
- **SplashScreen** (`src/renderer/src/components/layout/SplashScreen.tsx`): Animated video + static fallback
- **AboutModal** (`src/renderer/src/components/ui/AboutModal.tsx`): Logo in About tab

### About Modal

**Location:** `src/renderer/src/components/ui/AboutModal.tsx`

Three tabs: About, Credits, Legal. Includes:
- **About**: Key features list, version display, GitHub links
- **Credits**: Data sources (TMDB, MusicBrainz), AI assistant (Google Gemini), media analysis (FFmpeg/FFprobe), open source technologies, external services
- **Legal**: Privacy & data (local storage, API communication, credential encryption, AI features, auto-updates), trademarks (media servers, AI services, retailers, data services), disclaimer (including AI accuracy), MIT license

## External APIs

### Plex API
- Base URL: `https://plex.tv/api/v2`
- Authentication: PIN-based OAuth flow
- Headers: `X-Plex-Client-Identifier`, `X-Plex-Product`, `X-Plex-Token`

### TMDB API
- Base URL: `https://api.themoviedb.org/3`
- Rate limit: 40 requests per second
- Used for: Movie collection detection, TV series metadata, local folder metadata lookup
- Caching: 24-hour in-memory cache for API responses
- Optimizations: `append_to_response` for batch season fetches, series ID caching during scans

### MusicBrainz API
- Base URL: `https://musicbrainz.org/ws/2`
- Rate limit: 1 request per second (strict)
- Used for: Artist discography completeness, album track completeness

### FFprobe (Local Tool)
- **MediaFileAnalyzer** can auto-download FFprobe binaries on Windows
- Uses `adm-zip` for extraction (avoids PowerShell execution policy issues)
- Used by LocalFolderProvider and KodiLocalProvider for file analysis
- Extracts: resolution, codecs, bitrate, HDR format, audio tracks, subtitles
- Bundled path: `%APPDATA%\totality\ffprobe\`

### Local Artwork Protocol
Custom Electron protocol `local-artwork://` for serving local artwork files:
- `local-artwork://file?path=C:\path\to\file.jpg` - Direct file path access
- `local-artwork://albums/123.jpg` - App-cached artwork from `%APPDATA%\totality\artwork\`
- Registered before `app.whenReady()` via `protocol.registerSchemesAsPrivileged()`

## Security

### Credential Encryption

Sensitive credentials are encrypted at rest using Electron's `safeStorage` API, which leverages OS-level encryption:
- **Windows**: DPAPI (Data Protection API)
- **macOS**: Keychain
- **Linux**: libsecret

**Location:** `src/main/services/CredentialEncryptionService.ts`

**Encrypted fields in `connection_config`:**
- `token`, `accessToken`, `apiKey`, `password`, `secret`

**Encrypted settings:**
- `plex_token`, `tmdb_api_key`, `musicbrainz_api_token`, `gemini_api_key`

**How it works:**
1. On database initialization, existing plain-text credentials are automatically migrated to encrypted format
2. `DatabaseService` transparently encrypts credentials when saving and decrypts when reading
3. Encrypted values are prefixed with `ENC:` followed by base64-encoded ciphertext
4. If encryption is unavailable (rare edge cases), credentials fall back to plain text with a warning

**Important:** Encrypted credentials are tied to the OS user account. Moving the database to another machine will require re-entering credentials.

### Electron Security Settings

The application follows Electron security best practices:
- `contextIsolation: true` - Renderer isolated from Node.js
- `nodeIntegration: false` - No direct Node.js access in renderer
- Preload script uses `contextBridge` to expose only specific IPC methods

## Troubleshooting

### Build Errors
- Vite fails on Node modules: Check `external` list in `vite.config.ts`
- Missing types: Ensure `@types/*` installed, check `tsconfig.json` paths

### Database Issues
- Schema errors: Check `runMigrations()` in `DatabaseService.ts`
- Data not persisting: Verify `save()` called after writes
- Corruption: Delete database file and restart
- **NOT NULL constraint failed**: Check if upsert code uses `|| null` for columns defined as `NOT NULL DEFAULT ''` — use `|| ''` instead

### Source Deletion
When a source is deleted via `SourceManager.removeSource()` → `db.deleteMediaSource()`, both backends now clean up all associated data: `media_items`, `quality_scores`, `media_item_versions`, `media_item_collections`, `series_completeness`, `movie_collections`, `library_scans`, `media_sources`, `music_artists`, `music_albums`, `music_tracks`, `music_quality_scores`, `artist_completeness`, `album_completeness`, `wishlist_items`, `notifications`.

### IPC Errors
- "Method not found": Check handler registered in `registerXxxHandlers()`
- Type mismatches: Verify `preload/index.ts` types match handler signatures

### Local Folder Scanning Issues
- **Wrong year extracted**: FileNameParser prefers year in parentheses `(2019)`, then last bare year
- **Extras not filtered**: Check `EXTRAS_FILENAME_PATTERNS` in LocalFolderProvider.ts
- **TMDB not matching**: Verify TMDB API key in settings, check parsed title in logs
- **Missing artwork**: Run completeness analysis on specific source (not "all sources") for artwork updates
- **Numeric titles (e.g., "1917")**: Parser keeps numeric title intact, uses next year as release year

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + F` | Focus search |
| `Escape` | Close modal/panel |
| `G` | Toggle grid view |
| `L` | Toggle list view |

## Testing

Tests are in `tests/unit/`, configured via `vitest.config.ts`. Coverage targets `src/main/**/*.ts` excluding entry point and IPC handlers.

- **Globals enabled**: `describe`, `it`, `expect`, `vi` are available without importing
- **Setup file** (`tests/setup.ts`): Mocks `electron` (app, ipcMain, safeStorage) and `sql.js` globally
- **Environment**: `USE_SQLJS=true` is forced in test env since better-sqlite3 native module doesn't work in Vitest
- **Timeout**: 10 seconds per test
