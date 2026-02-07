import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import {
  CancellableOperation,
  wasRecentlyAnalyzed,
  type AnalysisProgress,
  type AnalysisOptions,
} from './utils/ProgressTracker'
import type { MovieCollection, MissingMovie, MediaItem } from '../types/database'
import type { TMDBCollection, TMDBMovieDetails } from '../types/tmdb'

/** Progress phases for collection analysis */
export type CollectionAnalysisPhase = 'scanning' | 'fetching' | 'complete'

/** Collection analysis progress type */
export type CollectionAnalysisProgress = AnalysisProgress<CollectionAnalysisPhase>

export interface CollectionAnalysisOptions extends AnalysisOptions {
  /** Deduplicate movies across providers by TMDB ID (default: true when no sourceId) */
  deduplicateByTmdbId?: boolean
}

interface CollectionInfo {
  tmdbCollectionId: number
  collectionName: string
  ownedMovies: MediaItem[]
}

interface TMDBLookupProgress {
  current: number
  total: number
  currentItem: string
  phase: 'lookup'
}

export class MovieCollectionService extends CancellableOperation {
  /**
   * Look up TMDB IDs for movies that don't have them
   * This is primarily for local sources (kodi-local, local) that may not have TMDB metadata
   * Uses IMDB ID lookup and title+year search as fallbacks
   */
  private async lookupMissingTMDBIds(
    movies: MediaItem[],
    onProgress?: (progress: TMDBLookupProgress) => void
  ): Promise<{ updated: number; failed: number }> {
    const db = getDatabase()
    const tmdb = getTMDBService()

    // Filter to movies without TMDB IDs
    const moviesWithoutTmdb = movies.filter(m => !m.tmdb_id)

    if (moviesWithoutTmdb.length === 0) {
      return { updated: 0, failed: 0 }
    }

    console.log(`[MovieCollectionService] Looking up TMDB IDs for ${moviesWithoutTmdb.length} movies`)

    let updated = 0
    let failed = 0
    const BATCH_SIZE = 5

    for (let i = 0; i < moviesWithoutTmdb.length; i += BATCH_SIZE) {
      // Check for cancellation
      if (this.isCancelled()) {
        console.log(`[MovieCollectionService] TMDB lookup cancelled at ${i}/${moviesWithoutTmdb.length}`)
        break
      }

      const batch = moviesWithoutTmdb.slice(i, i + BATCH_SIZE)

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (movie) => {
          let tmdbId: string | null = null

          // Method 1: Try IMDB ID lookup via /find endpoint
          if (movie.imdb_id && movie.imdb_id.startsWith('tt')) {
            try {
              const findResult = await tmdb.findByExternalId(movie.imdb_id, 'imdb_id')
              if (findResult.movie_results && findResult.movie_results.length > 0) {
                tmdbId = String(findResult.movie_results[0].id)
                console.log(`[MovieCollectionService] Found "${movie.title}" via IMDB: ${tmdbId}`)
              }
            } catch (error) {
              // Continue to title search
            }
          }

          // Method 2: Fall back to title + year search
          if (!tmdbId) {
            try {
              const searchResults = await tmdb.searchMovie(movie.title, movie.year)
              if (searchResults.results && searchResults.results.length > 0) {
                // Try to find exact match by year first
                const exactMatch = searchResults.results.find(r => {
                  const resultYear = r.release_date ? parseInt(r.release_date.split('-')[0], 10) : null
                  return resultYear === movie.year
                })
                const bestMatch = exactMatch || searchResults.results[0]
                tmdbId = String(bestMatch.id)
                console.log(`[MovieCollectionService] Found "${movie.title}" via search: ${tmdbId}`)
              }
            } catch (error) {
              console.warn(`[MovieCollectionService] Search failed for "${movie.title}":`, error)
            }
          }

          if (tmdbId && movie.id) {
            // Update the movie with the TMDB ID
            await db.updateMovieWithTMDBId(movie.id, tmdbId)
            return { movie, tmdbId, success: true }
          }

          return { movie, tmdbId: null, success: false }
        })
      )

      // Count results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            updated++
          } else {
            failed++
          }
        } else {
          failed++
        }
      }

      // Update progress
      onProgress?.({
        current: Math.min(i + BATCH_SIZE, moviesWithoutTmdb.length),
        total: moviesWithoutTmdb.length,
        currentItem: batch[0]?.title || '',
        phase: 'lookup',
      })
    }

    console.log(`[MovieCollectionService] TMDB lookup complete: ${updated} updated, ${failed} failed`)
    return { updated, failed }
  }


  /**
   * Deduplicate movies by TMDB ID across all providers
   * Keeps the highest quality version (by video bitrate) when duplicates exist
   */
  private deduplicateMoviesByTmdbId(movies: MediaItem[]): MediaItem[] {
    const movieMap = new Map<string, MediaItem>()

    for (const movie of movies) {
      // Skip movies without TMDB ID
      if (!movie.tmdb_id) continue

      const existing = movieMap.get(movie.tmdb_id)
      if (!existing) {
        movieMap.set(movie.tmdb_id, movie)
      } else {
        // Keep the one with higher video bitrate (better quality)
        const existingBitrate = existing.video_bitrate || 0
        const currentBitrate = movie.video_bitrate || 0
        if (currentBitrate > existingBitrate) {
          movieMap.set(movie.tmdb_id, movie)
        }
      }
    }

    return Array.from(movieMap.values())
  }

  /**
   * Get movies deduplicated by TMDB ID across all providers
   * This merges ownership from multiple sources for accurate collection completeness
   */
  private async getMoviesDeduplicatedByTmdbId(
    onProgress?: (progress: CollectionAnalysisProgress) => void
  ): Promise<MediaItem[]> {
    const db = getDatabase()

    // Get all movies from all sources
    const allMovies = db.getMediaItems({ type: 'movie' }) as MediaItem[]
    console.log(`[MovieCollectionService] Cross-provider deduplication: ${allMovies.length} total movies`)

    // For any source that's local, we need TMDB IDs first
    const sources = db.getMediaSources() as Array<{ id: number; source_type: string }>
    const localSourceIds = new Set(
      sources
        .filter((s: typeof sources[0]) => s.source_type === 'kodi-local' || s.source_type === 'local')
        .map((s: typeof sources[0]) => String(s.id))
    )

    // Check if any movies from local sources need TMDB ID lookups
    const localMoviesWithoutTmdb = allMovies.filter(
      m => m.source_id && localSourceIds.has(m.source_id) && !m.tmdb_id
    )

    if (localMoviesWithoutTmdb.length > 0) {
      console.log(`[MovieCollectionService] Looking up TMDB IDs for ${localMoviesWithoutTmdb.length} local movies`)

      const lookupProgressWrapper = onProgress ? (progress: TMDBLookupProgress) => {
        onProgress({
          current: progress.current,
          total: progress.total,
          currentItem: `Looking up: ${progress.currentItem}`,
          phase: 'scanning',
        })
      } : undefined

      await this.lookupMissingTMDBIds(localMoviesWithoutTmdb, lookupProgressWrapper)

      // Check for cancellation after lookup
      if (this.isCancelled()) {
        return []
      }

      // Re-fetch all movies to get updated TMDB IDs
      const updatedMovies = db.getMediaItems({ type: 'movie' }) as MediaItem[]
      const deduplicated = this.deduplicateMoviesByTmdbId(updatedMovies)
      console.log(`[MovieCollectionService] After deduplication: ${deduplicated.length} unique movies`)
      return deduplicated
    }

    const deduplicated = this.deduplicateMoviesByTmdbId(allMovies)
    console.log(`[MovieCollectionService] After deduplication: ${deduplicated.length} unique movies`)
    return deduplicated
  }

  /**
   * Analyze collections using TMDB API
   * 1. For each movie with TMDB ID, lookup which collection it belongs to
   * 2. Group movies by TMDB collection ID
   * 3. Fetch full collection details from TMDB to find all movies in collection
   * 4. Calculate missing movies by comparing with owned movies
   *
   * @param onProgress Progress callback
   * @param sourceId Optional source ID to scope analysis
   * @param libraryId Optional library ID to scope analysis
   * @param options Analysis options for performance tuning
   */
  async analyzeAllCollections(
    onProgress?: (progress: CollectionAnalysisProgress) => void,
    sourceId?: string,
    libraryId?: string,
    options: CollectionAnalysisOptions = {}
  ): Promise<{ completed: boolean; analyzed: number; skipped: number }> {
    // Apply default options
    // Default to deduplication when scanning all sources (no sourceId)
    const {
      skipRecentlyAnalyzed = true,
      reanalyzeAfterDays = 7,
      deduplicateByTmdbId = !sourceId, // Default to true when no sourceId
    } = options
    // Reset cancellation flag at start
    this.resetCancellation()

    const db = getDatabase()
    const tmdb = getTMDBService()

    // Check if TMDB API key is configured
    const tmdbApiKey = db.getSetting('tmdb_api_key')
    if (!tmdbApiKey) {
      console.log('[MovieCollectionService] TMDB API key not configured, cannot analyze collections')
      throw new Error('TMDB API key not configured. Please add your API key in Settings.')
    }

    // Initialize TMDB service
    await tmdb.initialize()

    // Check if source is a local drive (kodi-local or local) - these need TMDB lookups and artwork
    let isLocalSource = false
    if (sourceId) {
      const source = db.getMediaSourceById(sourceId)
      if (source && (source.source_type === 'kodi-local' || source.source_type === 'local')) {
        isLocalSource = true
        console.log('[MovieCollectionService] Local source detected, will lookup missing TMDB IDs and update artwork')
      }
    }

    // Get movies - either deduplicated across providers or from specific source
    let movies: MediaItem[]

    // Define filters for fetching movies (used for non-deduplicated path)
    const filters: { type: 'movie'; sourceId?: string; libraryId?: string } = { type: 'movie' }
    if (sourceId) filters.sourceId = sourceId
    if (libraryId) filters.libraryId = libraryId

    if (deduplicateByTmdbId && !sourceId) {
      console.log('[MovieCollectionService] Using cross-provider deduplication by TMDB ID')
      movies = await this.getMoviesDeduplicatedByTmdbId(onProgress)

      // Check for cancellation after deduplication
      if (this.isCancelled()) {
        return { completed: false, analyzed: 0, skipped: 0 }
      }
    } else {
      // Get movies from specific source/library
      movies = db.getMediaItems(filters) as MediaItem[]
    }

    // For local sources, look up TMDB IDs for movies that don't have them
    if (isLocalSource && !deduplicateByTmdbId) {
      const moviesWithoutTmdb = movies.filter(m => !m.tmdb_id)
      if (moviesWithoutTmdb.length > 0) {
        console.log(`[MovieCollectionService] Looking up TMDB IDs for ${moviesWithoutTmdb.length} movies without them`)

        // Create a lookup progress wrapper that maps to CollectionAnalysisProgress
        const lookupProgressWrapper = onProgress ? (progress: TMDBLookupProgress) => {
          onProgress({
            current: progress.current,
            total: progress.total,
            currentItem: `Looking up: ${progress.currentItem}`,
            phase: 'scanning', // Use scanning phase for lookup
          })
        } : undefined

        await this.lookupMissingTMDBIds(movies, lookupProgressWrapper)

        // Check for cancellation after lookup
        if (this.isCancelled()) {
          return { completed: false, analyzed: 0, skipped: 0 }
        }

        // Re-fetch movies to get updated TMDB IDs
        movies = db.getMediaItems(filters) as MediaItem[]
      }
    }

    // Filter to only movies with TMDB IDs
    const moviesWithTmdb = movies.filter(m => m.tmdb_id)
    console.log(`[MovieCollectionService] Found ${movies.length} movies, ${moviesWithTmdb.length} have TMDB IDs`)

    if (moviesWithTmdb.length === 0) {
      onProgress?.({
        current: 0,
        total: 0,
        currentItem: '',
        phase: 'complete',
      })
      return { completed: true, analyzed: 0, skipped: 0 }
    }

    // Phase 1: Scan movies to find which collections they belong to
    onProgress?.({
      current: 0,
      total: moviesWithTmdb.length,
      currentItem: 'Looking up movie collections from TMDB...',
      phase: 'scanning',
    })

    // Map: TMDB collection ID -> collection info
    const collectionMap = new Map<number, CollectionInfo>()
    let scannedCount = 0
    const BATCH_SIZE = 10

    for (let i = 0; i < moviesWithTmdb.length; i += BATCH_SIZE) {
      // Check for cancellation
      if (this.isCancelled()) {
        console.log(`[MovieCollectionService] Analysis cancelled at ${scannedCount}/${moviesWithTmdb.length}`)
        return { completed: false, analyzed: 0, skipped: 0 }
      }

      const batch = moviesWithTmdb.slice(i, i + BATCH_SIZE)

      // Fetch movie details from TMDB in parallel (with rate limiting handled by TMDBService)
      const detailsResults = await Promise.allSettled(
        batch.map(movie => tmdb.getMovieDetails(movie.tmdb_id!))
      )

      for (let j = 0; j < batch.length; j++) {
        const movie = batch[j]
        const result = detailsResults[j]

        if (result.status === 'fulfilled' && result.value) {
          const details: TMDBMovieDetails = result.value

          // Update artwork for local sources
          if (isLocalSource && sourceId && details.poster_path) {
            const posterUrl = tmdb.buildImageUrl(details.poster_path, 'w500') || undefined
            if (posterUrl) {
              await db.updateMediaItemArtwork(sourceId, movie.plex_id, {
                posterUrl: posterUrl,
              })
            }
          }

          // Check if movie belongs to a collection
          if (details.belongs_to_collection) {
            const collectionId = details.belongs_to_collection.id
            const collectionName = details.belongs_to_collection.name

            if (!collectionMap.has(collectionId)) {
              collectionMap.set(collectionId, {
                tmdbCollectionId: collectionId,
                collectionName: collectionName,
                ownedMovies: []
              })
            }
            collectionMap.get(collectionId)!.ownedMovies.push(movie)
          }
        } else if (result.status === 'rejected') {
          console.warn(`[MovieCollectionService] Failed to get TMDB details for "${movie.title}":`, result.reason)
        }

        scannedCount++
        onProgress?.({
          current: scannedCount,
          total: moviesWithTmdb.length,
          currentItem: movie.title,
          phase: 'scanning',
        })
      }
    }

    console.log(`[MovieCollectionService] Found ${collectionMap.size} collections from TMDB`)

    if (collectionMap.size === 0) {
      onProgress?.({
        current: moviesWithTmdb.length,
        total: moviesWithTmdb.length,
        currentItem: '',
        phase: 'complete',
      })
      return { completed: true, analyzed: 0, skipped: 0 }
    }

    // Pre-fetch existing collections to check for recently analyzed
    const existingCollections = new Map<string, { updatedAt: string; ownedCount: number }>()
    if (skipRecentlyAnalyzed) {
      const allCollections = db.getMovieCollections()
      for (const col of allCollections) {
        if (col.updated_at && col.tmdb_collection_id) {
          existingCollections.set(col.tmdb_collection_id, {
            updatedAt: col.updated_at,
            ownedCount: col.owned_movies,
          })
        }
      }
      console.log(`[MovieCollectionService] Found ${existingCollections.size} existing collections for skip check`)
    }

    // Clear existing collections to sync (only if not skipping)
    if (!skipRecentlyAnalyzed) {
      db.clearMovieCollections()
    }

    // Phase 2: Fetch full collection details and calculate missing movies
    const collectionEntries = Array.from(collectionMap.values())
    let processedCount = 0
    let skipped = 0

    // Start batch mode for efficient writes with checkpoints
    db.startBatch()

    try {
    for (const collectionInfo of collectionEntries) {
      // Check for cancellation - break instead of return to allow finally block to save
      if (this.isCancelled()) {
        console.log(`[MovieCollectionService] Analysis cancelled at ${processedCount}/${collectionEntries.length}`)
        break
      }

      // Check if recently analyzed and owned count hasn't changed
      if (skipRecentlyAnalyzed) {
        const existing = existingCollections.get(collectionInfo.tmdbCollectionId.toString())
        if (existing &&
            wasRecentlyAnalyzed(existing.updatedAt, reanalyzeAfterDays) &&
            existing.ownedCount === collectionInfo.ownedMovies.length) {
          skipped++
          processedCount++
          continue
        }
      }

      onProgress?.({
        current: processedCount + 1,
        total: collectionEntries.length,
        currentItem: collectionInfo.collectionName,
        phase: 'fetching',
        skipped,
      })

      try {
        // Fetch full collection details from TMDB
        const tmdbCollection: TMDBCollection = await tmdb.getCollectionDetails(
          collectionInfo.tmdbCollectionId.toString()
        )

        // Filter to only include released movies (release_date exists and is in the past)
        const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD format
        const releasedParts = tmdbCollection.parts.filter(part => {
          if (!part.release_date) return false
          return part.release_date <= today
        })

        // Skip collections with only 1 movie - these aren't really "collections"
        // This handles edge cases where TMDB has a collection entry for a standalone film
        if (releasedParts.length <= 1) {
          console.log(`[MovieCollectionService] Skipping "${tmdbCollection.name}" - only ${releasedParts.length} released movie(s), not a real collection`)
          processedCount++
          continue
        }

        // Get owned movie TMDB IDs
        const ownedTmdbIds = collectionInfo.ownedMovies
          .map(m => m.tmdb_id)
          .filter(Boolean) as string[]

        // Check which owned movies appear in the collection's parts
        // Note: TMDB can have inconsistencies where a movie's belongs_to_collection field
        // references a collection that doesn't list the movie in its parts array
        const releasedIds = new Set(releasedParts.map(p => p.id.toString()))
        const unvalidatedOwnedIds = ownedTmdbIds.filter(id => !releasedIds.has(id))

        // Log discrepancies but trust the movie's belongs_to_collection field
        if (unvalidatedOwnedIds.length > 0) {
          const unvalidatedMovies = collectionInfo.ownedMovies.filter(m => unvalidatedOwnedIds.includes(m.tmdb_id!))
          console.warn(`[MovieCollectionService] "${tmdbCollection.name}" - movies claim membership but not in TMDB parts: ${unvalidatedMovies.map(m => m.title).join(', ')} - keeping them anyway`)
        }

        // Skip only if we have NO owned movies at all (not just unvalidated ones)
        if (ownedTmdbIds.length === 0) {
          console.log(`[MovieCollectionService] Skipping "${tmdbCollection.name}" - no owned movies found`)
          processedCount++
          continue
        }

        // Use ALL owned IDs (trust belongs_to_collection) not just validated ones
        const allOwnedIdsSet = new Set(ownedTmdbIds)

        // Calculate missing movies (only from released movies, excluding all owned)
        const missingMovies: MissingMovie[] = releasedParts
          .filter(part => !allOwnedIdsSet.has(part.id.toString()))
          .map(part => ({
            tmdb_id: part.id.toString(),
            title: part.title,
            year: part.release_date ? parseInt(part.release_date.split('-')[0], 10) : undefined,
            poster_path: part.poster_path ? tmdb.buildImageUrl(part.poster_path, 'w300') || undefined : undefined
          }))

        const totalMovies = releasedParts.length
        const ownedCount = ownedTmdbIds.length
        const completenessPercentage = totalMovies > 0
          ? Math.round((ownedCount / totalMovies) * 100)
          : 100

        // Build collection data with all owned movie IDs (trusting belongs_to_collection)
        const data: Omit<MovieCollection, 'id' | 'created_at' | 'updated_at'> = {
          tmdb_collection_id: collectionInfo.tmdbCollectionId.toString(),
          collection_name: tmdbCollection.name,
          source_id: sourceId,
          library_id: libraryId,
          total_movies: totalMovies,
          owned_movies: ownedCount,
          missing_movies: JSON.stringify(missingMovies),
          owned_movie_ids: JSON.stringify(ownedTmdbIds),
          completeness_percentage: completenessPercentage,
          poster_url: tmdbCollection.poster_path
            ? tmdb.buildImageUrl(tmdbCollection.poster_path, 'w500') || undefined
            : undefined,
          backdrop_url: tmdbCollection.backdrop_path
            ? tmdb.buildImageUrl(tmdbCollection.backdrop_path, 'original') || undefined
            : undefined,
        }

        await db.upsertMovieCollection(data)

        const missingCount = missingMovies.length
        console.log(`[MovieCollectionService] ${tmdbCollection.name}: ${ownedCount}/${totalMovies} owned, ${missingCount} missing (${completenessPercentage}%)`)

      } catch (error) {
        console.error(`[MovieCollectionService] Failed to fetch collection "${collectionInfo.collectionName}":`, error)

        // Store partial info without TMDB details
        const ownedTmdbIds = collectionInfo.ownedMovies
          .map(m => m.tmdb_id)
          .filter(Boolean) as string[]

        const data: Omit<MovieCollection, 'id' | 'created_at' | 'updated_at'> = {
          tmdb_collection_id: collectionInfo.tmdbCollectionId.toString(),
          collection_name: collectionInfo.collectionName,
          source_id: sourceId,
          library_id: libraryId,
          total_movies: collectionInfo.ownedMovies.length,
          owned_movies: collectionInfo.ownedMovies.length,
          missing_movies: JSON.stringify([]),
          owned_movie_ids: JSON.stringify(ownedTmdbIds),
          completeness_percentage: 100, // Can't determine without TMDB
          poster_url: collectionInfo.ownedMovies[0]?.poster_url,
          backdrop_url: undefined,
        }

        await db.upsertMovieCollection(data)
      }

      processedCount++

      // Checkpoint every 25 collections to save progress
      if (processedCount % 25 === 0) {
        await db.forceSave()
      }
    }
    } finally {
      // Always save on exit (normal completion or cancellation)
      await db.endBatch()
    }

    const wasCompleted = !this.isCancelled()

    onProgress?.({
      current: collectionEntries.length,
      total: collectionEntries.length,
      currentItem: '',
      phase: 'complete',
      skipped,
    })

    console.log(`[MovieCollectionService] Analysis ${wasCompleted ? 'complete' : 'cancelled'}: ${processedCount - skipped} analyzed, ${skipped} skipped`)
    return { completed: wasCompleted, analyzed: processedCount - skipped, skipped }
  }

  /**
   * Get all movie collections
   */
  getCollections(): MovieCollection[] {
    const db = getDatabase()
    return db.getMovieCollections()
  }

  /**
   * Get incomplete collections only
   * @param sourceId Optional source ID to filter by
   */
  getIncompleteCollections(sourceId?: string): MovieCollection[] {
    const db = getDatabase()
    return db.getIncompleteMovieCollections(sourceId)
  }

  /**
   * Delete a collection
   */
  async deleteCollection(id: number): Promise<boolean> {
    const db = getDatabase()
    return await db.deleteMovieCollection(id)
  }

  /**
   * Get collection stats
   */
  getStats(): { total: number; complete: number; incomplete: number; totalMissing: number; avgCompleteness: number } {
    const db = getDatabase()
    return db.getMovieCollectionStats()
  }
}

// Singleton instance
let serviceInstance: MovieCollectionService | null = null

export function getMovieCollectionService(): MovieCollectionService {
  if (!serviceInstance) {
    serviceInstance = new MovieCollectionService()
  }
  return serviceInstance
}
