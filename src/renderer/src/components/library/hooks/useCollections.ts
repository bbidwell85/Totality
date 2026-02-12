import { useState, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { MediaItem, MovieCollectionData } from '../types'

interface UseCollectionsReturn {
  showCollectionModal: boolean
  setShowCollectionModal: Dispatch<SetStateAction<boolean>>
  selectedCollection: MovieCollectionData | null
  setSelectedCollection: Dispatch<SetStateAction<MovieCollectionData | null>>
  getCollectionForMovie: (movie: MediaItem) => MovieCollectionData | undefined
  getOwnedMoviesForCollection: (collection: MovieCollectionData) => MediaItem[]
  ownedMoviesForSelectedCollection: MediaItem[]
}

/**
 * Hook to manage movie collection state and lookups
 *
 * Provides functions to find which collection a movie belongs to,
 * and to get owned movies for a collection. Also manages modal state.
 *
 * @param items All media items (used for owned movie lookups)
 * @param movieCollections All movie collections data
 * @returns Collection state, modal controls, and lookup functions
 */
export function useCollections(
  items: MediaItem[],
  movieCollections: MovieCollectionData[]
): UseCollectionsReturn {
  // Collection modal state
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState<MovieCollectionData | null>(null)

  // Get collection data for a movie by checking owned_movie_ids
  const getCollectionForMovie = useCallback(
    (movie: MediaItem): MovieCollectionData | undefined => {
      if (!movie.tmdb_id) return undefined
      return movieCollections.find((c) => {
        try {
          const ownedIds = JSON.parse(c.owned_movie_ids || '[]')
          return ownedIds.includes(movie.tmdb_id)
        } catch {
          return false
        }
      })
    },
    [movieCollections]
  )

  // Get owned movies for a collection
  const getOwnedMoviesForCollection = useCallback(
    (collection: MovieCollectionData): MediaItem[] => {
      try {
        const ownedIds = new Set(JSON.parse(collection.owned_movie_ids || '[]'))
        return items.filter(
          (item) => item.type === 'movie' && item.tmdb_id && ownedIds.has(item.tmdb_id)
        )
      } catch {
        return []
      }
    },
    [items]
  )

  // Memoize owned movies for the selected collection to avoid recalculating on every render
  const ownedMoviesForSelectedCollection = useMemo(() => {
    if (!selectedCollection) return []
    return getOwnedMoviesForCollection(selectedCollection)
  }, [selectedCollection, getOwnedMoviesForCollection])

  return {
    showCollectionModal,
    setShowCollectionModal,
    selectedCollection,
    setSelectedCollection,
    getCollectionForMovie,
    getOwnedMoviesForCollection,
    ownedMoviesForSelectedCollection,
  }
}
