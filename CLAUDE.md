# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Totality is an Electron desktop application that analyzes media library quality from multiple sources (Plex, Jellyfin, Emby, Kodi, MediaMonkey) and recommends higher-quality versions. Includes tag sync (mood/genre) across sources with bidirectional write support. Built with Electron 41, React 18, TypeScript, Vite 6, and Tailwind CSS 4.

## Development Commands

```bash
npm run electron:dev     # Start Vite + Electron together (recommended for development)
npm run build            # TypeScript compile + Vite build + Electron Builder
npm run lint             # Run ESLint (flat config, eslint.config.js)
npm run preview          # Preview Vite production build
npm run test             # Run Vitest in watch mode
npm run test:run         # Run all tests once
npm run test:coverage    # Run tests with coverage report
npm run test:ui          # Open Vitest interactive UI in browser
npm run generate-icons   # Generate app icons from source
npm run electron:build   # Same as `npm run build` (alias)
```

**Note:** `postinstall` runs `electron-rebuild` automatically after `npm install` to compile native modules (better-sqlite3) for Electron's Node ABI.

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

Services use singleton pattern via `getXxxService()` getter functions (see Singleton Services pattern below). Key services with non-obvious behavior:

- **DatabaseService** (`getDatabaseService()`): Dual SQLite backend — better-sqlite3 (production) or SQL.js (fallback/tests). See Database Backend Selection.
- **SourceManager** (`getSourceManager()`): Orchestrates all provider lifecycles, scanning, connection testing
- **QualityAnalyzer** (`getQualityAnalyzer()`): Tier-based scoring with codec efficiency multipliers
- **GeminiService** (`getGeminiService()`): Sync constructor (async init causes race condition). See AI Chat & Analysis.
- **LoggingService** (`getLoggingService()`): Intercepts console globally, sanitizes sensitive data, verbose mode via `verbose()` method
- **TaskQueueService** (`getTaskQueueService()`): Background task queue — runs quality analysis after music scans

All other services follow the same singleton getter pattern and are discoverable via `grep -r "export function get.*Service"` in `src/main/`.

### Multi-Provider Architecture

**Location:** `src/main/providers/`

The application supports multiple media server providers through a common interface:

- **MediaProvider.ts**: Common interface for all providers (`ProviderType`: plex, jellyfin, emby, kodi, kodi-local, kodi-mysql, local, mediamonkey)
- **ProviderFactory.ts**: Creates provider instances by type
- **PlexProvider.ts**, **JellyfinProvider.ts**, **EmbyProvider.ts**, **KodiProvider.ts**, **KodiLocalProvider.ts**, **KodiMySQLProvider.ts**, **LocalFolderProvider.ts**, **MediaMonkeyProvider.ts**: Provider implementations
- **JellyfinEmbyBase.ts**: Shared base class for Jellyfin/Emby (similar APIs)
- **KodiDatabaseSchema.ts**: Schema mapping for local Kodi SQLite access. `convertKodiPathToLocal()` strips Kodi section prefixes (e.g., `music@smb://` → `smb://`) before converting SMB/NFS URLs to local paths.
- **MediaMonkeyDatabaseSchema.ts**: Schema mapping for MediaMonkey MM4/MM5 SQLite access
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
registerNotificationHandlers()
registerMoodHandlers()
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

Events: `sources:scanProgress`, `quality:analysisProgress`, `series:progress`, `collections:progress`, `music:scanProgress`, `music:qualityProgress`, `music:completenessProgress`, `monitoring:statusChanged`, `taskQueue:updated`, `library:updated`, `logging:entry`, `settings:changed`, `scan:completed`, `ai:toolUse`, `ai:chatStreamDelta`, `ai:chatStreamComplete`, `ai:analysisStreamDelta`, `ai:analysisStreamComplete`, `mood:syncProgress`

**Settings Change Events**: When a setting is updated via `setSetting()`, the main process emits `settings:changed` with `{ key, hasValue }`. Renderer components that depend on settings (e.g., Dashboard, MediaBrowser) listen via `window.electronAPI.onSettingsChanged()` to live-update without requiring a page reload. When reading settings in these handlers, always fetch fresh values from the API rather than relying on React state (which may be stale due to batched updates).

**Exclusion Events**: When exclusions are added/removed (via library dismiss or settings tab), a `CustomEvent('exclusions-changed')` is dispatched on `window`. Dashboard and MediaBrowser listen for this to live-reload completeness data. Dashboard recalculates `completeness_percentage` for artists after filtering out excluded items (same pattern as collections and series).

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

**Exclusions and Completeness Stats**: The `exclusions` table stores items dismissed by the user from completeness results. Completeness panel stats (Missing, Complete, Incomplete counts) are computed **client-side** from filtered data in `MediaBrowser.tsx:loadCompletenessData()` — the raw server stats don't account for exclusions, so stats are recalculated after filtering out excluded items. Dashboard also recalculates `completeness_percentage` for collections, series, and artists after exclusion filtering — artists with all missing items excluded reach 100% and are hidden from the panel.

### Quality Analysis System

**Video Quality Scoring** (`src/main/services/QualityAnalyzer.ts`):
1. Resolution tier: SD (<720p), 720p, 1080p, 4K (≥2160p)
2. Per-tier scoring: bitrate vs configurable medium/high thresholds → 0-100 score
3. At or above high threshold = 100 (no penalty curve beyond target)
4. Codec efficiency multipliers: H.264 (1.0x), HEVC (2.0x), AV1 (2.5x), VP9 (1.8x) — applied to effective bitrate before scoring
5. Audio scoring: same per-tier curve, no codec bonuses — pure bitrate vs threshold
6. Overall score = video × weight + audio × (1 - weight), configurable via `quality_video_weight` setting (default 70%)
7. Quality label (LOW/MEDIUM/HIGH) derived from weighted overall score (≥75=HIGH, ≥50=MEDIUM, <50=LOW)
8. Corrupt audio track detection: tracks with bitrate < channels × 32 kbps are skipped in best-track selection

**Music Quality Tiers**:
- **Ultra**: Lossless (FLAC/ALAC/WAV) with 24-bit+ OR >48kHz sample rate
- **High**: CD-quality lossless (16-bit / 44.1-48kHz)
- **High Lossy**: Lossy ≥256 kbps (recognized as high quality for its format)
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
- **ThemeContext**: Theme selection and persistence (`effectiveIsDark` for light/dark detection). 14 base themes (dark, slate, ember, midnight, oled, velvet, emerald, cobalt, carbon, matrix, fury, gotham, neon, whimsy) with dark/light/system modes. Film-inspired themes (matrix, fury, gotham, neon, whimsy) added in v0.3.1. Theme CSS vars in `src/renderer/src/styles/index.css`, selector UI in `AppearanceTab.tsx`.

**Key Renderer Libraries**:
- **react-window** + **react-virtualized-auto-sizer**: Virtualized lists/grids for large media libraries
- **lucide-react**: Icon library used throughout the UI
- **@dnd-kit**: Drag-and-drop for task queue reordering

### Background Systems

- **TaskQueueService** (`src/main/services/TaskQueueService.ts`): Task types: `library-scan`, `source-scan`, `series-completeness`, `collection-completeness`, `music-completeness`, `music-scan`. Supports pause/resume/cancel/reorder. Emits notifications on completion/failure. `TaskDefinition` supports optional `artistId` for single-artist music completeness analysis (routes through task queue instead of direct IPC call). Deduplicates tasks by `type + sourceId + libraryId` — adding a duplicate returns the existing task ID. `hasActiveTask(type, sourceId?, libraryId?)` allows IPC handlers to check for running/queued tasks before starting direct scans. Queue depth guarded by `MAX_QUEUE_DEPTH = 50` — rejects new tasks beyond limit. `sendLibraryUpdated(type)` accepts `'media'` or `'music'` for correct renderer refresh routing.
- **LiveMonitoringService** (`src/main/services/LiveMonitoringService.ts`): Polls sources on intervals, pauses during manual scans, creates `source_change` notifications. Emits `library:updated` to renderer after detecting changes. Default polling intervals defined in `DEFAULT_MONITORING_CONFIG` (`src/main/types/monitoring.ts`) — must include all `ProviderType` values. `pollingIntervals` type is `Partial<Record<ProviderType, number>>` since not all providers may have intervals configured.
- **Notifications** (`notifications` table): Types: `source_change`, `scan_complete`, `error`, `info`. Emitted from TaskQueueService, LiveMonitoringService, SourceManager, AutoUpdateService. UI in `ActivityPanel.tsx`. Push-based delivery via `notifications:new` IPC event (`src/main/ipc/utils/notificationEmitter.ts`) — ActivityPanel subscribes for real-time updates instead of relying solely on polling.
- **Wishlist**: Auto-fetches TMDB poster on add when `tmdb_id` present but `poster_url` missing (both direct and bulk add paths).

### Tag Sync (Mood/Genre)

**Location:** `src/main/services/MoodSyncService.ts`, `src/main/ipc/mood.ts`, `src/renderer/src/components/mood/MoodSyncPanel.tsx`

Bidirectional sync of mood and genre tags across Plex, MediaMonkey, and Kodi. User selects a source of truth, compares tags across sources, and pushes corrections.

- **MoodSyncService**: Compares tag fields across sources. Track matching by MusicBrainz ID (primary) or title+artist (fallback). Supports `SyncField` type (`'mood' | 'genre'`). Tag comparison is case-insensitive (`tagsMatch` normalizes to lowercase).
- **Write targets**: Plex (HTTP PUT API with `mood[i].tag.tag` params), MediaMonkey (SQLite write with FTS/IUNICODE handling), Kodi (SQLite write to `song.mood` or `song_genre` junction table). All database writes include backup, running-app detection, and confirmation dialog.
- **Tag Sync Panel**: Slide-out panel from TopBar (Tags icon). 4-step flow: Source of Truth → Fields (checkboxes) → Mode (Overwrite/Append) → Sync Targets. Dual-field comparison with inline diff highlighting. Per-track selective sync.
- **Plex mood/genre READ**: Uses per-tag-category approach (`/library/sections/{id}/mood?type=10` then `/all?type=10&mood={id}`) since bulk JSON endpoint strips tag data.
- **MediaMonkey IUNICODE collation**: sql.js can't register custom collations. Fix: replace IUNICODE→NOCASE in sqlite_master, export buffer, reimport. For writes, also handle FTS `mm` tokenizer by removing SongsText entries before export, restoring original schemas before saving.
- **MediaMonkey mood dedup**: `convertToMusicTrack()` merges moods from junction table (Lists/ListsSongs) and Songs.Mood column with case-insensitive deduplication, preferring column values (which carry the synced casing).
- **Supported providers for tag sync**: Plex, MediaMonkey, Kodi, Kodi-Local (controlled by `TAG_SYNC_PROVIDERS` set in MoodSyncService)

### MediaMonkey Provider

**Location:** `src/main/providers/mediamonkey/`

- **MediaMonkeyProvider.ts**: Read-only scan of MM4 (MM.DB) / MM5 (MM5.DB) SQLite databases. Music-only provider.
- **MediaMonkeyDatabaseSchema.ts**: Types and SQL queries for Songs, Albums, Artists, Lists/ListsSongs (moods), Genres/GenresSongs, Covers tables.
- **MediaMonkeyDiscoveryService.ts**: Auto-detects MM4/MM5 at `%APPDATA%\MediaMonkey\` and `%APPDATA%\MediaMonkey5\`.
- **MM5 column names**: `SamplingFrequency` (not SampleRate), `BPS` (not BitsPerSample), `Stereo` (not Channels), `TrackNumber`/`DiscNumber` are TEXT ("3/12" format).
- **Mood storage**: `Songs.Mood` column (semicolon-separated) AND `Lists` table (`IDListType=2`, `TextData` column) + `ListsSongs` junction. Comma-separated values must be split for Plex compatibility.

### Deletion Cleanup

When items are deleted from a source and a rescan runs, cleanup is centralized in the database methods (not in individual providers):

- **`deleteMediaItem()`**: Wrapped in SQLite transaction. For episodes: recounts `owned_episodes`/`owned_seasons`, updates `missing_episodes`/`missing_seasons` JSON (adds deleted episode to missing list), backdates `updated_at` to force re-analysis. For movies: updates `movie_collections` (removes TMDB ID from `owned_movie_ids`, adds to `missing_movies` JSON). Deletes associated versions, quality_scores, collections.
- **`deleteMusicTrack()`**: Wrapped in transaction. Removes orphaned albums (0 tracks) and artists (0 tracks). Updates album `track_count` and artist `track_count`/`album_count`. When tracks are deleted: updates `album_completeness.missing_tracks` JSON. When albums become empty: adds album to `artist_completeness.missing_albums` JSON, updates owned counts.
- **`cleanupOrphanedMediaData()`**: Belt-and-suspenders sweep after every scan. Validates collection ownership against actual media_items, updates series_completeness counts, removes orphaned music data.
- **Safety guard**: `removeStaleItems()` refuses bulk deletion when Plex returns 0 IDs but DB has items (prevents API failure from wiping library).

### Auto-Completeness After Scans

After any scan (manual rescan or live monitoring) that adds, updates, or removes items, completeness analysis is automatically triggered:

- **TV Shows**: `autoAnalyzeAffectedSeries()` — finds series with changed episode counts, runs `analyzeSeries()` for each via TMDB. Removes completeness records for fully deleted series. Runs directly (not queued) for fast targeted updates.
- **Movies**: Queues a scoped `collection-completeness` task for the affected library.
- **Music**: `autoRunMusicQualityAnalysis()` runs quality analysis, then `syncArtistCompletenessAfterScan()` and `syncAlbumCompletenessAfterScan()` update completeness cache by comparing actual owned items against `missing_*` JSON lists (no MusicBrainz API calls needed).
- **Live monitoring music**: Lightweight count check via `getMusicTrackCount()` (single Plex API call with `Container-Size=0`) before triggering expensive full music scan. Only scans if track count differs from DB.
- **Plex full scan counting**: `scanLibrary()` tracks `itemsAdded`/`itemsUpdated` by comparing against pre-scan `existingPlexIds` Set. `scanMusicLibrary()` similarly tracks via `existingTrackIds`. Previously both reported 0 for these fields.

### Dashboard & Library Live Refresh

- **Dashboard** reloads via `loadDashboardData()` which makes 6 parallel `Promise.allSettled` IPC calls (movie upgrades, TV upgrades, music upgrades, collections, series, artist completeness). Debounced (300ms). Triggers: `scan:completed`, `library:updated` (all types), `exclusions-changed`, `settings:changed`, `activeSourceId` change.
- **Library view** (`useLibraryEventListeners`) reloads on `library:updated` events: `type: 'media'` → `loadMedia()` + `loadCompletenessData()`; `type: 'music'` → `loadMusicData()` + `loadMusicCompletenessData()`. Also reloads on `scan:completed` when items changed. Debounced (500ms).
- **`loadMusicData()`** reloads stats, paginated artists, paginated albums, and refreshes `selectedArtist` to update track/album counts in subtitle.
- **`sendLibraryUpdated(type)`** in TaskQueueService accepts `'media'` or `'music'` type to route refresh correctly. Music completeness tasks emit `'music'` type.
- Disabled libraries filtered at DB level via `library_scans.is_enabled` JOIN on all completeness/upgrade queries (including `getSeriesCompleteness`, `getMovieCollections`, `getLibraryStats`, `getSeriesCompletenessStats`, `getMovieCollectionStats`).
- **Sort persistence**: `loadDashboardData` applies the persisted sort preference when setting data (not just via useEffect). This prevents stale sort order when the preference hasn't changed between reloads (React skips no-op `setState`, so the sort useEffect wouldn't re-fire).
- **Expanded row heights**: `VariableSizeList` row heights for expandable artists/collections/series use constants (`EXPANDED_ITEM_HEIGHT = 44`, `EXPANDED_BOTTOM_PAD = 8`) that must match actual CSS rendering. Mismatch causes content cutoff.

### Preference Persistence

Preferences persisted via `setSetting`/`getSetting`:
- `dashboard_upgrade_sort`, `dashboard_collection_sort`, `dashboard_series_sort`, `dashboard_artist_sort`
- `library_view_prefs` — JSON object storing per-tab `viewType` and `gridScale`
- `quality_video_weight` — video/audio score weighting (default 70%)

### Logging & Diagnostics

**Location:** `src/main/services/LoggingService.ts`

- In-memory circular buffer (2000 info + 500 important entries), intercepts `console.*` globally
- Sanitizes sensitive data (tokens, passwords, API keys) from log output
- **Verbose mode**: `getLoggingService().verbose(source, message, details?)` — persisted to DB (`verbose_logging_enabled`), zero overhead when disabled
- **File logging**: Daily rotation to `%APPDATA%\totality\logs\`, configurable min level and retention. Settings: `file_logging_enabled`, `file_logging_min_level`, `log_retention_days`

### AI Chat & Analysis (Gemini)

**Model:** Google Gemini `gemini-2.5-flash` via `@google/genai` SDK (free tier: 10 RPM, 250 RPD)

**Architecture:**
- **GeminiService** (`src/main/services/GeminiService.ts`): Sync constructor reads API key from DB (async causes race condition). `sendMessageWithTools()` runs agentic tool-use loop (max 10 rounds).
- **GeminiTools** (`src/main/services/GeminiTools.ts`): 21 tool definitions + `executeTool()` dispatcher for library queries, TMDB search, wishlist management.
- **GeminiAnalysisService** (`src/main/services/GeminiAnalysisService.ts`): 4 streaming report generators. Gathers data upfront (not agentic).
- **System Prompts** (`src/main/services/ai-system-prompts.ts`): Chat prompt has film/TV/music enthusiast personality.

**Critical Gotchas:**
- `.text` and `.functionCalls` are **getter properties**, NOT methods — don't use `()`
- Rate limit errors must be **returned** (not thrown) from IPC handlers — thrown errors lose custom properties during Electron IPC serialization
- Rate limit detection: checks both HTTP 429 and `RESOURCE_EXHAUSTED`. SDK auto-retries 429s up to 2 times before throwing.
- API key stored encrypted (`gemini_api_key`), refreshed on `settings:changed` event
- View context injected as `[Viewing: movies library]` prefix into last user message before sending to Gemini
- Chat history bounded to 20 messages; `compact()` strips null/undefined from tool responses

## Code Style

- No semicolons, single quotes, 2-space indent, trailing commas (es5), 100-char line width, `arrowParens: "always"`
- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters` — prefix unused parameters with `_` (ESLint `argsIgnorePattern: '^_'`)
- `@typescript-eslint/no-explicit-any` is `warn` — avoid `any` but it won't block builds
- ESLint 9 flat config (`eslint.config.js`), `typescript-eslint` v8 (unified package), `@typescript-eslint/no-require-imports` and `@typescript-eslint/no-unused-expressions` are off, `caughtErrors: 'none'` on no-unused-vars
- IPC handlers validate inputs with **Zod v4** schemas (`src/main/validation/schemas.ts`) using `validateInput(schema, input, 'context')` — note Zod v4 has different APIs from v3 (e.g., `z.object()` methods differ)
- **Zod v4 `z.record(enum, value)` gotcha**: Unlike v3, Zod v4 treats enum-keyed records as requiring ALL enum keys. For partial records (e.g., `pollingIntervals` where only some providers are configured), use `z.record(enum, value.optional())` so missing keys pass validation as `undefined`

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

Batch mode is reentrant (depth-counted) — nested `startBatch()`/`endBatch()` calls are safe. Only the outermost `endBatch()` flushes to disk.

### Shared Utilities

- **`MusicQualityAnalyzer`** (`src/main/services/MusicQualityAnalyzer.ts`): `analyzeAlbumQuality(db, sourceId?, onProgress?)` — extracted from 3 duplicate locations. Handles batch mode internally.
- **`getArtistAlbumsCombined`** (`src/main/services/utils/musicUtils.ts`): Combines albums by FK (`artistId`) and name (`artistName`) with deduplication. Extracted from 3 duplicate locations.
- **Quality colors** (`src/renderer/src/utils/qualityColors.ts`): `getQualityLevelColors()`, `getResolutionColors()`, `getMusicTierLabel()` — shared across MediaDetails, WishlistItemCard.
- **Settings constants** (`src/shared/settingKeys.ts`): `SETTING_KEYS` const object with all known setting keys. Used across renderer files to avoid bare string literals.

### Scan Concurrency Guards

Direct IPC scan handlers (`music:scanLibrary`, `series:analyzeAll`, `collections:analyzeAll`) check `TaskQueueService.hasActiveTask()` before executing. If a task of the same type is already running/queued, the handler throws an error. This prevents concurrent writes to shared tables.

### Exclusion Event Dispatch

When items are dismissed or un-dismissed in the Library view (`useDismissHandlers.ts`), the `exclusions-changed` CustomEvent is dispatched after each `addExclusion()`/`removeExclusion()` call. This triggers Dashboard and MediaBrowser to recalculate completeness data.

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

**Dual-Backend Gotcha**: `DatabaseServiceInterface` uses `[key: string]: any`, so TypeScript does NOT enforce method signature parity between `BetterSQLiteService` and `DatabaseService`. When adding or modifying database methods, manually verify both implementations have identical signatures. A mismatch will silently fail at runtime (e.g., wrong parameters passed positionally). Both backends now enforce `PRAGMA foreign_keys = ON` and protect `user_fixed_match` records in upsert ON CONFLICT clauses.

**NOT NULL DEFAULT '' Columns**: Several tables use `source_id TEXT NOT NULL DEFAULT ''` and `library_id TEXT NOT NULL DEFAULT ''`. When writing upsert methods, use `data.source_id || ''` (empty string), NOT `data.source_id || null`. Passing `null` to a NOT NULL column causes a `SqliteError: NOT NULL constraint failed` at runtime.

**Upsert Return IDs**: Music upsert methods (`upsertMusicAlbum`, `upsertMusicArtist`, `upsertMusicTrack`, `upsertMediaItem`) always look up the ID by unique key after INSERT/UPDATE. Do NOT use `lastInsertRowid` — it returns stale values after `ON CONFLICT DO UPDATE`, causing child records to link to wrong parents.

**Music Album Queries**: `getMusicAlbums` supports both `artistId` (FK) and `artistName` (string) filters. When both are provided, it uses `OR` logic (`artist_id = ? OR artist_name = ?`) to catch albums with mismatched FKs — matching how the completeness handler in `music.ts` finds owned albums. Always pass both when querying albums for a specific artist.

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
3. Add provider type to `ProviderType` union in `src/main/providers/base/MediaProvider.ts`, `src/main/types/database.ts`, `src/renderer/src/contexts/SourceContext.tsx`
4. Add to `source_type` CHECK constraint in `src/main/database/schema.ts` (requires table recreation migration for existing databases — see MediaMonkey CHECK migration pattern)
5. Add to `ProviderTypeSchema` in `src/main/validation/schemas.ts`
6. Add UI connection flow in `src/renderer/src/components/sources/` and register in `AddSourceModal.tsx`
7. Add provider color to `providerColors` maps in `Sidebar.tsx`, `SourceCard.tsx`, `mediaUtils.ts`
8. If supporting tag sync, add to `TAG_SYNC_PROVIDERS` set in `MoodSyncService.ts`

### Adding a React Component

Components in `src/renderer/src/components/` organized by domain: `dashboard/`, `library/`, `sources/`, `settings/`, `ui/`, `onboarding/`, `wishlist/`.

**Library view structure** (`src/renderer/src/components/library/`):
- `MediaBrowser.tsx`: Main container — manages state, data loading, tab switching, and the completeness panel
- `MoviesView.tsx`: Movie/collection grid and list views (extracted view component)
- `TVShowsView.tsx`: TV show/season/episode views (extracted view component)
- `MusicView.tsx`: Artist/album/track views (extracted view component). Album list `itemSize={104}`, track list `itemSize={40}`
- `hooks/`: Custom hooks for library state (`useLibraryState`, `useLibraryDataLoading`, `useLibraryEventListeners`, etc.)

**Alphabet Navigation**: The A-Z sidebar in library views uses `alphabetFilter` passed to backend queries (server-side filtering via `WHERE UPPER(SUBSTR(title, 1, 1)) = ?`). For collections-only view (all items in DOM), it uses DOM-based `scrollIntoView()` jump-to instead. The `getLetterOffset` IPC is no longer used by `scrollToLetter`.

**Collections Display**: `MoviesView.tsx` uses append-aware `displayItems` logic to prevent scroll mixing during infinite scroll pagination. When `collectionsOnly` is true, all collections render at once (no pagination). When false, new pages are appended without re-sorting existing items.

## External APIs & Rate Limits

- **TMDB**: 40 req/s, 24-hour in-memory cache, `append_to_response` for batch season fetches
- **MusicBrainz**: 1 req/s (strict), used for artist/album completeness
- **Plex**: PIN-based OAuth, requires `X-Plex-Client-Identifier` / `X-Plex-Product` / `X-Plex-Token` headers
- **FFprobe**: Auto-downloads on Windows via `adm-zip` (not PowerShell — avoids execution policy issues). Path: `%APPDATA%\totality\ffprobe\`
- **Local Artwork Protocol**: `local-artwork://file?path=...` or `local-artwork://albums/123.jpg`, registered before `app.whenReady()`

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
When a source is deleted via `SourceManager.removeSource()` → `db.deleteMediaSource()`, both backends clean up all associated data. **Important**: Wishlist cleanup runs BEFORE `deleteMediaItemsForSource()` since the subquery needs `media_items` to still exist. Tables cleaned: `wishlist_items`, `media_items`, `quality_scores`, `media_item_versions`, `media_item_collections`, `series_completeness`, `movie_collections`, `library_scans`, `media_sources`, `music_artists`, `music_albums`, `music_tracks`, `music_quality_scores`, `artist_completeness`, `album_completeness`, `notifications`.

### IPC Errors
- "Method not found": Check handler registered in `registerXxxHandlers()`
- Type mismatches: Verify `preload/index.ts` types match handler signatures

### Local Folder Scanning Issues
- **Wrong year extracted**: FileNameParser prefers year in parentheses `(2019)`, then last bare year
- **Extras not filtered**: Check `EXTRAS_FILENAME_PATTERNS` in LocalFolderProvider.ts
- **TMDB not matching**: Verify TMDB API key in settings, check parsed title in logs
- **Missing artwork**: Run completeness analysis on specific source (not "all sources") for artwork updates
- **Numeric titles (e.g., "1917")**: Parser keeps numeric title intact, uses next year as release year

## Testing

Tests are in `tests/unit/`, configured via `vitest.config.ts`. Coverage targets `src/main/**/*.ts` excluding entry point and IPC handlers.

- **Globals enabled**: `describe`, `it`, `expect`, `vi` are available without importing
- **Setup file** (`tests/setup.ts`): Mocks `electron` (app, ipcMain, safeStorage) and `sql.js` globally
- **Environment**: `USE_SQLJS=true` is forced in test env since better-sqlite3 native module doesn't work in Vitest
- **Timeout**: 10 seconds per test
