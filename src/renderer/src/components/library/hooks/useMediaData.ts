import { useState, useCallback, useRef, useMemo } from 'react'
import type {
  MediaItem,
  LibraryStats,
  SeriesCompletenessData,
  MovieCollectionData,
  SeriesStats,
  CollectionStats,
} from '../types'

type MediaViewType = 'movies' | 'tv' | 'music'

interface UseMediaDataOptions {
  activeSourceId: string | null
  filterItem: (item: MediaItem) => boolean
}

interface UseMediaDataReturn {
  // Core data
  items: MediaItem[]
  stats: LibraryStats | null
  // Loading states
  loading: boolean
  isRefreshing: boolean
  error: string | null
  // View state
  view: MediaViewType
  setView: (view: MediaViewType) => void
  selectedMediaId: number | null
  setSelectedMediaId: (id: number | null) => void
  detailRefreshKey: number
  setDetailRefreshKey: (fn: (prev: number) => number) => void
  viewType: 'grid' | 'list'
  setViewType: (type: 'grid' | 'list') => void
  gridScale: number
  setGridScale: (scale: number) => void
  // Completeness data
  seriesCompleteness: Map<string, SeriesCompletenessData>
  movieCollections: MovieCollectionData[]
  seriesStats: SeriesStats | null
  collectionStats: CollectionStats | null
  // Computed data
  movies: MediaItem[]
  hasInitialLoad: boolean
  // Data loading
  loadMedia: () => Promise<void>
  loadStats: (sourceId?: string) => Promise<void>
  loadCompletenessData: () => Promise<void>
}

/**
 * Hook to manage core media data loading and state
 *
 * Handles loading media items, stats, and completeness data,
 * as well as view state and selection.
 *
 * @param options Media data configuration
 * @returns Media data state and loading functions
 */
export function useMediaData({
  activeSourceId,
  filterItem,
}: UseMediaDataOptions): UseMediaDataReturn {
  // Core data state
  const [items, setItems] = useState<MediaItem[]>([])
  const [stats, setStats] = useState<LibraryStats | null>(null)

  // Loading states
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasInitialLoadRef = useRef(false)

  // View state
  const [view, setView] = useState<MediaViewType>('movies')
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [viewType, setViewType] = useState<'grid' | 'list'>('grid')
  const [gridScale, setGridScale] = useState(4)

  // Completeness state
  const [seriesCompleteness, setSeriesCompleteness] = useState<
    Map<string, SeriesCompletenessData>
  >(new Map())
  const [movieCollections, setMovieCollections] = useState<MovieCollectionData[]>([])
  const [seriesStats, setSeriesStats] = useState<SeriesStats | null>(null)
  const [collectionStats, setCollectionStats] = useState<CollectionStats | null>(null)

  // Load media items
  const loadMedia = useCallback(async () => {
    try {
      // Use refreshing state after initial load (source switching)
      // Use loading state only for initial load
      if (hasInitialLoadRef.current) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      // Build filters with active source
      const filters: { sourceId?: string } = {}
      if (activeSourceId) {
        filters.sourceId = activeSourceId
      }

      const mediaItems = (await window.electronAPI.getMediaItems(filters)) as MediaItem[]
      setItems(mediaItems)
      hasInitialLoadRef.current = true
    } catch (err) {
      console.error('Error loading media:', err)
      setError('Failed to load media items')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [activeSourceId])

  // Load library stats
  const loadStats = useCallback(async (sourceId?: string) => {
    try {
      const libraryStats = await window.electronAPI.getLibraryStats(sourceId)
      setStats(libraryStats)
    } catch (err) {
      console.warn('Failed to load library stats:', err)
    }
  }, [])

  // Load completeness data (non-blocking background load)
  const loadCompletenessData = useCallback(async () => {
    try {
      const [seriesData, collectionsData, sStats, cStats] = await Promise.all([
        window.electronAPI.seriesGetAll(),
        window.electronAPI.collectionsGetAll(),
        window.electronAPI.seriesGetStats(),
        window.electronAPI.collectionsGetStats(),
      ])

      // Index series by title for O(1) lookup
      const seriesMap = new Map<string, SeriesCompletenessData>()
      ;(seriesData as SeriesCompletenessData[]).forEach((s) => {
        seriesMap.set(s.series_title, s)
      })
      setSeriesCompleteness(seriesMap)
      setMovieCollections(collectionsData as MovieCollectionData[])
      setSeriesStats(sStats as SeriesStats)
      setCollectionStats(cStats as CollectionStats)
    } catch (err) {
      console.warn('Failed to load completeness data:', err)
    }
  }, [])

  // Filtered movies
  const movies = useMemo(
    () => items.filter((item) => item.type === 'movie' && filterItem(item)),
    [items, filterItem]
  )

  return {
    // Core data
    items,
    stats,
    // Loading states
    loading,
    isRefreshing,
    error,
    // View state
    view,
    setView,
    selectedMediaId,
    setSelectedMediaId,
    detailRefreshKey,
    setDetailRefreshKey,
    viewType,
    setViewType,
    gridScale,
    setGridScale,
    // Completeness data
    seriesCompleteness,
    movieCollections,
    seriesStats,
    collectionStats,
    // Computed data
    movies,
    hasInitialLoad: hasInitialLoadRef.current,
    // Data loading
    loadMedia,
    loadStats,
    loadCompletenessData,
  }
}
