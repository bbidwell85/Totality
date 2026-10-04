import { useState, useCallback, useRef } from 'react'
import { usePagination } from './usePagination'
import type { MediaItem } from '../types'

export type MovieSortBy = 'title' | 'year' | 'play_count' | 'last_watched_at' | 'tmdb_rating'

interface UseMoviePaginationOptions {
  activeSourceId: string | null
  activeLibraryId: string | null
  tierFilter: string
  qualityFilter: string
  searchQuery: string
}

interface UseMoviePaginationReturn {
  paginatedMovies: MediaItem[]
  setPaginatedMovies: React.Dispatch<React.SetStateAction<MediaItem[]>>
  totalMovieCount: number
  moviesLoading: boolean
  movieSortBy: MovieSortBy
  setMovieSortBy: (sort: MovieSortBy) => void
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
}: UseMoviePaginationOptions): UseMoviePaginationReturn {
  const [movieSortBy, setMovieSortByState] = useState<MovieSortBy>('title')
  const movieSortByRef = useRef<MovieSortBy>('title')

  const setMovieSortBy = useCallback((sort: MovieSortBy) => {
    movieSortByRef.current = sort
    setMovieSortByState(sort)
  }, [])

  const { items, setItems, totalCount, loading, load, loadMore } = usePagination<MediaItem>({
    pageSize: 10000,
    fetchItems: (filters) => window.electronAPI.getMediaItems(filters) as Promise<MediaItem[]>,
    fetchCount: (filters) => window.electronAPI.countMediaItems(filters) as Promise<number>,
    buildFilters: () => {
      const sortBy = movieSortByRef.current
      const sortOrder = (sortBy === 'play_count' || sortBy === 'last_watched_at' || sortBy === 'tmdb_rating') ? 'desc' : 'asc'
      const filters: Record<string, unknown> = {
        type: 'movie',
        sortBy,
        sortOrder,
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (tierFilter !== 'all') filters.qualityTier = tierFilter
      if (qualityFilter !== 'all') filters.tierQuality = qualityFilter.toUpperCase()
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()
      return filters
    },
    deps: [activeSourceId, activeLibraryId, tierFilter, qualityFilter, searchQuery],
  })

  return {
    paginatedMovies: items,
    setPaginatedMovies: setItems,
    totalMovieCount: totalCount,
    moviesLoading: loading,
    movieSortBy,
    setMovieSortBy,
    loadPaginatedMovies: load,
    loadMoreMovies: loadMore,
  }
}
