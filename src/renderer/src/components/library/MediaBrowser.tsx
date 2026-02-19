import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { MediaDetails } from './MediaDetails'
import { CompletenessPanel } from './CompletenessPanel'
import { MissingItemPopup } from './MissingItemPopup'
import { CollectionModal } from './CollectionModal'
import { MatchFixModal } from './MatchFixModal'
import { WishlistPanel } from '../wishlist/WishlistPanel'
import { ActivityPanel } from '../ui/ActivityPanel'
import { MoviesView } from './MoviesView'
import { TVShowsView } from './TVShowsView'
import { MusicView } from './MusicView'
import { Grid3x3, List, Search, X, Library, Layers, Music, Disc3, User, RefreshCw, Film, Tv, CircleFadingArrowUp, Settings, Star, Home } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'
import { useNavigation } from '../../contexts/NavigationContext'
import { useWishlist } from '../../contexts/WishlistContext'
import { useToast } from '../../contexts/ToastContext'
import { EnhancedEmptyState } from '../onboarding'
import logoImage from '../../assets/totality_header_logo.png'
import { MoviePlaceholder, TvPlaceholder, EpisodePlaceholder } from '../ui/MediaPlaceholders'

// Import extracted hooks (more hooks available in ./hooks for gradual migration)
import {
  useThemeAccent,
  usePanelState,
  useLibraryFilters,
  useCollections,
  useMediaActions,
  useAnalysisManager,
  useDismissHandlers,
  useLibraryEventListeners,
} from './hooks'
import {
  emitDismissUpgrade,
} from '../../utils/dismissEvents'

// Import types from shared types file
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicStats,
  MediaItem,
  TVShow,
  TVShowSummary,
  TVSeason,
  LibraryStats,
  SeriesCompletenessData,
  MovieCollectionData,
  SeriesStats,
  CollectionStats,
  MusicCompletenessStats,
  ArtistCompletenessData,
  AlbumCompletenessData,
  MediaBrowserProps,
} from './types'

export function MediaBrowser({
  onAddSource: _onAddSource,
  onOpenSettings,
  sidebarCollapsed = false,
  onNavigateHome,
  initialTab,
  hideHeader = false,
  showCompletenessPanel: externalShowCompletenessPanel,
  showWishlistPanel: externalShowWishlistPanel,
  onToggleCompleteness: externalToggleCompleteness,
  onToggleWishlist: externalToggleWishlist,
  libraryTab,
  onLibraryTabChange,
  onAutoRefreshChange
}: MediaBrowserProps) {
  const { sources, activeSourceId, scanProgress, setActiveSource, markLibraryAsNew } = useSources()
  const { addToast } = useToast()
  const { count: wishlistCount } = useWishlist()
  const { pendingNavigation, clearNavigation } = useNavigation()

  // Use extracted hooks
  const themeAccentColor = useThemeAccent()

  // Panel state (completeness/wishlist panels)
  const {
    showCompletenessPanel,
    showWishlistPanel,
    setShowCompletenessPanel,
    setShowWishlistPanel,
  } = usePanelState({
    externalShowCompletenessPanel,
    externalShowWishlistPanel,
    onToggleCompleteness: externalToggleCompleteness,
    onToggleWishlist: externalToggleWishlist,
  })

  const [loading, setLoading] = useState(true)
  const isRefreshing = false // Placeholder: set to true during source switching for dimmed UI
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false) // For background incremental scan on app start
  const error: string | null = null // Placeholder: set during load failures
  const hasInitialLoadRef = useRef(false) // Track if initial load is complete
  const hasAutoSwitchedRef = useRef(false) // Track if auto-switch has been done (to prevent loop)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [view, setView] = useState<'movies' | 'tv' | 'music'>('movies')

  // Music state
  const [musicArtists, setMusicArtists] = useState<MusicArtist[]>([])
  const [musicAlbums, setMusicAlbums] = useState<MusicAlbum[]>([])
  const [musicStats, setMusicStats] = useState<MusicStats | null>(null)
  const [selectedArtist, setSelectedArtist] = useState<MusicArtist | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<MusicAlbum | null>(null)
  const [albumTracks, setAlbumTracks] = useState<MusicTrack[]>([])
  const [allMusicTracks, setAllMusicTracks] = useState<MusicTrack[]>([])
  const [totalTrackCount, setTotalTrackCount] = useState(0)
  const [tracksLoading, setTracksLoading] = useState(false)
  const tracksOffsetRef = useRef(0)
  const TRACKS_PAGE_SIZE = 500
  const [selectedAlbumCompleteness, setSelectedAlbumCompleteness] = useState<AlbumCompletenessData | null>(null)
  const [musicViewMode, setMusicViewMode] = useState<'artists' | 'albums' | 'tracks'>('artists')
  const [trackSortColumn, setTrackSortColumn] = useState<'title' | 'artist' | 'album' | 'codec' | 'duration'>('title')
  const [trackSortDirection, setTrackSortDirection] = useState<'asc' | 'desc'>('asc')
  // Artist pagination state
  const [totalArtistCount, setTotalArtistCount] = useState(0)
  const [artistsLoading, setArtistsLoading] = useState(false)
  const artistsOffsetRef = useRef(0)
  const ARTISTS_PAGE_SIZE = 50
  // Album pagination state
  const [totalAlbumCount, setTotalAlbumCount] = useState(0)
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const albumsOffsetRef = useRef(0)
  const ALBUMS_PAGE_SIZE = 200
  const [albumSortColumn, setAlbumSortColumn] = useState<'title' | 'artist'>('title')
  const [albumSortDirection, setAlbumSortDirection] = useState<'asc' | 'desc'>('asc')
  // Movie pagination state
  const [paginatedMovies, setPaginatedMovies] = useState<MediaItem[]>([])
  const [totalMovieCount, setTotalMovieCount] = useState(0)
  const [moviesLoading, setMoviesLoading] = useState(false)
  const moviesOffsetRef = useRef(0)
  const MOVIES_PAGE_SIZE = 200
  // TV show pagination state
  const [paginatedShows, setPaginatedShows] = useState<TVShowSummary[]>([])
  const [totalShowCount, setTotalShowCount] = useState(0)
  const [showsLoading, setShowsLoading] = useState(false)
  const showsOffsetRef = useRef(0)
  const SHOWS_PAGE_SIZE = 200
  // Selected show episode loading (on-demand)
  const [selectedShowEpisodes, setSelectedShowEpisodes] = useState<MediaItem[]>([])
  const [selectedShowEpisodesLoading, setSelectedShowEpisodesLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  // Filters (extracted to useLibraryFilters hook)
  const {
    tierFilter, setTierFilter,
    qualityFilter, setQualityFilter,
    alphabetFilter, setAlphabetFilter,
    debouncedTierFilter, debouncedQualityFilter,
  } = useLibraryFilters(searchInput)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [searchQuery, _setSearchQuery] = useState('')
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [searchResultIndex, setSearchResultIndex] = useState(-1)
  const [searchTrackResults, setSearchTrackResults] = useState<Array<{ id: number; title: string; album_id: number; album_title?: string; artist_name?: string; thumb_url?: string; needs_upgrade: boolean; type: 'track' }>>([])
  const searchTrackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const moviesTabRef = useRef<HTMLButtonElement>(null)
  const tvTabRef = useRef<HTMLButtonElement>(null)
  const musicTabRef = useRef<HTMLButtonElement>(null)
  const completenessButtonRef = useRef<HTMLButtonElement>(null)
  const wishlistButtonRef = useRef<HTMLButtonElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  // Filter refs - using Map for dynamic buttons
  const tierFilterRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const qualityFilterRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const alphabetFilterRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const gridViewRef = useRef<HTMLButtonElement>(null)
  const listViewRef = useRef<HTMLButtonElement>(null)
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0) // Increment to force detail view refresh
  const [viewType, setViewType] = useState<'grid' | 'list'>('grid')
  const [gridScale, setGridScale] = useState(4) // 1-7 scale for grid columns (4 = 50%)
  const [collectionsOnly, setCollectionsOnly] = useState(false)

  // TV Show navigation
  const [selectedShow, setSelectedShow] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)

  // Completeness state
  const [seriesCompleteness, setSeriesCompleteness] = useState<Map<string, SeriesCompletenessData>>(new Map())
  const [movieCollections, setMovieCollections] = useState<MovieCollectionData[]>([])
  const [seriesStats, setSeriesStats] = useState<SeriesStats | null>(null)
  const [collectionStats, setCollectionStats] = useState<CollectionStats | null>(null)
  const [musicCompletenessStats, setMusicCompletenessStats] = useState<MusicCompletenessStats | null>(null)
  const [artistCompleteness, setArtistCompleteness] = useState<Map<string, ArtistCompletenessData>>(new Map())
  const [allAlbumCompleteness, setAllAlbumCompleteness] = useState<Map<number, AlbumCompletenessData>>(new Map())
  // EP/Singles inclusion settings (for real-time filtering)
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)
  // isAnalyzing, analysisProgress, analysisType, tmdbApiKeySet, analysis handlers: see useAnalysisManager hook below

  // Collection modal state + helpers (extracted hook)
  const {
    showCollectionModal, setShowCollectionModal,
    selectedCollection, setSelectedCollection,
    getCollectionForMovie,
    ownedMoviesForSelectedCollection,
  } = useCollections(paginatedMovies, movieCollections)

  // matchFixModal, selectedMissingItem, handleRescanItem provided by useMediaActions hook (below pagination functions)

  // Active source libraries (to determine which library types exist)
  const [activeSourceLibraries, setActiveSourceLibraries] = useState<Array<{ id: string; name: string; type: string }>>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_librariesLoading, setLibrariesLoading] = useState(false)

  // Library filter within current view
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null)

  // Libraries of the current view type (for library filter dropdown)
  const currentTypeLibraries = useMemo(() =>
    activeSourceLibraries.filter(lib =>
      view === 'movies' ? lib.type === 'movie' :
      view === 'tv' ? lib.type === 'show' :
      lib.type === 'music'
    ), [activeSourceLibraries, view])

  // Reset library filter when view or source changes
  useEffect(() => {
    setActiveLibraryId(null)
  }, [view, activeSourceId])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // W - Toggle wishlist panel
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        setShowWishlistPanel(prev => {
          const newState = !prev
          if (newState) setShowCompletenessPanel(false)
          return newState
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle initialTab prop from dashboard navigation
  useEffect(() => {
    if (initialTab) {
      setView(initialTab)
    }
  }, [initialTab])

  // Sync view with external libraryTab prop (one-way: prop → state)
  // Only update when prop changes, not on every render
  useEffect(() => {
    if (libraryTab && libraryTab !== view) {
      setView(libraryTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryTab])
  // Note: Removed auto-notify effect to break bidirectional sync loop
  // Parent is notified only via explicit user tab clicks (see handleTabClick)

  // Notify parent when auto-refresh state changes
  useEffect(() => {
    onAutoRefreshChange?.(isAutoRefreshing)
  }, [isAutoRefreshing, onAutoRefreshChange])

  // Load libraries for active source - only include enabled libraries
  // This ensures unchecked libraries don't appear in the top menu bar
  const loadActiveSourceLibraries = useCallback(async () => {
    if (activeSourceId) {
      setLibrariesLoading(true)
      try {
        // Use getLibrariesWithStatus to get enabled status, then filter
        const libsWithStatus = await window.electronAPI.sourcesGetLibrariesWithStatus(activeSourceId)
        const enabledLibs = libsWithStatus.filter(lib => lib.isEnabled)
        setActiveSourceLibraries(enabledLibs)
      } catch (err) {
        console.error('Failed to load active source libraries:', err)
        // Don't reset to empty on error - keep previous libraries visible
        // This prevents buttons from disappearing when a connection check fails
      } finally {
        setLibrariesLoading(false)
      }
    } else {
      setActiveSourceLibraries([])
      setLibrariesLoading(false)
    }
  }, [activeSourceId])

  useEffect(() => {
    loadActiveSourceLibraries()
  }, [loadActiveSourceLibraries])

  // Event listeners and initial data load placed after pagination functions (see below)


  // Compute which library types exist for the active source
  // When a source is selected, check its actual library types
  // When no source is selected (all sources), check global stats
  const hasMovies = activeSourceId
    ? activeSourceLibraries.some(lib => lib.type === 'movie')
    : (stats?.totalMovies ?? 0) > 0
  const hasTV = activeSourceId
    ? activeSourceLibraries.some(lib => lib.type === 'show')
    : (stats?.totalShows ?? 0) > 0
  const hasMusic = activeSourceId
    ? activeSourceLibraries.some(lib => lib.type === 'music')
    : (musicStats?.totalArtists ?? 0) > 0

  // Auto-switch view if current view has no content (only on initial load)
  useEffect(() => {
    // Only auto-switch once to prevent loops
    if (!loading && !hasAutoSwitchedRef.current) {
      if (view === 'movies' && !hasMovies) {
        if (hasTV) setView('tv')
        else if (hasMusic) setView('music')
      } else if (view === 'tv' && !hasTV) {
        if (hasMovies) setView('movies')
        else if (hasMusic) setView('music')
      } else if (view === 'music' && !hasMusic) {
        if (hasMovies) setView('movies')
        else if (hasTV) setView('tv')
      }
      // Mark as done after checking (even if no switch needed)
      if (hasMovies || hasTV || hasMusic) {
        hasAutoSwitchedRef.current = true
      }
    }
  }, [hasMovies, hasTV, hasMusic, view, loading])

  const loadStats = async (sourceId?: string) => {
    try {
      const libraryStats = await window.electronAPI.getLibraryStats(sourceId || undefined)
      setStats(libraryStats)
    } catch (err) {
      console.warn('Failed to load library stats:', err)
    }
  }

  // Load completeness data (non-blocking background load)
  const loadCompletenessData = async () => {
    try {
      const [seriesData, collectionsData, , , collectionExclusions, seriesExclusions] = await Promise.all([
        window.electronAPI.seriesGetAll(activeSourceId || undefined),
        window.electronAPI.collectionsGetAll(activeSourceId || undefined),
        window.electronAPI.seriesGetStats(),
        window.electronAPI.collectionsGetStats(),
        window.electronAPI.getExclusions('collection_movie'),
        window.electronAPI.getExclusions('series_episode'),
      ])

      // Build exclusion lookup sets
      const excludedCollectionMovies = new Set(collectionExclusions.map((e: { parent_key: string | null; reference_key: string | null }) => `${e.parent_key}:${e.reference_key}`))
      const excludedSeriesEpisodes = new Set(seriesExclusions.map((e: { parent_key: string | null; reference_key: string | null }) => `${e.parent_key}:${e.reference_key}`))

      // Filter collections: remove excluded missing movies, adjust totals
      const filteredCollections = (collectionsData as MovieCollectionData[])
        .map(c => {
          try {
            const missing = JSON.parse(c.missing_movies || '[]')
            const filtered = missing.filter((m: { tmdb_id: string }) => !excludedCollectionMovies.has(`${c.tmdb_collection_id}:${m.tmdb_id}`))
            if (filtered.length !== missing.length) {
              const excludedCount = missing.length - filtered.length
              const newTotal = c.total_movies - excludedCount
              return {
                ...c,
                missing_movies: JSON.stringify(filtered),
                total_movies: newTotal,
                completeness_percentage: newTotal > 0 ? c.owned_movies / newTotal * 100 : 100
              }
            }
          } catch { /* keep original */ }
          return c
        })
        .filter(c => c.total_movies > 1)
      setMovieCollections(filteredCollections)

      // Filter series: remove excluded missing episodes
      const seriesMap = new Map<string, SeriesCompletenessData>()
      ;(seriesData as SeriesCompletenessData[]).forEach(s => {
        try {
          const missing = JSON.parse(s.missing_episodes || '[]')
          const parentKey = s.tmdb_id || s.series_title
          const filtered = missing.filter((ep: { season_number: number; episode_number: number }) =>
            !excludedSeriesEpisodes.has(`${parentKey}:S${ep.season_number}E${ep.episode_number}`)
          )
          if (filtered.length !== missing.length) {
            seriesMap.set(s.series_title, { ...s, missing_episodes: JSON.stringify(filtered) })
            return
          }
        } catch { /* keep original */ }
        seriesMap.set(s.series_title, s)
      })
      setSeriesCompleteness(seriesMap)

      // Compute stats from filtered data so dismissed items are excluded
      const seriesEntries = Array.from(seriesMap.values())
      setSeriesStats({
        totalSeries: seriesEntries.length,
        completeSeries: seriesEntries.filter(s => {
          try { return JSON.parse(s.missing_episodes || '[]').length === 0 } catch { return true }
        }).length,
        incompleteSeries: seriesEntries.filter(s => {
          try { return JSON.parse(s.missing_episodes || '[]').length > 0 } catch { return false }
        }).length,
        totalMissingEpisodes: seriesEntries.reduce((sum, s) => {
          try { return sum + JSON.parse(s.missing_episodes || '[]').length } catch { return sum }
        }, 0),
        averageCompleteness: seriesEntries.length > 0
          ? Math.round(seriesEntries.reduce((sum, s) => sum + (s.completeness_percentage || 0), 0) / seriesEntries.length)
          : 0,
      })
      setCollectionStats({
        total: filteredCollections.length,
        complete: filteredCollections.filter(c => c.completeness_percentage >= 100).length,
        incomplete: filteredCollections.filter(c => c.completeness_percentage < 100).length,
        totalMissing: filteredCollections.reduce((sum, c) => {
          try { return sum + JSON.parse(c.missing_movies || '[]').length } catch { return sum }
        }, 0),
        avgCompleteness: filteredCollections.length > 0
          ? Math.round(filteredCollections.reduce((sum, c) => sum + c.completeness_percentage, 0) / filteredCollections.length)
          : 0,
      })
    } catch (err) {
      console.warn('Failed to load completeness data:', err)
    }
  }

  // Analysis state + handlers (extracted hook)
  const {
    isAnalyzing, setIsAnalyzing,
    analysisProgress, setAnalysisProgress,
    analysisType, setAnalysisType,
    tmdbApiKeySet, setTmdbApiKeySet,
    handleAnalyzeSeries, handleAnalyzeCollections, handleAnalyzeMusic,
    handleAnalyzeSingleSeries, handleCancelAnalysis, checkTmdbApiKey,
  } = useAnalysisManager({ sources, activeSourceId, activeSourceLibraries, loadCompletenessData })

  // Load music stats (non-blocking background load)
  const loadMusicData = async () => {
    try {
      const mStats = await window.electronAPI.musicGetStats(activeSourceId || undefined)
      setMusicStats(mStats as MusicStats)
    } catch (err) {
      console.warn('Failed to load music stats:', err)
    }
    // Also reload paginated artists when music data refreshes
    loadPaginatedArtists(true)
  }

  // Load paginated artists from server with current filters/sorting
  const loadPaginatedArtists = useCallback(async (reset = true) => {
    if (artistsLoading) return
    setArtistsLoading(true)
    try {
      const offset = reset ? 0 : artistsOffsetRef.current
      const filters: Record<string, unknown> = {
        limit: ARTISTS_PAGE_SIZE,
        offset,
        sortBy: 'name',
        sortOrder: 'asc',
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (alphabetFilter) filters.alphabetFilter = alphabetFilter
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()

      const [artists, count] = await Promise.all([
        window.electronAPI.musicGetArtists(filters),
        window.electronAPI.musicCountArtists(filters),
      ])

      if (reset) {
        setMusicArtists(artists as MusicArtist[])
        artistsOffsetRef.current = ARTISTS_PAGE_SIZE
      } else {
        setMusicArtists(prev => [...prev, ...(artists as MusicArtist[])])
        artistsOffsetRef.current = offset + ARTISTS_PAGE_SIZE
      }
      setTotalArtistCount(count)
    } catch (err) {
      console.warn('Failed to load paginated artists:', err)
    } finally {
      setArtistsLoading(false)
    }
  }, [activeSourceId, activeLibraryId, alphabetFilter, searchQuery, artistsLoading])

  // Load more artists (infinite scroll callback)
  const loadMoreArtists = useCallback(() => {
    if (artistsOffsetRef.current < totalArtistCount && !artistsLoading) {
      loadPaginatedArtists(false)
    }
  }, [totalArtistCount, artistsLoading, loadPaginatedArtists])

  // Load paginated tracks from server with current filters/sorting
  const loadPaginatedTracks = useCallback(async (reset = true) => {
    if (tracksLoading) return
    setTracksLoading(true)
    try {
      const offset = reset ? 0 : tracksOffsetRef.current
      const filters: Record<string, unknown> = {
        limit: TRACKS_PAGE_SIZE,
        offset,
        sortBy: trackSortColumn,
        sortOrder: trackSortDirection,
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (alphabetFilter) filters.alphabetFilter = alphabetFilter
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()

      const [tracks, count] = await Promise.all([
        window.electronAPI.musicGetTracks(filters),
        window.electronAPI.musicCountTracks(filters),
      ])

      if (reset) {
        setAllMusicTracks(tracks as MusicTrack[])
        tracksOffsetRef.current = TRACKS_PAGE_SIZE
      } else {
        setAllMusicTracks(prev => [...prev, ...(tracks as MusicTrack[])])
        tracksOffsetRef.current = offset + TRACKS_PAGE_SIZE
      }
      setTotalTrackCount(count)
    } catch (err) {
      console.warn('Failed to load paginated tracks:', err)
    } finally {
      setTracksLoading(false)
    }
  }, [activeSourceId, activeLibraryId, alphabetFilter, searchQuery, trackSortColumn, trackSortDirection, tracksLoading])

  // Load more tracks (infinite scroll callback)
  const loadMoreTracks = useCallback(() => {
    if (tracksOffsetRef.current < totalTrackCount && !tracksLoading) {
      loadPaginatedTracks(false)
    }
  }, [totalTrackCount, tracksLoading, loadPaginatedTracks])

  // Trigger server-side track loading when tracks tab is active and filters change
  useEffect(() => {
    if (view === 'music' && musicViewMode === 'tracks') {
      loadPaginatedTracks(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, musicViewMode, activeSourceId, activeLibraryId, alphabetFilter, searchQuery, trackSortColumn, trackSortDirection])

  // Load paginated albums from server with current filters/sorting
  const loadPaginatedAlbums = useCallback(async (reset = true) => {
    if (albumsLoading) return
    setAlbumsLoading(true)
    try {
      const offset = reset ? 0 : albumsOffsetRef.current
      const filters: Record<string, unknown> = {
        limit: ALBUMS_PAGE_SIZE,
        offset,
        sortBy: albumSortColumn === 'artist' ? 'artist' : 'title',
        sortOrder: albumSortDirection,
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (alphabetFilter) filters.alphabetFilter = alphabetFilter
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()
      if (selectedArtist) filters.artistId = selectedArtist.id

      const [albums, count] = await Promise.all([
        window.electronAPI.musicGetAlbums(filters),
        window.electronAPI.musicCountAlbums(filters),
      ])

      if (reset) {
        setMusicAlbums(albums as MusicAlbum[])
        albumsOffsetRef.current = ALBUMS_PAGE_SIZE
      } else {
        setMusicAlbums(prev => [...prev, ...(albums as MusicAlbum[])])
        albumsOffsetRef.current = offset + ALBUMS_PAGE_SIZE
      }
      setTotalAlbumCount(count)
    } catch (err) {
      console.warn('Failed to load paginated albums:', err)
    } finally {
      setAlbumsLoading(false)
    }
  }, [activeSourceId, activeLibraryId, alphabetFilter, searchQuery, albumSortColumn, albumSortDirection, albumsLoading, selectedArtist])

  // Load more albums (infinite scroll callback)
  const loadMoreAlbums = useCallback(() => {
    if (albumsOffsetRef.current < totalAlbumCount && !albumsLoading) {
      loadPaginatedAlbums(false)
    }
  }, [totalAlbumCount, albumsLoading, loadPaginatedAlbums])

  // Trigger server-side artist loading when artists tab is active and filters change
  useEffect(() => {
    if (view === 'music' && musicViewMode === 'artists') {
      loadPaginatedArtists(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, musicViewMode, activeSourceId, activeLibraryId, alphabetFilter, searchQuery])

  // Trigger server-side album loading when albums tab is active and filters change
  useEffect(() => {
    if (view === 'music' && (musicViewMode === 'albums' || selectedArtist)) {
      loadPaginatedAlbums(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, musicViewMode, activeSourceId, activeLibraryId, alphabetFilter, searchQuery, albumSortColumn, albumSortDirection, selectedArtist])

  // Load paginated movies from server with current filters/sorting
  const loadPaginatedMovies = useCallback(async (reset = true) => {
    if (moviesLoading) return
    setMoviesLoading(true)
    try {
      const offset = reset ? 0 : moviesOffsetRef.current
      const filters: Record<string, unknown> = {
        type: 'movie',
        limit: MOVIES_PAGE_SIZE,
        offset,
        sortBy: 'title',
        sortOrder: 'asc',
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (alphabetFilter) filters.alphabetFilter = alphabetFilter
      if (debouncedTierFilter !== 'all') filters.qualityTier = debouncedTierFilter
      if (debouncedQualityFilter !== 'all') filters.tierQuality = debouncedQualityFilter.toUpperCase()
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()

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
  }, [activeSourceId, activeLibraryId, alphabetFilter, debouncedTierFilter, debouncedQualityFilter, searchQuery, moviesLoading])

  // Load more movies (infinite scroll callback)
  const loadMoreMovies = useCallback(() => {
    if (moviesOffsetRef.current < totalMovieCount && !moviesLoading) {
      loadPaginatedMovies(false)
    }
  }, [totalMovieCount, moviesLoading, loadPaginatedMovies])

  // Trigger server-side movie loading when movies view is active and filters change
  useEffect(() => {
    if (view === 'movies') {
      loadPaginatedMovies(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeSourceId, activeLibraryId, alphabetFilter, debouncedTierFilter, debouncedQualityFilter, searchQuery])

  // Load paginated TV shows from server with current filters
  const loadPaginatedShows = useCallback(async (reset = true) => {
    if (showsLoading) return
    setShowsLoading(true)
    try {
      const offset = reset ? 0 : showsOffsetRef.current
      const filters: Record<string, unknown> = {
        limit: SHOWS_PAGE_SIZE,
        offset,
        sortBy: 'title',
        sortOrder: 'asc',
      }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (alphabetFilter) filters.alphabetFilter = alphabetFilter
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()

      const [newShows, count] = await Promise.all([
        window.electronAPI.getTVShows(filters),
        window.electronAPI.countTVShows(filters)
      ])

      if (reset) {
        setPaginatedShows(newShows as TVShowSummary[])
        showsOffsetRef.current = SHOWS_PAGE_SIZE
      } else {
        setPaginatedShows(prev => [...prev, ...(newShows as TVShowSummary[])])
        showsOffsetRef.current = offset + SHOWS_PAGE_SIZE
      }
      setTotalShowCount(count as number)
    } catch (err) {
      console.error('Error loading TV shows:', err)
    } finally {
      setShowsLoading(false)
    }
  }, [showsLoading, activeSourceId, activeLibraryId, alphabetFilter, searchQuery])

  const loadMoreShows = useCallback(() => {
    if (showsOffsetRef.current < totalShowCount && !showsLoading) {
      loadPaginatedShows(false)
    }
  }, [totalShowCount, showsLoading, loadPaginatedShows])

  // Load episodes on demand when a show is selected
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

  // Trigger server-side TV show loading when TV view is active and filters change
  useEffect(() => {
    if (view === 'tv') {
      loadPaginatedShows(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeSourceId, activeLibraryId, alphabetFilter, searchQuery])

  // Load episodes when a show is selected
  useEffect(() => {
    if (selectedShow) {
      loadSelectedShowEpisodes(selectedShow)
    } else {
      setSelectedShowEpisodes([])
    }
  }, [selectedShow, loadSelectedShowEpisodes])

  // Event listeners and initial data load placed after loadMusicCompletenessData (see below)

  // Load tracks for a specific album
  const loadAlbumTracks = async (albumId: number) => {
    try {
      const tracks = await window.electronAPI.musicGetTracksByAlbum(albumId)
      setAlbumTracks(tracks as MusicTrack[])
    } catch (err) {
      console.warn('Failed to load album tracks:', err)
      setAlbumTracks([])
    }
  }

  // Load album completeness data
  const loadAlbumCompleteness = async (albumId: number) => {
    try {
      const completeness = await window.electronAPI.musicGetAlbumCompleteness(albumId)
      setSelectedAlbumCompleteness(completeness as AlbumCompletenessData | null)
    } catch (err) {
      console.warn('Failed to load album completeness:', err)
      setSelectedAlbumCompleteness(null)
    }
  }

  // Analyze a single album for missing tracks
  const analyzeAlbumCompleteness = async (albumId: number) => {
    try {
      console.log(`[MediaBrowser] Analyzing album ${albumId} for missing tracks...`)
      const result = await window.electronAPI.musicAnalyzeAlbumTrackCompleteness(albumId)
      console.log(`[MediaBrowser] Analysis result:`, result)

      // Reload selected album completeness if this is the selected album
      await loadAlbumCompleteness(albumId)

      // Also reload the all album completeness map for the grid view badges
      const albumCompletenessData = await window.electronAPI.musicGetAllAlbumCompleteness() as AlbumCompletenessData[]
      const albumCompletenessMap = new Map<number, AlbumCompletenessData>()
      albumCompletenessData.forEach(c => {
        albumCompletenessMap.set(c.album_id, c)
      })
      setAllAlbumCompleteness(albumCompletenessMap)
    } catch (err) {
      console.error('Failed to analyze album completeness:', err)
    }
  }

  // Analyze a single artist for missing albums
  const analyzeArtistCompleteness = async (artistId: number) => {
    try {
      console.log(`[MediaBrowser] Analyzing artist ${artistId} for missing albums...`)
      const result = await window.electronAPI.musicAnalyzeArtistCompleteness(artistId)
      console.log(`[MediaBrowser] Artist analysis result:`, result)

      // Reload all artist completeness data to refresh the UI
      await loadMusicCompletenessData()
    } catch (err) {
      console.error('Failed to analyze artist completeness:', err)
    }
  }

  // Media actions (match fix modal, missing item popup, rescan) — extracted hook
  const reloadAfterRescan = useCallback(async () => {
    loadPaginatedMovies(true)
    loadPaginatedShows(true)
    if (selectedShow) await loadSelectedShowEpisodes(selectedShow)
  }, [loadPaginatedMovies, loadPaginatedShows, selectedShow, loadSelectedShowEpisodes])

  const {
    matchFixModal, setMatchFixModal,
    selectedMissingItem, setSelectedMissingItem,
    handleRescanItem,
  } = useMediaActions({ selectedMediaId, loadMedia: reloadAfterRescan, setDetailRefreshKey })

  // Dismiss handlers (extracted hook)
  const {
    handleDismissUpgrade,
    handleDismissMissingEpisode,
    handleDismissMissingSeason,
    handleDismissCollectionMovie,
    handleDismissMissingItem,
  } = useDismissHandlers({
    setPaginatedMovies, setSelectedShowEpisodes,
    seriesCompleteness, setSeriesCompleteness,
    selectedCollection, setSelectedCollection, setMovieCollections,
    selectedMissingItem, setSelectedMissingItem, addToast,
  })

  // Load music completeness data
  // Optional overrides allow callers to pass fresh EP/Singles values to avoid stale state
  const loadMusicCompletenessData = async (overrideEps?: boolean, overrideSingles?: boolean) => {
    try {
      const completenessData = await window.electronAPI.musicGetAllArtistCompleteness() as ArtistCompletenessData[]

      // Index by artist name
      const completenessMap = new Map<string, ArtistCompletenessData>()
      completenessData.forEach(c => {
        completenessMap.set(c.artist_name, c)
      })
      setArtistCompleteness(completenessMap)

      // Load album completeness data
      const albumCompletenessData = await window.electronAPI.musicGetAllAlbumCompleteness() as AlbumCompletenessData[]
      const albumCompletenessMap = new Map<number, AlbumCompletenessData>()
      albumCompletenessData.forEach(c => {
        albumCompletenessMap.set(c.album_id, c)
      })
      setAllAlbumCompleteness(albumCompletenessMap)

      // Calculate stats with real-time EP/Singles filtering
      const effectiveEps = overrideEps ?? includeEps
      const effectiveSingles = overrideSingles ?? includeSingles
      const totalArtists = musicStats?.totalArtists ?? musicArtists.length
      const analyzedArtists = completenessData.length

      // Recalculate completeness from raw counts using current settings
      let completeArtists = 0
      let totalMissingAlbums = 0
      let totalPctSum = 0
      for (const c of completenessData) {
        const totalItems = (c.total_albums || 0) * 3
          + (effectiveEps ? (c.total_eps || 0) * 2 : 0)
          + (effectiveSingles ? (c.total_singles || 0) : 0)
        const ownedItems = (c.owned_albums || 0) * 3
          + (effectiveEps ? (c.owned_eps || 0) * 2 : 0)
          + (effectiveSingles ? (c.owned_singles || 0) : 0)
        const pct = totalItems > 0 ? Math.round((ownedItems / totalItems) * 100) : 100
        totalPctSum += pct
        if (pct >= 100) completeArtists++

        const missingAlbumCount = Math.max(0, (c.total_albums || 0) - (c.owned_albums || 0))
        const missingEpCount = effectiveEps ? Math.max(0, (c.total_eps || 0) - (c.owned_eps || 0)) : 0
        const missingSingleCount = effectiveSingles ? Math.max(0, (c.total_singles || 0) - (c.owned_singles || 0)) : 0
        totalMissingAlbums += missingAlbumCount + missingEpCount + missingSingleCount
      }
      const incompleteArtists = analyzedArtists - completeArtists

      const avgCompleteness = analyzedArtists > 0
        ? Math.round(totalPctSum / analyzedArtists)
        : 0

      setMusicCompletenessStats({
        totalArtists,
        analyzedArtists,
        completeArtists,
        incompleteArtists,
        totalMissingAlbums,
        averageCompleteness: avgCompleteness,
      })
    } catch (err) {
      console.warn('Failed to load music completeness data:', err)
    }
  }

  // Reload media callback for event-driven updates
  const reloadMediaForEvents = useCallback(async () => {
    loadPaginatedMovies(true)
    loadPaginatedShows(true)
    if (selectedShow) loadSelectedShowEpisodes(selectedShow)
  }, [loadPaginatedMovies, loadPaginatedShows, selectedShow, loadSelectedShowEpisodes])

  // Load EP/Singles inclusion settings
  const loadEpSingleSettings = useCallback(async () => {
    const [epsVal, singlesVal] = await Promise.all([
      window.electronAPI.getSetting('completeness_include_eps'),
      window.electronAPI.getSetting('completeness_include_singles'),
    ])
    setIncludeEps((epsVal as string) !== 'false')
    setIncludeSingles((singlesVal as string) !== 'false')
  }, [])

  // Event listeners: analysis progress, library updates, auto-refresh, task queue, scan completion (extracted hook)
  useLibraryEventListeners({
    activeSourceId,
    scanProgressSize: scanProgress.size,
    loadMedia: reloadMediaForEvents,
    loadStats,
    loadCompletenessData,
    loadMusicData,
    loadMusicCompletenessData,
    loadActiveSourceLibraries,
    loadEpSingleSettings,
    setIsAnalyzing, setAnalysisType, setAnalysisProgress,
    setTmdbApiKeySet, setIsAutoRefreshing,
    setActiveSource, markLibraryAsNew, addToast,
  })

  // Initial data load + reload on source change
  useEffect(() => {
    loadStats(activeSourceId || undefined).then(() => {
      hasInitialLoadRef.current = true
      setLoading(false)
    })
    loadCompletenessData()
    loadMusicData()
    loadMusicCompletenessData()
    loadEpSingleSettings()
    checkTmdbApiKey()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceId])

  // getCollectionForMovie, getOwnedMoviesForCollection, ownedMoviesForSelectedCollection
  // provided by useCollections hook above

  // Organize selected show's episodes into seasons (on-demand when show is clicked)
  const selectedShowData = useMemo((): TVShow | null => {
    if (!selectedShow || selectedShowEpisodes.length === 0) return null

    const seasons = new Map<number, TVSeason>()
    selectedShowEpisodes.forEach(episode => {
      const seasonNum = episode.season_number || 0
      if (!seasons.has(seasonNum)) {
        seasons.set(seasonNum, {
          seasonNumber: seasonNum,
          episodes: [],
          posterUrl: episode.season_poster_url
        })
      }
      const season = seasons.get(seasonNum)!
      if (!season.posterUrl && episode.season_poster_url) {
        season.posterUrl = episode.season_poster_url
      }
      season.episodes.push(episode)
    })
    // Sort episodes within seasons
    seasons.forEach(season => {
      season.episodes.sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
    })

    return {
      title: selectedShow,
      poster_url: selectedShowEpisodes[0]?.poster_url,
      seasons
    }
  }, [selectedShow, selectedShowEpisodes])

  const filterItem = useCallback((item: MediaItem): boolean => {
    // Alphabet filter
    if (alphabetFilter) {
      const title = item.type === 'episode' && item.series_title ? item.series_title : item.title
      const firstChar = title.charAt(0).toUpperCase()
      if (alphabetFilter === '#') {
        // Numbers and special characters
        if (/[A-Z]/.test(firstChar)) return false
      } else {
        if (firstChar !== alphabetFilter) return false
      }
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      const title = item.title.toLowerCase()
      const seriesTitle = (item.series_title || '').toLowerCase()
      if (!title.includes(query) && !seriesTitle.includes(query)) {
        return false
      }
    }

    // Tier filter (use debounced value)
    if (debouncedTierFilter !== 'all' && item.quality_tier !== debouncedTierFilter) return false

    // Quality filter (use debounced value)
    if (debouncedQualityFilter !== 'all') {
      const tierQuality = (item.tier_quality || 'MEDIUM').toLowerCase()
      if (tierQuality !== debouncedQualityFilter) return false
    }

    return true
  }, [alphabetFilter, searchQuery, debouncedTierFilter, debouncedQualityFilter])

  // Movies are now loaded from the server pre-filtered/sorted/paginated
  const movies = paginatedMovies

  // Global search results for live preview (searches all content types)
  const globalSearchResults = useMemo(() => {
    if (!searchInput.trim() || searchInput.length < 2) return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }

    const query = searchInput.toLowerCase()
    const maxResults = 5 // Max results per category

    // Search movies (from loaded pages)
    const movieResults = paginatedMovies
      .filter(item => item.title.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map(item => ({
        id: item.id,
        title: item.title,
        year: item.year,
        poster_url: item.poster_url,
        needs_upgrade: item.needs_upgrade || item.tier_quality === 'LOW',
        type: 'movie' as const
      }))

    // Search TV shows (from loaded pages)
    const tvResults = paginatedShows
      .filter(show => show.series_title.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map(show => ({
        id: show.series_title,
        title: show.series_title,
        poster_url: show.poster_url,
        type: 'tv' as const
      }))

    // Search episodes (from currently selected show only)
    const episodeResults = selectedShowEpisodes
      .filter(item => (
        item.title.toLowerCase().includes(query) ||
        (item.series_title && item.series_title.toLowerCase().includes(query))
      ))
      .slice(0, maxResults)
      .map(item => ({
        id: item.id,
        title: item.title,
        series_title: item.series_title,
        season_number: item.season_number,
        episode_number: item.episode_number,
        thumb_url: item.episode_thumb_url || item.season_poster_url || item.poster_url,
        needs_upgrade: item.needs_upgrade || item.tier_quality === 'LOW',
        type: 'episode' as const
      }))

    // Search music artists
    const artistResults = musicArtists
      .filter(artist => artist.name.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map(artist => ({
        id: artist.id,
        title: artist.name,
        thumb_url: artist.thumb_url,
        type: 'artist' as const
      }))

    // Search music albums
    const albumResults = musicAlbums
      .filter(album =>
        album.title.toLowerCase().includes(query) ||
        album.artist_name.toLowerCase().includes(query)
      )
      .slice(0, maxResults)
      .map(album => ({
        id: album.id,
        title: album.title,
        subtitle: album.artist_name,
        year: album.year,
        thumb_url: album.thumb_url,
        needs_upgrade: false,
        type: 'album' as const
      }))

    return {
      movies: movieResults,
      tvShows: tvResults,
      episodes: episodeResults,
      artists: artistResults,
      albums: albumResults,
      tracks: searchTrackResults
    }
  }, [searchInput, paginatedMovies, paginatedShows, selectedShowEpisodes, musicArtists, musicAlbums, searchTrackResults])

  // Async track search for global search dropdown (server-side query since tracks are paginated)
  useEffect(() => {
    if (searchTrackTimerRef.current) clearTimeout(searchTrackTimerRef.current)
    const query = searchInput.trim().toLowerCase()
    if (!query || query.length < 2) {
      setSearchTrackResults([])
      return
    }
    searchTrackTimerRef.current = setTimeout(async () => {
      try {
        const filters: Record<string, unknown> = { searchQuery: query, limit: 5, offset: 0 }
        if (activeSourceId) filters.sourceId = activeSourceId
        const tracks = await window.electronAPI.musicGetTracks(filters) as MusicTrack[]
        setSearchTrackResults(tracks.map(track => {
          const album = musicAlbums.find(a => a.id === track.album_id)
          return {
            id: track.id,
            title: track.title,
            album_id: track.album_id || 0,
            album_title: album?.title,
            artist_name: album?.artist_name,
            thumb_url: album?.thumb_url,
            needs_upgrade: !track.is_lossless && !track.is_hi_res,
            type: 'track' as const
          }
        }))
      } catch {
        setSearchTrackResults([])
      }
    }, 200)
    return () => { if (searchTrackTimerRef.current) clearTimeout(searchTrackTimerRef.current) }
  }, [searchInput, activeSourceId, musicAlbums])

  const hasSearchResults = globalSearchResults.movies.length > 0 ||
    globalSearchResults.tvShows.length > 0 ||
    globalSearchResults.episodes.length > 0 ||
    globalSearchResults.artists.length > 0 ||
    globalSearchResults.albums.length > 0 ||
    globalSearchResults.tracks.length > 0

  // Flatten search results for keyboard navigation
  const flattenedResults = useMemo(() => {
    const results: Array<{ type: 'movie' | 'tv' | 'episode' | 'artist' | 'album' | 'track'; id: number | string; extra?: { series_title?: string; album_id?: number } }> = []
    globalSearchResults.movies.forEach(m => results.push({ type: 'movie', id: m.id }))
    globalSearchResults.tvShows.forEach(s => results.push({ type: 'tv', id: s.id }))
    globalSearchResults.episodes.forEach(e => results.push({ type: 'episode', id: e.id, extra: { series_title: e.series_title } }))
    globalSearchResults.artists.forEach(a => results.push({ type: 'artist', id: a.id }))
    globalSearchResults.albums.forEach(a => results.push({ type: 'album', id: a.id }))
    globalSearchResults.tracks.forEach(t => results.push({ type: 'track', id: t.id, extra: { album_id: t.album_id } }))
    return results
  }, [globalSearchResults])

  // Reset search result index when search input changes
  useEffect(() => {
    setSearchResultIndex(-1)
  }, [searchInput])

  // Keyboard navigation for search results
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showSearchResults || !hasSearchResults) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSearchResultIndex(prev =>
          prev < flattenedResults.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSearchResultIndex(prev =>
          prev > 0 ? prev - 1 : flattenedResults.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (searchResultIndex >= 0 && searchResultIndex < flattenedResults.length) {
          const result = flattenedResults[searchResultIndex]
          handleSearchResultClick(result.type, result.id, result.extra)
        }
        break
      case 'Escape':
        e.preventDefault()
        setShowSearchResults(false)
        setSearchResultIndex(-1)
        searchInputRef.current?.blur()
        break
    }
  }

  // Handle clicking outside search results to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle search result selection
  const handleSearchResultClick = (type: 'movie' | 'tv' | 'episode' | 'artist' | 'album' | 'track', id: number | string, extra?: { series_title?: string; album_id?: number }) => {
    setShowSearchResults(false)
    setSearchInput('')

    if (type === 'movie') {
      setView('movies')
      setSelectedMediaId(id as number)
    } else if (type === 'tv') {
      setView('tv')
      setSelectedShow(id as string)
      setSelectedSeason(null)
    } else if (type === 'episode') {
      setView('tv')
      if (extra?.series_title) {
        setSelectedShow(extra.series_title)
      }
      setSelectedMediaId(id as number)
    } else if (type === 'artist') {
      setView('music')
      setMusicViewMode('artists')
      const artist = musicArtists.find(a => a.id === id)
      if (artist) setSelectedArtist(artist)
    } else if (type === 'album') {
      setView('music')
      setMusicViewMode('albums')
      const album = musicAlbums.find(a => a.id === id)
      if (album) {
        setSelectedAlbum(album)
        loadAlbumTracks(album.id)
      }
    } else if (type === 'track') {
      setView('music')
      setMusicViewMode('tracks')
      // If we have the album_id, select that album to show track in context
      if (extra?.album_id) {
        const album = musicAlbums.find(a => a.id === extra.album_id)
        if (album) {
          setSelectedAlbum(album)
          loadAlbumTracks(album.id)
        }
      }
    }
  }

  // Handle navigation from notifications or other sources
  useEffect(() => {
    if (!pendingNavigation) return

    const { type, id, artistName } = pendingNavigation

    console.log('[MediaBrowser] Handling navigation:', pendingNavigation)

    if (type === 'movie') {
      setView('movies')
      setSelectedMediaId(typeof id === 'string' ? parseInt(id, 10) : id)
    } else if (type === 'episode') {
      setView('tv')
      if (pendingNavigation.seriesTitle) {
        setSelectedShow(pendingNavigation.seriesTitle)
      }
      setSelectedMediaId(typeof id === 'string' ? parseInt(id, 10) : id)
    } else if (type === 'artist') {
      setView('music')
      setMusicViewMode('artists')
      // Find artist by name since we may not have the ID directly
      if (artistName) {
        const artist = musicArtists.find(a => a.name === artistName)
        if (artist) {
          setSelectedArtist(artist)
        } else {
          // Artist not in paginated list — search server by name
          window.electronAPI.musicGetArtists({ searchQuery: artistName, limit: 1, offset: 0 }).then(result => {
            const artists = result as MusicArtist[]
            if (artists.length > 0) setSelectedArtist(artists[0])
          }).catch(err => console.error('Failed to find artist for navigation:', err))
        }
      }
    } else if (type === 'album') {
      setView('music')
      setMusicViewMode('albums')
      const numId = typeof id === 'string' ? parseInt(id, 10) : id
      const album = musicAlbums.find(a => a.id === numId)
      if (album) {
        setSelectedAlbum(album)
        loadAlbumTracks(album.id)
      }
    } else if (type === 'track') {
      setView('music')
      setMusicViewMode('albums')
      // For tracks, we need to find the track first to get its album
      const numId = typeof id === 'string' ? parseInt(id, 10) : id
      // Look up the track to find its album
      window.electronAPI.musicGetTracks({ limit: 10000 }).then(result => {
        const tracks = result as MusicTrack[]
        const track = tracks.find(t => t.id === numId)
        if (track?.album_id) {
          const album = musicAlbums.find(a => a.id === track.album_id)
          if (album) {
            setSelectedAlbum(album)
            loadAlbumTracks(album.id)
          }
        }
      }).catch(err => console.error('Failed to find track for navigation:', err))
    }

    clearNavigation()
  }, [pendingNavigation, musicArtists, musicAlbums, clearNavigation])

  if (loading && !hasInitialLoadRef.current) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-center">
          <div className="text-muted-foreground">Loading media library...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  // Check if we should show empty state (handled in content area below)
  const showEmptyState = sources.length === 0

  return (
    <div className="h-screen flex flex-col">
      {/* Fixed Control Bar - floating header with logo (hidden when global TopBar is used) */}
      {!hideHeader && (
      <header
        id="top-bar"
        className="dark fixed top-4 left-4 right-4 z-[100] bg-black rounded-2xl shadow-xl px-4 py-3"
        role="banner"
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-4">
          {/* Left Section: Logo + Search */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* Logo - Left */}
            <img src={logoImage} alt="Totality" className="h-10 flex-shrink-0" />

          {/* Search - Flexible width with min/max constraints */}
          <div ref={searchContainerRef} className="relative flex-shrink min-w-24 max-w-80 w-64" role="combobox" aria-expanded={showSearchResults && hasSearchResults} aria-haspopup="listbox" aria-owns="search-results-listbox">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search all libraries..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value)
                setShowSearchResults(true)
              }}
              onFocus={() => setShowSearchResults(true)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-10 pr-8 py-2 bg-muted/50 border border-border/50 rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search all libraries"
              aria-autocomplete="list"
              aria-controls="search-results-listbox"
              aria-activedescendant={searchResultIndex >= 0 ? `search-result-${searchResultIndex}` : undefined}
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput('')
                  setShowSearchResults(false)
                  setSearchResultIndex(-1)
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground z-10 focus:outline-none focus:ring-2 focus:ring-primary rounded"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Search Results Dropdown */}
            {showSearchResults && searchInput.length >= 2 && hasSearchResults && (
              <div
                id="search-results-listbox"
                role="listbox"
                aria-label="Search results"
                className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-2xl overflow-hidden z-[9999] max-h-[400px] overflow-y-auto"
              >
                {/* Movies */}
                {globalSearchResults.movies.length > 0 && (
                  <div role="group" aria-labelledby="search-movies-label">
                    <div id="search-movies-label" className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2" role="presentation">
                      <Film className="w-3 h-3" aria-hidden="true" />
                      Movies
                    </div>
                    {globalSearchResults.movies.map((movie, idx) => {
                      const flatIndex = idx
                      return (
                        <button
                          key={`movie-${movie.id}`}
                          id={`search-result-${flatIndex}`}
                          role="option"
                          aria-selected={searchResultIndex === flatIndex}
                          onClick={() => handleSearchResultClick('movie', movie.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-none ${
                            searchResultIndex === flatIndex
                              ? 'bg-primary/20 ring-2 ring-inset ring-primary'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          {movie.poster_url ? (
                            <img src={movie.poster_url} alt="" className="w-8 h-12 object-cover rounded" />
                          ) : (
                            <div className="w-8 h-12 bg-muted rounded flex items-center justify-center">
                              <MoviePlaceholder className="w-6 h-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{movie.title}</div>
                            {movie.year && <div className="text-xs text-muted-foreground">{movie.year}</div>}
                          </div>
                          {movie.needs_upgrade && (
                            <CircleFadingArrowUp className="w-5 h-5 text-red-500 flex-shrink-0" aria-label="Upgrade recommended" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* TV Shows */}
                {globalSearchResults.tvShows.length > 0 && (
                  <div role="group" aria-labelledby="search-tv-label">
                    <div id="search-tv-label" className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2" role="presentation">
                      <Tv className="w-3 h-3" aria-hidden="true" />
                      TV Shows
                    </div>
                    {globalSearchResults.tvShows.map((show, idx) => {
                      const flatIndex = globalSearchResults.movies.length + idx
                      return (
                        <button
                          key={`tv-${show.id}`}
                          id={`search-result-${flatIndex}`}
                          role="option"
                          aria-selected={searchResultIndex === flatIndex}
                          onClick={() => handleSearchResultClick('tv', show.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-none ${
                            searchResultIndex === flatIndex
                              ? 'bg-primary/20 ring-2 ring-inset ring-primary'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          {show.poster_url ? (
                            <img src={show.poster_url} alt="" className="w-8 h-12 object-cover rounded" />
                          ) : (
                            <div className="w-8 h-12 bg-muted rounded flex items-center justify-center">
                              <TvPlaceholder className="w-6 h-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{show.title}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Episodes */}
                {globalSearchResults.episodes.length > 0 && (
                  <div role="group" aria-labelledby="search-episodes-label">
                    <div id="search-episodes-label" className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2" role="presentation">
                      <Tv className="w-3 h-3" aria-hidden="true" />
                      Episodes
                    </div>
                    {globalSearchResults.episodes.map((episode, idx) => {
                      const flatIndex = globalSearchResults.movies.length + globalSearchResults.tvShows.length + idx
                      return (
                        <button
                          key={`episode-${episode.id}`}
                          id={`search-result-${flatIndex}`}
                          role="option"
                          aria-selected={searchResultIndex === flatIndex}
                          onClick={() => handleSearchResultClick('episode', episode.id, { series_title: episode.series_title })}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-none ${
                            searchResultIndex === flatIndex
                              ? 'bg-primary/20 ring-2 ring-inset ring-primary'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          {episode.thumb_url ? (
                            <img src={episode.thumb_url} alt="" className="w-12 h-8 object-cover rounded" />
                          ) : (
                            <div className="w-12 h-8 bg-muted rounded flex items-center justify-center">
                              <EpisodePlaceholder className="w-6 h-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{episode.title}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {episode.series_title} • S{episode.season_number}E{episode.episode_number}
                            </div>
                          </div>
                          {episode.needs_upgrade && (
                            <CircleFadingArrowUp className="w-4 h-4 text-red-500 flex-shrink-0" aria-label="Upgrade recommended" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Artists */}
                {globalSearchResults.artists.length > 0 && (
                  <div role="group" aria-labelledby="search-artists-label">
                    <div id="search-artists-label" className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2" role="presentation">
                      <User className="w-3 h-3" aria-hidden="true" />
                      Artists
                    </div>
                    {globalSearchResults.artists.map((artist, idx) => {
                      const flatIndex = globalSearchResults.movies.length + globalSearchResults.tvShows.length + globalSearchResults.episodes.length + idx
                      return (
                        <button
                          key={`artist-${artist.id}`}
                          id={`search-result-${flatIndex}`}
                          role="option"
                          aria-selected={searchResultIndex === flatIndex}
                          onClick={() => handleSearchResultClick('artist', artist.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-none ${
                            searchResultIndex === flatIndex
                              ? 'bg-primary/20 ring-2 ring-inset ring-primary'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          {artist.thumb_url ? (
                            <img src={artist.thumb_url} alt="" className="w-10 h-10 object-cover rounded-full" />
                          ) : (
                            <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                              <User className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{artist.title}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Albums */}
                {globalSearchResults.albums.length > 0 && (
                  <div role="group" aria-labelledby="search-albums-label">
                    <div id="search-albums-label" className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2" role="presentation">
                      <Disc3 className="w-3 h-3" aria-hidden="true" />
                      Albums
                    </div>
                    {globalSearchResults.albums.map((album, idx) => {
                      const flatIndex = globalSearchResults.movies.length + globalSearchResults.tvShows.length + globalSearchResults.episodes.length + globalSearchResults.artists.length + idx
                      return (
                        <button
                          key={`album-${album.id}`}
                          id={`search-result-${flatIndex}`}
                          role="option"
                          aria-selected={searchResultIndex === flatIndex}
                          onClick={() => handleSearchResultClick('album', album.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-none ${
                            searchResultIndex === flatIndex
                              ? 'bg-primary/20 ring-2 ring-inset ring-primary'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          {album.thumb_url ? (
                            <img src={album.thumb_url} alt="" className="w-10 h-10 object-cover rounded" />
                          ) : (
                            <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                              <Disc3 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{album.title}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {album.subtitle}{album.year ? ` • ${album.year}` : ''}
                            </div>
                          </div>
                          {album.needs_upgrade && (
                            <CircleFadingArrowUp className="w-5 h-5 text-red-500 flex-shrink-0" aria-label="Upgrade recommended" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Tracks */}
                {globalSearchResults.tracks.length > 0 && (
                  <div role="group" aria-labelledby="search-tracks-label">
                    <div id="search-tracks-label" className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2" role="presentation">
                      <Music className="w-3 h-3" aria-hidden="true" />
                      Tracks
                    </div>
                    {globalSearchResults.tracks.map((track, idx) => {
                      const flatIndex = globalSearchResults.movies.length + globalSearchResults.tvShows.length + globalSearchResults.episodes.length + globalSearchResults.artists.length + globalSearchResults.albums.length + idx
                      return (
                        <button
                          key={`track-${track.id}`}
                          id={`search-result-${flatIndex}`}
                          role="option"
                          aria-selected={searchResultIndex === flatIndex}
                          onClick={() => handleSearchResultClick('track', track.id, { album_id: track.album_id })}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-none ${
                            searchResultIndex === flatIndex
                              ? 'bg-primary/20 ring-2 ring-inset ring-primary'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          {track.thumb_url ? (
                            <img src={track.thumb_url} alt="" className="w-10 h-10 object-cover rounded" />
                          ) : (
                            <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                              <Music className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{track.title}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {track.album_title}{track.artist_name ? ` • ${track.artist_name}` : ''}
                            </div>
                          </div>
                          {track.needs_upgrade && (
                            <CircleFadingArrowUp className="w-5 h-5 text-red-500 flex-shrink-0" aria-label="Upgrade recommended" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* No results message */}
            {showSearchResults && searchInput.length >= 2 && !hasSearchResults && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-2xl p-4 z-[9999]">
                <div className="text-sm text-muted-foreground text-center">No results found</div>
              </div>
            )}
          </div>
          </div>

          {/* Library Buttons - Centered (hidden when no sources) */}
          {!showEmptyState && (
          <div className="flex-shrink-0" role="tablist" aria-label="Library type">
            <div className="flex gap-1">
                {/* Home Button */}
                {onNavigateHome && (
                  <button
                    onClick={onNavigateHome}
                    className="px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 bg-card text-muted-foreground hover:bg-muted"
                    title="Return to Dashboard"
                    aria-label="Dashboard"
                  >
                    <Home className="w-4 h-4" />
                  </button>
                )}

                {/* Divider */}
                {onNavigateHome && (
                  <div className="w-px bg-border/50 mx-1" />
                )}

                {/* Movies Button - Always visible */}
                <button
                  ref={moviesTabRef}
                  onClick={() => {
                    if (!hasMovies) return
                    setView('movies')
                    onLibraryTabChange?.('movies')
                    setSelectedShow(null)
                    setSelectedSeason(null)
                    setSelectedArtist(null)
                    setSelectedAlbum(null)
                  }}
                  disabled={!hasMovies}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 ${
                    view === 'movies'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted/50`}
                  role="tab"
                  aria-selected={view === 'movies'}
                  aria-controls="library-content"
                  aria-disabled={!hasMovies}
                >
                  <Film className="w-4 h-4" />
                  <span>Movies</span>
                </button>

                {/* TV Shows Button - Always visible */}
                <button
                  ref={tvTabRef}
                  onClick={() => {
                    if (!hasTV) return
                    setView('tv')
                    onLibraryTabChange?.('tv')
                    setSelectedShow(null)
                    setSelectedSeason(null)
                    setSelectedArtist(null)
                    setSelectedAlbum(null)
                  }}
                  disabled={!hasTV}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 ${
                    view === 'tv'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted/50`}
                  role="tab"
                  aria-selected={view === 'tv'}
                  aria-controls="library-content"
                  aria-disabled={!hasTV}
                >
                  <Tv className="w-4 h-4" />
                  <span>TV Shows</span>
                </button>

                {/* Music Button - Always visible */}
                <button
                  ref={musicTabRef}
                  onClick={() => {
                    if (!hasMusic) return
                    setView('music')
                    onLibraryTabChange?.('music')
                    setSelectedShow(null)
                    setSelectedSeason(null)
                    setSelectedArtist(null)
                    setSelectedAlbum(null)
                  }}
                  disabled={!hasMusic}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 ${
                    view === 'music'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted/50`}
                  role="tab"
                  aria-selected={view === 'music'}
                  aria-controls="library-content"
                  aria-disabled={!hasMusic}
                >
                  <Music className="w-4 h-4" />
                  <span>Music</span>
                </button>

                {/* Auto-refresh indicator */}
                {isAutoRefreshing && (
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground" title="Checking for new content...">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Syncing</span>
                  </div>
                )}
            </div>
          </div>
          )}

          {/* Right Section: Panel Toggle & Settings */}
          <div className="flex items-center justify-end flex-1 gap-2">
            <button
              ref={completenessButtonRef}
              onClick={() => {
                const newState = !showCompletenessPanel
                if (newState) setShowWishlistPanel(false)
                setShowCompletenessPanel(newState)
              }}
              className={`p-2.5 rounded-md transition-colors flex items-center gap-1 flex-shrink-0 focus:outline-none ${
                showCompletenessPanel
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
              aria-label={showCompletenessPanel ? 'Hide completeness panel' : 'Show completeness panel'}
              aria-expanded={showCompletenessPanel}
              aria-controls="completeness-panel"
            >
              <Library className="w-4 h-4" aria-hidden="true" />
              {!tmdbApiKeySet && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: themeAccentColor }} aria-label="API key not configured" />}
            </button>
            <button
              ref={wishlistButtonRef}
              onClick={() => {
                const newState = !showWishlistPanel
                if (newState) setShowCompletenessPanel(false)
                setShowWishlistPanel(newState)
              }}
              className={`p-2.5 rounded-md transition-colors flex items-center gap-1.5 flex-shrink-0 focus:outline-none ${
                showWishlistPanel
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
              aria-label={showWishlistPanel ? 'Hide wishlist panel' : 'Show wishlist panel'}
              aria-expanded={showWishlistPanel}
              aria-controls="wishlist-panel"
            >
              <Star className="w-4 h-4" aria-hidden="true" />
              {wishlistCount > 0 && (
                <span
                  className={`text-xs font-medium ${showWishlistPanel ? 'text-primary-foreground' : ''}`}
                  style={showWishlistPanel ? undefined : { color: themeAccentColor }}
                >
                  {wishlistCount}
                </span>
              )}
            </button>
            <ActivityPanel />
            <button
              ref={settingsButtonRef}
              onClick={() => onOpenSettings?.()}
              className="p-2.5 rounded-md transition-colors flex-shrink-0 bg-card text-muted-foreground hover:bg-muted focus:outline-none"
              aria-label="Open settings"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      )}

      {/* Library Content Container - self-contained element */}
      <main
        id="library-content"
        className={`fixed top-[88px] bottom-4 transition-[left,right,opacity] duration-300 ease-out flex flex-col ${isRefreshing ? 'opacity-60' : 'opacity-100'}`}
        style={{
          left: sidebarCollapsed ? '96px' : '288px',
          right: showCompletenessPanel || showWishlistPanel ? '340px' : '16px'
        }}
        role="tabpanel"
        aria-label={`${view === 'movies' ? 'Movies' : view === 'tv' ? 'TV Shows' : 'Music'} library`}
      >
        {/* Controls Bar - sticky within container */}
        <div className="flex-shrink-0 py-3 px-4">
          <div className="flex flex-col gap-2">
            {/* Row 1: Filters (left) | Separator | View Controls (right) */}
            <div className="flex items-center justify-between">
              {/* Left side: Filters */}
              <div className="flex items-center gap-4">
                {/* Music View Mode Toggle */}
                {view === 'music' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">View</span>
                    <div className="flex gap-1">
                      {(['artists', 'albums', 'tracks'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => {
                            setMusicViewMode(mode)
                            setSelectedArtist(null)
                            setSelectedAlbum(null)
                            setAlbumTracks([])
                          }}
                          className={`px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                            musicViewMode === mode
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-card text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Library Filter (shown when source has 2+ libraries of current type) */}
                {activeSourceId && currentTypeLibraries.length >= 2 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Library</span>
                    <select
                      value={activeLibraryId || ''}
                      onChange={(e) => setActiveLibraryId(e.target.value || null)}
                      className="px-2.5 py-1 bg-card border border-border rounded-md text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">All Libraries</option>
                      {currentTypeLibraries.map(lib => (
                        <option key={lib.id} value={lib.id}>{lib.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Resolution Tier Filter (only for video, not music artists/albums) */}
                {(view === 'movies' || view === 'tv' || (view === 'music' && musicViewMode === 'tracks')) && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Resolution</span>
                    <div className="flex gap-1">
                      {['all', '4K', '1080p', '720p', 'SD'].map((tier) => (
                        <button
                          key={tier}
                          ref={(el) => {
                            if (el) tierFilterRefs.current.set(tier, el)
                            else tierFilterRefs.current.delete(tier)
                          }}
                          onClick={() => setTierFilter(tier as typeof tierFilter)}
                          className={`px-2.5 py-1 rounded-md text-xs transition-colors focus:outline-none ${
                            tierFilter === tier
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-card text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {tier === 'all' ? 'All' : tier}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Divider between Resolution and Quality */}
                {(view === 'movies' || view === 'tv' || (view === 'music' && musicViewMode === 'tracks')) &&
                 (view !== 'music' || musicViewMode === 'tracks') && (
                  <div className="h-6 w-px bg-border/50" />
                )}

                {/* Quality Filter */}
                {(view !== 'music' || musicViewMode === 'tracks') && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Quality</span>
                    <div className="flex gap-1">
                      {['all', 'high', 'medium', 'low'].map((quality) => (
                        <button
                          key={quality}
                          ref={(el) => {
                            if (el) qualityFilterRefs.current.set(quality, el)
                            else qualityFilterRefs.current.delete(quality)
                          }}
                          onClick={() => setQualityFilter(quality as typeof qualityFilter)}
                          className={`px-2.5 py-1 rounded-md text-xs transition-colors focus:outline-none ${
                            qualityFilter === quality
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-card text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {quality.charAt(0).toUpperCase() + quality.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Collections Filter (movies only) */}
                {view === 'movies' && movieCollections.length > 0 && (
                  <>
                    <div className="h-6 w-px bg-border/50" />
                    <button
                      onClick={() => setCollectionsOnly(!collectionsOnly)}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors focus:outline-none flex items-center gap-1.5 ${
                        collectionsOnly
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-muted-foreground hover:bg-muted'
                      }`}
                      title="Show only collections"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Collections
                    </button>
                  </>
                )}
              </div>

              {/* Right side: Scale and View Toggle */}
              <div className="flex items-center gap-3 ml-auto">
                {/* Grid Scale Slider */}
                {!(view === 'tv' && selectedShow) &&
                 !(view === 'music' && musicViewMode === 'tracks') &&
                 viewType === 'grid' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="1"
                      max="7"
                      value={gridScale}
                      onChange={(e) => setGridScale(Number(e.target.value))}
                      className="w-20 h-1 bg-border/50 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md"
                    />
                  </div>
                )}

                {/* View Toggle (Grid/List) */}
                {!(view === 'tv' && selectedShow) &&
                 !(view === 'music' && musicViewMode === 'tracks') && (
                  <div className="flex gap-1">
                    <button
                      ref={gridViewRef}
                      onClick={() => setViewType('grid')}
                      className={`p-1.5 rounded-md transition-colors focus:outline-none ${
                        viewType === 'grid'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Grid3x3 className="w-4 h-4" />
                    </button>
                    <button
                      ref={listViewRef}
                      onClick={() => setViewType('list')}
                      className={`p-1.5 rounded-md transition-colors focus:outline-none ${
                        viewType === 'list'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Scrollable Content Area with Alphabet Filter */}
        <div className="flex-1 relative min-h-0">
          {/* Main scrollable content */}
          <div className="absolute inset-0 overflow-y-auto scrollbar-visible px-4 pb-4 pr-8">

        {/* Content Display */}
        {showEmptyState ? (
          <EnhancedEmptyState />
        ) : (
          view === 'movies' ? (
            <MoviesView
              movies={movies}
              onSelectMovie={(id, _movie) => setSelectedMediaId(id)}
              onSelectCollection={(collection) => {
                setSelectedCollection(collection)
                setShowCollectionModal(true)
              }}
              viewType={viewType}
              gridScale={gridScale}
              getCollectionForMovie={getCollectionForMovie}
              movieCollections={movieCollections}
              showSourceBadge={!activeSourceId && sources.length > 1}
              onFixMatch={(mediaItemId, title, year, filePath) => setMatchFixModal({ isOpen: true, type: 'movie', title, year, filePath, mediaItemId })}
              onRescan={handleRescanItem}
              onDismissUpgrade={handleDismissUpgrade}
              totalMovieCount={totalMovieCount}
              moviesLoading={moviesLoading}
              onLoadMoreMovies={loadMoreMovies}
              collectionsOnly={collectionsOnly}
            />
          ) : view === 'tv' ? (
          <TVShowsView
            shows={paginatedShows}
            selectedShow={selectedShow}
            selectedSeason={selectedSeason}
            selectedShowData={selectedShowData}
            selectedShowLoading={selectedShowEpisodesLoading}
            onSelectShow={setSelectedShow}
            onSelectSeason={setSelectedSeason}
            onSelectEpisode={setSelectedMediaId}
            filterItem={filterItem}
            gridScale={gridScale}
            viewType={viewType}
            seriesCompleteness={seriesCompleteness}
            onMissingItemClick={setSelectedMissingItem}
            showSourceBadge={!activeSourceId && sources.length > 1}
            onAnalyzeSeries={handleAnalyzeSingleSeries}
            onFixMatch={(title, sourceId, folderPath) => setMatchFixModal({ isOpen: true, type: 'series', title, sourceId, filePath: folderPath })}
            onRescanEpisode={async (episode) => {
              if (episode.source_id && episode.file_path) {
                await handleRescanItem(episode.id, episode.source_id, episode.library_id || null, episode.file_path)
              }
            }}
            onDismissUpgrade={handleDismissUpgrade}
            onDismissMissingEpisode={handleDismissMissingEpisode}
            onDismissMissingSeason={handleDismissMissingSeason}
            totalShowCount={totalShowCount}
            showsLoading={showsLoading}
            onLoadMoreShows={loadMoreShows}
          />
        ) : (
          <MusicView
            artists={musicArtists}
            totalArtistCount={totalArtistCount}
            artistsLoading={artistsLoading}
            onLoadMoreArtists={loadMoreArtists}
            albums={musicAlbums}
            tracks={albumTracks}
            allTracks={allMusicTracks}
            totalTrackCount={totalTrackCount}
            tracksLoading={tracksLoading}
            onLoadMoreTracks={loadMoreTracks}
            totalAlbumCount={totalAlbumCount}
            albumsLoading={albumsLoading}
            onLoadMoreAlbums={loadMoreAlbums}
            albumSortColumn={albumSortColumn}
            albumSortDirection={albumSortDirection}
            onAlbumSortChange={(col, dir) => { setAlbumSortColumn(col); setAlbumSortDirection(dir) }}
            stats={musicStats}
            selectedArtist={selectedArtist}
            selectedAlbum={selectedAlbum}
            artistCompleteness={artistCompleteness}
            albumCompleteness={selectedAlbumCompleteness}
            allAlbumCompleteness={allAlbumCompleteness}
            musicViewMode={musicViewMode}
            trackSortColumn={trackSortColumn}
            trackSortDirection={trackSortDirection}
            onTrackSortChange={(col, dir) => { setTrackSortColumn(col); setTrackSortDirection(dir) }}
            onSelectArtist={(artist) => {
              setSelectedArtist(artist)
              setSelectedAlbum(null)
              setAlbumTracks([])
              setSelectedAlbumCompleteness(null)
            }}
            onSelectAlbum={(album) => {
              setSelectedAlbum(album)
              loadAlbumTracks(album.id)
              loadAlbumCompleteness(album.id)
            }}
            onBack={() => {
              if (selectedAlbum) {
                setSelectedAlbum(null)
                setAlbumTracks([])
                setSelectedAlbumCompleteness(null)
              } else if (selectedArtist) {
                setSelectedArtist(null)
              }
            }}
            gridScale={gridScale}
            viewType={viewType}
            searchQuery={searchQuery}
            alphabetFilter={alphabetFilter}
            qualityFilter={qualityFilter}
            showSourceBadge={!activeSourceId && sources.length > 1}
            onAnalyzeAlbum={analyzeAlbumCompleteness}
            onAnalyzeArtist={analyzeArtistCompleteness}
            onArtistCompletenessUpdated={loadMusicCompletenessData}
            onFixArtistMatch={(artistId, artistName) => setMatchFixModal({ isOpen: true, type: 'artist', title: artistName, artistId })}
            onFixAlbumMatch={(albumId, albumTitle, artistName) => setMatchFixModal({ isOpen: true, type: 'album', title: albumTitle, artistName, albumId })}
            onRescanTrack={async (track) => {
              if (track.source_id && track.file_path) {
                await handleRescanItem(0, track.source_id, track.library_id || null, track.file_path)
              }
            }}
            includeEps={includeEps}
            includeSingles={includeSingles}
          />
        ))}
          </div>

          {/* Vertical Alphabet Filter - positioned left of scrollbar */}
          <div className="absolute right-3 top-0 bottom-0 flex flex-col items-center justify-between py-2" role="group" aria-label="Filter by letter">
            <button
              ref={(el) => {
                if (el) alphabetFilterRefs.current.set('all', el)
                else alphabetFilterRefs.current.delete('all')
              }}
              onClick={() => setAlphabetFilter(null)}
              className={`w-5 h-5 flex items-center justify-center text-[10px] font-medium transition-colors focus:outline-none ${
                alphabetFilter === null
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Show all"
              aria-label="Show all items"
              aria-pressed={alphabetFilter === null}
            >
              All
            </button>
            <button
              ref={(el) => {
                if (el) alphabetFilterRefs.current.set('#', el)
                else alphabetFilterRefs.current.delete('#')
              }}
              onClick={() => setAlphabetFilter('#')}
              className={`w-5 h-5 flex items-center justify-center text-[10px] font-medium transition-colors focus:outline-none ${
                alphabetFilter === '#'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Numbers and special characters"
              aria-label="Filter by numbers and special characters"
              aria-pressed={alphabetFilter === '#'}
            >
              #
            </button>
            {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map((letter) => (
              <button
                key={letter}
                ref={(el) => {
                  if (el) alphabetFilterRefs.current.set(letter, el)
                  else alphabetFilterRefs.current.delete(letter)
                }}
                onClick={() => setAlphabetFilter(letter)}
                className={`w-5 h-5 flex items-center justify-center text-[10px] font-medium transition-colors focus:outline-none ${
                  alphabetFilter === letter
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-label={`Filter by letter ${letter}`}
                aria-pressed={alphabetFilter === letter}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Media Details Modal */}
      {selectedMediaId && (
        <MediaDetails
          key={`${selectedMediaId}-${detailRefreshKey}`}
          mediaId={selectedMediaId}
          onClose={() => setSelectedMediaId(null)}
          onRescan={handleRescanItem}
          onFixMatch={(mediaItemId, title, year, filePath) => setMatchFixModal({ isOpen: true, type: 'movie', title, year, filePath, mediaItemId })}
          onDismissUpgrade={(mediaId, title) => {
            // Find the item in current view and delegate to existing handler
            const movieItem = paginatedMovies.find(m => m.id === mediaId)
            const episodeItem = selectedShowEpisodes.find(e => e.id === mediaId)
            const item = movieItem || episodeItem
            if (item) {
              handleDismissUpgrade(item)
            } else {
              // Item not in current paginated view, call addExclusion directly
              window.electronAPI.addExclusion('media_upgrade', mediaId, undefined, undefined, title)
            }
            emitDismissUpgrade({ mediaId })
          }}
        />
      )}

      {/* Completeness Panel */}
      <CompletenessPanel
        isOpen={showCompletenessPanel}
        onClose={() => setShowCompletenessPanel(false)}
        seriesStats={seriesStats}
        collectionStats={collectionStats}
        musicStats={musicCompletenessStats}
        onAnalyzeSeries={handleAnalyzeSeries}
        onAnalyzeCollections={handleAnalyzeCollections}
        onAnalyzeMusic={handleAnalyzeMusic}
        onCancel={handleCancelAnalysis}
        isAnalyzing={isAnalyzing}
        analysisProgress={analysisProgress}
        analysisType={analysisType}
        onDataRefresh={() => {
          loadEpSingleSettings()
          loadCompletenessData()
          loadMusicCompletenessData()
        }}
        hasTV={hasTV}
        hasMovies={hasMovies}
        hasMusic={hasMusic}
        onOpenSettings={onOpenSettings}
        libraries={activeSourceLibraries}
      />

      {/* Wishlist Panel */}
      <WishlistPanel
        isOpen={showWishlistPanel}
        onClose={() => setShowWishlistPanel(false)}
      />

      {/* Collection Modal */}
      {showCollectionModal && selectedCollection && (
        <CollectionModal
          collection={selectedCollection}
          ownedMovies={ownedMoviesForSelectedCollection}
          onClose={() => {
            setShowCollectionModal(false)
            setSelectedCollection(null)
          }}
          onMovieClick={(movieId) => {
            setShowCollectionModal(false)
            setSelectedCollection(null)
            setSelectedMediaId(movieId)
          }}
          onDismissCollectionMovie={handleDismissCollectionMovie}
        />
      )}

      {/* Missing Item Popup */}
      {selectedMissingItem && (
        <MissingItemPopup
          type={selectedMissingItem.type}
          title={selectedMissingItem.title}
          year={selectedMissingItem.year}
          airDate={selectedMissingItem.airDate}
          seasonNumber={selectedMissingItem.seasonNumber}
          episodeNumber={selectedMissingItem.episodeNumber}
          posterUrl={selectedMissingItem.posterUrl}
          tmdbId={selectedMissingItem.tmdbId}
          imdbId={selectedMissingItem.imdbId}
          seriesTitle={selectedMissingItem.seriesTitle}
          onClose={() => setSelectedMissingItem(null)}
          onDismiss={handleDismissMissingItem}
        />
      )}

      {/* Match Fix Modal */}
      {matchFixModal && (
        <MatchFixModal
          isOpen={matchFixModal.isOpen}
          onClose={() => setMatchFixModal(null)}
          type={matchFixModal.type}
          currentTitle={matchFixModal.title}
          currentYear={matchFixModal.year}
          filePath={matchFixModal.filePath}
          artistName={matchFixModal.artistName}
          sourceId={matchFixModal.sourceId}
          mediaItemId={matchFixModal.mediaItemId}
          artistId={matchFixModal.artistId}
          albumId={matchFixModal.albumId}
          onMatchFixed={() => {
            // Refresh the data after fixing a match
            if (matchFixModal.type === 'artist' || matchFixModal.type === 'album') {
              loadMusicData()
            } else {
              loadPaginatedMovies(true)
              loadPaginatedShows(true)
              if (selectedShow) loadSelectedShowEpisodes(selectedShow)
            }
          }}
        />
      )}
    </div>
  )
}
