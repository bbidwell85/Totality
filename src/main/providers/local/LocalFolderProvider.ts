import { getErrorMessage } from '../../services/utils/errorUtils'
/**
 * LocalFolderProvider
 *
 * Implements the MediaProvider interface for scanning local folders.
 * Uses FFprobe for file analysis and TMDB for metadata.
 */

import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getMediaFileAnalyzer, type FileAnalysisResult, type AnalyzedAudioStream } from '../../services/MediaFileAnalyzer'
import { getFileNameParser, ParsedMovieInfo, ParsedEpisodeInfo } from '../../services/FileNameParser'
import { getTMDBService } from '../../services/TMDBService'
import { getMusicBrainzService } from '../../services/MusicBrainzService'
import { normalizeVideoCodec, normalizeResolution, normalizeAudioCodec } from '../../services/MediaNormalizer'
import type {
  MediaProvider,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  ProgressCallback,
  SourceConfig,
  ProviderType,
  AudioStreamInfo,
} from '../base/MediaProvider'
import type { MediaItem, MediaItemVersion, AudioTrack } from '../../types/database'
import { extractVersionNames } from '../utils/VersionNaming'

export interface LocalFolderConfig {
  folderPath: string
  mediaType: 'movies' | 'tvshows' | 'music' | 'mixed'
  name?: string
  // Custom library configurations from user selection
  customLibraries?: Array<{
    name: string
    path: string
    mediaType: 'movies' | 'tvshows' | 'music'
    enabled: boolean
  }>
}

// Minimum duration in seconds for movies (45 minutes)
// This filters out featurettes, behind-the-scenes, trailers, etc.
const MIN_MOVIE_DURATION_SECONDS = 45 * 60 // 2700 seconds

// Patterns to detect extras/featurettes in filenames (not just folders)
const EXTRAS_FILENAME_PATTERNS = [
  /\b(featurette|featurettes)\b/i,
  /\bbehind[.\-_ ]?the[.\-_ ]?scenes?\b/i,
  /\bdeleted[.\-_ ]?scenes?\b/i,
  /\bgag[.\-_ ]?reel\b/i,
  /\bbloopers?\b/i,
  /\binterview(s|ed)?\b/i,
  /\bmaking[.\-_ ]?of\b/i,
  /\bshort[.\-_ ]?film\b/i,
  /\b(trailer|teaser)\b/i,
  /\bpromo(s)?\b/i,
  /\bcommentary\b/i,
  /\bbonus[.\-_ ]?(content|feature)?\b/i,
  /\bextras?\b/i,
  /\bbts\b/i, // Behind The Scenes abbreviation
  /\bouttakes?\b/i,
  /\bscene[.\-_ ]?\d+\b/i, // Scene 1, Scene-2, etc. (individual scenes)
  // Alternate versions and cuts
  /\balternate[.\-_ ]?(opening|ending|cut|version|take|scene)?\b/i,
  /\bextended[.\-_ ]?(cut|scene|version)?\b/i,
  // Scene suffix (catches "-scene" at end of filename)
  /[.\-_ ]scene$/i,
  // Credits
  /\b(opening|closing)[.\-_ ]?credits?\b/i,
]

/**
 * Check if a filename indicates extras/bonus content rather than main feature
 */
function isExtrasContent(filename: string): boolean {
  const lowerFilename = filename.toLowerCase()

  // Check for sample files
  if (lowerFilename.includes('sample')) {
    return true
  }

  // Check against extras patterns
  for (const pattern of EXTRAS_FILENAME_PATTERNS) {
    if (pattern.test(lowerFilename)) {
      return true
    }
  }

  return false
}

export class LocalFolderProvider implements MediaProvider {
  readonly providerType: ProviderType = 'local' as ProviderType
  readonly sourceId: string

  private folderPath: string = ''
  private mediaType: 'movies' | 'tvshows' | 'music' | 'mixed' = 'mixed'
  private displayName: string = ''
  private customLibraries: LocalFolderConfig['customLibraries'] = undefined

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || this.generateSourceId()

    // Load from connection config if provided
    if (config.connectionConfig) {
      const connConfig = config.connectionConfig as LocalFolderConfig
      this.folderPath = connConfig.folderPath || ''
      this.mediaType = connConfig.mediaType || 'mixed'
      this.displayName = connConfig.name || path.basename(this.folderPath) || 'Local Folder'
      this.customLibraries = connConfig.customLibraries
    }
  }

  private generateSourceId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      const config = credentials as LocalFolderConfig

      if (!config.folderPath) {
        return {
          success: false,
          error: 'Folder path is required',
        }
      }

      // Check if folder exists
      if (!fs.existsSync(config.folderPath)) {
        return {
          success: false,
          error: `Folder not found: ${config.folderPath}`,
        }
      }

      // Check if it's a directory
      const stats = fs.statSync(config.folderPath)
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: 'Path is not a directory',
        }
      }

      this.folderPath = config.folderPath
      this.mediaType = config.mediaType || 'mixed'
      this.displayName = config.name || path.basename(this.folderPath)

      return {
        success: true,
        serverName: this.displayName,
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.folderPath && fs.existsSync(this.folderPath)
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close
  }

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.folderPath) {
      return { success: false, error: 'Folder path not configured' }
    }

    if (!fs.existsSync(this.folderPath)) {
      return { success: false, error: 'Folder not found' }
    }

    const startTime = Date.now()

    try {
      // Count media files asynchronously to avoid blocking UI
      const parser = getFileNameParser()
      let mediaFileCount = 0
      let directoriesProcessed = 0

      const countFiles = async (dir: string, depth = 0): Promise<void> => {
        if (depth > 10) return // Prevent infinite recursion

        try {
          const entries = await fs.promises.readdir(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory()) {
              await countFiles(path.join(dir, entry.name), depth + 1)
            } else if (parser.isMediaFile(entry.name)) {
              mediaFileCount++
            }
          }

          // Yield to event loop periodically to prevent UI blocking
          directoriesProcessed++
          if (directoriesProcessed % 50 === 0) {
            await new Promise(resolve => setImmediate(resolve))
          }
        } catch {
          // Skip inaccessible directories
        }
      }

      await countFiles(this.folderPath)

      return {
        success: true,
        serverName: `${this.displayName} (${mediaFileCount} media files)`,
        serverVersion: 'Local Folder',
        latencyMs: Date.now() - startTime,
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Connection test failed',
      }
    }
  }

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  // Known folder names for auto-detection in mixed mode
  private static readonly MOVIE_FOLDER_NAMES = ['movies', 'films', 'movie', 'film']
  private static readonly TVSHOW_FOLDER_NAMES = ['tv shows', 'tv', 'shows', 'series', 'television', 'tvshows']
  private static readonly MUSIC_FOLDER_NAMES = ['music', 'audio', 'songs', 'albums', 'artists']

  async getLibraries(): Promise<MediaLibrary[]> {
    if (!this.folderPath || !fs.existsSync(this.folderPath)) {
      return []
    }

    const libraries: MediaLibrary[] = []

    // If custom libraries are configured, use those instead of auto-detection
    if (this.customLibraries && this.customLibraries.length > 0) {
      for (const lib of this.customLibraries) {
        if (!lib.enabled) continue

        // Map mediaType to library type
        const libType: 'movie' | 'show' | 'music' = lib.mediaType === 'movies' ? 'movie' :
          lib.mediaType === 'tvshows' ? 'show' : 'music'

        libraries.push({
          id: `${lib.mediaType}:${lib.name}`,
          name: lib.name,
          type: libType,
        })
      }

      return libraries
    }

    // For "mixed" mode, auto-detect subfolders by name
    if (this.mediaType === 'mixed') {
      try {
        const entries = await fs.promises.readdir(this.folderPath, { withFileTypes: true })

        for (const entry of entries) {
          if (!entry.isDirectory()) continue

          const folderNameLower = entry.name.toLowerCase()

          // Check for movie folders
          if (LocalFolderProvider.MOVIE_FOLDER_NAMES.includes(folderNameLower)) {
            libraries.push({
              id: `movies:${entry.name}`,
              name: entry.name,
              type: 'movie',
            })
          }
          // Check for TV show folders
          else if (LocalFolderProvider.TVSHOW_FOLDER_NAMES.includes(folderNameLower)) {
            libraries.push({
              id: `tvshows:${entry.name}`,
              name: entry.name,
              type: 'show',
            })
          }
          // Check for music folders
          else if (LocalFolderProvider.MUSIC_FOLDER_NAMES.includes(folderNameLower)) {
            libraries.push({
              id: `music:${entry.name}`,
              name: entry.name,
              type: 'music',
            })
          }
        }

        // If no known folders found, fall back to scanning root as movies
        if (libraries.length === 0) {
          libraries.push({
            id: 'movies',
            name: 'Movies',
            type: 'movie',
          })
        }
      } catch (error) {
        console.warn('[LocalFolderProvider] Failed to scan for subfolders:', error)
        // Fall back to movies
        libraries.push({
          id: 'movies',
          name: 'Movies',
          type: 'movie',
        })
      }

      return libraries
    }

    if (this.mediaType === 'movies') {
      libraries.push({
        id: 'movies',
        name: 'Movies',
        type: 'movie',
      })
    }

    if (this.mediaType === 'tvshows') {
      libraries.push({
        id: 'tvshows',
        name: 'TV Shows',
        type: 'show',
      })
    }

    if (this.mediaType === 'music') {
      libraries.push({
        id: 'music',
        name: 'Music',
        type: 'music',
      })
    }

    return libraries
  }

  async getLibraryItems(_libraryId: string): Promise<MediaMetadata[]> {
    // This would return all items, but we'll handle this in scanLibrary instead
    // for better progress reporting
    return []
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    const db = getDatabase()
    const items = db.getMediaItems({ sourceId: this.sourceId }) as MediaItem[]
    const mediaItem = items.find((item: MediaItem) => item.plex_id === itemId)

    if (mediaItem) {
      return this.convertMediaItemToMetadata(mediaItem)
    }

    throw new Error(`Item not found: ${itemId}. Run a library scan first.`)
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress, sinceTimestamp, forceFullScan, targetFiles } = options || {}

    // If targetFiles provided, use targeted scanning (much faster)
    if (targetFiles && targetFiles.length > 0) {
      console.log(`[LocalFolderProvider ${this.sourceId}] Targeted scan for ${targetFiles.length} files`)
      return this.scanTargetedFiles(libraryId, targetFiles, onProgress)
    }

    // Determine if this is an incremental scan
    const isIncremental = !!sinceTimestamp && !forceFullScan
    if (isIncremental) {
      console.log(`[LocalFolderProvider ${this.sourceId}] Incremental scan since ${sinceTimestamp.toISOString()}`)
    }

    // Parse library ID - format can be "type" or "type:subfolder"
    const [libraryType, subfolderName] = libraryId.includes(':')
      ? libraryId.split(':', 2)
      : [libraryId, null]

    // Determine the actual scan path
    // First check if this is a custom library with an explicit path
    let scanPath: string
    if (this.customLibraries && subfolderName) {
      const customLib = this.customLibraries.find(lib => lib.name === subfolderName)
      if (customLib) {
        scanPath = customLib.path
      } else {
        scanPath = path.join(this.folderPath, subfolderName)
      }
    } else if (subfolderName) {
      scanPath = path.join(this.folderPath, subfolderName)
    } else {
      scanPath = this.folderPath
    }

    // Handle music library separately
    if (libraryType === 'music') {
      return this.scanMusicLibrary(onProgress, scanPath)
    }

    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    if (!scanPath || !fs.existsSync(scanPath)) {
      result.errors.push('Folder not found or not configured')
      result.durationMs = Date.now() - startTime
      return result
    }

    try {
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      const fileAnalyzer = getMediaFileAnalyzer()
      const parser = getFileNameParser()
      const tmdb = getTMDBService()

      await analyzer.loadThresholdsFromDatabase()

      // Check both FFprobe availability AND user setting (default to enabled if not set)
      const ffprobeEnabled = db.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && await fileAnalyzer.isAvailable()
      const tmdbConfigured = await this.isTMDBConfigured()

      // Parallel FFprobe settings
      const ffprobeParallelEnabled = db.getSetting('ffprobe_parallel_enabled') !== 'false'
      const ffprobeBatchSize = parseInt(db.getSetting('ffprobe_batch_size') || '25', 10)

      const scannedFilePaths = new Set<string>()
      const scanType = libraryType === 'movies' ? 'movie' : 'episode'

      // Phase 1: Discover all media files
      console.log(`[LocalFolderProvider ${this.sourceId}] Starting scan, onProgress defined: ${!!onProgress}`)
      onProgress?.({
        current: 0,
        total: 100,
        phase: 'fetching',
        currentItem: 'Scanning folder structure...',
        percentage: 0,
      })

      const mediaFiles = await this.discoverMediaFiles(scanPath, scanType, onProgress, isIncremental ? sinceTimestamp : undefined)
      const totalFiles = mediaFiles.length

      console.log(`[LocalFolderProvider ${this.sourceId}] Found ${totalFiles} ${scanType} files`)

      if (totalFiles === 0) {
        result.success = true
        result.durationMs = Date.now() - startTime
        return result
      }

      // Phase 2: Process each file
      db.startBatch()

      // Cache for series TMDB lookups - avoids searching for same series 50+ times
      const seriesTmdbCache = new Map<string, { tmdbId: number; name: string; posterPath?: string; seasonPosters: Map<number, string | null> } | null>()

      // Cache for movie TMDB lookups - avoids redundant searches for same movie
      const movieTmdbCache = new Map<string, { tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null>()

      // Structure to hold pre-processed file info for batch FFprobe
      interface FileToProcess {
        filePath: string
        relativePath: string
        fileMtime: number
        parsed: ParsedMovieInfo | ParsedEpisodeInfo
        metadata: MediaMetadata
      }

      // Collected processed items for grouping before DB save
      interface ProcessedItem {
        metadata: MediaMetadata
        parsed: ParsedMovieInfo | ParsedEpisodeInfo
        fileMtime: number
      }
      const processedItems: ProcessedItem[] = []

      try {
        // Process in batches for parallel FFprobe analysis
        const useParallelFFprobe = ffprobeAvailable && ffprobeParallelEnabled && ffprobeBatchSize > 1
        console.log(`[LocalFolderProvider ${this.sourceId}] Using ${useParallelFFprobe ? 'parallel' : 'sequential'} FFprobe (batch size: ${ffprobeBatchSize})`)

        for (let batchStart = 0; batchStart < mediaFiles.length; batchStart += ffprobeBatchSize) {
          const batchEnd = Math.min(batchStart + ffprobeBatchSize, mediaFiles.length)
          const batchFiles = mediaFiles.slice(batchStart, batchEnd)

          // Phase 2a: Pre-process batch (mtime check, parsing, TMDB lookup)
          const filesToProcess: FileToProcess[] = []
          const filesToAnalyze: string[] = []

          for (let i = 0; i < batchFiles.length; i++) {
            const globalIndex = batchStart + i
            const { filePath, relativePath } = batchFiles[i]

            onProgress?.({
              current: globalIndex + 1,
              total: totalFiles,
              phase: 'processing',
              currentItem: path.basename(filePath),
              percentage: ((globalIndex + 1) / totalFiles) * 100,
            })

            try {
              // Check if file is unchanged (skip expensive re-analysis)
              const stat = await fsPromises.stat(filePath)
              const fileMtime = stat.mtime.getTime()
              const existingItem = db.getMediaItemByPath(filePath)

              if (existingItem?.file_mtime === fileMtime) {
                // File unchanged, mark as present and skip processing
                scannedFilePaths.add(filePath)
                result.itemsScanned++
                continue
              }

              // Parse filename
              const folderContext = path.dirname(relativePath)
              const parsed = parser.parse(path.basename(filePath), folderContext)

              if (!parsed || (scanType === 'movie' && parsed.type !== 'movie') ||
                  (scanType === 'episode' && parsed.type !== 'episode')) {
                continue
              }

              // Create base metadata (includes TMDB lookup)
              let metadata: MediaMetadata

              if (parsed.type === 'movie') {
                const movieInfo = parsed as ParsedMovieInfo
                metadata = await this.createMovieMetadata(filePath, movieInfo, tmdbConfigured, tmdb, movieTmdbCache)
              } else {
                const episodeInfo = parsed as ParsedEpisodeInfo
                metadata = await this.createEpisodeMetadata(filePath, episodeInfo, tmdbConfigured, tmdb, seriesTmdbCache)
              }

              // Collect file for processing
              filesToProcess.push({ filePath, relativePath, fileMtime, parsed: parsed as ParsedMovieInfo | ParsedEpisodeInfo, metadata })

              // Collect file for FFprobe analysis if enabled
              if (ffprobeAvailable) {
                filesToAnalyze.push(filePath)
              }
            } catch (error: unknown) {
              result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`)
            }
          }

          // Phase 2b: Batch FFprobe analysis
          let ffprobeResults = new Map<string, import('../../services/MediaFileAnalyzer').FileAnalysisResult>()

          if (filesToAnalyze.length > 0) {
            onProgress?.({
              current: batchEnd,
              total: totalFiles,
              phase: 'analyzing',
              currentItem: `Analyzing ${filesToAnalyze.length} files...`,
              percentage: (batchEnd / totalFiles) * 100,
            })

            if (useParallelFFprobe) {
              // Parallel analysis using worker pool
              ffprobeResults = await fileAnalyzer.analyzeFilesParallel(filesToAnalyze)
            } else {
              // Sequential analysis (fallback)
              for (const fp of filesToAnalyze) {
                const analysis = await fileAnalyzer.analyzeFile(fp)
                ffprobeResults.set(fp, analysis)
              }
            }
          }

          // Phase 2c: Apply FFprobe results and collect for grouping
          for (const fileInfo of filesToProcess) {
            const { filePath, fileMtime, parsed } = fileInfo
            let { metadata } = fileInfo

            try {
              // Apply FFprobe data if available
              const analysis = ffprobeResults.get(filePath)
              if (analysis?.success) {
                metadata = this.enhanceWithFFprobeData(metadata, analysis)

                // Filter out short videos for movies (featurettes, behind-the-scenes, etc.)
                if (scanType === 'movie' && analysis.duration && analysis.duration < MIN_MOVIE_DURATION_SECONDS) {
                  console.log(`[LocalFolderProvider ${this.sourceId}] Skipping short video (${Math.round(analysis.duration / 60)}min): ${path.basename(filePath)}`)
                  continue
                }
              }

              processedItems.push({ metadata, parsed, fileMtime })
              scannedFilePaths.add(filePath)
            } catch (error: unknown) {
              result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`)
            }
          }
        }

        // Phase 2d: Group movies by TMDB ID, then save to DB with versions
        type VersionData = Omit<MediaItemVersion, 'id' | 'media_item_id'>

        const groups: ProcessedItem[][] = []
        if (scanType === 'movie') {
          const groupMap = new Map<string, ProcessedItem[]>()
          for (const item of processedItems) {
            const tmdbId = item.metadata.tmdbId
            const groupKey = tmdbId
              ? `tmdb:${tmdbId}`
              : `title:${this.normalizeGroupTitle(item.metadata.title || '')}|${item.metadata.year || ''}`
            if (!groupMap.has(groupKey)) groupMap.set(groupKey, [])
            groupMap.get(groupKey)!.push(item)
          }
          groups.push(...groupMap.values())
        } else {
          for (const item of processedItems) {
            groups.push([item])
          }
        }

        const multiVersionGroups = groups.filter(g => g.length > 1).length
        if (multiVersionGroups > 0) {
          console.log(`[LocalFolderProvider ${this.sourceId}] Grouped ${processedItems.length} items into ${groups.length} entries (${multiVersionGroups} with multiple versions)`)
        }

        for (const group of groups) {
          try {
            const versions: VersionData[] = group.map(item =>
              this.convertMetadataToVersion(item.metadata, item.parsed, item.fileMtime)
            )

            if (versions.length > 1) {
              extractVersionNames(versions)
            }

            // Pick best version for parent item
            const bestIdx = versions.reduce((bi, v, i) =>
              this.scoreVersion(v) > this.scoreVersion(versions[bi]) ? i : bi, 0)
            const bestItem = group[bestIdx]

            const mediaItem = this.convertMetadataToMediaItem(bestItem.metadata)
            if (!mediaItem) continue

            mediaItem.source_id = this.sourceId
            mediaItem.source_type = 'local'
            mediaItem.library_id = libraryId
            mediaItem.file_mtime = bestItem.fileMtime
            mediaItem.version_count = versions.length
            // Use first item's plex_id as canonical (stable across rescans)
            mediaItem.plex_id = group[0].metadata.itemId

            const id = await db.upsertMediaItem(mediaItem)

            for (const version of versions) {
              const vScore = analyzer.analyzeVersion(version as MediaItemVersion)
              db.upsertMediaItemVersion({ ...version, media_item_id: id, ...vScore } as MediaItemVersion)
            }
            if (versions.length > 1) {
              db.updateBestVersion(id)
            }

            mediaItem.id = id
            const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
            await db.upsertQualityScore(qualityScore)

            result.itemsScanned++

            if (result.itemsScanned % 50 === 0) {
              await db.forceSave()
            }
          } catch (error: unknown) {
            const names = group.map(g => path.basename(g.metadata.filePath || '')).join(', ')
            result.errors.push(`Failed to save ${names}: ${getErrorMessage(error)}`)
          }
        }
      } finally {
        await db.endBatch()
      }

      // Phase 3: Remove stale items (only for full scans)
      // During incremental scans, we only process changed files, so we can't determine stale items
      if (!isIncremental) {
        onProgress?.({
          current: totalFiles,
          total: totalFiles,
          phase: 'saving',
          currentItem: 'Removing stale entries...',
          percentage: 100,
        })

        const existingItems = db.getMediaItems({ type: scanType, sourceId: this.sourceId, libraryId })
        for (const item of existingItems) {
          if (!scannedFilePaths.has(item.file_path)) {
            if (item.id) {
              await db.deleteMediaItem(item.id)
              result.itemsRemoved++
            }
          }
        }
      }

      // Update scan time
      await db.updateSourceScanTime(this.sourceId)

      // Log TMDB match statistics
      const movieMatches = Array.from(movieTmdbCache.values()).filter(v => v !== null).length
      const movieTotal = movieTmdbCache.size
      const seriesMatches = Array.from(seriesTmdbCache.values()).filter(v => v !== null).length
      const seriesTotal = seriesTmdbCache.size

      if (movieTotal > 0 || seriesTotal > 0) {
        const moviePercent = movieTotal > 0 ? Math.round((movieMatches / movieTotal) * 100) : 0
        const seriesPercent = seriesTotal > 0 ? Math.round((seriesMatches / seriesTotal) * 100) : 0
        console.log(`[LocalFolderProvider ${this.sourceId}] TMDB match stats:`)
        if (movieTotal > 0) {
          console.log(`  Movies: ${movieMatches}/${movieTotal} matched (${moviePercent}%)`)
        }
        if (seriesTotal > 0) {
          console.log(`  Series: ${seriesMatches}/${seriesTotal} matched (${seriesPercent}%)`)
        }
      }

      result.success = true
      result.durationMs = Date.now() - startTime

      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  // ============================================================================
  // TARGETED FILE SCANNING
  // ============================================================================

  /**
   * Scan only specific files (for live monitoring)
   * Much faster than full library scan when only a few files changed
   */
  private async scanTargetedFiles(
    libraryId: string,
    filePaths: string[],
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    const [libraryType] = libraryId.includes(':') ? libraryId.split(':', 2) : [libraryId]

    // Handle music library separately
    if (libraryType === 'music') {
      return this.scanTargetedMusicFiles(filePaths, onProgress)
    }

    try {
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      const fileAnalyzer = getMediaFileAnalyzer()
      const parser = getFileNameParser()
      const tmdb = getTMDBService()

      await analyzer.loadThresholdsFromDatabase()

      // Check both FFprobe availability AND user setting (default to enabled if not set)
      const ffprobeEnabled = db.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && await fileAnalyzer.isAvailable()
      const tmdbConfigured = await this.isTMDBConfigured()
      const scanType = libraryType === 'movies' ? 'movie' : 'episode'

      // Filter to only valid media files that exist
      const validFiles = filePaths.filter(filePath => {
        if (!fs.existsSync(filePath)) {
          // File was deleted
          return false
        }
        return parser.isVideoFile(path.basename(filePath))
      })

      // Handle deleted files
      const deletedFiles = filePaths.filter(filePath => !fs.existsSync(filePath))
      for (const filePath of deletedFiles) {
        const existingItem = db.getMediaItemByPath(filePath)
        if (existingItem?.id) {
          await db.deleteMediaItem(existingItem.id)
          result.itemsRemoved++
          console.log(`[LocalFolderProvider ${this.sourceId}] Removed deleted file: ${path.basename(filePath)}`)
        }
      }

      if (validFiles.length === 0 && deletedFiles.length === 0) {
        result.success = true
        result.durationMs = Date.now() - startTime
        return result
      }

      console.log(`[LocalFolderProvider ${this.sourceId}] Scanning ${validFiles.length} targeted files`)

      db.startBatch()

      // Cache for series TMDB lookups - avoids searching for same series multiple times
      const seriesTmdbCache = new Map<string, { tmdbId: number; name: string; posterPath?: string; seasonPosters: Map<number, string | null> } | null>()

      // Cache for movie TMDB lookups - avoids redundant searches for same movie
      const movieTmdbCache = new Map<string, { tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null>()

      try {
        for (let i = 0; i < validFiles.length; i++) {
          const filePath = validFiles[i]
          const relativePath = path.relative(this.folderPath, filePath)

          onProgress?.({
            current: i + 1,
            total: validFiles.length,
            phase: 'processing',
            currentItem: path.basename(filePath),
            percentage: ((i + 1) / validFiles.length) * 100,
          })

          try {
            // Get file stats for mtime tracking
            const stat = await fsPromises.stat(filePath)
            const fileMtime = stat.mtime.getTime()

            // Check if this is a new file or existing
            const existingItem = db.getMediaItemByPath(filePath)
            const isNew = !existingItem

            // Parse filename
            const folderContext = path.dirname(relativePath)
            const parsed = parser.parse(path.basename(filePath), folderContext)

            if (!parsed || (scanType === 'movie' && parsed.type !== 'movie') ||
                (scanType === 'episode' && parsed.type !== 'episode')) {
              continue
            }

            // Create base metadata
            let metadata: MediaMetadata

            if (parsed.type === 'movie') {
              const movieInfo = parsed as ParsedMovieInfo
              metadata = await this.createMovieMetadata(filePath, movieInfo, tmdbConfigured, tmdb, movieTmdbCache)
            } else {
              const episodeInfo = parsed as ParsedEpisodeInfo
              metadata = await this.createEpisodeMetadata(filePath, episodeInfo, tmdbConfigured, tmdb, seriesTmdbCache)
            }

            // Analyze with FFprobe if available
            if (ffprobeAvailable) {
              onProgress?.({
                current: i + 1,
                total: validFiles.length,
                phase: 'analyzing',
                currentItem: path.basename(filePath),
                percentage: ((i + 1) / validFiles.length) * 100,
              })

              const analysis = await fileAnalyzer.analyzeFile(filePath)
              if (analysis.success) {
                metadata = this.enhanceWithFFprobeData(metadata, analysis)

                // Filter out short videos for movies (featurettes, behind-the-scenes, etc.)
                if (scanType === 'movie' && analysis.duration && analysis.duration < MIN_MOVIE_DURATION_SECONDS) {
                  console.log(`[LocalFolderProvider ${this.sourceId}] Skipping short video (${Math.round(analysis.duration / 60)}min): ${path.basename(filePath)}`)
                  continue
                }
              }
            }

            // Convert to MediaItem and save
            const mediaItem = this.convertMetadataToMediaItem(metadata)
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = 'local'
              mediaItem.library_id = libraryId
              mediaItem.file_mtime = fileMtime

              const id = await db.upsertMediaItem(mediaItem)

              // Create version record
              const version = this.convertMetadataToVersion(metadata, parsed as ParsedMovieInfo | ParsedEpisodeInfo, fileMtime)
              const vScore = analyzer.analyzeVersion(version as MediaItemVersion)
              db.upsertMediaItemVersion({ ...version, media_item_id: id, ...vScore } as MediaItemVersion)

              // Analyze quality
              mediaItem.id = id
              const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
              await db.upsertQualityScore(qualityScore)

              result.itemsScanned++
              if (isNew) {
                result.itemsAdded++
                console.log(`[LocalFolderProvider ${this.sourceId}] Added: ${metadata.title}`)
              } else {
                result.itemsUpdated++
                console.log(`[LocalFolderProvider ${this.sourceId}] Updated: ${metadata.title}`)
              }
            }
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`)
          }
        }
      } finally {
        await db.endBatch()
      }

      // Log TMDB match statistics for targeted scan
      const movieMatches = Array.from(movieTmdbCache.values()).filter(v => v !== null).length
      const movieTotal = movieTmdbCache.size
      const seriesMatches = Array.from(seriesTmdbCache.values()).filter(v => v !== null).length
      const seriesTotal = seriesTmdbCache.size

      if (movieTotal > 0 || seriesTotal > 0) {
        const parts: string[] = []
        if (movieTotal > 0) {
          parts.push(`${movieMatches}/${movieTotal} movies`)
        }
        if (seriesTotal > 0) {
          parts.push(`${seriesMatches}/${seriesTotal} series`)
        }
        console.log(`[LocalFolderProvider ${this.sourceId}] TMDB matches: ${parts.join(', ')}`)
      }

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[LocalFolderProvider ${this.sourceId}] Targeted scan complete: ${result.itemsAdded} added, ${result.itemsUpdated} updated, ${result.itemsRemoved} removed`)

      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  /**
   * Scan specific music files (for live monitoring)
   */
  private async scanTargetedMusicFiles(
    filePaths: string[],
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    try {
      const db = getDatabase()
      const fileAnalyzer = getMediaFileAnalyzer()
      const parser = getFileNameParser()

      // Check both FFprobe availability AND user setting (default to enabled if not set)
      const ffprobeEnabled = db.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && await fileAnalyzer.isAvailable()

      // Filter to only valid audio files that exist
      const validFiles = filePaths.filter(filePath => {
        if (!fs.existsSync(filePath)) {
          return false
        }
        return parser.isAudioFile(path.basename(filePath))
      })

      // Handle deleted files
      const deletedFiles = filePaths.filter(filePath => !fs.existsSync(filePath))
      console.log(`[LocalFolderProvider ${this.sourceId}] Checking ${deletedFiles.length} deleted files`)
      for (const filePath of deletedFiles) {
        console.log(`[LocalFolderProvider ${this.sourceId}] Looking up deleted track: ${path.basename(filePath)}`)
        const existingTrack = db.getMusicTrackByPath(filePath)
        if (existingTrack?.id) {
          await db.deleteMusicTrack(existingTrack.id)
          result.itemsRemoved++
          console.log(`[LocalFolderProvider ${this.sourceId}] Removed deleted track: ${path.basename(filePath)}`)
        } else {
          console.log(`[LocalFolderProvider ${this.sourceId}] Track not found in database for: ${path.basename(filePath)}`)
        }
      }

      if (validFiles.length === 0 && deletedFiles.length === 0) {
        result.success = true
        result.durationMs = Date.now() - startTime
        return result
      }

      console.log(`[LocalFolderProvider ${this.sourceId}] Scanning ${validFiles.length} targeted music files`)

      // Maps to track artists and albums
      const artistMap = new Map<string, number>()
      const albumMap = new Map<string, number>()

      db.startBatch()

      try {
        for (let i = 0; i < validFiles.length; i++) {
          const filePath = validFiles[i]
          const relativePath = path.relative(this.folderPath, filePath)

          onProgress?.({
            current: i + 1,
            total: validFiles.length,
            phase: 'processing',
            currentItem: path.basename(filePath),
            percentage: ((i + 1) / validFiles.length) * 100,
          })

          try {
            // Check if this is a new file or existing
            const existingTrack = db.getMusicTrackByPath(filePath)
            const isNew = !existingTrack

            // Parse filename and folder structure
            const folderContext = path.dirname(relativePath)
            const parsed = parser.parseMusic(path.basename(filePath, path.extname(filePath)), folderContext)

            const artistName = parsed.artist || 'Unknown Artist'
            const albumName = parsed.album || 'Unknown Album'
            const trackTitle = parsed.title || path.basename(filePath, path.extname(filePath))

            // Get file stats
            const stats = await fs.promises.stat(filePath)

            // Analyze with FFprobe if available
            let audioInfo: {
              codec?: string
              bitrate?: number
              sampleRate?: number
              bitDepth?: number
              channels?: number
              duration?: number
              isLossless?: boolean
              hasEmbeddedArtwork?: boolean
            } = {}

            if (ffprobeAvailable) {
              const analysis = await fileAnalyzer.analyzeFile(filePath)
              if (analysis.success && analysis.audioTracks && analysis.audioTracks.length > 0) {
                const primaryAudio = analysis.audioTracks[0]
                audioInfo = {
                  codec: normalizeAudioCodec(primaryAudio.codec, primaryAudio.profile),
                  bitrate: primaryAudio.bitrate,
                  sampleRate: primaryAudio.sampleRate,
                  bitDepth: primaryAudio.bitDepth,
                  channels: primaryAudio.channels,
                  duration: analysis.duration,
                  isLossless: this.isLosslessCodec(primaryAudio.codec),
                  hasEmbeddedArtwork: analysis.embeddedArtwork?.hasArtwork,
                }
              }
            }

            // Get or create artist
            let artistId = artistMap.get(artistName.toLowerCase())
            if (!artistId) {
              // Check if artist exists in database
              const existingArtist = db.getMusicArtistByName(artistName, this.sourceId)
              if (existingArtist && existingArtist.id) {
                artistId = existingArtist.id
              } else {
                artistId = await db.upsertMusicArtist({
                  source_id: this.sourceId,
                  source_type: 'local',
                  library_id: 'music',
                  provider_id: this.generateItemId(`artist_${artistName}`),
                  name: artistName,
                  sort_name: artistName,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
              }
              artistMap.set(artistName.toLowerCase(), artistId!)
            }

            // Get or create album
            const albumKey = `${artistName.toLowerCase()}|${albumName.toLowerCase()}`
            let albumId = albumMap.get(albumKey)

            if (!albumId) {
              // Check if album exists in database (artistId is guaranteed to exist at this point)
              const existingAlbum = db.getMusicAlbumByName(albumName, artistId!)
              if (existingAlbum && existingAlbum.id) {
                albumId = existingAlbum.id
              } else {
                albumId = await db.upsertMusicAlbum({
                  source_id: this.sourceId,
                  source_type: 'local',
                  library_id: 'music',
                  provider_id: this.generateItemId(`album_${artistName}_${albumName}`),
                  artist_id: artistId!,
                  artist_name: artistName,
                  title: albumName,
                  sort_title: albumName,
                  year: parsed.year,
                  album_type: 'album',
                  best_audio_codec: audioInfo.codec,
                  best_audio_bitrate: audioInfo.bitrate,
                  best_sample_rate: audioInfo.sampleRate,
                  best_bit_depth: audioInfo.bitDepth,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })

                // Try to get album artwork
                if (audioInfo.hasEmbeddedArtwork && ffprobeAvailable) {
                  const artworkPath = await this.extractAlbumArtwork(filePath, albumId!, fileAnalyzer)
                  if (artworkPath) {
                    await db.updateMusicAlbumArtwork(albumId!, artworkPath)
                  }
                } else {
                  const folderArtwork = await this.findFolderArtwork(path.dirname(filePath))
                  if (folderArtwork) {
                    const artworkUrl = `local-artwork://file?path=${encodeURIComponent(folderArtwork)}`
                    await db.updateMusicAlbumArtwork(albumId!, artworkUrl)
                  }
                }
              }
              albumMap.set(albumKey, albumId!)
            }

            // Create/update track
            await db.upsertMusicTrack({
              source_id: this.sourceId,
              source_type: 'local',
              library_id: 'music',
              provider_id: this.generateItemId(filePath),
              album_id: albumId,
              artist_id: artistId,
              album_name: albumName,
              artist_name: artistName,
              title: trackTitle,
              track_number: parsed.trackNumber,
              disc_number: parsed.discNumber,
              duration: audioInfo.duration,
              file_path: filePath,
              file_size: stats.size,
              container: path.extname(filePath).slice(1).toLowerCase(),
              audio_codec: audioInfo.codec || 'Unknown',
              audio_bitrate: audioInfo.bitrate,
              sample_rate: audioInfo.sampleRate,
              bit_depth: audioInfo.bitDepth,
              channels: audioInfo.channels,
              is_lossless: audioInfo.isLossless,
              is_hi_res: this.isHiRes(audioInfo.sampleRate, audioInfo.bitDepth),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })

            result.itemsScanned++
            if (isNew) {
              result.itemsAdded++
              console.log(`[LocalFolderProvider ${this.sourceId}] Added track: ${trackTitle}`)
            } else {
              result.itemsUpdated++
              console.log(`[LocalFolderProvider ${this.sourceId}] Updated track: ${trackTitle}`)
            }
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`)
          }
        }
      } finally {
        await db.endBatch()
      }

      // Update artist stats for affected artists
      for (const [, artistId] of artistMap) {
        const albums = db.getMusicAlbums({ artistId })
        const tracks = db.getMusicTracks({ artistId })
        await db.updateMusicArtistCounts(artistId, albums.length, tracks.length)
      }

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[LocalFolderProvider ${this.sourceId}] Targeted music scan complete: ${result.itemsAdded} added, ${result.itemsUpdated} updated, ${result.itemsRemoved} removed`)

      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async discoverMediaFiles(
    rootDir: string,
    _type: 'movie' | 'episode',
    _onProgress?: ProgressCallback,
    sinceTimestamp?: Date
  ): Promise<Array<{ filePath: string; relativePath: string }>> {
    const parser = getFileNameParser()
    const files: Array<{ filePath: string; relativePath: string }> = []
    let directoriesProcessed = 0
    let skippedUnchanged = 0

    const scanDir = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 15) return // Prevent infinite recursion

      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)

          if (entry.isDirectory()) {
            // Skip common non-media folders and extras content
            const lowerName = entry.name.toLowerCase()
            if ([
              '@eadir', '.ds_store', 'thumbs', 'metadata',
              // Extras and bonus content folders
              'extras', 'extra', 'featurettes', 'featurette', 'behind the scenes',
              'deleted scenes', 'interviews', 'interview', 'scenes', 'shorts', 'short',
              'trailers', 'trailer', 'other', 'bonus', 'bonuses', 'bonus features',
              'special features', 'specials', 'samples', 'sample', 'subs', 'subtitles'
            ].includes(lowerName)) {
              continue
            }
            await scanDir(fullPath, depth + 1)
          } else if (parser.isVideoFile(entry.name)) {
            // Skip extras/featurettes/bonus content based on filename patterns
            if (isExtrasContent(entry.name)) {
              continue
            }

            // For incremental scans, skip files not modified since last scan
            if (sinceTimestamp) {
              try {
                const stat = await fs.promises.stat(fullPath)
                if (stat.mtime < sinceTimestamp) {
                  skippedUnchanged++
                  continue
                }
              } catch {
                // If we can't stat the file, include it anyway
              }
            }

            const relativePath = path.relative(rootDir, fullPath)
            files.push({ filePath: fullPath, relativePath })
          }
        }

        // Yield to event loop periodically to prevent UI blocking
        directoriesProcessed++
        if (directoriesProcessed % 50 === 0) {
          await new Promise(resolve => setImmediate(resolve))
        }
      } catch (error) {
        // Skip inaccessible directories
        console.warn(`[LocalFolderProvider] Cannot access directory: ${path.basename(dir)}`)
      }
    }

    await scanDir(rootDir)

    if (sinceTimestamp && skippedUnchanged > 0) {
      console.log(`[LocalFolderProvider ${this.sourceId}] Incremental scan: skipped ${skippedUnchanged} unchanged files`)
    }

    return files
  }

  private async isTMDBConfigured(): Promise<boolean> {
    try {
      const db = getDatabase()
      const apiKey = await db.getSetting('tmdb_api_key')
      return !!apiKey && apiKey.length > 0
    } catch {
      return false
    }
  }

  /**
   * Check if MusicBrainz name correction is enabled (default: true)
   */
  private async isMusicBrainzNameCorrectionEnabled(): Promise<boolean> {
    try {
      const db = getDatabase()
      const setting = db.getSetting('musicbrainz_name_correction')
      // Default to true if not set
      return setting !== 'false'
    } catch {
      return true
    }
  }

  /**
   * Lookup canonical artist name from MusicBrainz
   * Returns the canonical name if found with high confidence, otherwise returns original name
   */
  private async lookupCanonicalArtistName(
    artistName: string,
    cache: Map<string, string>
  ): Promise<string> {
    // Check cache first
    const cached = cache.get(artistName.toLowerCase())
    if (cached !== undefined) {
      return cached
    }

    try {
      const mb = getMusicBrainzService()
      const results = await mb.searchArtist(artistName)

      if (results.length > 0) {
        // Find exact match (case-insensitive) or use first result if high score
        const exactMatch = results.find(
          a => a.name.toLowerCase() === artistName.toLowerCase()
        )

        if (exactMatch) {
          // Exact match - use canonical capitalization
          cache.set(artistName.toLowerCase(), exactMatch.name)
          return exactMatch.name
        }

        // Check if first result is close enough (same normalized form)
        const firstResult = results[0]
        const normalizedInput = artistName.toLowerCase().replace(/[^a-z0-9]/g, '')
        const normalizedResult = firstResult.name.toLowerCase().replace(/[^a-z0-9]/g, '')

        if (normalizedInput === normalizedResult) {
          cache.set(artistName.toLowerCase(), firstResult.name)
          return firstResult.name
        }
      }

      // No good match - keep original
      cache.set(artistName.toLowerCase(), artistName)
      return artistName
    } catch (error) {
      console.warn(`[LocalFolderProvider] MusicBrainz artist lookup failed for "${artistName}":`, error)
      cache.set(artistName.toLowerCase(), artistName)
      return artistName
    }
  }

  private async createMovieMetadata(
    filePath: string,
    parsed: ParsedMovieInfo,
    fetchFromTMDB: boolean,
    tmdb: ReturnType<typeof getTMDBService>,
    movieTmdbCache?: Map<string, { tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null>
  ): Promise<MediaMetadata> {
    const stats = await fs.promises.stat(filePath)

    const metadata: MediaMetadata = {
      providerId: this.sourceId,
      providerType: 'local' as ProviderType,
      itemId: this.generateItemId(filePath),
      title: parsed.title || path.basename(filePath),
      type: 'movie',
      year: parsed.year,
      filePath,
      fileSize: stats.size,
      resolution: parsed.resolution,
      videoCodec: parsed.codec,
    }

    // Try to fetch from TMDB with improved matching
    if (fetchFromTMDB && parsed.title) {
      try {
        const parser = getFileNameParser()
        const normalizedTitle = parser.normalizeForSearch(parsed.title)
        const cacheKey = `${normalizedTitle.toLowerCase()}|${parsed.year || ''}`

        // Check cache first
        if (movieTmdbCache?.has(cacheKey)) {
          const cached = movieTmdbCache.get(cacheKey)
          if (cached) {
            metadata.tmdbId = cached.tmdbId
            metadata.title = cached.title
            metadata.year = cached.year
            metadata.posterUrl = cached.posterPath
              ? `https://image.tmdb.org/t/p/w500${cached.posterPath}`
              : undefined
            metadata.backdropUrl = cached.backdropPath
              ? `https://image.tmdb.org/t/p/w1280${cached.backdropPath}`
              : undefined
          }
          return metadata
        }

        // Multi-strategy TMDB search
        const match = await this.searchMovieWithFallbacks(parsed.title, normalizedTitle, parsed.year, tmdb)

        if (match) {
          metadata.tmdbId = match.tmdbId
          metadata.title = match.title
          metadata.year = match.year
          metadata.posterUrl = match.posterPath
            ? `https://image.tmdb.org/t/p/w500${match.posterPath}`
            : undefined
          metadata.backdropUrl = match.backdropPath
            ? `https://image.tmdb.org/t/p/w1280${match.backdropPath}`
            : undefined

          // Cache the result
          movieTmdbCache?.set(cacheKey, match)
        } else {
          // Cache null to avoid retrying
          movieTmdbCache?.set(cacheKey, null)
        }
      } catch (error) {
        // Ignore TMDB errors, continue with parsed data
        console.warn(`[LocalFolderProvider] TMDB lookup failed for "${parsed.title}":`, error)
      }
    }

    return metadata
  }

  /**
   * Multi-strategy TMDB movie search with fuzzy year matching
   * Tries multiple strategies to find the best match:
   * 1. Exact title + exact year
   * 2. Normalized title + exact year
   * 3. Normalized title + fuzzy year (+/- 1)
   * 4. Normalized title without year (fallback)
   */
  private async searchMovieWithFallbacks(
    originalTitle: string,
    normalizedTitle: string,
    year: number | undefined,
    tmdb: ReturnType<typeof getTMDBService>
  ): Promise<{ tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null> {
    // Helper to find best match from results
    const findBestMatch = (
      results: Array<{ id: number; title: string; release_date?: string; poster_path?: string | null; backdrop_path?: string | null }>,
      targetYear?: number
    ): { tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null => {
      if (!results || results.length === 0) return null

      // If we have a target year, try to find an exact or close match
      if (targetYear) {
        // First try exact year match
        const exactMatch = results.find(r =>
          r.release_date?.startsWith(String(targetYear))
        )
        if (exactMatch) {
          return {
            tmdbId: exactMatch.id,
            title: exactMatch.title,
            year: exactMatch.release_date ? parseInt(exactMatch.release_date.split('-')[0], 10) : undefined,
            posterPath: exactMatch.poster_path || undefined,
            backdropPath: exactMatch.backdrop_path || undefined,
          }
        }

        // Try fuzzy year match (+/- 1 year)
        const fuzzyMatch = results.find(r => {
          if (!r.release_date) return false
          const resultYear = parseInt(r.release_date.split('-')[0], 10)
          return Math.abs(resultYear - targetYear) <= 1
        })
        if (fuzzyMatch) {
          console.log(`[LocalFolderProvider] Fuzzy year match: "${fuzzyMatch.title}" (${fuzzyMatch.release_date?.split('-')[0]}) for target year ${targetYear}`)
          return {
            tmdbId: fuzzyMatch.id,
            title: fuzzyMatch.title,
            year: fuzzyMatch.release_date ? parseInt(fuzzyMatch.release_date.split('-')[0], 10) : undefined,
            posterPath: fuzzyMatch.poster_path || undefined,
            backdropPath: fuzzyMatch.backdrop_path || undefined,
          }
        }
      }

      // Fall back to first result
      const first = results[0]
      return {
        tmdbId: first.id,
        title: first.title,
        year: first.release_date ? parseInt(first.release_date.split('-')[0], 10) : undefined,
        posterPath: first.poster_path || undefined,
        backdropPath: first.backdrop_path || undefined,
      }
    }

    // Strategy 1: Original title with year
    if (year) {
      const response = await tmdb.searchMovie(originalTitle, year)
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    // Strategy 2: Normalized title with year
    if (year && normalizedTitle !== originalTitle) {
      const response = await tmdb.searchMovie(normalizedTitle, year)
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    // Strategy 3: Original title without year (to get more results)
    {
      const response = await tmdb.searchMovie(originalTitle)
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    // Strategy 4: Normalized title without year
    if (normalizedTitle !== originalTitle) {
      const response = await tmdb.searchMovie(normalizedTitle)
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    // No match found
    console.log(`[LocalFolderProvider] No TMDB match found for "${originalTitle}" (${year || 'no year'})`)
    return null
  }

  private async createEpisodeMetadata(
    filePath: string,
    parsed: ParsedEpisodeInfo,
    fetchFromTMDB: boolean,
    tmdb: ReturnType<typeof getTMDBService>,
    seriesTmdbCache?: Map<string, { tmdbId: number; name: string; posterPath?: string; seasonPosters: Map<number, string | null> } | null>
  ): Promise<MediaMetadata> {
    const stats = await fs.promises.stat(filePath)

    const metadata: MediaMetadata = {
      providerId: this.sourceId,
      providerType: 'local' as ProviderType,
      itemId: this.generateItemId(filePath),
      title: parsed.episodeTitle || `Episode ${parsed.episodeNumber}`,
      type: 'episode',
      seriesTitle: parsed.seriesTitle || 'Unknown Series',
      seasonNumber: parsed.seasonNumber,
      episodeNumber: parsed.episodeNumber,
      year: parsed.year,
      filePath,
      fileSize: stats.size,
      resolution: parsed.resolution,
      videoCodec: parsed.codec,
    }

    // Try to fetch episode details from TMDB
    if (fetchFromTMDB && parsed.seriesTitle && parsed.seasonNumber && parsed.episodeNumber) {
      try {
        const seriesKey = parsed.seriesTitle.toLowerCase()

        // Check cache first to avoid redundant series lookups
        let cachedSeries = seriesTmdbCache?.get(seriesKey)
        const needsLookup = cachedSeries === undefined

        if (needsLookup) {
          // First lookup for this series - search for it
          const searchResponse = await tmdb.searchTVShow(parsed.seriesTitle)
          if (searchResponse.results && searchResponse.results.length > 0) {
            const series = searchResponse.results[0]
            cachedSeries = {
              tmdbId: series.id,
              name: series.name,
              posterPath: series.poster_path || undefined,
              seasonPosters: new Map()
            }
            seriesTmdbCache?.set(seriesKey, cachedSeries)
          } else {
            // Series not found, cache null to avoid retrying
            seriesTmdbCache?.set(seriesKey, null)
            cachedSeries = null
          }
        }

        // If we have a cached series, get the episode details
        if (cachedSeries) {
          metadata.seriesTitle = cachedSeries.name
          metadata.seriesTmdbId = cachedSeries.tmdbId

          // Set series poster as fallback
          if (cachedSeries.posterPath) {
            metadata.posterUrl = `https://image.tmdb.org/t/p/w500${cachedSeries.posterPath}`
          }

          // Get episode details (this is still per-episode but much cheaper than searching)
          const episode = await tmdb.getEpisodeDetails(
            cachedSeries.tmdbId,
            parsed.seasonNumber,
            parsed.episodeNumber
          )

          if (episode) {
            // Use TMDB episode title if better than parsed
            if (episode.name) {
              metadata.title = episode.name
            }

            // Air date can provide year context
            if (episode.air_date) {
              const airYear = parseInt(episode.air_date.split('-')[0], 10)
              if (!isNaN(airYear)) {
                metadata.year = airYear
              }
            }

            // Episode thumbnail (still image)
            if (episode.still_path) {
              metadata.episodeThumbUrl = `https://image.tmdb.org/t/p/w300${episode.still_path}`
            }
          }

          // Fetch season poster if not cached
          if (!cachedSeries.seasonPosters.has(parsed.seasonNumber)) {
            try {
              const seasonDetails = await tmdb.getSeasonDetails(
                cachedSeries.tmdbId.toString(),
                parsed.seasonNumber
              )
              cachedSeries.seasonPosters.set(
                parsed.seasonNumber,
                seasonDetails?.poster_path || null
              )
            } catch {
              // Season might not exist, cache null to avoid retrying
              cachedSeries.seasonPosters.set(parsed.seasonNumber, null)
            }
          }

          // Set season poster
          const seasonPoster = cachedSeries.seasonPosters.get(parsed.seasonNumber)
          if (seasonPoster) {
            metadata.seasonPosterUrl = `https://image.tmdb.org/t/p/w500${seasonPoster}`
          }
        }
      } catch (error) {
        // Ignore TMDB errors, continue with parsed data
        console.warn(`[LocalFolderProvider] TMDB episode lookup failed for "${parsed.seriesTitle}" S${parsed.seasonNumber}E${parsed.episodeNumber}:`, error)
      }
    }

    return metadata
  }

  private enhanceWithFFprobeData(metadata: MediaMetadata, analysis: FileAnalysisResult): MediaMetadata {
    const enhanced = { ...metadata }

    if (analysis.video) {
      enhanced.width = analysis.video.width
      enhanced.height = analysis.video.height
      enhanced.resolution = normalizeResolution(analysis.video.width, analysis.video.height)
      enhanced.videoCodec = normalizeVideoCodec(analysis.video.codec)
      enhanced.videoBitrate = analysis.video.bitrate
      enhanced.videoFrameRate = analysis.video.frameRate
      enhanced.colorBitDepth = analysis.video.bitDepth
      enhanced.hdrFormat = analysis.video.hdrFormat
      enhanced.videoProfile = analysis.video.profile
      enhanced.colorSpace = analysis.video.colorSpace
    }

    if (analysis.duration) {
      enhanced.duration = analysis.duration
    }

    if (analysis.fileSize) {
      enhanced.fileSize = analysis.fileSize
    }

    if (analysis.container) {
      enhanced.container = analysis.container
    }

    if (analysis.audioTracks && analysis.audioTracks.length > 0) {
      enhanced.audioTracks = analysis.audioTracks.map((track: AnalyzedAudioStream) => ({
        codec: normalizeAudioCodec(track.codec, track.profile),
        channels: track.channels,
        bitrate: track.bitrate,
        sampleRate: track.sampleRate,
        language: track.language,
        isDefault: track.isDefault,
        hasObjectAudio: track.hasObjectAudio,
      }))

      // Select the best audio track for primary fields (not just first track)
      const primary = this.selectBestFFprobeAudioTrack(analysis.audioTracks)
      if (primary) {
        // Use profile from the matching raw AnalyzedAudioStream for proper DTS variant detection
        const rawTrack = analysis.audioTracks.find(t => t.codec === primary.codec && t.channels === primary.channels)
        enhanced.audioCodec = normalizeAudioCodec(primary.codec, rawTrack?.profile)
        enhanced.audioChannels = primary.channels
        enhanced.audioBitrate = primary.bitrate
        enhanced.hasObjectAudio = primary.hasObjectAudio
      }
    }

    // Subtitle tracks
    if (analysis.subtitleTracks && analysis.subtitleTracks.length > 0) {
      enhanced.subtitleTracks = analysis.subtitleTracks.map(track => ({
        codec: track.codec,
        language: track.language,
        title: track.title,
        isDefault: track.isDefault,
        isForced: track.isForced,
      }))
    }

    // Apply embedded metadata selectively
    // TMDB data takes priority for year (more reliable than file tags)
    // But file tags can supplement missing data
    if (analysis.embeddedMetadata) {
      const embedded = analysis.embeddedMetadata

      // Only use embedded year if we don't have a TMDB year
      // TMDB release dates are more accurate than file metadata (which may be encode date)
      if (embedded.year && !enhanced.year) {
        enhanced.year = embedded.year
      }

      // TV show specific metadata
      if (enhanced.type === 'episode') {
        if (embedded.showName) {
          enhanced.seriesTitle = embedded.showName
        }
        if (embedded.seasonNumber) {
          enhanced.seasonNumber = embedded.seasonNumber
        }
        if (embedded.episodeNumber) {
          enhanced.episodeNumber = embedded.episodeNumber
        }
        // For episodes: embedded title is the episode title
        // episodeTitle field takes priority, then main title
        if (embedded.episodeTitle) {
          enhanced.title = embedded.episodeTitle
        } else if (embedded.title && embedded.showName && embedded.title !== embedded.showName) {
          // If title is different from show name, it's the episode title
          enhanced.title = embedded.title
        }
      } else {
        // For movies: embedded title is the movie title
        if (embedded.title) {
          enhanced.title = embedded.title
        }
      }
    }

    return enhanced
  }

  /**
   * Select the best audio track from FFprobe analysis results
   * Prioritizes: Object audio > Lossless > Premium surround > Standard surround > Stereo
   */
  private selectBestFFprobeAudioTrack(tracks: Array<{
    codec: string
    channels: number
    bitrate?: number
    hasObjectAudio: boolean
  }>): typeof tracks[0] | undefined {
    if (!tracks || tracks.length === 0) return undefined
    if (tracks.length === 1) return tracks[0]

    let bestTrack = tracks[0]
    let bestScore = this.calculateAudioTrackScore(bestTrack)

    for (let i = 1; i < tracks.length; i++) {
      const score = this.calculateAudioTrackScore(tracks[i])
      if (score > bestScore) {
        bestScore = score
        bestTrack = tracks[i]
      }
    }

    return bestTrack
  }

  /**
   * Calculate quality score for an audio track (higher = better)
   */
  private calculateAudioTrackScore(track: {
    codec: string
    channels: number
    bitrate?: number
    hasObjectAudio: boolean
  }): number {
    let score = 0
    const codecLower = track.codec.toLowerCase()

    // Object audio (Atmos, DTS:X) - highest priority
    if (track.hasObjectAudio) {
      score += 10000
    }

    // Lossless codecs
    if (codecLower.includes('truehd') || codecLower.includes('dts-hd') || codecLower === 'dtshd' ||
        codecLower === 'flac' || codecLower.includes('pcm') || codecLower === 'alac') {
      score += 5000
    }

    // Premium lossy codecs
    if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('dd+')) {
      score += 3000
    } else if (codecLower.includes('ac3') || codecLower.includes('ac-3') || codecLower === 'dts') {
      score += 2000
    } else if (codecLower === 'aac') {
      score += 1000
    }

    // More channels = better
    score += (track.channels || 2) * 100

    // Higher bitrate = better
    score += (track.bitrate || 0)

    return score
  }

  private generateItemId(filePath: string): string {
    // Create a stable ID based on the file path
    const hash = this.simpleHash(filePath)
    return `local_${hash}`
  }

  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  private scoreVersion(v: { resolution: string; video_bitrate: number; hdr_format?: string }): number {
    const tierRank = v.resolution.includes('2160') ? 4
      : v.resolution.includes('1080') ? 3
      : v.resolution.includes('720') ? 2 : 1
    const hdrBonus = v.hdr_format && v.hdr_format !== 'None' ? 1000 : 0
    return tierRank * 100000 + hdrBonus + v.video_bitrate
  }

  private normalizeGroupTitle(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/\s*[-:(]\s*(director'?s?\s*cut|extended|unrated|theatrical|imax|remastered|special\s*edition|ultimate\s*edition|collector'?s?\s*edition)\s*[):]?\s*$/i, '')
      .replace(/\s*\(\s*\)\s*$/, '')
      .trim()
  }

  private convertMetadataToVersion(metadata: MediaMetadata, parsed: ParsedMovieInfo | ParsedEpisodeInfo, fileMtime: number): Omit<MediaItemVersion, 'id' | 'media_item_id'> {
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks?.length) {
      metadata.audioTracks.forEach((track, index) => {
        audioTracks.push({
          index,
          codec: track.codec || 'Unknown',
          channels: track.channels || 2,
          bitrate: track.bitrate || 0,
          language: track.language,
          hasObjectAudio: track.hasObjectAudio || false,
        })
      })
    } else if (metadata.audioCodec) {
      audioTracks.push({ index: 0, codec: metadata.audioCodec, channels: metadata.audioChannels || 2, bitrate: metadata.audioBitrate || 0, hasObjectAudio: false })
    }

    const resolution = metadata.resolution || 'SD'
    const hdrFormat = metadata.hdrFormat || 'None'
    const edition = (parsed.type === 'movie' ? (parsed as ParsedMovieInfo).edition : undefined) || undefined
    const source = parsed.type !== 'music' ? parsed.source : undefined
    const sourceType = source && /remux/i.test(source) ? 'REMUX'
      : source && /web-dl|webdl/i.test(source) ? 'WEB-DL'
      : undefined

    const labelParts = [resolution]
    if (hdrFormat !== 'None') labelParts.push(hdrFormat)
    if (sourceType) labelParts.push(sourceType)
    if (edition) labelParts.push(edition)

    return {
      version_source: `local_file_${this.simpleHash(metadata.filePath || '')}`,
      edition,
      source_type: sourceType,
      label: labelParts.join(' '),
      file_path: metadata.filePath || '',
      file_size: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      resolution,
      width: metadata.width || 0,
      height: metadata.height || 0,
      video_codec: metadata.videoCodec || '',
      video_bitrate: metadata.videoBitrate || 0,
      audio_codec: metadata.audioCodec || '',
      audio_channels: metadata.audioChannels || 2,
      audio_bitrate: metadata.audioBitrate || 0,
      video_frame_rate: metadata.videoFrameRate,
      color_bit_depth: metadata.colorBitDepth,
      hdr_format: hdrFormat === 'None' ? undefined : hdrFormat,
      color_space: metadata.colorSpace,
      video_profile: metadata.videoProfile,
      audio_profile: metadata.audioProfile,
      audio_sample_rate: metadata.audioSampleRate,
      has_object_audio: metadata.hasObjectAudio,
      audio_tracks: JSON.stringify(audioTracks),
      subtitle_tracks: metadata.subtitleTracks?.length
        ? JSON.stringify(metadata.subtitleTracks.map((t, i) => ({ index: i, codec: t.codec || 'unknown', language: t.language, title: t.title, isDefault: t.isDefault || false, isForced: t.isForced || false })))
        : undefined,
      container: metadata.container,
      file_mtime: fileMtime,
    }
  }

  private convertMetadataToMediaItem(metadata: MediaMetadata): MediaItem | null {
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks && metadata.audioTracks.length > 0) {
      metadata.audioTracks.forEach((track, index) => {
        audioTracks.push({
          index,
          codec: track.codec || 'Unknown',
          channels: track.channels || 2,
          bitrate: track.bitrate || 0,
          language: track.language,
          hasObjectAudio: track.hasObjectAudio || false,
        })
      })
    } else if (metadata.audioCodec) {
      audioTracks.push({
        index: 0,
        codec: metadata.audioCodec,
        channels: metadata.audioChannels || 2,
        bitrate: metadata.audioBitrate || 0,
        hasObjectAudio: false,
      })
    }

    return {
      plex_id: metadata.itemId,
      title: metadata.title,
      year: metadata.year,
      type: metadata.type,
      series_title: metadata.seriesTitle,
      season_number: metadata.seasonNumber,
      episode_number: metadata.episodeNumber,
      file_path: metadata.filePath || '',
      file_size: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      resolution: metadata.resolution || 'SD',
      width: metadata.width || 0,
      height: metadata.height || 0,
      video_codec: metadata.videoCodec || '',
      video_bitrate: metadata.videoBitrate || 0,
      audio_codec: metadata.audioCodec || '',
      audio_channels: metadata.audioChannels || 2,
      audio_bitrate: metadata.audioBitrate || 0,
      hdr_format: metadata.hdrFormat,
      video_frame_rate: metadata.videoFrameRate,
      color_bit_depth: metadata.colorBitDepth,
      color_space: metadata.colorSpace,
      video_profile: metadata.videoProfile,
      audio_tracks: JSON.stringify(audioTracks),
      subtitle_tracks: metadata.subtitleTracks && metadata.subtitleTracks.length > 0
        ? JSON.stringify(metadata.subtitleTracks.map((t, i) => ({
            index: i,
            codec: t.codec || 'unknown',
            language: t.language,
            title: t.title,
            isDefault: t.isDefault || false,
            isForced: t.isForced || false,
          })))
        : undefined,
      imdb_id: metadata.imdbId,
      tmdb_id: metadata.tmdbId?.toString(),
      poster_url: metadata.posterUrl,
      episode_thumb_url: metadata.episodeThumbUrl,
      season_poster_url: metadata.seasonPosterUrl,
      container: metadata.container,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert a MediaItem (from database) back to MediaMetadata format
   */
  private convertMediaItemToMetadata(item: MediaItem): MediaMetadata {
    // Parse audio tracks from JSON string
    let audioTracks: AudioStreamInfo[] = []
    if (item.audio_tracks) {
      try {
        const tracks = JSON.parse(item.audio_tracks) as AudioTrack[]
        audioTracks = tracks.map(track => ({
          codec: track.codec,
          channels: track.channels,
          bitrate: track.bitrate,
          language: track.language,
          title: track.title,
          isDefault: track.isDefault,
          hasObjectAudio: track.hasObjectAudio,
          index: track.index,
        }))
      } catch {
        // Ignore parse errors
      }
    }

    return {
      providerId: this.sourceId,
      providerType: 'local' as ProviderType,
      itemId: item.plex_id || '',
      title: item.title,
      type: item.type,
      year: item.year,

      // Episode-specific
      seriesTitle: item.series_title,
      seasonNumber: item.season_number,
      episodeNumber: item.episode_number,

      // External IDs
      imdbId: item.imdb_id,
      tmdbId: item.tmdb_id ? parseInt(item.tmdb_id, 10) : undefined,
      seriesTmdbId: item.series_tmdb_id ? parseInt(item.series_tmdb_id, 10) : undefined,

      // File info
      filePath: item.file_path,
      fileSize: item.file_size,
      duration: item.duration,
      container: item.container,

      // Video quality
      resolution: item.resolution,
      width: item.width,
      height: item.height,
      videoCodec: item.video_codec,
      videoBitrate: item.video_bitrate,
      videoFrameRate: item.video_frame_rate,
      colorBitDepth: item.color_bit_depth,
      hdrFormat: item.hdr_format,
      colorSpace: item.color_space,
      videoProfile: item.video_profile,

      // Audio quality (primary track)
      audioCodec: item.audio_codec,
      audioChannels: item.audio_channels,
      audioBitrate: item.audio_bitrate,
      audioSampleRate: item.audio_sample_rate,
      hasObjectAudio: item.has_object_audio,

      // All audio tracks
      audioTracks,

      // Artwork
      posterUrl: item.poster_url,
      episodeThumbUrl: item.episode_thumb_url,
      seasonPosterUrl: item.season_poster_url,
    }
  }

  // ============================================================================
  // MUSIC SCANNING
  // ============================================================================

  private async scanMusicLibrary(onProgress?: ProgressCallback, scanPath?: string): Promise<ScanResult> {
    const musicPath = scanPath || this.folderPath
    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    if (!musicPath || !fs.existsSync(musicPath)) {
      result.errors.push('Folder not found or not configured')
      result.durationMs = Date.now() - startTime
      return result
    }

    try {
      const db = getDatabase()
      const fileAnalyzer = getMediaFileAnalyzer()
      const parser = getFileNameParser()

      // Check both FFprobe availability AND user setting (default to enabled if not set)
      const ffprobeEnabled = db.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && await fileAnalyzer.isAvailable()
      const mbNameCorrectionEnabled = await this.isMusicBrainzNameCorrectionEnabled()
      const scannedFilePaths = new Set<string>()
      const mbArtistNameCache = new Map<string, string>() // parsed name -> canonical name

      // Parallel FFprobe settings
      const ffprobeParallelEnabled = db.getSetting('ffprobe_parallel_enabled') !== 'false'
      const ffprobeBatchSize = parseInt(db.getSetting('ffprobe_batch_size') || '50', 10)

      if (mbNameCorrectionEnabled) {
        console.log(`[LocalFolderProvider ${this.sourceId}] MusicBrainz name correction enabled`)
      }

      // Phase 1: Discover all audio files
      onProgress?.({
        current: 0,
        total: 100,
        phase: 'fetching',
        currentItem: 'Scanning for music files...',
        percentage: 0,
      })

      const audioFiles = await this.discoverAudioFiles(musicPath)
      const totalFiles = audioFiles.length

      console.log(`[LocalFolderProvider ${this.sourceId}] Found ${totalFiles} audio files`)

      if (totalFiles === 0) {
        result.success = true
        result.durationMs = Date.now() - startTime
        return result
      }

      // Maps to track artists and albums for linking
      const artistMap = new Map<string, number>() // artist name -> artist ID
      const albumMap = new Map<string, number>() // "artist|album" -> album ID
      const albumArtworkMap = new Map<string, string | null>() // "artist|album" -> artwork path (null = checked, no artwork)

      // Type for pre-processed audio file info
      interface AudioFileToProcess {
        filePath: string
        relativePath: string
        fileMtime: number
        fileSize: number
        artistName: string
        albumName: string
        trackTitle: string
        trackNumber?: number
        discNumber?: number
        year?: number
      }

      // Phase 2: Process each file in batches
      db.startBatch()
      const useParallelFFprobe = ffprobeAvailable && ffprobeParallelEnabled && ffprobeBatchSize > 1
      console.log(`[LocalFolderProvider ${this.sourceId}] Using ${useParallelFFprobe ? 'parallel' : 'sequential'} FFprobe for music (batch size: ${ffprobeBatchSize})`)

      try {
        for (let batchStart = 0; batchStart < audioFiles.length; batchStart += ffprobeBatchSize) {
          const batchEnd = Math.min(batchStart + ffprobeBatchSize, audioFiles.length)
          const batchFiles = audioFiles.slice(batchStart, batchEnd)

          // Phase 2a: Pre-process batch (mtime check, parsing, name lookup)
          const filesToProcess: AudioFileToProcess[] = []
          const filesToAnalyze: string[] = []

          for (let i = 0; i < batchFiles.length; i++) {
            const globalIndex = batchStart + i
            const { filePath, relativePath } = batchFiles[i]

            onProgress?.({
              current: globalIndex + 1,
              total: totalFiles,
              phase: 'processing',
              currentItem: path.basename(filePath),
              percentage: ((globalIndex + 1) / totalFiles) * 100,
            })

            try {
              // Parse filename and folder structure
              const folderContext = path.dirname(relativePath)
              const parsed = parser.parseMusic(path.basename(filePath, path.extname(filePath)), folderContext)

              let artistName = parsed.artist || 'Unknown Artist'
              const albumName = parsed.album || 'Unknown Album'
              const trackTitle = parsed.title || path.basename(filePath, path.extname(filePath))

              // Lookup canonical artist name from MusicBrainz if enabled
              if (mbNameCorrectionEnabled && artistName !== 'Unknown Artist') {
                artistName = await this.lookupCanonicalArtistName(artistName, mbArtistNameCache)
              }

              // Get file stats
              const stats = await fs.promises.stat(filePath)
              const fileMtime = stats.mtime.getTime()

              // Delta scanning: Check if track exists and is unchanged
              const existingTrack = db.getMusicTrackByPath(filePath)
              if (existingTrack?.file_mtime === fileMtime) {
                // File unchanged, skip expensive FFprobe analysis
                scannedFilePaths.add(filePath)
                result.itemsScanned++
                continue
              }

              // Collect file for processing
              filesToProcess.push({
                filePath,
                relativePath,
                fileMtime,
                fileSize: stats.size,
                artistName,
                albumName,
                trackTitle,
                trackNumber: parsed.trackNumber,
                discNumber: parsed.discNumber,
                year: parsed.year,
              })

              // Collect file for FFprobe analysis if enabled
              if (ffprobeAvailable) {
                filesToAnalyze.push(filePath)
              }
            } catch (error: unknown) {
              result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`)
            }
          }

          // Phase 2b: Batch FFprobe analysis
          let ffprobeResults = new Map<string, import('../../services/MediaFileAnalyzer').FileAnalysisResult>()

          if (filesToAnalyze.length > 0) {
            onProgress?.({
              current: batchEnd,
              total: totalFiles,
              phase: 'analyzing',
              currentItem: `Analyzing ${filesToAnalyze.length} audio files...`,
              percentage: (batchEnd / totalFiles) * 100,
            })

            if (useParallelFFprobe) {
              // Parallel analysis using worker pool
              ffprobeResults = await fileAnalyzer.analyzeFilesParallel(filesToAnalyze)
            } else {
              // Sequential analysis (fallback)
              for (const fp of filesToAnalyze) {
                const analysis = await fileAnalyzer.analyzeFile(fp)
                ffprobeResults.set(fp, analysis)
              }
            }
          }

          // Phase 2c: Apply FFprobe results and save
          for (const fileInfo of filesToProcess) {
            const { filePath, fileMtime, artistName, albumName, trackTitle } = fileInfo

            try {
              // Extract audio info from FFprobe results
              let audioInfo: {
                codec?: string
                bitrate?: number
                sampleRate?: number
                bitDepth?: number
                channels?: number
                duration?: number
                isLossless?: boolean
                hasEmbeddedArtwork?: boolean
              } = {}

              const analysis = ffprobeResults.get(filePath)
              if (analysis?.success && analysis.audioTracks && analysis.audioTracks.length > 0) {
                const primaryAudio = analysis.audioTracks[0]
                audioInfo = {
                  codec: normalizeAudioCodec(primaryAudio.codec, primaryAudio.profile),
                  bitrate: primaryAudio.bitrate,
                  sampleRate: primaryAudio.sampleRate,
                  bitDepth: primaryAudio.bitDepth,
                  channels: primaryAudio.channels,
                  duration: analysis.duration,
                  isLossless: this.isLosslessCodec(primaryAudio.codec),
                  hasEmbeddedArtwork: analysis.embeddedArtwork?.hasArtwork,
                }
              }

            // Get or create artist
            let artistId = artistMap.get(artistName.toLowerCase())
            if (!artistId) {
              artistId = await db.upsertMusicArtist({
                source_id: this.sourceId,
                source_type: 'local',
                library_id: 'music',
                provider_id: this.generateItemId(`artist_${artistName}`),
                name: artistName,
                sort_name: artistName,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              artistMap.set(artistName.toLowerCase(), artistId!)
            }

            // Get or create album
            const albumKey = `${artistName.toLowerCase()}|${albumName.toLowerCase()}`
            let albumId = albumMap.get(albumKey)

            if (!albumId) {
              albumId = await db.upsertMusicAlbum({
                source_id: this.sourceId,
                source_type: 'local',
                library_id: 'music',
                provider_id: this.generateItemId(`album_${artistName}_${albumName}`),
                artist_id: artistId!,
                artist_name: artistName,
                title: albumName,
                sort_title: albumName,
                year: fileInfo.year,
                album_type: 'album',
                best_audio_codec: audioInfo.codec,
                best_audio_bitrate: audioInfo.bitrate,
                best_sample_rate: audioInfo.sampleRate,
                best_bit_depth: audioInfo.bitDepth,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              albumMap.set(albumKey, albumId!)
            }

            // Extract album artwork if not already done for this album
            // Priority: 1) Embedded artwork from audio file, 2) Folder artwork (cover.jpg, folder.jpg)
            if (!albumArtworkMap.has(albumKey)) {
              let artworkPath: string | null = null

              // Debug: Log artwork detection status
              console.log(`[LocalFolderProvider] Artwork check for "${artistName} - ${albumName}": hasEmbedded=${audioInfo.hasEmbeddedArtwork}, ffprobeAvailable=${ffprobeAvailable}`)

              // Try embedded artwork first (most reliable for the specific release)
              if (audioInfo.hasEmbeddedArtwork && ffprobeAvailable) {
                try {
                  artworkPath = await this.extractAlbumArtwork(filePath, albumId!, fileAnalyzer)
                  if (artworkPath) {
                    console.log(`[LocalFolderProvider] Extracted embedded artwork for "${albumName}"`)

                  } else {
                    console.log(`[LocalFolderProvider] Failed to extract embedded artwork for "${albumName}" (returned null)`)
                  }
                } catch (extractErr) {
                  console.warn(`[LocalFolderProvider] Error extracting embedded artwork for "${albumName}":`, extractErr)
                }
              }

              // Fallback: check for folder artwork (cover.jpg, folder.jpg, etc.)
              if (!artworkPath) {
                const folderPath = path.dirname(filePath)
                const folderArtwork = await this.findFolderArtwork(folderPath)
                if (folderArtwork) {
                  artworkPath = `local-artwork://file?path=${encodeURIComponent(folderArtwork)}`
                  console.log(`[LocalFolderProvider] Using folder artwork for "${albumName}": ${path.basename(folderArtwork)}`)
                } else {
                  console.log(`[LocalFolderProvider] No folder artwork found for "${albumName}" in ${path.basename(folderPath)}`)
                }
              }

              albumArtworkMap.set(albumKey, artworkPath)
              if (artworkPath) {
                await db.updateMusicAlbumArtwork(albumId, artworkPath)
              } else {
                console.log(`[LocalFolderProvider] No artwork found for "${artistName} - ${albumName}" - will use Cover Art Archive fallback during completeness analysis`)
              }
            }

            // Create track
            await db.upsertMusicTrack({
              source_id: this.sourceId,
              source_type: 'local',
              library_id: 'music',
              provider_id: this.generateItemId(filePath),
              album_id: albumId,
              artist_id: artistId,
              album_name: albumName,
              artist_name: artistName,
              title: trackTitle,
              track_number: fileInfo.trackNumber,
              disc_number: fileInfo.discNumber,
              duration: audioInfo.duration,
              file_path: filePath,
              file_size: fileInfo.fileSize,
              file_mtime: fileMtime,
              container: path.extname(filePath).slice(1).toLowerCase(),
              audio_codec: audioInfo.codec || 'Unknown',
              audio_bitrate: audioInfo.bitrate,
              sample_rate: audioInfo.sampleRate,
              bit_depth: audioInfo.bitDepth,
              channels: audioInfo.channels,
              is_lossless: audioInfo.isLossless,
              is_hi_res: this.isHiRes(audioInfo.sampleRate, audioInfo.bitDepth),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })

            scannedFilePaths.add(filePath)
            result.itemsScanned++

            } catch (error: unknown) {
              result.errors.push(`Failed to save ${path.basename(filePath)}: ${getErrorMessage(error)}`)
            }
          }

          // Checkpoint after each batch
          if (result.itemsScanned > 0) {
            await db.forceSave()
          }
        }
      } finally {
        await db.endBatch()
      }

      // Update album stats (track count, duration, etc.)
      await this.updateAlbumStats(db, albumMap)

      // Update artist stats (album count, track count)
      await this.updateArtistStats(db, artistMap)

      // Update scan time
      await db.updateSourceScanTime(this.sourceId)

      result.success = true
      result.durationMs = Date.now() - startTime

      console.log(`[LocalFolderProvider ${this.sourceId}] Music scan complete: ${result.itemsScanned} tracks, ${artistMap.size} artists, ${albumMap.size} albums`)

      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  private async discoverAudioFiles(
    rootDir: string
  ): Promise<Array<{ filePath: string; relativePath: string }>> {
    const parser = getFileNameParser()
    const files: Array<{ filePath: string; relativePath: string }> = []
    let directoriesProcessed = 0

    const scanDir = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 15) return // Prevent infinite recursion

      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)

          if (entry.isDirectory()) {
            // Skip common non-music folders
            const lowerName = entry.name.toLowerCase()
            if (['@eadir', '.ds_store', 'thumbs', 'metadata', 'artwork', 'scans', 'covers'].includes(lowerName)) {
              continue
            }
            await scanDir(fullPath, depth + 1)
          } else if (parser.isAudioFile(entry.name)) {
            const relativePath = path.relative(rootDir, fullPath)
            files.push({ filePath: fullPath, relativePath })
          }
        }

        // Yield to event loop periodically to prevent UI blocking
        directoriesProcessed++
        if (directoriesProcessed % 50 === 0) {
          await new Promise(resolve => setImmediate(resolve))
        }
      } catch (error) {
        // Skip inaccessible directories
        console.warn(`[LocalFolderProvider] Cannot access directory: ${path.basename(dir)}`)
      }
    }

    await scanDir(rootDir)

    return files
  }

  private isLosslessCodec(codec: string): boolean {
    const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'ape', 'pcm', 'dsd', 'dsf', 'dff']
    const lower = codec.toLowerCase()
    return losslessCodecs.some(c => lower.includes(c))
  }

  private isHiRes(sampleRate?: number, bitDepth?: number): boolean {
    // Hi-Res is typically > 44.1kHz/16-bit
    if (sampleRate && sampleRate > 48000) return true
    if (bitDepth && bitDepth > 16) return true
    return false
  }

  private async updateAlbumStats(
    _db: ReturnType<typeof getDatabase>,
    _albumMap: Map<string, number>
  ): Promise<void> {
    // This would update album stats like track_count, total_duration, etc.
    // For now, we'll leave it simple - the stats are calculated when displaying
  }

  /**
   * Extract album artwork from an audio file's embedded metadata
   * @param audioFilePath Path to the audio file with embedded artwork
   * @param albumId Album ID for naming the output file
   * @param fileAnalyzer MediaFileAnalyzer instance
   * @returns file:// URL to the extracted artwork, or null if extraction failed
   */
  private async extractAlbumArtwork(
    audioFilePath: string,
    albumId: number,
    fileAnalyzer: ReturnType<typeof getMediaFileAnalyzer>
  ): Promise<string | null> {
    try {
      // Create artwork directory in app data
      const userDataPath = app.getPath('userData')
      const artworkDir = path.join(userDataPath, 'artwork', 'albums')

      if (!fs.existsSync(artworkDir)) {
        fs.mkdirSync(artworkDir, { recursive: true })
      }

      // Output path for the artwork
      const outputPath = path.join(artworkDir, `${albumId}.jpg`)

      // Use custom protocol for serving local artwork
      // Format: local-artwork://albums/123.jpg
      const artworkUrl = `local-artwork://albums/${albumId}.jpg`

      // Check if artwork already exists
      if (fs.existsSync(outputPath)) {
        return artworkUrl
      }

      // Extract artwork
      const success = await fileAnalyzer.extractArtwork(audioFilePath, outputPath)

      if (success) {
        console.log(`[LocalFolderProvider] Extracted album artwork for album ${albumId}`)
        return artworkUrl
      }

      return null
    } catch (error) {
      console.warn(`[LocalFolderProvider] Failed to extract artwork from ${path.basename(audioFilePath)}:`, error)
      return null
    }
  }

  /**
   * Find folder artwork (cover.jpg, folder.jpg, etc.) in an album directory
   * Common artwork filenames used by music players and rippers
   */
  private async findFolderArtwork(folderPath: string): Promise<string | null> {
    const artworkFilenames = [
      'cover.jpg', 'cover.jpeg', 'cover.png',
      'folder.jpg', 'folder.jpeg', 'folder.png',
      'front.jpg', 'front.jpeg', 'front.png',
      'album.jpg', 'album.jpeg', 'album.png',
      'albumart.jpg', 'albumart.jpeg', 'albumart.png',
      'artwork.jpg', 'artwork.jpeg', 'artwork.png',
    ]

    try {
      const files = fs.readdirSync(folderPath)
      const lowerFiles = files.map(f => f.toLowerCase())

      for (const artworkName of artworkFilenames) {
        const index = lowerFiles.indexOf(artworkName)
        if (index !== -1) {
          return path.join(folderPath, files[index])
        }
      }

      return null
    } catch {
      return null
    }
  }

  private async updateArtistStats(
    db: ReturnType<typeof getDatabase>,
    artistMap: Map<string, number>
  ): Promise<void> {
    // Update album_count and track_count for each artist
    for (const [, artistId] of artistMap) {
      // Count albums for this artist
      const albums = db.getMusicAlbums({ artistId })
      const albumCount = albums.length

      // Count tracks for this artist
      const tracks = db.getMusicTracks({ artistId })
      const trackCount = tracks.length

      // Update the artist record
      await db.updateMusicArtistCounts(artistId, albumCount, trackCount)
    }
  }
}
