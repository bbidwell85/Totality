import { useState, useCallback, useRef } from 'react'
import { usePagination } from './usePagination'
import type { MediaItem, TVShowSummary } from '../types'

export type TVShowSortBy = 'title' | 'play_count' | 'last_watched_at'

interface UseTVShowPaginationOptions {
  activeSourceId: string | null
  activeLibraryId: string | null
  searchQuery: string
}

interface UseTVShowPaginationReturn {
  paginatedShows: TVShowSummary[]
  setPaginatedShows: React.Dispatch<React.SetStateAction<TVShowSummary[]>>
  totalShowCount: number
  totalEpisodeCount: number
  showsLoading: boolean
  tvSortBy: TVShowSortBy
  setTvSortBy: (sort: TVShowSortBy) => void
  selectedShowEpisodes: MediaItem[]
  setSelectedShowEpisodes: React.Dispatch<React.SetStateAction<MediaItem[]>>
  selectedShowEpisodesLoading: boolean
  loadPaginatedShows: (reset?: boolean, startOffset?: number) => Promise<void>
  loadMoreShows: () => void
  loadSelectedShowEpisodes: (showTitle: string) => Promise<void>
}

/**
 * Hook to manage server-side paginated TV show loading with on-demand episode loading.
 */
export function useTVShowPagination({
  activeSourceId,
  activeLibraryId,
  searchQuery,
}: UseTVShowPaginationOptions): UseTVShowPaginationReturn {
  const [totalEpisodeCount, setTotalEpisodeCount] = useState(0)
  const [tvSortBy, setTvSortByState] = useState<TVShowSortBy>('title')
  const tvSortByRef = useRef<TVShowSortBy>('title')
  const setTvSortBy = useCallback((sort: TVShowSortBy) => {
    tvSortByRef.current = sort
    setTvSortByState(sort)
  }, [])
  const [selectedShowEpisodes, setSelectedShowEpisodes] = useState<MediaItem[]>([])
  const [selectedShowEpisodesLoading, setSelectedShowEpisodesLoading] = useState(false)

  const { items, setItems, totalCount, loading, load, loadMore } = usePagination<TVShowSummary>({
    pageSize: 10000,
    fetchItems: async (filters) => {
      const [shows, , episodeCount] = await Promise.all([
        window.electronAPI.getTVShows(filters),
        // Count is handled by usePagination via fetchCount
        Promise.resolve(0),
        window.electronAPI.countTVEpisodes(filters),
      ])
      setTotalEpisodeCount(episodeCount as number)
      return shows as TVShowSummary[]
    },
    fetchCount: (filters) => window.electronAPI.countTVShows(filters) as Promise<number>,
    buildFilters: () => {
      const sortBy = tvSortByRef.current
      const sortOrder = (sortBy === 'play_count' || sortBy === 'last_watched_at') ? 'desc' : 'asc'
      const filters: Record<string, unknown> = { sortBy, sortOrder }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()
      return filters
    },
    deps: [activeSourceId, activeLibraryId, searchQuery],
  })

  const loadSelectedShowEpisodes = useCallback(async (showTitle: string) => {
    setSelectedShowEpisodesLoading(true)
    try {
      const episodes = await window.electronAPI.seriesGetEpisodes(showTitle, activeSourceId || undefined)
      setSelectedShowEpisodes(episodes as MediaItem[])
    } catch (err) {
      console.error('Error loading episodes for show:', err)
      setSelectedShowEpisodes([])
    } finally {
      setSelectedShowEpisodesLoading(false)
    }
  }, [activeSourceId])

  return {
    paginatedShows: items,
    setPaginatedShows: setItems,
    totalShowCount: totalCount,
    totalEpisodeCount,
    showsLoading: loading,
    tvSortBy, setTvSortBy,
    selectedShowEpisodes, setSelectedShowEpisodes, selectedShowEpisodesLoading,
    loadPaginatedShows: load,
    loadMoreShows: loadMore,
    loadSelectedShowEpisodes,
  }
}
