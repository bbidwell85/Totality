import { useState, useCallback, useRef } from 'react'
import type { MediaItem } from '../types'

const MOVIES_PAGE_SIZE = 200

interface UseMoviePaginationOptions {
  activeSourceId: string | null
  activeLibraryId: string | null
  tierFilter: string
  qualityFilter: string
  searchQuery: string
  alphabetFilter: string | null
}

interface UseMoviePaginationReturn {
  paginatedMovies: MediaItem[]
  setPaginatedMovies: React.Dispatch<React.SetStateAction<MediaItem[]>>
  totalMovieCount: number
  moviesLoading: boolean
  loadPaginatedMovies: (reset?: boolean, startOffset?: number) => Promise<void>
  loadMoreMovies: () => void
}

/**
 * Hook to manage server-side paginated movie loading with filters.
 */
export function useMoviePagination({
  activeSourceId,
  activeLibraryId,
  tierFilter,
  qualityFilter,
  searchQuery,
  alphabetFilter,
}: UseMoviePaginationOptions): UseMoviePaginationReturn {
  const [paginatedMovies, setPaginatedMovies] = useState<MediaItem[]>([])
  const [totalMovieCount, setTotalMovieCount] = useState(0)
  const [moviesLoading, setMoviesLoading] = useState(false)
  const moviesOffsetRef = useRef(0)

  const loadPaginatedMovies = useCallback(async (reset = true, startOffset?: number) => {
    if (moviesLoading) return
    setMoviesLoading(true)
    try {
      const offset = reset ? (startOffset ?? 0) : moviesOffsetRef.current
      const filters: Record<string, unknown> = {
        type: 'movie',
        limit: MOVIES_PAGE_SIZE,
        offset,
        sortBy: 'title',
        sortOrder: 'asc',
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (tierFilter !== 'all') filters.qualityTier = tierFilter
      if (qualityFilter !== 'all') filters.tierQuality = qualityFilter.toUpperCase()
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()
      if (alphabetFilter) filters.alphabetFilter = alphabetFilter

      const [movieItems, count] = await Promise.all([
        window.electronAPI.getMediaItems(filters),
        window.electronAPI.countMediaItems(filters),
      ])

      if (reset) {
        setPaginatedMovies(movieItems as MediaItem[])
        moviesOffsetRef.current = MOVIES_PAGE_SIZE
      } else {
        setPaginatedMovies(prev => [...prev, ...(movieItems as MediaItem[])])
        moviesOffsetRef.current = offset + MOVIES_PAGE_SIZE
      }
      setTotalMovieCount(count)
    } catch (err) {
      console.warn('Failed to load paginated movies:', err)
    } finally {
      setMoviesLoading(false)
    }
  }, [activeSourceId, activeLibraryId, tierFilter, qualityFilter, searchQuery, alphabetFilter, moviesLoading])

  const loadMoreMovies = useCallback(() => {
    if (moviesOffsetRef.current < totalMovieCount && !moviesLoading) {
      loadPaginatedMovies(false)
    }
  }, [totalMovieCount, moviesLoading, loadPaginatedMovies])

  return { paginatedMovies, setPaginatedMovies, totalMovieCount, moviesLoading, loadPaginatedMovies, loadMoreMovies }
}
