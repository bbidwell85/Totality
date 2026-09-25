import { useState, useCallback, useRef } from 'react'
import type { MediaItem, TVShowSummary } from '../types'

const SHOWS_PAGE_SIZE = 200

interface UseTVShowPaginationOptions {
  activeSourceId: string | null
  activeLibraryId: string | null
  searchQuery: string
  alphabetFilter: string | null
}

interface UseTVShowPaginationReturn {
  paginatedShows: TVShowSummary[]
  setPaginatedShows: React.Dispatch<React.SetStateAction<TVShowSummary[]>>
  totalShowCount: number
  totalEpisodeCount: number
  showsLoading: boolean
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
  alphabetFilter,
}: UseTVShowPaginationOptions): UseTVShowPaginationReturn {
  const [paginatedShows, setPaginatedShows] = useState<TVShowSummary[]>([])
  const [totalShowCount, setTotalShowCount] = useState(0)
  const [totalEpisodeCount, setTotalEpisodeCount] = useState(0)
  const [showsLoading, setShowsLoading] = useState(false)
  const showsOffsetRef = useRef(0)
  const [selectedShowEpisodes, setSelectedShowEpisodes] = useState<MediaItem[]>([])
  const [selectedShowEpisodesLoading, setSelectedShowEpisodesLoading] = useState(false)

  const loadPaginatedShows = useCallback(async (reset = true, startOffset?: number) => {
    if (showsLoading) return
    setShowsLoading(true)
    try {
      const offset = reset ? (startOffset ?? 0) : showsOffsetRef.current
      const filters: Record<string, unknown> = {
        limit: SHOWS_PAGE_SIZE,
        offset,
        sortBy: 'title',
        sortOrder: 'asc',
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()
      if (alphabetFilter) filters.alphabetFilter = alphabetFilter

      const [newShows, count, episodeCount] = await Promise.all([
        window.electronAPI.getTVShows(filters),
        window.electronAPI.countTVShows(filters),
        window.electronAPI.countTVEpisodes(filters),
      ])

      if (reset) {
        setPaginatedShows(newShows as TVShowSummary[])
        showsOffsetRef.current = SHOWS_PAGE_SIZE
      } else {
        setPaginatedShows(prev => [...prev, ...(newShows as TVShowSummary[])])
        showsOffsetRef.current = offset + SHOWS_PAGE_SIZE
      }
      setTotalShowCount(count as number)
      setTotalEpisodeCount(episodeCount as number)
    } catch (err) {
      console.error('Error loading TV shows:', err)
    } finally {
      setShowsLoading(false)
    }
  }, [showsLoading, activeSourceId, activeLibraryId, searchQuery, alphabetFilter])

  const loadMoreShows = useCallback(() => {
    if (showsOffsetRef.current < totalShowCount && !showsLoading) {
      loadPaginatedShows(false)
    }
  }, [totalShowCount, showsLoading, loadPaginatedShows])

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
    paginatedShows, setPaginatedShows,
    totalShowCount, totalEpisodeCount, showsLoading,
    selectedShowEpisodes, setSelectedShowEpisodes, selectedShowEpisodesLoading,
    loadPaginatedShows, loadMoreShows, loadSelectedShowEpisodes,
  }
}
