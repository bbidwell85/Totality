import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FixedSizeList as VirtualList } from 'react-window'
import { MediaDetails } from './MediaDetails'
import { CompletenessPanel } from './CompletenessPanel'
import { MissingItemCard } from './MissingItemCard'
import { MissingItemPopup } from './MissingItemPopup'
import { CollectionModal } from './CollectionModal'
import { MatchFixModal } from './MatchFixModal'
import { QualityBadges } from './QualityBadges'
import { WishlistPanel } from '../wishlist/WishlistPanel'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import { ActivityPanel } from '../ui/ActivityPanel'
import { Grid3x3, List, Search, X, Library, Layers, Music, Disc3, User, MoreVertical, RefreshCw, Film, Tv, Folder, CircleFadingArrowUp, Pencil, Settings, Star, Home } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'
import { useNavigation } from '../../contexts/NavigationContext'
import { useWishlist } from '../../contexts/WishlistContext'
import { useToast } from '../../contexts/ToastContext'
import { EnhancedEmptyState } from '../onboarding'
import logoImage from '../../assets/totality_header_logo.png'
import { useKeyboardNavigation } from '../../contexts/KeyboardNavigationContext'
import { MoviePlaceholder, TvPlaceholder, EpisodePlaceholder } from '../ui/MediaPlaceholders'
import { useMenuClose } from '../../hooks/useMenuClose'

// Import extracted hooks (more hooks available in ./hooks for gradual migration)
import {
  useThemeAccent,
  usePanelState,
} from './hooks'

// Import types from shared types file
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicStats,
  MissingEpisode,
  MediaItem,
  TVShow,
  SeasonInfo,
  TVSeason,
  LibraryStats,
  SeriesCompletenessData,
  MovieCollectionData,
  SeriesStats,
  CollectionStats,
  MusicCompletenessStats,
  ArtistCompletenessData,
  MissingAlbum,
  MissingTrack,
  AlbumCompletenessData,
  AnalysisProgress,
  MediaBrowserProps,
} from './types'

// Import utilities from shared utils file
import { providerColors, formatSeasonLabel, getStatusBadge } from './mediaUtils'

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

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false) // For source switching without full UI flash
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false) // For background incremental scan on app start
  const [error, setError] = useState<string | null>(null)
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
  const [selectedAlbumCompleteness, setSelectedAlbumCompleteness] = useState<AlbumCompletenessData | null>(null)
  const [musicViewMode, setMusicViewMode] = useState<'artists' | 'albums' | 'tracks'>('artists')
  const [tierFilter, setTierFilter] = useState<'all' | 'SD' | '720p' | '1080p' | '4K'>('all')
  const [qualityFilter, setQualityFilter] = useState<'all' | 'low' | 'medium' | 'high'>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, _setSearchQuery] = useState('')
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [searchResultIndex, setSearchResultIndex] = useState(-1)
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
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const [debouncedTierFilter, setDebouncedTierFilter] = useState<'all' | 'SD' | '720p' | '1080p' | '4K'>('all')
  const [debouncedQualityFilter, setDebouncedQualityFilter] = useState<'all' | 'low' | 'medium' | 'high'>('all')
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0) // Increment to force detail view refresh
  const [viewType, setViewType] = useState<'grid' | 'list'>('grid')
  const [gridScale, setGridScale] = useState(4) // 1-7 scale for grid columns (4 = 50%)
  const [alphabetFilter, setAlphabetFilter] = useState<string | null>(null)

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
  // Panel state now managed by usePanelState hook (defined above)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analysisType, setAnalysisType] = useState<'series' | 'collections' | 'music' | null>(null)
  const [tmdbApiKeySet, setTmdbApiKeySet] = useState(false)

  // Collection modal state
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState<MovieCollectionData | null>(null)

  // Missing item popup state
  const [selectedMissingItem, setSelectedMissingItem] = useState<{
    type: 'episode' | 'season' | 'movie'
    title: string
    year?: number
    airDate?: string
    seasonNumber?: number
    episodeNumber?: number
    posterUrl?: string
    tmdbId?: string
    imdbId?: string
    seriesTitle?: string
  } | null>(null)

  // Match fix modal state
  const [matchFixModal, setMatchFixModal] = useState<{
    isOpen: boolean
    type: 'series' | 'movie' | 'artist' | 'album'
    title: string
    year?: number
    filePath?: string
    artistName?: string
    sourceId?: string
    mediaItemId?: number
    artistId?: number
    albumId?: number
  } | null>(null)

  // Active source libraries (to determine which library types exist)
  const [activeSourceLibraries, setActiveSourceLibraries] = useState<Array<{ type: string }>>([])
  const [_librariesLoading, setLibrariesLoading] = useState(false)

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

  // Debounced library update handler for live refresh during scans/analysis
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null)
  const handleLibraryUpdate = useCallback((data: { type: 'media' | 'music' | 'libraryToggle'; sourceId?: string }) => {
    // Skip expensive DB queries during active scans - will reload when scan completes via flush()
    const hasActiveScan = scanProgress.size > 0
    if (hasActiveScan && data.type !== 'libraryToggle') {
      return
    }

    // Debounce updates to avoid excessive refreshes
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current)
    }
    pendingUpdateRef.current = setTimeout(() => {
      if (data.type === 'libraryToggle') {
        // Refresh enabled libraries when a library is toggled
        // Only refresh if it's the active source or no sourceId specified
        if (!data.sourceId || data.sourceId === activeSourceId) {
          loadActiveSourceLibraries()
        }
      } else if (data.type === 'media') {
        loadMedia()
        loadStats(activeSourceId || undefined)
        loadCompletenessData()
      } else if (data.type === 'music') {
        loadMusicData()
        loadMusicCompletenessData()
      }
      pendingUpdateRef.current = null
    }, 500) // 500ms debounce for live updates
  }, [activeSourceId, loadActiveSourceLibraries, scanProgress.size])

  // Register toolbar elements for keyboard navigation
  useEffect(() => {
    // Toolbar elements: search, view tabs, panel buttons, settings
    if (searchInputRef.current) {
      registerFocusable('toolbar-search', searchInputRef.current, 'toolbar', 0)
    }
    if (moviesTabRef.current) {
      registerFocusable('toolbar-movies', moviesTabRef.current, 'toolbar', 1)
    }
    if (tvTabRef.current) {
      registerFocusable('toolbar-tv', tvTabRef.current, 'toolbar', 2)
    }
    if (musicTabRef.current) {
      registerFocusable('toolbar-music', musicTabRef.current, 'toolbar', 3)
    }
    if (completenessButtonRef.current) {
      registerFocusable('toolbar-completeness', completenessButtonRef.current, 'toolbar', 4)
    }
    if (wishlistButtonRef.current) {
      registerFocusable('toolbar-wishlist', wishlistButtonRef.current, 'toolbar', 5)
    }
    if (settingsButtonRef.current) {
      registerFocusable('toolbar-settings', settingsButtonRef.current, 'toolbar', 6)
    }
    return () => {
      unregisterFocusable('toolbar-search')
      unregisterFocusable('toolbar-movies')
      unregisterFocusable('toolbar-tv')
      unregisterFocusable('toolbar-music')
      unregisterFocusable('toolbar-completeness')
      unregisterFocusable('toolbar-wishlist')
      unregisterFocusable('toolbar-settings')
    }
  }, [registerFocusable, unregisterFocusable])

  // Check which toolbar elements are focused
  const isSearchFocused = focusedId === 'toolbar-search' && isNavigationActive
  const isMoviesTabFocused = focusedId === 'toolbar-movies' && isNavigationActive
  const isTvTabFocused = focusedId === 'toolbar-tv' && isNavigationActive
  const isMusicTabFocused = focusedId === 'toolbar-music' && isNavigationActive
  const isCompletenessButtonFocused = focusedId === 'toolbar-completeness' && isNavigationActive
  const isWishlistButtonFocused = focusedId === 'toolbar-wishlist' && isNavigationActive
  const isSettingsButtonFocused = focusedId === 'toolbar-settings' && isNavigationActive

  // Register filter elements for keyboard navigation
  useEffect(() => {
    let filterIndex = 0

    // Tier filter buttons
    const tierOptions = ['all', '4K', '1080p', '720p', 'SD']
    tierOptions.forEach((tier) => {
      const ref = tierFilterRefs.current.get(tier)
      if (ref) {
        registerFocusable(`filter-tier-${tier}`, ref, 'filters', filterIndex++)
      }
    })

    // Quality filter buttons
    const qualityOptions = ['all', 'high', 'medium', 'low']
    qualityOptions.forEach((quality) => {
      const ref = qualityFilterRefs.current.get(quality)
      if (ref) {
        registerFocusable(`filter-quality-${quality}`, ref, 'filters', filterIndex++)
      }
    })

    // View toggle buttons
    if (gridViewRef.current) {
      registerFocusable('filter-view-grid', gridViewRef.current, 'filters', filterIndex++)
    }
    if (listViewRef.current) {
      registerFocusable('filter-view-list', listViewRef.current, 'filters', filterIndex++)
    }

    // Alphabet filter buttons
    const alphabetOptions = [null, '#', ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ')]
    alphabetOptions.forEach((letter) => {
      const key = letter === null ? 'all' : letter
      const ref = alphabetFilterRefs.current.get(key)
      if (ref) {
        registerFocusable(`filter-alpha-${key}`, ref, 'filters', filterIndex++)
      }
    })

    return () => {
      tierOptions.forEach((tier) => unregisterFocusable(`filter-tier-${tier}`))
      qualityOptions.forEach((quality) => unregisterFocusable(`filter-quality-${quality}`))
      unregisterFocusable('filter-view-grid')
      unregisterFocusable('filter-view-list')
      alphabetOptions.forEach((letter) => {
        const key = letter === null ? 'all' : letter
        unregisterFocusable(`filter-alpha-${key}`)
      })
    }
  }, [registerFocusable, unregisterFocusable, view])

  // Helper to check if a filter element is focused
  const isFilterFocused = (type: string, value: string) => focusedId === `filter-${type}-${value}` && isNavigationActive

  useEffect(() => {
    loadMedia()
    loadStats(activeSourceId || undefined)
    loadCompletenessData()
    loadMusicData()
    loadMusicCompletenessData()
    checkTmdbApiKey()

    // Listen for completeness analysis progress
    const cleanupSeriesProgress = window.electronAPI.onSeriesProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
    })
    const cleanupCollectionsProgress = window.electronAPI.onCollectionsProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
    })
    const cleanupMusicAnalysisProgress = window.electronAPI.onMusicAnalysisProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
    })

    // Listen for library updates (live refresh during scans/analysis)
    const cleanupLibraryUpdated = window.electronAPI.onLibraryUpdated(handleLibraryUpdate)

    // Listen for auto-refresh events (incremental scan on app start)
    const cleanupAutoRefreshStarted = window.electronAPI.onAutoRefreshStarted(() => {
      setIsAutoRefreshing(true)
    })
    const cleanupAutoRefreshComplete = window.electronAPI.onAutoRefreshComplete(() => {
      setIsAutoRefreshing(false)
    })

    // Listen for task queue task completion (refreshes data after queued scans complete)
    const cleanupTaskComplete = window.electronAPI.onTaskQueueTaskComplete?.((task: unknown) => {
      const t = task as { type: string; status: string }
      // Refresh data when a scan task completes successfully
      if (t.status === 'completed') {
        if (t.type === 'library-scan' || t.type === 'music-scan') {
          handleLibraryUpdate({ type: t.type === 'music-scan' ? 'music' : 'media' })
        }
        // Refresh completeness data after completeness tasks
        if (t.type === 'series-completeness' || t.type === 'collection-completeness') {
          loadCompletenessData()
        }
        if (t.type === 'music-completeness') {
          loadMusicCompletenessData()
        }
      }
    })

    // Listen for task queue state updates to sync analyzing state
    const cleanupTaskQueueUpdated = window.electronAPI.onTaskQueueUpdated?.((state: unknown) => {
      const s = state as { currentTask: { type: string; progress?: AnalysisProgress } | null }
      if (s.currentTask) {
        const taskType = s.currentTask.type
        if (taskType === 'series-completeness') {
          setIsAnalyzing(true)
          setAnalysisType('series')
          if (s.currentTask.progress) {
            setAnalysisProgress(s.currentTask.progress)
          }
        } else if (taskType === 'collection-completeness') {
          setIsAnalyzing(true)
          setAnalysisType('collections')
          if (s.currentTask.progress) {
            setAnalysisProgress(s.currentTask.progress)
          }
        } else if (taskType === 'music-completeness') {
          setIsAnalyzing(true)
          setAnalysisType('music')
          if (s.currentTask.progress) {
            setAnalysisProgress(s.currentTask.progress)
          }
        } else {
          // Non-completeness task running, reset completeness analyzing state
          setIsAnalyzing(false)
          setAnalysisType(null)
        }
      } else {
        // No task running
        setIsAnalyzing(false)
        setAnalysisType(null)
        setAnalysisProgress(null)
      }
    })

    // Listen for settings changes (e.g., API key added/removed in Settings)
    const cleanupSettingsChanged = window.electronAPI.onSettingsChanged?.((data) => {
      if (data.key === 'tmdb_api_key') {
        setTmdbApiKeySet(data.hasValue)
      }
    })

    // Listen for scan completion to show toast notification
    const cleanupScanCompleted = window.electronAPI.onScanCompleted?.((data) => {
      // Show toast notification
      const itemsChanged = data.itemsAdded + data.itemsUpdated
      const message = itemsChanged > 0
        ? `Added ${data.itemsAdded}, updated ${data.itemsUpdated}`
        : `${data.itemsScanned} items scanned, no changes`

      addToast({
        type: 'success',
        title: `${data.libraryName} complete`,
        message,
        action: data.sourceId ? {
          label: 'View Library',
          onClick: () => {
            if (data.sourceId) {
              setActiveSource(data.sourceId)
            }
          }
        } : undefined
      })

      // Mark library as having new items (for sidebar badge)
      if (data.sourceId && data.libraryId && data.itemsAdded > 0) {
        markLibraryAsNew(`${data.sourceId}:${data.libraryId}`, data.itemsAdded)
      }

      // Auto-navigate on first scan to help new users
      if (data.isFirstScan && data.sourceId) {
        setActiveSource(data.sourceId)
      }
    })

    // Cleanup all listeners on unmount
    return () => {
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current)
      }
      cleanupSeriesProgress?.()
      cleanupCollectionsProgress?.()
      cleanupMusicAnalysisProgress?.()
      cleanupLibraryUpdated?.()
      cleanupAutoRefreshStarted?.()
      cleanupAutoRefreshComplete?.()
      cleanupTaskComplete?.()
      cleanupTaskQueueUpdated?.()
      cleanupSettingsChanged?.()
      cleanupScanCompleted?.()
    }
  }, [handleLibraryUpdate, addToast, setActiveSource, markLibraryAsNew])

  // Reload media and stats when active source changes
  useEffect(() => {
    loadMedia()
    loadStats(activeSourceId || undefined)
    loadMusicData()
    loadCompletenessData()
  }, [activeSourceId])

  // Debounce filter changes (faster than search since they're button clicks)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTierFilter(tierFilter)
      setDebouncedQualityFilter(qualityFilter)
    }, 150) // 150ms debounce for filters

    return () => clearTimeout(timer)
  }, [tierFilter, qualityFilter])

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

  const loadMedia = async () => {
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

      const mediaItems: any[] = await window.electronAPI.getMediaItems(filters)
      setItems(mediaItems)
      hasInitialLoadRef.current = true
    } catch (err) {
      console.error('Error loading media:', err)
      setError('Failed to load media items')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

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
      const [seriesData, collectionsData, sStats, cStats] = await Promise.all([
        window.electronAPI.seriesGetAll(),
        window.electronAPI.collectionsGetAll(),
        window.electronAPI.seriesGetStats(),
        window.electronAPI.collectionsGetStats()
      ])

      // Index series by title for O(1) lookup
      const seriesMap = new Map<string, SeriesCompletenessData>()
      ;(seriesData as SeriesCompletenessData[]).forEach(s => {
        seriesMap.set(s.series_title, s)
      })
      setSeriesCompleteness(seriesMap)
      setMovieCollections(collectionsData as MovieCollectionData[])
      setSeriesStats(sStats as SeriesStats)
      setCollectionStats(cStats as CollectionStats)
    } catch (err) {
      console.warn('Failed to load completeness data:', err)
    }
  }

  // Load music data (non-blocking background load)
  const loadMusicData = async () => {
    try {
      const filters = activeSourceId
        ? { sourceId: activeSourceId }
        : undefined
      const [artists, albums, tracks, mStats] = await Promise.all([
        window.electronAPI.musicGetArtists(filters),
        window.electronAPI.musicGetAlbums(filters),
        window.electronAPI.musicGetTracks(filters),
        window.electronAPI.musicGetStats(activeSourceId || undefined)
      ])

      setMusicArtists(artists as MusicArtist[])
      setMusicAlbums(albums as MusicAlbum[])
      setAllMusicTracks(tracks as MusicTrack[])
      setMusicStats(mStats as MusicStats)
    } catch (err) {
      console.warn('Failed to load music data:', err)
    }
  }

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

  // Check if TMDB API key is configured
  const checkTmdbApiKey = async () => {
    try {
      const key = await window.electronAPI.getSetting('tmdb_api_key')
      setTmdbApiKeySet(!!key && key.length > 0)
    } catch (err) {
      console.warn('Failed to check TMDB API key:', err)
    }
  }

  // Run series analysis via task queue
  const handleAnalyzeSeries = async () => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'series-completeness',
        label: `Analyze TV Series (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue series analysis:', err)
    }
  }

  // Run collections analysis via task queue
  const handleAnalyzeCollections = async () => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'collection-completeness',
        label: `Analyze Collections (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue collections analysis:', err)
    }
  }

  // Run unified music analysis via task queue
  const handleAnalyzeMusic = async () => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'music-completeness',
        label: `Analyze Music (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue music analysis:', err)
    }
  }

  // Analyze a single series for completeness
  const handleAnalyzeSingleSeries = async (seriesTitle: string) => {
    try {
      console.log(`[MediaBrowser] Analyzing series: ${seriesTitle}`)
      await window.electronAPI.seriesAnalyze(seriesTitle)
      // Reload completeness data after analysis
      await loadCompletenessData()
    } catch (err) {
      console.error('Single series analysis failed:', err)
    }
  }

  // Cancel current analysis
  const handleCancelAnalysis = async (_type: 'series' | 'collections' | 'music') => {
    try {
      // Cancel the current task in the queue
      await window.electronAPI.taskQueueCancelCurrent()
    } catch (err) {
      console.error('Failed to cancel analysis:', err)
    }
  }

  // Rescan a single media item
  const handleRescanItem = async (mediaItemId: number, sourceId: string, libraryId: string | null, filePath: string) => {
    try {
      console.log(`[MediaBrowser] Rescanning item: ${filePath}`)
      await window.electronAPI.sourcesScanItem(sourceId, libraryId, filePath)
      // Reload media items to show updated data
      await loadMedia()
      // If the detail view is open for this item, force it to refresh
      if (selectedMediaId === mediaItemId) {
        setDetailRefreshKey(prev => prev + 1)
      }
    } catch (err) {
      console.error('Rescan failed:', err)
    }
  }

  // Load music completeness data
  const loadMusicCompletenessData = async () => {
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

      // Calculate stats
      const totalArtists = musicArtists.length
      const analyzedArtists = completenessData.length
      const completeArtists = completenessData.filter(c => c.completeness_percentage >= 100).length
      const incompleteArtists = analyzedArtists - completeArtists

      // Count total missing albums
      let totalMissingAlbums = 0
      for (const c of completenessData) {
        try {
          const missingAlbums = JSON.parse(c.missing_albums || '[]')
          totalMissingAlbums += missingAlbums.length
        } catch { /* ignore */ }
      }

      const avgCompleteness = analyzedArtists > 0
        ? Math.round(completenessData.reduce((sum, c) => sum + c.completeness_percentage, 0) / analyzedArtists)
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

  // Get collection data for a movie by checking owned_movie_ids
  const getCollectionForMovie = useCallback((movie: MediaItem): MovieCollectionData | undefined => {
    if (!movie.tmdb_id) return undefined
    return movieCollections.find(c => {
      try {
        const ownedIds = JSON.parse(c.owned_movie_ids || '[]')
        return ownedIds.includes(movie.tmdb_id)
      } catch {
        return false
      }
    })
  }, [movieCollections])

  // Get owned movies for a collection
  const getOwnedMoviesForCollection = useCallback((collection: MovieCollectionData): MediaItem[] => {
    try {
      const ownedIds = new Set(JSON.parse(collection.owned_movie_ids || '[]'))
      return items.filter(item =>
        item.type === 'movie' && item.tmdb_id && ownedIds.has(item.tmdb_id)
      )
    } catch {
      return []
    }
  }, [items])

  // Memoize owned movies for the selected collection to avoid recalculating on every render
  const ownedMoviesForSelectedCollection = useMemo(() => {
    if (!selectedCollection) return []
    return getOwnedMoviesForCollection(selectedCollection)
  }, [selectedCollection, getOwnedMoviesForCollection])

  // Organize TV shows hierarchically
  const organizeShows = useCallback((): Map<string, TVShow> => {
    const shows = new Map<string, TVShow>()

    items
      .filter(item => item.type === 'episode')
      .forEach(episode => {
        const showTitle = episode.series_title || 'Unknown Series'

        if (!shows.has(showTitle)) {
          shows.set(showTitle, {
            title: showTitle,
            poster_url: episode.poster_url,
            seasons: new Map()
          })
        }

        const show = shows.get(showTitle)!
        const seasonNum = episode.season_number || 0

        // Update show poster if not set yet but this episode has one
        if (!show.poster_url && episode.poster_url) {
          show.poster_url = episode.poster_url
        }

        if (!show.seasons.has(seasonNum)) {
          show.seasons.set(seasonNum, {
            seasonNumber: seasonNum,
            episodes: [],
            posterUrl: episode.season_poster_url
          })
        }

        // Update season poster if not set yet
        const season = show.seasons.get(seasonNum)!
        if (!season.posterUrl && episode.season_poster_url) {
          season.posterUrl = episode.season_poster_url
        }

        season.episodes.push(episode)
      })

    // Sort episodes within each season
    shows.forEach(show => {
      show.seasons.forEach(season => {
        season.episodes.sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
      })
    })

    return shows
  }, [items])

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

  const movies = useMemo(
    () => items.filter(item => item.type === 'movie' && filterItem(item)),
    [items, filterItem]
  )

  const tvShows = useMemo(() => organizeShows(), [organizeShows])

  // Filter TV shows by alphabet and search, then sort alphabetically
  const filteredShows = useMemo(
    () => Array.from(tvShows.entries())
      .filter(([title]) => {
        // Alphabet filter
        if (alphabetFilter) {
          const firstChar = title.charAt(0).toUpperCase()
          if (alphabetFilter === '#') {
            if (/[A-Z]/.test(firstChar)) return false
          } else {
            if (firstChar !== alphabetFilter) return false
          }
        }

        // Search filter
        if (!searchQuery.trim()) return true
        return title.toLowerCase().includes(searchQuery.toLowerCase())
      })
      .sort((a, b) => a[0].localeCompare(b[0])),
    [tvShows, alphabetFilter, searchQuery]
  )

  // Global search results for live preview (searches all content types)
  const globalSearchResults = useMemo(() => {
    if (!searchInput.trim() || searchInput.length < 2) return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }

    const query = searchInput.toLowerCase()
    const maxResults = 5 // Max results per category

    // Search movies
    const movieResults = items
      .filter(item => item.type === 'movie' && item.title.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map(item => ({
        id: item.id,
        title: item.title,
        year: item.year,
        poster_url: item.poster_url,
        needs_upgrade: item.needs_upgrade || item.tier_quality === 'LOW',
        type: 'movie' as const
      }))

    // Search TV shows (unique titles only)
    const tvResults = Array.from(tvShows.entries())
      .filter(([title]) => title.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map(([title, show]) => ({
        id: title,
        title: title,
        poster_url: show.poster_url,
        type: 'tv' as const
      }))

    // Search episodes
    const episodeResults = items
      .filter(item => item.type === 'episode' && (
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

    // Search music tracks (include album info)
    const trackResults = allMusicTracks
      .filter(track => track.title.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map(track => {
        const album = musicAlbums.find(a => a.id === track.album_id)
        return {
          id: track.id,
          title: track.title,
          album_id: track.album_id,
          album_title: album?.title,
          artist_name: album?.artist_name,
          thumb_url: album?.thumb_url,
          needs_upgrade: !track.is_lossless && !track.is_hi_res,
          type: 'track' as const
        }
      })

    return {
      movies: movieResults,
      tvShows: tvResults,
      episodes: episodeResults,
      artists: artistResults,
      albums: albumResults,
      tracks: trackResults
    }
  }, [searchInput, items, tvShows, musicArtists, musicAlbums, allMusicTracks])

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
        if (artist) setSelectedArtist(artist)
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
              className={`w-full pl-10 pr-8 py-2 bg-muted/50 border border-border/50 rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${isSearchFocused ? 'ring-2 ring-primary' : ''}`}
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
                  } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted/50 ${isMoviesTabFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' : ''}`}
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
                  } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted/50 ${isTvTabFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' : ''}`}
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
                  } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted/50 ${isMusicTabFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' : ''}`}
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
              } ${isCompletenessButtonFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' : ''}`}
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
              } ${isWishlistButtonFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' : ''}`}
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
              className={`p-2.5 rounded-md transition-colors flex-shrink-0 bg-card text-muted-foreground hover:bg-muted focus:outline-none ${isSettingsButtonFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' : ''}`}
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
                          } ${isFilterFocused('tier', tier) ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
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
                          } ${isFilterFocused('quality', quality) ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                        >
                          {quality.charAt(0).toUpperCase() + quality.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
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
                      } ${isFilterFocused('view', 'grid') ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
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
                      } ${isFilterFocused('view', 'list') ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
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
            />
          ) : view === 'tv' ? (
          <TVShowsView
            shows={filteredShows}
            selectedShow={selectedShow}
            selectedSeason={selectedSeason}
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
          />
        ) : (
          <MusicView
            artists={musicArtists}
            albums={musicAlbums}
            tracks={albumTracks}
            allTracks={allMusicTracks}
            stats={musicStats}
            selectedArtist={selectedArtist}
            selectedAlbum={selectedAlbum}
            artistCompleteness={artistCompleteness}
            albumCompleteness={selectedAlbumCompleteness}
            allAlbumCompleteness={allAlbumCompleteness}
            musicViewMode={musicViewMode}
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
          loadCompletenessData()
          loadMusicCompletenessData()
        }}
        hasTV={hasTV}
        hasMovies={hasMovies}
        hasMusic={hasMusic}
        onOpenSettings={onOpenSettings}
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
              loadMedia()
            }
          }}
        />
      )}
    </div>
  )
}

// Display item type for grouped movies view
type MovieDisplayItem =
  | { type: 'collection'; collection: MovieCollectionData }
  | { type: 'movie'; movie: MediaItem }

function MoviesView({
  movies,
  onSelectMovie,
  onSelectCollection,
  viewType,
  gridScale,
  getCollectionForMovie,
  movieCollections,
  showSourceBadge,
  onFixMatch,
  onRescan
}: {
  movies: MediaItem[]
  onSelectMovie: (id: number, movie: MediaItem) => void
  onSelectCollection: (collection: MovieCollectionData) => void
  viewType: 'grid' | 'list'
  gridScale: number
  getCollectionForMovie: (movie: MediaItem) => MovieCollectionData | undefined
  movieCollections: MovieCollectionData[]
  showSourceBadge: boolean
  onFixMatch?: (mediaItemId: number, title: string, year?: number, filePath?: string) => void
  onRescan?: (mediaItemId: number, sourceId: string, libraryId: string | null, filePath: string) => Promise<void>
}) {
  // Map scale to minimum poster width (1=smallest, 7=largest)
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120,  // Smallest posters
      2: 140,
      3: 160,
      4: 180,
      5: 200,  // Default
      6: 240,
      7: 300   // Largest posters
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Group movies by collection - show collections as single items
  const displayItems = useMemo<MovieDisplayItem[]>(() => {
    // Build a set of movie IDs that belong to collections
    const moviesInCollections = new Set<number>()
    const collectionMovieMap = new Map<string, MediaItem[]>()

    // Find which movies belong to which collection
    for (const movie of movies) {
      const collection = getCollectionForMovie(movie)
      if (collection) {
        moviesInCollections.add(movie.id)
        const existing = collectionMovieMap.get(collection.tmdb_collection_id) || []
        existing.push(movie)
        collectionMovieMap.set(collection.tmdb_collection_id, existing)
      }
    }

    // Build display items
    const items: MovieDisplayItem[] = []

    // Add collections (only those that have at least one movie in current filtered view)
    const addedCollections = new Set<string>()
    for (const collection of movieCollections) {
      if (collectionMovieMap.has(collection.tmdb_collection_id) && !addedCollections.has(collection.tmdb_collection_id)) {
        items.push({ type: 'collection', collection })
        addedCollections.add(collection.tmdb_collection_id)
      }
    }

    // Add individual movies not in any collection
    for (const movie of movies) {
      if (!moviesInCollections.has(movie.id)) {
        items.push({ type: 'movie', movie })
      }
    }

    // Sort all items alphabetically together (collections and movies interleaved)
    items.sort((a, b) => {
      const titleA = a.type === 'collection' ? a.collection.collection_name : a.movie.title
      const titleB = b.type === 'collection' ? b.collection.collection_name : b.movie.title
      return titleA.localeCompare(titleB)
    })

    return items
  }, [movies, movieCollections, getCollectionForMovie])

  if (displayItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <MoviePlaceholder className="w-20 h-20 text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-lg">No movies found</p>
        <p className="text-sm text-muted-foreground mt-2">
          Scan a movie library from the sidebar to get started
        </p>
      </div>
    )
  }

  if (viewType === 'list') {
    return (
      <div className="space-y-2">
        {displayItems.map((item, index) => {
          if (item.type === 'collection') {
            return (
              <CollectionListItem
                key={`collection-${item.collection.id}`}
                collection={item.collection}
                onClick={() => onSelectCollection(item.collection)}
                focusIndex={index}
              />
            )
          }
          return (
            <MovieListItem
              key={item.movie.id}
              movie={item.movie}
              onClick={() => onSelectMovie(item.movie.id, item.movie)}
              showSourceBadge={showSourceBadge}
              collectionData={getCollectionForMovie(item.movie)}
              onFixMatch={onFixMatch ? () => onFixMatch(item.movie.id, item.movie.title, item.movie.year, item.movie.file_path) : undefined}
              onRescan={onRescan && item.movie.source_id && item.movie.file_path ? () => onRescan(item.movie.id, item.movie.source_id!, item.movie.library_id || null, item.movie.file_path!) : undefined}
              focusIndex={index}
            />
          )
        })}
      </div>
    )
  }

  // Grid view using standard grid (VirtualizedGrid doesn't support mixed item types well)
  return (
    <div
      className="grid gap-8"
      style={{
        gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)`
      }}
    >
      {displayItems.map((item, index) => {
        if (item.type === 'collection') {
          return (
            <CollectionCard
              key={`collection-${item.collection.id}`}
              collection={item.collection}
              onClick={() => onSelectCollection(item.collection)}
              focusIndex={index}
            />
          )
        }
        return (
          <MovieCard
            key={item.movie.id}
            movie={item.movie}
            onClick={() => onSelectMovie(item.movie.id, item.movie)}
            collectionData={getCollectionForMovie(item.movie)}
            showSourceBadge={showSourceBadge}
            onFixMatch={onFixMatch ? () => onFixMatch(item.movie.id, item.movie.title, item.movie.year, item.movie.file_path) : undefined}
            onRescan={onRescan && item.movie.source_id && item.movie.file_path ? () => onRescan(item.movie.id, item.movie.source_id!, item.movie.library_id || null, item.movie.file_path!) : undefined}
            focusIndex={index}
          />
        )
      })}
    </div>
  )
}

// Collection card for grid view
const CollectionCard = memo(({ collection, onClick, focusIndex }: { collection: MovieCollectionData; onClick: () => void; focusIndex?: number }) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-collection-${collection.id}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`focus-poster-only cursor-pointer hover-scale outline-none ${isFocused ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster */}
      <div className={`aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
        {collection.poster_url ? (
          <img
            src={collection.poster_url}
            alt={collection.collection_name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-purple-500/20 to-blue-500/20">
            <Layers className="w-12 h-12 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Title and badge below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{collection.collection_name}</h4>
          <p className="text-xs text-muted-foreground">
            {collection.owned_movies} of {collection.total_movies} movies
          </p>
        </div>
        {/* Collection completion badge */}
        <div
          className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1 ${
            collection.completeness_percentage === 100
              ? 'bg-green-500 text-white'
              : 'bg-foreground text-background border border-border'
          }`}
          title={`${collection.owned_movies} of ${collection.total_movies} movies owned`}
        >
          <Layers className="w-3 h-3" />
          <span>{collection.owned_movies}/{collection.total_movies}</span>
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.collection.id === nextProps.collection.id &&
         prevProps.collection.owned_movies === nextProps.collection.owned_movies &&
         prevProps.collection.total_movies === nextProps.collection.total_movies &&
         prevProps.collection.poster_url === nextProps.collection.poster_url &&
         prevProps.focusIndex === nextProps.focusIndex
})

// Collection list item for list view
function CollectionListItem({ collection, onClick, focusIndex }: { collection: MovieCollectionData; onClick: () => void; focusIndex?: number }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-collection-list-${collection.id}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-none ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster Thumbnail */}
      <div className="w-16 h-24 bg-muted rounded-md overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {collection.poster_url ? (
          <img
            src={collection.poster_url}
            alt={collection.collection_name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layers className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{collection.collection_name}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {collection.owned_movies} of {collection.total_movies} movies
        </p>
      </div>

      {/* Collection completion badge - aligned with upgrade icon position */}
      <div className="flex-shrink-0 flex items-center justify-center">
        <div
          className={`text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1 ${
            collection.completeness_percentage === 100
              ? 'bg-green-500 text-white'
              : 'bg-foreground text-background border border-border'
          }`}
          title={`${collection.owned_movies} of ${collection.total_movies} movies owned`}
        >
          <Layers className="w-3 h-3" />
          <span>{collection.owned_movies}/{collection.total_movies}</span>
        </div>
      </div>
    </div>
  )
}

const MovieCard = memo(({ movie, onClick, collectionData, showSourceBadge, onFixMatch, onRescan, focusIndex }: { movie: MediaItem; onClick: () => void; collectionData?: MovieCollectionData; showSourceBadge?: boolean; onFixMatch?: (mediaItemId: number) => void; onRescan?: (mediaItemId: number) => Promise<void>; focusIndex?: number }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-movie-${movie.id}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && movie.id) {
      onFixMatch(movie.id)
    }
  }

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan && movie.id) {
      setIsRescanning(true)
      try {
        await onRescan(movie.id)
      } finally {
        setIsRescanning(false)
      }
    }
  }

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`focus-poster-only group cursor-pointer hover-scale outline-none ${isFocused ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster */}
      <div className={`aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
        {/* 3-dot menu button */}
        {(onFixMatch || onRescan) && (
          <div ref={menuRef} className="absolute top-2 left-2 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className={`w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity ${isRescanning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              {isRescanning ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <MoreVertical className="w-4 h-4" />
              )}
            </button>

            {/* Dropdown menu */}
            {showMenu && !isRescanning && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                {onRescan && movie.file_path && (
                  <button
                    onClick={handleRescan}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rescan File
                  </button>
                )}
                {onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Fix Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Source Badge - show which provider this item is from */}
        {showSourceBadge && movie.source_type && (
          <div
            className={`absolute bottom-2 left-2 ${providerColors[movie.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
            title={movie.source_type.charAt(0).toUpperCase() + movie.source_type.slice(1)}
          >
            {movie.source_type.charAt(0).toUpperCase()}
          </div>
        )}

        {movie.poster_url ? (
          <img
            src={movie.poster_url}
            alt={movie.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><MoviePlaceholder className="w-20 h-20 text-muted-foreground" /></div>
        )}
      </div>

      {/* Title and Year below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{movie.title}</h4>
          {movie.year && <p className="text-xs text-muted-foreground">{movie.year}</p>}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          {/* Collection Badge - shown when movie is part of a collection */}
          {collectionData && (
            <div
              className={`text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1 ${
                collectionData.completeness_percentage === 100
                  ? 'bg-green-500 text-white'
                  : 'bg-foreground text-background border border-border'
              }`}
              title={`Part of ${collectionData.collection_name} (${collectionData.owned_movies}/${collectionData.total_movies})`}
            >
              <Layers className="w-3 h-3" />
              <span>{collectionData.owned_movies}/{collectionData.total_movies}</span>
            </div>
          )}
          {/* Quality Upgrade Badge */}
          {(movie.tier_quality === 'LOW' || !!movie.needs_upgrade) && (
            <div title="Quality upgrade recommended">
              <CircleFadingArrowUp className="w-5 h-5 text-red-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.movie.id === nextProps.movie.id &&
         prevProps.movie.tier_quality === nextProps.movie.tier_quality &&
         prevProps.movie.needs_upgrade === nextProps.movie.needs_upgrade &&
         prevProps.movie.poster_url === nextProps.movie.poster_url &&
         prevProps.movie.quality_tier === nextProps.movie.quality_tier &&
         prevProps.movie.source_type === nextProps.movie.source_type &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.collectionData?.id === nextProps.collectionData?.id &&
         prevProps.collectionData?.completeness_percentage === nextProps.collectionData?.completeness_percentage &&
         prevProps.focusIndex === nextProps.focusIndex
})

const MovieListItem = memo(({ movie, onClick, showSourceBadge, collectionData, onFixMatch, onRescan, focusIndex }: { movie: MediaItem; onClick: () => void; showSourceBadge?: boolean; collectionData?: MovieCollectionData; onFixMatch?: (mediaItemId: number) => void; onRescan?: (mediaItemId: number) => Promise<void>; focusIndex?: number }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-movie-list-${movie.id}`
  const isFocused = focusedId === focusId && isNavigationActive
  const needsUpgrade = movie.tier_quality === 'LOW' || !!movie.needs_upgrade

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && movie.id) {
      onFixMatch(movie.id)
    }
  }

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan && movie.id) {
      setIsRescanning(true)
      try {
        await onRescan(movie.id)
      } finally {
        setIsRescanning(false)
      }
    }
  }

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-none ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster Thumbnail */}
      <div className="w-16 h-24 bg-muted rounded-md overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {movie.poster_url ? (
          <img
            src={movie.poster_url}
            alt={movie.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><MoviePlaceholder className="w-8 h-8 text-muted-foreground" /></div>
        )}
        {/* 3-dot menu button */}
        {(onFixMatch || onRescan) && (
          <div ref={menuRef} className="absolute top-1 left-1 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className={`w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity ${isRescanning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              {isRescanning ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <MoreVertical className="w-3 h-3" />
              )}
            </button>

            {/* Dropdown menu */}
            {showMenu && !isRescanning && (
              <div className="absolute top-7 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                {onRescan && movie.file_path && (
                  <button
                    onClick={handleRescan}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rescan File
                  </button>
                )}
                {onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Fix Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {/* Source badge for list view */}
        {showSourceBadge && movie.source_type && (
          <div
            className={`absolute bottom-0 left-0 right-0 ${providerColors[movie.source_type] || 'bg-gray-500'} text-white text-xs font-bold text-center py-0.5`}
          >
            {movie.source_type.toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{movie.title}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {movie.year}{movie.year && movie.resolution ? ' • ' : ''}{movie.resolution}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {movie.quality_tier && movie.tier_quality && (
            <span className="text-xs text-muted-foreground">
              {movie.quality_tier} • {movie.tier_quality}
            </span>
          )}
          <QualityBadges item={movie} whiteBg={false} />
        </div>
      </div>

      {/* Badges */}
      <div className="flex-shrink-0 flex items-center justify-center">
        {/* Show upgrade icon if needs upgrade, otherwise show collection badge */}
        {needsUpgrade ? (
          <div title="Quality upgrade recommended">
            <CircleFadingArrowUp className="w-6 h-6 text-red-500" />
          </div>
        ) : collectionData ? (
          <div
            className={`text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1 ${
              collectionData.completeness_percentage === 100
                ? 'bg-green-500 text-white'
                : 'bg-foreground text-background border border-border'
            }`}
            title={`Part of ${collectionData.collection_name} (${collectionData.owned_movies}/${collectionData.total_movies})`}
          >
            <Layers className="w-3 h-3" />
            <span>{collectionData.owned_movies}/{collectionData.total_movies}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.movie.id === nextProps.movie.id &&
         prevProps.movie.tier_quality === nextProps.movie.tier_quality &&
         prevProps.movie.needs_upgrade === nextProps.movie.needs_upgrade &&
         prevProps.collectionData?.id === nextProps.collectionData?.id &&
         prevProps.collectionData?.completeness_percentage === nextProps.collectionData?.completeness_percentage &&
         prevProps.movie.poster_url === nextProps.movie.poster_url &&
         prevProps.movie.quality_tier === nextProps.movie.quality_tier &&
         prevProps.movie.source_type === nextProps.movie.source_type &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.focusIndex === nextProps.focusIndex
})

// List item component for TV shows
const ShowListItem = memo(({ show, onClick, completenessData, showSourceBadge, onAnalyzeSeries, onFixMatch, focusIndex }: {
  show: TVShow
  onClick: () => void
  completenessData?: SeriesCompletenessData
  showSourceBadge?: boolean
  onAnalyzeSeries?: () => Promise<void>
  onFixMatch?: (sourceId: string, folderPath?: string) => void
  focusIndex?: number
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-show-list-${show.title}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  const totalEpisodes = Array.from(show.seasons.values()).reduce(
    (sum, season) => sum + season.episodes.length,
    0
  )
  const seasonCount = show.seasons.size

  // Get source type, source ID, and folder path from the first episode
  const { sourceType, sourceId, folderPath } = (() => {
    for (const season of show.seasons.values()) {
      if (season.episodes.length > 0) {
        const ep = season.episodes[0]
        // Extract folder path from file path (remove filename)
        const filePath = ep.file_path
        const folder = filePath ? filePath.replace(/[/\\][^/\\]+$/, '') : undefined
        return {
          sourceType: ep.source_type,
          sourceId: ep.source_id,
          folderPath: folder
        }
      }
    }
    return { sourceType: undefined, sourceId: undefined, folderPath: undefined }
  })()

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeSeries) {
      setIsAnalyzing(true)
      await onAnalyzeSeries()
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && sourceId) {
      onFixMatch(sourceId, folderPath)
    }
  }

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-none ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster Thumbnail */}
      <div className="w-16 h-24 bg-muted rounded-md overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {show.poster_url ? (
          <img
            src={show.poster_url}
            alt={show.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><TvPlaceholder className="w-8 h-8 text-muted-foreground" /></div>
        )}
        {/* 3-dot menu button */}
        <div className="absolute top-1 left-1 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isAnalyzing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <MoreVertical className="w-3 h-3" />
            )}
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute top-7 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
              <button
                onClick={handleAnalyze}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Analyze Series
              </button>
              {onFixMatch && (
                <button
                  onClick={handleFixMatch}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Fix Match
                </button>
              )}
            </div>
          )}
        </div>
        {/* Source badge */}
        {showSourceBadge && sourceType && (
          <div
            className={`absolute bottom-0 left-0 right-0 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-xs font-bold text-center py-0.5`}
          >
            {sourceType.toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{show.title}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'} • {totalEpisodes} Episodes
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {completenessData && (
            <span className="text-xs text-muted-foreground">
              {completenessData.owned_episodes}/{completenessData.total_episodes} episodes
            </span>
          )}
          {completenessData?.status && (
            <span className="px-2 py-0.5 text-xs font-medium bg-muted rounded">
              {getStatusBadge(completenessData.status)?.text || completenessData.status}
            </span>
          )}
        </div>
      </div>

      {/* Completion Badge */}
      {completenessData && (
        <div
          className="flex-shrink-0 flex items-center"
          title={`${completenessData.owned_episodes} of ${completenessData.total_episodes} episodes`}
        >
          {completenessData.completeness_percentage === 100 ? (
            <div className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              100%
            </div>
          ) : (
            <div className="bg-foreground text-background text-xs font-bold px-2 py-1 rounded shadow-md border border-border">
              {Math.round(completenessData.completeness_percentage)}%
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// Episode row component with keyboard navigation
const EpisodeRow = memo(({ episode, onClick, onRescan, focusIndex }: {
  episode: MediaItem
  onClick: () => void
  onRescan?: (episode: MediaItem) => Promise<void>
  focusIndex?: number
}) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-episode-${episode.id}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan) {
      setIsRescanning(true)
      try {
        await onRescan(episode)
      } finally {
        setIsRescanning(false)
      }
    }
  }

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`group flex gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer outline-none ${isFocused ? 'bg-muted/40 ring-2 ring-primary ring-inset' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Episode Thumbnail - 16:9 aspect ratio with shadow */}
      <div className="w-44 aspect-video bg-muted flex-shrink-0 relative overflow-hidden rounded-md shadow-md shadow-black/20">
        {episode.episode_thumb_url ? (
          <img
            src={episode.episode_thumb_url}
            alt={episode.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><EpisodePlaceholder className="w-10 h-10 text-muted-foreground" /></div>
        )}

        {/* 3-dot menu button */}
        {onRescan && episode.file_path && (
          <div ref={menuRef} className="absolute top-1 left-1 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className={`w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity ${isRescanning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              {isRescanning ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <MoreVertical className="w-3 h-3" />
              )}
            </button>

            {showMenu && !isRescanning && (
              <div className="absolute top-7 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={handleRescan}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Rescan File
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground flex-shrink-0">
            E{episode.episode_number}
          </span>
          <h4 className="font-semibold truncate">{episode.title}</h4>
        </div>
        <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
          <span>{episode.resolution}</span>
          <span>{(episode.video_bitrate / 1000).toFixed(1)} Mbps</span>
          <span>{episode.audio_channels}.0 Audio</span>
        </div>

        {/* Quality badges - white bg with black text */}
        <div className="mt-2 flex flex-wrap gap-1">
          <QualityBadges item={episode} whiteBg />
        </div>
      </div>

      {/* Upgrade indicator */}
      {(episode.tier_quality === 'LOW' || !!episode.needs_upgrade) && (
        <div
          className="flex-shrink-0 flex items-center"
          title="Quality upgrade recommended"
        >
          <CircleFadingArrowUp className="w-6 h-6 text-red-500" />
        </div>
      )}
    </div>
  )
})

function TVShowsView({
  shows,
  selectedShow,
  selectedSeason,
  onSelectShow,
  onSelectSeason,
  onSelectEpisode,
  filterItem,
  gridScale,
  viewType,
  seriesCompleteness,
  onMissingItemClick,
  showSourceBadge,
  onAnalyzeSeries,
  onFixMatch,
  onRescanEpisode
}: {
  shows: [string, TVShow][]
  selectedShow: string | null
  selectedSeason: number | null
  onSelectShow: (show: string | null) => void
  onSelectSeason: (season: number | null) => void
  onSelectEpisode: (id: number) => void
  filterItem: (item: MediaItem) => boolean
  gridScale: number
  viewType: 'grid' | 'list'
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onMissingItemClick: (item: {
    type: 'episode' | 'season' | 'movie'
    title: string
    year?: number
    airDate?: string
    seasonNumber?: number
    episodeNumber?: number
    posterUrl?: string
    tmdbId?: string
    imdbId?: string
    seriesTitle?: string
  } | null) => void
  showSourceBadge: boolean
  onAnalyzeSeries: (seriesTitle: string) => void
  onFixMatch?: (title: string, sourceId: string, folderPath?: string) => void
  onRescanEpisode?: (episode: MediaItem) => Promise<void>
}) {
  // Breadcrumb navigation
  const handleBack = () => {
    if (selectedSeason !== null) {
      onSelectSeason(null)
    } else if (selectedShow !== null) {
      onSelectShow(null)
    }
  }

  const currentShow = selectedShow ? shows.find(([title]) => title === selectedShow)?.[1] : null

  // Map scale to minimum poster width (same as movies)
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120,  // Smallest posters
      2: 140,
      3: 160,
      4: 180,
      5: 200,  // Default
      6: 240,
      7: 300   // Largest posters
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Show list view (top level - all shows)
  if (!selectedShow) {
    if (shows.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <TvPlaceholder className="w-20 h-20 text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-lg">No TV shows found</p>
          <p className="text-sm text-muted-foreground mt-2">
            Scan a TV library from the sidebar to get started
          </p>
        </div>
      )
    }

    // List view
    if (viewType === 'list') {
      return (
        <div className="space-y-2">
          {shows.map(([title, show], index) => {
            const completeness = seriesCompleteness.get(title)
            return <ShowListItem key={title} show={show} onClick={() => onSelectShow(title)} completenessData={completeness} showSourceBadge={showSourceBadge} onAnalyzeSeries={async () => { await onAnalyzeSeries(title) }} onFixMatch={onFixMatch ? (sourceId, folderPath) => onFixMatch(title, sourceId, folderPath) : undefined} focusIndex={index} />
          })}
        </div>
      )
    }

    // Grid view (default)
    return (
      <div
        className="grid gap-8"
        style={{
          gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)`
        }}
      >
        {shows.map(([title, show], index) => {
          const completeness = seriesCompleteness.get(title)
          return <ShowCard key={title} show={show} onClick={() => onSelectShow(title)} completenessData={completeness} showSourceBadge={showSourceBadge} onAnalyzeSeries={() => onAnalyzeSeries(title)} onFixMatch={onFixMatch ? (sourceId, folderPath) => onFixMatch(title, sourceId, folderPath) : undefined} focusIndex={index} />
        })}
      </div>
    )
  }

  // Season list view
  if (selectedShow && selectedSeason === null && currentShow) {
    const ownedSeasons = Array.from(currentShow.seasons.values()).sort((a, b) => a.seasonNumber - b.seasonNumber)
    const completenessData = seriesCompleteness.get(selectedShow)

    // Parse missing seasons from completeness data
    let missingSeasonNumbers: number[] = []
    if (completenessData?.missing_seasons) {
      try {
        missingSeasonNumbers = JSON.parse(completenessData.missing_seasons) || []
      } catch {
        missingSeasonNumbers = []
      }
    }

    // Build combined list of owned and missing seasons
    const ownedSeasonNumbers = new Set(ownedSeasons.map(s => s.seasonNumber))
    const allSeasonItems: Array<{ type: 'owned' | 'missing'; seasonNumber: number; season?: TVSeason }> = [
      ...ownedSeasons.map(s => ({ type: 'owned' as const, seasonNumber: s.seasonNumber, season: s })),
      ...missingSeasonNumbers
        .filter(num => !ownedSeasonNumbers.has(num))
        .map(num => ({ type: 'missing' as const, seasonNumber: num }))
    ].sort((a, b) => a.seasonNumber - b.seasonNumber)

    const totalSeasons = completenessData?.total_seasons || ownedSeasons.length

    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to TV Shows
        </button>

        <div className="flex items-start gap-4 mb-6">
          {currentShow.poster_url && (
            <div className="w-32 aspect-[2/3] bg-muted rounded-lg overflow-hidden flex-shrink-0 shadow-lg shadow-black/30">
              <img
                src={currentShow.poster_url}
                alt={currentShow.title}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
          )}
          <div>
            <h3 className="text-2xl font-bold mb-1">{currentShow.title}</h3>
            {completenessData?.status && (
              <div className="mb-2">
                <span className="inline-block px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
                  {getStatusBadge(completenessData.status)?.text || completenessData.status}
                </span>
              </div>
            )}
            <p className="text-muted-foreground">
              {ownedSeasons.length} of {totalSeasons} Seasons
              {missingSeasonNumbers.length > 0 && (
                <span className="text-orange-500 ml-2">({missingSeasonNumbers.length} missing)</span>
              )}
            </p>
            <button
              onClick={() => onAnalyzeSeries(selectedShow)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors mt-3"
            >
              <RefreshCw className="w-4 h-4" />
              Analyze Series
            </button>
          </div>
        </div>

        <div
          className="grid gap-8"
          style={{
            gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)`
          }}
        >
          {allSeasonItems.map((item, index) => (
            item.type === 'owned' && item.season ? (
              <SeasonCard
                key={item.seasonNumber}
                season={item.season as SeasonInfo}
                showTitle={currentShow.title}
                onClick={() => onSelectSeason(item.seasonNumber)}
                focusIndex={index}
              />
            ) : (
              <MissingSeasonCardWithArtwork
                key={`missing-${item.seasonNumber}`}
                seasonNumber={item.seasonNumber}
                showTitle={currentShow.title}
                tmdbId={completenessData?.tmdb_id}
                fallbackPosterUrl={completenessData?.poster_url || currentShow.poster_url}
                onClick={() => onMissingItemClick({
                  type: 'season',
                  title: formatSeasonLabel(item.seasonNumber),
                  seasonNumber: item.seasonNumber,
                  posterUrl: completenessData?.poster_url || currentShow.poster_url,
                  tmdbId: completenessData?.tmdb_id,
                  seriesTitle: currentShow.title
                })}
                focusIndex={index}
              />
            )
          ))}
        </div>
      </div>
    )
  }

  // Episode list view
  if (selectedShow && selectedSeason !== null && currentShow) {
    const season = currentShow.seasons.get(selectedSeason)
    const completenessData = seriesCompleteness.get(selectedShow)

    // Get owned episodes for this season
    const ownedEpisodes = season ? season.episodes.filter(filterItem) : []
    const ownedEpisodeNumbers = new Set(ownedEpisodes.map(e => e.episode_number))

    // Parse missing episodes from completeness data, filter by current season
    let missingEpisodesForSeason: MissingEpisode[] = []
    if (completenessData?.missing_episodes) {
      try {
        const allMissing: MissingEpisode[] = JSON.parse(completenessData.missing_episodes) || []
        missingEpisodesForSeason = allMissing.filter(
          ep => ep.season_number === selectedSeason && !ownedEpisodeNumbers.has(ep.episode_number)
        )
      } catch {
        missingEpisodesForSeason = []
      }
    }

    // Get fallback poster for missing episodes (season poster > series poster)
    const missingEpisodePoster = season?.posterUrl || completenessData?.poster_url || currentShow.poster_url

    // Build combined list sorted by episode number
    type EpisodeItem = { type: 'owned'; episode: MediaItem } | { type: 'missing'; missing: MissingEpisode }
    const allEpisodeItems: EpisodeItem[] = [
      ...ownedEpisodes.map(e => ({ type: 'owned' as const, episode: e })),
      ...missingEpisodesForSeason.map(m => ({ type: 'missing' as const, missing: m }))
    ].sort((a, b) => {
      const aNum = a.type === 'owned' ? (a.episode.episode_number || 0) : a.missing.episode_number
      const bNum = b.type === 'owned' ? (b.episode.episode_number || 0) : b.missing.episode_number
      return aNum - bNum
    })

    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to {currentShow.title}
        </button>

        <div className="flex items-center gap-4">
          <h3 className="text-xl font-bold">
            {currentShow.title} - {formatSeasonLabel(selectedSeason!)}
          </h3>
          {missingEpisodesForSeason.length > 0 && (
            <span className="text-sm text-orange-500">
              ({missingEpisodesForSeason.length} missing)
            </span>
          )}
        </div>

        <div className="divide-y divide-border/50">
          {allEpisodeItems.map((item, index) => (
            item.type === 'owned' ? (
              <EpisodeRow
                key={item.episode.id}
                episode={item.episode}
                onClick={() => onSelectEpisode(item.episode.id)}
                onRescan={onRescanEpisode}
                focusIndex={index}
              />
            ) : (
              <MissingEpisodeRowWithArtwork
                key={`missing-${item.missing.season_number}-${item.missing.episode_number}`}
                episode={item.missing}
                tmdbId={completenessData?.tmdb_id}
                fallbackPosterUrl={missingEpisodePoster}
                onClick={() => onMissingItemClick({
                  type: 'episode',
                  title: item.missing.title || `Episode ${item.missing.episode_number}`,
                  airDate: item.missing.air_date,
                  seasonNumber: item.missing.season_number,
                  episodeNumber: item.missing.episode_number,
                  posterUrl: missingEpisodePoster,
                  tmdbId: completenessData?.tmdb_id,
                  seriesTitle: currentShow.title
                })}
                focusIndex={index}
              />
            )
          ))}
        </div>
      </div>
    )
  }

  return null
}

const ShowCard = memo(({ show, onClick, completenessData, showSourceBadge, onAnalyzeSeries, onFixMatch, focusIndex }: { show: TVShow; onClick: () => void; completenessData?: SeriesCompletenessData; showSourceBadge?: boolean; onAnalyzeSeries?: () => void; onFixMatch?: (sourceId: string, folderPath?: string) => void; focusIndex?: number }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-show-${show.title}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  const totalEpisodes = Array.from(show.seasons.values()).reduce(
    (sum, season) => sum + season.episodes.length,
    0
  )

  // Get source type, source ID, and folder path from the first episode
  const { sourceType, sourceId, folderPath } = useMemo(() => {
    for (const season of show.seasons.values()) {
      if (season.episodes.length > 0) {
        const ep = season.episodes[0]
        // Extract folder path from file path (remove filename)
        const filePath = ep.file_path
        const folder = filePath ? filePath.replace(/[/\\][^/\\]+$/, '') : undefined
        return {
          sourceType: ep.source_type,
          sourceId: ep.source_id,
          folderPath: folder
        }
      }
    }
    return { sourceType: undefined, sourceId: undefined, folderPath: undefined }
  }, [show.seasons])

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeSeries) {
      setIsAnalyzing(true)
      await onAnalyzeSeries()
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && sourceId) {
      onFixMatch(sourceId, folderPath)
    }
  }

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`focus-poster-only cursor-pointer hover-scale relative group outline-none ${isFocused ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className={`aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
        {/* 3-dot menu button */}
        <div ref={menuRef} className="absolute top-2 left-2 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isAnalyzing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <MoreVertical className="w-4 h-4" />
            )}
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
              <button
                onClick={handleAnalyze}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Analyze Series
              </button>
              {onFixMatch && (
                <button
                  onClick={handleFixMatch}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Fix Match
                </button>
              )}
            </div>
          )}
        </div>

        {/* Source Badge */}
        {showSourceBadge && sourceType && (
          <div
            className={`absolute bottom-2 left-2 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
            title={sourceType.charAt(0).toUpperCase() + sourceType.slice(1)}
          >
            {sourceType.charAt(0).toUpperCase()}
          </div>
        )}

        {show.poster_url ? (
          <img
            src={show.poster_url}
            alt={show.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><TvPlaceholder className="w-20 h-20 text-muted-foreground" /></div>
        )}
      </div>

      {/* Title and info below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{show.title}</h4>
          <p className="text-xs text-muted-foreground">
            {show.seasons.size} {show.seasons.size === 1 ? 'Season' : 'Seasons'} • {totalEpisodes} Episodes
          </p>
        </div>
        {completenessData && (
          <div
            className="flex-shrink-0"
            title={`${completenessData.owned_episodes} of ${completenessData.total_episodes} episodes`}
          >
            {completenessData.completeness_percentage === 100 ? (
              <div className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                100%
              </div>
            ) : (
              <div className="bg-foreground text-background text-xs font-bold px-2 py-1 rounded shadow-md border border-border">
                {Math.round(completenessData.completeness_percentage)}%
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.show.title === nextProps.show.title &&
         prevProps.show.poster_url === nextProps.show.poster_url &&
         prevProps.show.seasons === nextProps.show.seasons &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.completenessData?.id === nextProps.completenessData?.id &&
         prevProps.completenessData?.completeness_percentage === nextProps.completenessData?.completeness_percentage &&
         prevProps.onAnalyzeSeries === nextProps.onAnalyzeSeries &&
         prevProps.focusIndex === nextProps.focusIndex
})

// Component to fetch and display missing season with actual TMDB artwork
const MissingSeasonCardWithArtwork = memo(({
  seasonNumber,
  showTitle,
  tmdbId,
  fallbackPosterUrl,
  onClick,
  focusIndex
}: {
  seasonNumber: number
  showTitle: string
  tmdbId?: string
  fallbackPosterUrl?: string
  onClick: () => void
  focusIndex?: number
}) => {
  const [posterUrl, setPosterUrl] = useState<string | undefined>(fallbackPosterUrl)

  useEffect(() => {
    if (tmdbId) {
      window.electronAPI.seriesGetSeasonPoster(tmdbId, seasonNumber)
        .then((url) => {
          if (url) setPosterUrl(url)
        })
        .catch((err) => {
          console.warn(`Failed to fetch ${formatSeasonLabel(seasonNumber)} poster:`, err)
        })
    }
  }, [tmdbId, seasonNumber])

  return (
    <MissingItemCard
      type="season"
      title={formatSeasonLabel(seasonNumber)}
      subtitle={showTitle}
      posterUrl={posterUrl}
      onClick={onClick}
      focusIndex={focusIndex}
      tmdbId={tmdbId}
      seriesTitle={showTitle}
      seasonNumber={seasonNumber}
    />
  )
})

// Component to fetch and display missing episode with actual TMDB artwork
const MissingEpisodeRowWithArtwork = memo(({
  episode,
  tmdbId,
  fallbackPosterUrl,
  onClick,
  focusIndex
}: {
  episode: MissingEpisode
  tmdbId?: string
  fallbackPosterUrl?: string
  onClick: () => void
  focusIndex?: number
}) => {
  const [stillUrl, setStillUrl] = useState<string | undefined>(fallbackPosterUrl)
  const cardRef = useRef<HTMLDivElement>(null)
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-missing-episode-${episode.season_number}-${episode.episode_number}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  useEffect(() => {
    if (tmdbId) {
      window.electronAPI.seriesGetEpisodeStill(tmdbId, episode.season_number, episode.episode_number)
        .then((url) => {
          if (url) setStillUrl(url)
        })
        .catch((err) => {
          console.warn(`Failed to fetch episode still for S${episode.season_number}E${episode.episode_number}:`, err)
        })
    }
  }, [tmdbId, episode.season_number, episode.episode_number])

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`flex gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer outline-none ${isFocused ? 'bg-muted/40 ring-2 ring-primary ring-inset' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Missing Episode Thumbnail - 16:9 aspect ratio with shadow */}
      <div className="w-44 aspect-video bg-muted flex-shrink-0 relative overflow-hidden rounded-md shadow-md shadow-black/20">
        {stillUrl ? (
          <img
            src={stillUrl}
            alt={episode.title || `Episode ${episode.episode_number}`}
            loading="lazy"
            className="w-full h-full object-cover grayscale opacity-50"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50">
            <EpisodePlaceholder className="w-10 h-10 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground flex-shrink-0">
            E{episode.episode_number}
          </span>
          <h4 className="font-semibold truncate text-muted-foreground">
            {episode.title || 'Unknown Title'}
          </h4>
        </div>
        {episode.air_date && (
          <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
            <span>Aired: {new Date(episode.air_date).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Missing indicator */}
      <div
        className="flex-shrink-0 flex items-center"
        title="Missing episode"
      >
        <span className="text-orange-500 text-xs font-bold uppercase">Missing</span>
      </div>
    </div>
  )
})

const SeasonCard = memo(({ season, showTitle, onClick, focusIndex }: { season: SeasonInfo; showTitle: string; onClick: () => void; focusIndex?: number }) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = `content-season-${season.seasonNumber}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`focus-poster-only group cursor-pointer hover-scale outline-none ${isFocused ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className={`aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
        {season.posterUrl ? (
          <img
            src={season.posterUrl}
            alt={`${showTitle} - ${formatSeasonLabel(season.seasonNumber)}`}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><Folder className="w-16 h-16 text-white/30" strokeWidth={1.5} /></div>
        )}
      </div>

      {/* Title below poster */}
      <div className="pt-2">
        <h4 className="font-medium text-sm truncate">{formatSeasonLabel(season.seasonNumber)}</h4>
        <p className="text-xs text-muted-foreground">
          {season.episodes.length} {season.episodes.length === 1 ? 'Episode' : 'Episodes'}
        </p>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.season.seasonNumber === nextProps.season.seasonNumber &&
         prevProps.showTitle === nextProps.showTitle &&
         prevProps.season.posterUrl === nextProps.season.posterUrl &&
         prevProps.season.episodes === nextProps.season.episodes &&
         prevProps.focusIndex === nextProps.focusIndex
})

// ============================================================================
// MUSIC VIEW COMPONENTS
// ============================================================================

function MusicView({
  artists,
  albums,
  tracks,
  allTracks,
  stats,
  selectedArtist,
  selectedAlbum,
  artistCompleteness,
  albumCompleteness,
  allAlbumCompleteness,
  musicViewMode,
  onSelectArtist,
  onSelectAlbum,
  onBack,
  gridScale,
  viewType,
  searchQuery,
  alphabetFilter,
  qualityFilter,
  showSourceBadge,
  onAnalyzeAlbum,
  onAnalyzeArtist,
  onArtistCompletenessUpdated,
  onFixArtistMatch,
  onFixAlbumMatch,
  onRescanTrack
}: {
  artists: MusicArtist[]
  albums: MusicAlbum[]
  tracks: MusicTrack[]
  allTracks: MusicTrack[]
  stats: MusicStats | null
  selectedArtist: MusicArtist | null
  selectedAlbum: MusicAlbum | null
  artistCompleteness: Map<string, ArtistCompletenessData>
  albumCompleteness: AlbumCompletenessData | null
  allAlbumCompleteness: Map<number, AlbumCompletenessData>
  musicViewMode: 'artists' | 'albums' | 'tracks'
  onSelectArtist: (artist: MusicArtist) => void
  onSelectAlbum: (album: MusicAlbum) => void
  onBack: () => void
  gridScale: number
  viewType: 'grid' | 'list'
  searchQuery: string
  alphabetFilter: string | null
  qualityFilter: 'all' | 'low' | 'medium' | 'high'
  showSourceBadge: boolean
  onAnalyzeAlbum: (albumId: number) => Promise<void>
  onAnalyzeArtist: (artistId: number) => Promise<void>
  onArtistCompletenessUpdated: () => void
  onFixArtistMatch?: (artistId: number, artistName: string) => void
  onFixAlbumMatch?: (albumId: number, albumTitle: string, artistName: string) => void
  onRescanTrack?: (track: MusicTrack) => Promise<void>
}) {
  const [isAnalyzingAlbum, setIsAnalyzingAlbum] = useState(false)
  const [isAnalyzingArtist, setIsAnalyzingArtist] = useState(false)
  const [trackMenuOpen, setTrackMenuOpen] = useState<string | number | null>(null)
  const [rescanningTrackId, setRescanningTrackId] = useState<string | number | null>(null)
  const trackMenuRef = useRef<HTMLDivElement>(null)

  // Click-outside handler for track menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (trackMenuRef.current && !trackMenuRef.current.contains(event.target as Node)) {
        setTrackMenuOpen(null)
      }
    }
    if (trackMenuOpen !== null) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [trackMenuOpen])

  // Escape key handler for track menu
  useEffect(() => {
    if (trackMenuOpen === null) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTrackMenuOpen(null)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [trackMenuOpen])

  // Handle track rescan
  const handleTrackRescan = async (trackId: string | number, originalTrack: MusicTrack | undefined) => {
    if (!originalTrack || !onRescanTrack) return
    setTrackMenuOpen(null)
    setRescanningTrackId(trackId)
    try {
      await onRescanTrack(originalTrack)
    } finally {
      setRescanningTrackId(null)
    }
  }
  const [selectedTrackForQuality, setSelectedTrackForQuality] = useState<{
    title: string
    codec?: string
    bitrate?: number
    sample_rate?: number
    bit_depth?: number
    is_lossless?: boolean
    qualityTier: string | null
    artist_name?: string
    album_title?: string
  } | null>(null)

  // Track list column state
  const [trackColumnWidths, setTrackColumnWidths] = useState({
    title: 200,
    artist: 160,
    album: 180,
    quality: 60,
    codec: 70,
    duration: 60
  })
  const [trackSortColumn, setTrackSortColumn] = useState<'title' | 'artist' | 'album' | 'codec' | 'duration'>('title')
  const [trackSortDirection, setTrackSortDirection] = useState<'asc' | 'desc'>('asc')

  // Album sort state
  const [albumSortColumn, setAlbumSortColumn] = useState<'title' | 'artist'>('title')
  const [albumSortDirection, setAlbumSortDirection] = useState<'asc' | 'desc'>('asc')
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  // Column resize handlers - use refs to avoid re-renders during drag
  const pendingWidthRef = useRef<number>(0)
  const rafIdRef = useRef<number | null>(null)

  const handleResizeStart = (column: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingColumn(column)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = trackColumnWidths[column as keyof typeof trackColumnWidths]
    pendingWidthRef.current = resizeStartWidth.current
  }

  useEffect(() => {
    if (!resizingColumn) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current
      pendingWidthRef.current = Math.max(50, resizeStartWidth.current + delta)

      // Use RAF to batch updates and update only the header visually during drag
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(() => {
        const header = document.querySelector(`[data-resize-column="${resizingColumn}"]`) as HTMLElement
        if (header) header.style.width = `${pendingWidthRef.current}px`
      })
    }

    const handleMouseUp = () => {
      // Only update state once on mouse up
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      setTrackColumnWidths(prev => ({ ...prev, [resizingColumn]: pendingWidthRef.current }))
      setResizingColumn(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [resizingColumn])

  // Column sort handler for tracks
  const handleTrackSort = (column: 'title' | 'artist' | 'album' | 'codec' | 'duration') => {
    if (trackSortColumn === column) {
      setTrackSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setTrackSortColumn(column)
      setTrackSortDirection('asc')
    }
  }

  // Column sort handler for albums
  const handleAlbumSort = (column: 'title' | 'artist') => {
    if (albumSortColumn === column) {
      setAlbumSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setAlbumSortColumn(column)
      setAlbumSortDirection('asc')
    }
  }

  // Wrapper to handle analyze with loading state
  const handleAnalyzeAlbum = async (albumId: number) => {
    setIsAnalyzingAlbum(true)
    try {
      await onAnalyzeAlbum(albumId)
    } finally {
      setIsAnalyzingAlbum(false)
    }
  }

  // Wrapper to handle artist analysis with loading state
  const handleAnalyzeArtist = async (artistId: number) => {
    setIsAnalyzingArtist(true)
    try {
      await onAnalyzeArtist(artistId)
      onArtistCompletenessUpdated()
    } finally {
      setIsAnalyzingArtist(false)
    }
  }

  // Map scale to minimum poster width
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120, 2: 140, 3: 160, 4: 180, 5: 200, 6: 240, 7: 300
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Create lookup maps for artist and album names
  const artistNameMap = useMemo(() => {
    const map = new Map<number, string>()
    artists.forEach(a => map.set(a.id, a.name))
    return map
  }, [artists])

  const albumInfoMap = useMemo(() => {
    const map = new Map<number, { title: string; artistName?: string }>()
    albums.forEach(a => map.set(a.id, { title: a.title, artistName: a.artist_name }))
    return map
  }, [albums])

  // Filter artists by search and alphabet
  const filteredArtists = useMemo(() => {
    return artists.filter(artist => {
      // Alphabet filter
      if (alphabetFilter) {
        const firstChar = artist.name.charAt(0).toUpperCase()
        if (alphabetFilter === '#') {
          if (/[A-Z]/.test(firstChar)) return false
        } else {
          if (firstChar !== alphabetFilter) return false
        }
      }
      // Search filter
      if (searchQuery.trim()) {
        return artist.name.toLowerCase().includes(searchQuery.toLowerCase())
      }
      return true
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [artists, searchQuery, alphabetFilter])

  // Filter albums for selected artist or all albums
  const filteredAlbums = useMemo(() => {
    let filtered = selectedArtist
      ? albums.filter(a => a.artist_id === selectedArtist.id)
      : albums

    // Apply search filter when not viewing a specific artist
    if (!selectedArtist && searchQuery.trim()) {
      filtered = filtered.filter(album =>
        album.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        album.artist_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Apply alphabet filter when not viewing a specific artist
    if (!selectedArtist && alphabetFilter) {
      filtered = filtered.filter(album => {
        const firstChar = album.title.charAt(0).toUpperCase()
        if (alphabetFilter === '#') {
          return !/[A-Z]/.test(firstChar)
        }
        return firstChar === alphabetFilter
      })
    }

    return filtered.sort((a, b) => (a.year || 0) - (b.year || 0))
  }, [albums, selectedArtist, searchQuery, alphabetFilter])

  // Filter all albums for albums view mode (must be before early returns)
  const allFilteredAlbums = useMemo(() => {
    let filtered = albums

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(album =>
        album.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        album.artist_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Apply alphabet filter
    if (alphabetFilter) {
      filtered = filtered.filter(album => {
        const firstChar = album.title.charAt(0).toUpperCase()
        if (alphabetFilter === '#') {
          return !/[A-Z]/.test(firstChar)
        }
        return firstChar === alphabetFilter
      })
    }

    // Sort based on selected column
    return filtered.sort((a, b) => {
      let comparison = 0
      switch (albumSortColumn) {
        case 'title':
          comparison = a.title.localeCompare(b.title)
          break
        case 'artist':
          comparison = (a.artist_name || '').localeCompare(b.artist_name || '')
          break
      }
      return albumSortDirection === 'asc' ? comparison : -comparison
    })
  }, [albums, searchQuery, alphabetFilter, albumSortColumn, albumSortDirection])

  // Filter all tracks for tracks view mode (must be before early returns)
  const filteredTracks = useMemo(() => {
    // Quality tier calculation helper
    const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']

    const isLosslessCodec = (codec?: string): boolean => {
      if (!codec) return false
      const codecLower = codec.toLowerCase()
      return LOSSLESS_CODECS.some(c => codecLower.includes(c))
    }

    const isAACCodec = (codec?: string): boolean => {
      if (!codec) return false
      return codec.toLowerCase().includes('aac')
    }

    const getTrackQualityTier = (track: MusicTrack): 'ultra' | 'high' | 'medium' | 'low' | null => {
      const bitrateKbps = track.audio_bitrate || 0
      const sampleRate = track.sample_rate || 0
      const bitDepth = track.bit_depth || 16
      const isLossless = track.is_lossless || isLosslessCodec(track.audio_codec)

      if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) return 'ultra'
      if (isLossless) return 'high'
      if (isAACCodec(track.audio_codec)) {
        if (bitrateKbps >= 128) return 'medium'
      } else {
        if (bitrateKbps >= 160) return 'medium'
      }
      if (bitrateKbps > 0) return 'low'
      if (track.audio_codec) {
        const codecLower = track.audio_codec.toLowerCase()
        if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) {
          return 'medium'
        }
      }
      return null
    }

    let filtered = allTracks

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(track =>
        track.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Apply alphabet filter
    if (alphabetFilter) {
      filtered = filtered.filter(track => {
        const firstChar = track.title.charAt(0).toUpperCase()
        if (alphabetFilter === '#') {
          return !/[A-Z]/.test(firstChar)
        }
        return firstChar === alphabetFilter
      })
    }

    // Apply quality filter
    if (qualityFilter !== 'all') {
      filtered = filtered.filter(track => {
        const tier = getTrackQualityTier(track)
        if (qualityFilter === 'high') {
          // High includes ultra and high
          return tier === 'ultra' || tier === 'high'
        } else if (qualityFilter === 'medium') {
          return tier === 'medium'
        } else if (qualityFilter === 'low') {
          return tier === 'low'
        }
        return true
      })
    }

    // Sort based on selected column
    return filtered.sort((a, b) => {
      let comparison = 0
      switch (trackSortColumn) {
        case 'title':
          comparison = a.title.localeCompare(b.title)
          break
        case 'artist': {
          const artistA = a.artist_id ? (artistNameMap.get(a.artist_id) || '') : (a.album_id ? (albumInfoMap.get(a.album_id)?.artistName || '') : '')
          const artistB = b.artist_id ? (artistNameMap.get(b.artist_id) || '') : (b.album_id ? (albumInfoMap.get(b.album_id)?.artistName || '') : '')
          comparison = artistA.localeCompare(artistB)
          break
        }
        case 'album': {
          const albumA = a.album_id ? (albumInfoMap.get(a.album_id)?.title || '') : ''
          const albumB = b.album_id ? (albumInfoMap.get(b.album_id)?.title || '') : ''
          comparison = albumA.localeCompare(albumB)
          break
        }
        case 'codec':
          comparison = (a.audio_codec || '').localeCompare(b.audio_codec || '')
          break
        case 'duration':
          comparison = (a.duration || 0) - (b.duration || 0)
          break
      }
      return trackSortDirection === 'asc' ? comparison : -comparison
    })
  }, [allTracks, searchQuery, alphabetFilter, qualityFilter, trackSortColumn, trackSortDirection, artistNameMap, albumInfoMap])

  // Album detail view
  if (selectedAlbum) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to {selectedArtist ? selectedArtist.name : 'Albums'}
        </button>

        {/* Album Header */}
        <div className="flex items-start gap-6">
          <div className="w-48 aspect-square bg-muted rounded-lg overflow-hidden flex-shrink-0 shadow-lg">
            {selectedAlbum.thumb_url ? (
              <img
                src={selectedAlbum.thumb_url}
                alt={selectedAlbum.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Disc3 className="w-16 h-16 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{selectedAlbum.title}</h2>
            <p className="text-lg text-muted-foreground">{selectedAlbum.artist_name}</p>
            {selectedAlbum.year && (
              <p className="text-sm text-muted-foreground mt-1">{selectedAlbum.year}</p>
            )}
            {(() => {
              const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
              const codec = (selectedAlbum.best_audio_codec || '').toLowerCase()
              const isLossless = losslessCodecs.some(c => codec.includes(c))
              const isHiRes = isLossless && ((selectedAlbum.best_bit_depth || 0) > 16 || (selectedAlbum.best_sample_rate || 0) > 48000)
              return (
                <div className="flex flex-wrap gap-2 mt-3">
                  {isHiRes && (
                    <span className="px-2 py-1 text-xs font-bold bg-purple-600 text-white rounded">Hi-Res</span>
                  )}
                  {isLossless && !isHiRes && (
                    <span className="px-2 py-1 text-xs font-bold bg-green-600 text-white rounded">Lossless</span>
                  )}
                  {(selectedAlbum.best_bit_depth ?? 0) > 16 && (
                    <span className="px-2 py-1 text-xs font-bold bg-orange-600 text-white rounded">
                      {selectedAlbum.best_bit_depth}-bit
                    </span>
                  )}
                  {selectedAlbum.album_type && selectedAlbum.album_type !== 'album' && (
                    <span className="px-2 py-1 text-xs font-bold bg-gray-600 text-white rounded capitalize">
                      {selectedAlbum.album_type}
                    </span>
                  )}
                </div>
              )
            })()}
            <p className="text-sm text-muted-foreground mt-3">
              {selectedAlbum.track_count}{albumCompleteness ? ` of ${albumCompleteness.total_tracks}` : ''} tracks
              {selectedAlbum.duration_ms && (
                <> • {Math.floor(selectedAlbum.duration_ms / 60000)} min</>
              )}
            </p>
            {/* Analyze button */}
            <button
              onClick={() => selectedAlbum.id && handleAnalyzeAlbum(selectedAlbum.id)}
              disabled={isAnalyzingAlbum}
              className="mt-3 flex items-center gap-2 px-3 py-1.5 text-sm bg-foreground text-background hover:bg-foreground/80 rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isAnalyzingAlbum ? 'animate-spin' : ''}`} />
              {isAnalyzingAlbum ? 'Analyzing...' : 'Analyze for missing tracks'}
            </button>
          </div>
        </div>

        {/* Track List - Combined owned and missing tracks */}
        {(() => {
          // Parse missing tracks from completeness data
          let missingTracks: MissingTrack[] = []
          if (albumCompleteness) {
            try {
              missingTracks = JSON.parse(albumCompleteness.missing_tracks || '[]')
            } catch { /* ignore */ }
          }

          // Create unified track list with type marker
          type UnifiedTrack = {
            id: string | number
            title: string
            track_number?: number
            disc_number?: number
            duration_ms?: number
            codec?: string
            bitrate?: number
            sample_rate?: number
            bit_depth?: number
            is_hi_res?: boolean
            is_lossless?: boolean
            isMissing: boolean
            musicbrainz_id?: string
            // For rescan functionality
            source_id?: string
            library_id?: string
            file_path?: string
            originalTrack?: MusicTrack
          }

          // Quality tier calculation based on audio file specs
          // Tiers: Ultra (Hi-Res) > High (CD Lossless) > Medium (Transparent Lossy) > Low
          type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | null

          // Lossless codecs
          const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']

          const isLosslessCodec = (codec?: string): boolean => {
            if (!codec) return false
            const codecLower = codec.toLowerCase()
            return LOSSLESS_CODECS.some(c => codecLower.includes(c))
          }

          const isAACCodec = (codec?: string): boolean => {
            if (!codec) return false
            return codec.toLowerCase().includes('aac')
          }

          const getQualityTier = (track: UnifiedTrack): QualityTier => {
            if (track.isMissing) return null

            // Plex returns bitrate in kbps already
            const bitrateKbps = track.bitrate || 0
            const sampleRate = track.sample_rate || 0
            const bitDepth = track.bit_depth || 16
            const isLossless = track.is_lossless || isLosslessCodec(track.codec)

            // ULTRA / HI-RES: Lossless with bit depth ≥ 24-bit OR sample rate > 48kHz
            if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) {
              return 'ultra'
            }

            // HIGH (CD-QUALITY LOSSLESS): Lossless at standard resolution (44.1/48kHz, 16-bit)
            if (isLossless) {
              return 'high'
            }

            // MEDIUM: Lossy with bitrate ≥ 160 kbps (MP3) OR AAC ≥ 128 kbps
            if (isAACCodec(track.codec)) {
              // AAC is more efficient - 128+ kbps is considered transparent
              if (bitrateKbps >= 128) return 'medium'
            } else {
              // MP3/other lossy - 160+ kbps for transparent quality
              if (bitrateKbps >= 160) return 'medium'
            }

            // LOW: Lossy with bitrate < 160 kbps (or < 128 for AAC)
            if (bitrateKbps > 0) {
              return 'low'
            }

            // If no bitrate info but we have a codec, try to infer quality
            if (track.codec) {
              // If it's a known lossy codec without bitrate, assume medium quality
              const codecLower = track.codec.toLowerCase()
              if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) {
                return 'medium'
              }
            }

            return null
          }

          const qualityTierConfig: Record<QualityTier & string, { label: string; class: string; title: string }> = {
            'ultra': { label: 'Ultra', class: 'bg-foreground text-background', title: 'Hi-Res lossless: 24-bit or >48kHz sample rate' },
            'high': { label: 'High', class: 'bg-foreground text-background', title: 'CD-quality lossless: FLAC/ALAC/WAV at 16-bit/44.1-48kHz' },
            'medium': { label: 'Medium', class: 'bg-foreground text-background', title: 'Transparent lossy: MP3 ≥160kbps or AAC ≥128kbps' },
            'low': { label: 'Low', class: 'bg-foreground text-background', title: 'Low bitrate lossy: below transparent threshold' },
          }

          const unifiedTracks: UnifiedTrack[] = [
            // Owned tracks
            ...tracks.map(t => ({
              id: t.id,
              title: t.title,
              track_number: t.track_number,
              disc_number: t.disc_number,
              duration_ms: t.duration,
              codec: t.audio_codec,
              bitrate: t.audio_bitrate,
              sample_rate: t.sample_rate,
              bit_depth: t.bit_depth,
              is_hi_res: t.is_hi_res,
              is_lossless: t.is_lossless,
              isMissing: false,
              // For rescan functionality
              source_id: t.source_id,
              library_id: t.library_id,
              file_path: t.file_path,
              originalTrack: t
            })),
            // Missing tracks
            ...missingTracks.map((t, idx) => ({
              id: t.musicbrainz_id || `missing-${idx}`,
              title: t.title,
              track_number: t.track_number,
              disc_number: t.disc_number,
              duration_ms: t.duration_ms,
              codec: undefined,
              bitrate: undefined,
              is_hi_res: undefined,
              is_lossless: undefined,
              isMissing: true,
              musicbrainz_id: t.musicbrainz_id
            }))
          ]

          // Sort by disc number, then track number
          unifiedTracks.sort((a, b) => {
            const discA = a.disc_number || 1
            const discB = b.disc_number || 1
            if (discA !== discB) return discA - discB
            const trackA = a.track_number || 999
            const trackB = b.track_number || 999
            return trackA - trackB
          })

          return (
            <div className="divide-y divide-border/50">
              {unifiedTracks.map((track) => {
                const qualityTier = getQualityTier(track)
                const tierConfig = qualityTier ? qualityTierConfig[qualityTier] : null

                return (
                  <div
                    key={track.id}
                    className={`flex items-center gap-4 py-3 px-2 transition-colors group ${
                      track.isMissing
                        ? 'opacity-40'
                        : 'hover:bg-muted/30 cursor-pointer'
                    }`}
                    onClick={() => {
                      if (!track.isMissing) {
                        setSelectedTrackForQuality({
                          title: track.title,
                          codec: track.codec,
                          bitrate: track.bitrate,
                          sample_rate: track.sample_rate,
                          bit_depth: track.bit_depth,
                          is_lossless: track.is_lossless,
                          qualityTier: qualityTier,
                          artist_name: selectedAlbum.artist_name,
                          album_title: selectedAlbum.title
                        })
                      }
                    }}
                  >
                    <span className={`w-8 text-sm text-right ${
                      track.isMissing ? 'text-muted-foreground/50' : 'text-muted-foreground'
                    }`}>
                      {track.track_number || '-'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-medium truncate ${
                          track.isMissing ? 'text-muted-foreground' : ''
                        }`}>
                          {track.title}
                        </h4>
                      </div>
                      <div className={`flex items-center gap-3 text-xs mt-0.5 ${
                        track.isMissing ? 'text-muted-foreground/50' : 'text-muted-foreground'
                      }`}>
                        {tierConfig && (
                          <span
                            className={`px-1.5 py-0.5 text-xs font-bold rounded ${tierConfig.class}`}
                            title={tierConfig.title}
                          >
                            {tierConfig.label}
                          </span>
                        )}
                        {track.duration_ms && (
                          <span>{Math.floor(track.duration_ms / 60000)}:{String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}</span>
                        )}
                        {!track.isMissing && track.codec && <span className="uppercase">{track.codec}</span>}
                        {!track.isMissing && !!track.bitrate && <span>{Math.round(track.bitrate)} kbps</span>}
                        {!track.isMissing && !!track.sample_rate && <span>{track.sample_rate >= 1000 ? `${(track.sample_rate / 1000).toFixed(1)}kHz` : `${track.sample_rate}Hz`}</span>}
                        {!track.isMissing && !!track.bit_depth && <span>{track.bit_depth}-bit</span>}
                      </div>
                    </div>
                    {/* 3-dot menu for owned tracks with file_path */}
                    {!track.isMissing && track.file_path && onRescanTrack && (
                      <div className="relative flex-shrink-0" ref={trackMenuOpen === track.id ? trackMenuRef : undefined}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setTrackMenuOpen(trackMenuOpen === track.id ? null : track.id)
                          }}
                          className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {rescanningTrackId === track.id ? (
                            <RefreshCw className="w-3.5 h-3.5 text-white animate-spin" />
                          ) : (
                            <MoreVertical className="w-3.5 h-3.5 text-white" />
                          )}
                        </button>
                        {trackMenuOpen === track.id && rescanningTrackId !== track.id && (
                          <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px] z-50">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleTrackRescan(track.id, track.originalTrack)
                              }}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Rescan File
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Add to wishlist button for missing tracks */}
                    {track.isMissing && (
                      <div className="flex-shrink-0">
                        <AddToWishlistButton
                          mediaType="track"
                          title={track.title}
                          musicbrainzId={track.musicbrainz_id}
                          artistName={selectedAlbum.artist_name}
                          albumTitle={selectedAlbum.title}
                          posterUrl={selectedAlbum.thumb_url || undefined}
                          compact
                        />
                      </div>
                    )}
                  </div>
                )
              })}
              {unifiedTracks.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  No tracks found
                </div>
              )}
            </div>
          )
        })()}

        {/* Track Quality Details Modal */}
        {selectedTrackForQuality && (() => {
          const tier = selectedTrackForQuality.qualityTier
          const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Unknown'
          const tierDescription = tier === 'ultra' ? 'Hi-Res Lossless' :
                                  tier === 'high' ? 'CD-Quality Lossless' :
                                  tier === 'medium' ? 'Transparent Lossy' :
                                  tier === 'low' ? 'Low Bitrate Lossy' : 'Unknown'
          const tierColor = tier === 'ultra' ? 'text-purple-500' :
                           tier === 'high' ? 'text-green-500' :
                           tier === 'medium' ? 'text-blue-500' :
                           tier === 'low' ? 'text-red-500' : 'text-muted-foreground'

          // Calculate a score based on the tier (for visual consistency with video modal)
          const tierScore = tier === 'ultra' ? 100 :
                           tier === 'high' ? 85 :
                           tier === 'medium' ? 60 :
                           tier === 'low' ? 30 : 0

          // Check if bitrate is low (for lossy codecs, below 160kbps for MP3 or 128kbps for AAC)
          const isLossyCodec = !selectedTrackForQuality.is_lossless
          const codec = (selectedTrackForQuality.codec || '').toLowerCase()
          const isAAC = codec.includes('aac')
          const bitrateLow = isLossyCodec && selectedTrackForQuality.bitrate &&
            (isAAC ? selectedTrackForQuality.bitrate < 128 : selectedTrackForQuality.bitrate < 160)

          // Get explanation text for low/medium tiers
          const getIssueText = () => {
            if (tier === 'low') {
              return `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps may have audible artifacts. Consider 256+ kbps for transparent quality, or lossless for archival.`
            }
            if (tier === 'medium') {
              return `Good for everyday listening. Lossless (FLAC) available for critical listening or archival.`
            }
            return null
          }
          const issueText = getIssueText()

          return createPortal(
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-6"
              onClick={() => setSelectedTrackForQuality(null)}
            >
              <div
                className="bg-card rounded-xl w-full max-w-lg overflow-hidden shadow-2xl border border-border"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-4 border-b border-border/30 bg-black/30 rounded-t-xl">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold truncate">{selectedTrackForQuality.title}</h2>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedTrackForQuality.artist_name && selectedTrackForQuality.album_title
                        ? `${selectedTrackForQuality.artist_name} · ${selectedTrackForQuality.album_title}`
                        : 'Track Quality Analysis'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Add to Wishlist Button for low quality tracks */}
                    {(tier === 'low' || tier === 'medium') && selectedTrackForQuality.artist_name && (
                      <AddToWishlistButton
                        mediaType="track"
                        title={selectedTrackForQuality.title}
                        artistName={selectedTrackForQuality.artist_name}
                        albumTitle={selectedTrackForQuality.album_title}
                        posterUrl={selectedAlbum?.thumb_url || undefined}
                        reason="upgrade"
                      />
                    )}
                    <button
                      onClick={() => setSelectedTrackForQuality(null)}
                      className="text-muted-foreground hover:text-foreground p-1"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                  {/* Quality Score Card */}
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{tierLabel}</div>
                          <div className={`text-xs font-medium ${tierColor}`}>{tierDescription}</div>
                        </div>
                        <div className="h-10 w-px bg-border" />
                        <div className="text-center">
                          <div className="text-2xl font-bold">{tierScore}</div>
                          <div className="text-xs text-muted-foreground">Score</div>
                        </div>
                      </div>

                      {/* Premium Badges */}
                      <div className="flex flex-wrap gap-1.5">
                        {!!selectedTrackForQuality.is_lossless && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-500/20 text-green-400">Lossless</span>
                        )}
                        {(selectedTrackForQuality.bit_depth ?? 0) >= 24 && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Hi-Res</span>
                        )}
                      </div>
                    </div>

                    {/* Score Bar */}
                    <div className="mt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-14">Quality</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${tierScore}%` }} />
                        </div>
                        <span className="text-xs w-8 text-right">{tierScore}</span>
                      </div>
                    </div>

                    {/* Issue text - shown inside quality score card */}
                    {issueText && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="text-sm text-muted-foreground">{issueText}</div>
                      </div>
                    )}
                  </div>

                  {/* Technical Specs */}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audio Specs</h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Codec</span>
                        <span className="font-medium uppercase">{selectedTrackForQuality.codec || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bitrate</span>
                        <span className="font-medium flex items-center">
                          {selectedTrackForQuality.bitrate ? `${Math.round(selectedTrackForQuality.bitrate)} kbps` : 'N/A'}
                          {bitrateLow && <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sample Rate</span>
                        <span className="font-medium">{selectedTrackForQuality.sample_rate ? `${(selectedTrackForQuality.sample_rate / 1000).toFixed(1)} kHz` : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bit Depth</span>
                        <span className="font-medium">{selectedTrackForQuality.bit_depth ? `${selectedTrackForQuality.bit_depth}-bit` : 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        })()}
      </div>
    )
  }

  // Artist detail view (showing albums)
  if (selectedArtist) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Artists
        </button>

        {/* Artist Header */}
        <div className="flex items-start gap-6">
          <div className="w-40 h-40 bg-muted rounded-full overflow-hidden flex-shrink-0 shadow-lg">
            {selectedArtist.thumb_url ? (
              <img
                src={selectedArtist.thumb_url}
                alt={selectedArtist.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-16 h-16 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{selectedArtist.name}</h2>
            <p className="text-muted-foreground mt-1">
              {selectedArtist.album_count} albums • {selectedArtist.track_count} tracks
            </p>
            {/* Completeness info */}
            {artistCompleteness.has(selectedArtist.name) && (
              <p className="text-sm text-muted-foreground mt-2">
                {artistCompleteness.get(selectedArtist.name)!.owned_albums} of {artistCompleteness.get(selectedArtist.name)!.total_albums} albums in discography
              </p>
            )}
            {/* Analyze button */}
            <button
              onClick={() => handleAnalyzeArtist(selectedArtist.id)}
              disabled={isAnalyzingArtist}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors mt-3"
            >
              <RefreshCw className={`w-4 h-4 ${isAnalyzingArtist ? 'animate-spin' : ''}`} />
              {isAnalyzingArtist ? 'Analyzing...' : 'Analyze Completeness'}
            </button>
          </div>
        </div>

        {/* Albums Grid/List */}
        <div>
          <h3 className="text-lg font-semibold mb-4">Your Albums</h3>
          {filteredAlbums.length === 0 ? (
            <div className="p-12 text-center">
              <Disc3 className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No albums found</p>
            </div>
          ) : viewType === 'list' ? (
            <div className="space-y-2">
              {filteredAlbums.map(album => (
                <AlbumListItem
                  key={album.id}
                  album={album}
                  onClick={() => onSelectAlbum(album)}
                  showArtist={false}
                  showSourceBadge={showSourceBadge}
                  completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                />
              ))}
            </div>
          ) : (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
            >
              {filteredAlbums.map(album => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onClick={() => onSelectAlbum(album)}
                  showArtist={false}
                  showSourceBadge={showSourceBadge}
                  onAnalyze={onAnalyzeAlbum}
                  onFixMatch={onFixAlbumMatch && album.id ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name || '') : undefined}
                  completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* Missing Albums Section */}
        {artistCompleteness.has(selectedArtist.name) && (() => {
          const completeness = artistCompleteness.get(selectedArtist.name)!
          let missingAlbums: MissingAlbum[] = []
          let missingEps: MissingAlbum[] = []
          let missingSingles: MissingAlbum[] = []
          try {
            missingAlbums = JSON.parse(completeness.missing_albums || '[]')
            missingEps = JSON.parse(completeness.missing_eps || '[]')
            missingSingles = JSON.parse(completeness.missing_singles || '[]')
          } catch { /* ignore */ }

          const allMissing = [...missingAlbums, ...missingEps, ...missingSingles]
          if (allMissing.length === 0) return null

          return (
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4 text-yellow-400">
                Missing ({allMissing.length})
              </h3>
              {viewType === 'list' ? (
                <div className="space-y-2">
                  {allMissing.map((album, idx) => (
                    <MissingAlbumListItem
                      key={album.musicbrainz_id || idx}
                      album={album}
                      artistName={selectedArtist.name}
                    />
                  ))}
                </div>
              ) : (
                <div
                  className="grid gap-6"
                  style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
                >
                  {allMissing.map((album, idx) => (
                    <MissingAlbumCard
                      key={album.musicbrainz_id || idx}
                      album={album}
                      artistName={selectedArtist.name}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    )
  }

  // Main view - check for empty state
  const hasNoMusic = filteredArtists.length === 0 && albums.length === 0 && allTracks.length === 0
  if (hasNoMusic) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Music className="w-16 h-16 text-muted-foreground mb-4" strokeWidth={1.5} />
        <p className="text-muted-foreground text-lg">No music found</p>
        <p className="text-sm text-muted-foreground mt-2">
          Scan a music library from the sidebar to get started
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Stats Bar */}
      {stats && (
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <span>{stats.totalArtists} Artists</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{stats.totalAlbums} Albums</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{stats.totalTracks} Tracks</span>
          {stats.losslessAlbums > 0 && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="text-green-500">{stats.losslessAlbums} Lossless</span>
            </>
          )}
          {stats.hiResAlbums > 0 && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="text-purple-500">{stats.hiResAlbums} Hi-Res</span>
            </>
          )}
        </div>
      )}

      {/* Artists View Mode */}
      {musicViewMode === 'artists' && filteredArtists.length > 0 && (
        <div>
          {viewType === 'list' ? (
            <div className="space-y-2">
              {filteredArtists.map(artist => (
                <ArtistListItem
                  key={artist.id}
                  artist={artist}
                  completeness={artistCompleteness.get(artist.name)}
                  onClick={() => onSelectArtist(artist)}
                  showSourceBadge={showSourceBadge}
                  onFixMatch={onFixArtistMatch ? () => onFixArtistMatch(artist.id, artist.name) : undefined}
                  onAnalyzeCompleteness={onAnalyzeArtist}
                />
              ))}
            </div>
          ) : (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
            >
              {filteredArtists.map(artist => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  onClick={() => onSelectArtist(artist)}
                  showSourceBadge={showSourceBadge}
                  onFixMatch={onFixArtistMatch ? () => onFixArtistMatch(artist.id, artist.name) : undefined}
                  onAnalyzeCompleteness={onAnalyzeArtist}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Albums View Mode */}
      {musicViewMode === 'albums' && (
        <div>
          {allFilteredAlbums.length === 0 ? (
            <div className="p-12 text-center">
              <Disc3 className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No albums found</p>
            </div>
          ) : viewType === 'list' ? (
            <div>
              {/* Column Headers */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider select-none">
                {/* Thumbnail placeholder */}
                <div className="w-16" />

                {/* Title column */}
                <div
                  className="flex-1 flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => handleAlbumSort('title')}
                >
                  <span>Album</span>
                  {albumSortColumn === 'title' && (
                    <span className="text-primary">{albumSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>

                {/* Artist column */}
                <div
                  className="w-48 flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => handleAlbumSort('artist')}
                >
                  <span>Artist</span>
                  {albumSortColumn === 'artist' && (
                    <span className="text-primary">{albumSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </div>

              {/* Virtualized Album List */}
              <VirtualList
                height={Math.max(400, window.innerHeight - 280)}
                itemCount={allFilteredAlbums.length}
                itemSize={88}
                width="100%"
                className="scrollbar-visible"
                itemData={{
                  albums: allFilteredAlbums,
                  onSelectAlbum,
                  showSourceBadge,
                  allAlbumCompleteness
                }}
              >
                {({ index, style, data }: { index: number; style: React.CSSProperties; data: {
                  albums: MusicAlbum[];
                  onSelectAlbum: (album: MusicAlbum) => void;
                  showSourceBadge: boolean;
                  allAlbumCompleteness: Map<number, AlbumCompletenessData>;
                }}) => {
                  const album = data.albums[index]
                  return (
                    <div style={style}>
                      <AlbumListItem
                        album={album}
                        onClick={() => data.onSelectAlbum(album)}
                        showArtist={true}
                        showSourceBadge={data.showSourceBadge}
                        completeness={album.id ? data.allAlbumCompleteness.get(album.id) : undefined}
                      />
                    </div>
                  )
                }}
              </VirtualList>
            </div>
          ) : (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
            >
              {allFilteredAlbums.map(album => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onClick={() => onSelectAlbum(album)}
                  showArtist={true}
                  showSourceBadge={showSourceBadge}
                  onAnalyze={onAnalyzeAlbum}
                  onFixMatch={onFixAlbumMatch && album.id ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name || '') : undefined}
                  completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tracks View Mode */}
      {musicViewMode === 'tracks' && (
        <div>
          {filteredTracks.length === 0 ? (
            <div className="p-12 text-center">
              <Music className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No tracks found</p>
            </div>
          ) : (
            <div>
              {/* Column Headers */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider select-none">
                {/* # column */}
                <div className="w-8 text-center">#</div>

                {/* Title column */}
                <div
                  data-resize-column="title"
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.title, minWidth: 50 }}
                  onClick={() => handleTrackSort('title')}
                >
                  <span>Title</span>
                  {trackSortColumn === 'title' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <div
                    className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded"
                    onMouseDown={(e) => handleResizeStart('title', e)}
                  />
                </div>

                {/* Artist column */}
                <div
                  data-resize-column="artist"
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.artist, minWidth: 50 }}
                  onClick={() => handleTrackSort('artist')}
                >
                  <span>Artist</span>
                  {trackSortColumn === 'artist' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <div
                    className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded"
                    onMouseDown={(e) => handleResizeStart('artist', e)}
                  />
                </div>

                {/* Album column */}
                <div
                  data-resize-column="album"
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.album, minWidth: 50 }}
                  onClick={() => handleTrackSort('album')}
                >
                  <span>Album</span>
                  {trackSortColumn === 'album' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <div
                    className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded"
                    onMouseDown={(e) => handleResizeStart('album', e)}
                  />
                </div>

                {/* Quality column */}
                <div style={{ width: trackColumnWidths.quality, minWidth: 50 }}>
                  <span>Quality</span>
                </div>

                {/* Codec column */}
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.codec, minWidth: 50 }}
                  onClick={() => handleTrackSort('codec')}
                >
                  <span>Codec</span>
                  {trackSortColumn === 'codec' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>

                {/* Duration column */}
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors text-right"
                  style={{ width: trackColumnWidths.duration, minWidth: 50 }}
                  onClick={() => handleTrackSort('duration')}
                >
                  <span>Time</span>
                  {trackSortColumn === 'duration' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </div>

              {/* Virtualized Track List */}
              <VirtualList
                height={Math.max(400, window.innerHeight - 280)}
                itemCount={filteredTracks.length}
                itemSize={40}
                width="100%"
                className="scrollbar-visible"
                itemData={{
                  tracks: filteredTracks,
                  artistNameMap,
                  albumInfoMap,
                  columnWidths: trackColumnWidths,
                  setSelectedTrackForQuality
                }}
              >
                {({ index, style, data }: { index: number; style: React.CSSProperties; data: {
                  tracks: MusicTrack[]
                  artistNameMap: Map<number, string>
                  albumInfoMap: Map<number, { title: string; artistName?: string }>
                  columnWidths: typeof trackColumnWidths
                  setSelectedTrackForQuality: typeof setSelectedTrackForQuality
                }}) => {
                  const track = data.tracks[index]
                  const albumInfo = track.album_id ? data.albumInfoMap.get(track.album_id) : undefined
                  const artistName = track.artist_id
                    ? data.artistNameMap.get(track.artist_id)
                    : albumInfo?.artistName
                  return (
                    <div style={style}>
                      <TrackListItem
                        track={track}
                        index={index + 1}
                        artistName={artistName}
                        albumTitle={albumInfo?.title}
                        columnWidths={data.columnWidths}
                        onClickQuality={() => {
                          // Compute quality tier
                          const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']
                          const codecLower = (track.audio_codec || '').toLowerCase()
                          const isLossless = track.is_lossless || LOSSLESS_CODECS.some(c => codecLower.includes(c))
                          const bitrateKbps = track.audio_bitrate || 0
                          const sampleRate = track.sample_rate || 0
                          const bitDepth = track.bit_depth || 16
                          const isAAC = codecLower.includes('aac')

                          let qualityTier: 'ultra' | 'high' | 'medium' | 'low' | null = null
                          if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) qualityTier = 'ultra'
                          else if (isLossless) qualityTier = 'high'
                          else if (isAAC && bitrateKbps >= 128) qualityTier = 'medium'
                          else if (!isAAC && bitrateKbps >= 160) qualityTier = 'medium'
                          else if (bitrateKbps > 0) qualityTier = 'low'
                          else if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) qualityTier = 'medium'

                          data.setSelectedTrackForQuality({
                            title: track.title,
                            codec: track.audio_codec,
                            bitrate: track.audio_bitrate,
                            sample_rate: track.sample_rate,
                            bit_depth: track.bit_depth,
                            is_lossless: track.is_lossless,
                            qualityTier,
                            artist_name: artistName,
                            album_title: albumInfo?.title
                          })
                        }}
                      />
                    </div>
                  )
                }}
              </VirtualList>
            </div>
          )}
        </div>
      )}

      {/* Empty state for artists view */}
      {musicViewMode === 'artists' && filteredArtists.length === 0 && (
        <div className="p-12 text-center">
          <User className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No artists found</p>
        </div>
      )}

      {/* Track Quality Details Modal */}
      {selectedTrackForQuality && (() => {
        const tier = selectedTrackForQuality.qualityTier
        const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Unknown'
        const tierDescription = tier === 'ultra' ? 'Hi-Res Lossless' :
                                tier === 'high' ? 'CD-Quality Lossless' :
                                tier === 'medium' ? 'Transparent Lossy' :
                                tier === 'low' ? 'Low Bitrate Lossy' : 'Unknown'
        const tierColor = tier === 'ultra' ? 'text-purple-500' :
                         tier === 'high' ? 'text-green-500' :
                         tier === 'medium' ? 'text-blue-500' :
                         tier === 'low' ? 'text-red-500' : 'text-muted-foreground'
        const tierScore = tier === 'ultra' ? 100 :
                         tier === 'high' ? 85 :
                         tier === 'medium' ? 60 :
                         tier === 'low' ? 30 : 0

        // Check if bitrate is low (for lossy codecs, below 160kbps for MP3 or 128kbps for AAC)
        const isLossyCodec = !selectedTrackForQuality.is_lossless
        const codec = (selectedTrackForQuality.codec || '').toLowerCase()
        const isAAC = codec.includes('aac')
        const bitrateLow = isLossyCodec && selectedTrackForQuality.bitrate &&
          (isAAC ? selectedTrackForQuality.bitrate < 128 : selectedTrackForQuality.bitrate < 160)

        // Get explanation text for low/medium tiers
        const getIssueText = () => {
          if (tier === 'low') {
            return `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps may have audible artifacts. Consider 256+ kbps for transparent quality, or lossless for archival.`
          }
          if (tier === 'medium') {
            return `Good for everyday listening. Lossless (FLAC) available for critical listening or archival.`
          }
          return null
        }
        const issueText = getIssueText()

        return createPortal(
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-6"
            onClick={() => setSelectedTrackForQuality(null)}
          >
            <div
              className="bg-card rounded-xl w-full max-w-lg overflow-hidden shadow-2xl border border-border"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 p-4 border-b border-border/30 bg-black/30 rounded-t-xl">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold truncate">{selectedTrackForQuality.title}</h2>
                  <p className="text-sm text-muted-foreground truncate">
                    {selectedTrackForQuality.artist_name && selectedTrackForQuality.album_title
                      ? `${selectedTrackForQuality.artist_name} · ${selectedTrackForQuality.album_title}`
                      : 'Track Quality Analysis'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Add to Wishlist Button for low quality tracks */}
                  {(tier === 'low' || tier === 'medium') && (
                    <AddToWishlistButton
                      mediaType="track"
                      title={selectedTrackForQuality.title}
                      artistName={selectedTrackForQuality.artist_name}
                      albumTitle={selectedTrackForQuality.album_title}
                      reason="upgrade"
                    />
                  )}
                  <button
                    onClick={() => setSelectedTrackForQuality(null)}
                    className="text-muted-foreground hover:text-foreground p-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                {/* Quality Score Card */}
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierLabel}</div>
                        <div className={`text-xs font-medium ${tierColor}`}>{tierDescription}</div>
                      </div>
                      <div className="h-10 w-px bg-border" />
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierScore}</div>
                        <div className="text-xs text-muted-foreground">Score</div>
                      </div>
                    </div>

                    {/* Premium Badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {!!selectedTrackForQuality.is_lossless && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-500/20 text-green-400">Lossless</span>
                      )}
                      {(selectedTrackForQuality.bit_depth ?? 0) >= 24 && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Hi-Res</span>
                      )}
                    </div>
                  </div>

                  {/* Score Bar */}
                  <div className="mt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-14">Quality</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${tierScore}%` }} />
                      </div>
                      <span className="text-xs w-8 text-right">{tierScore}</span>
                    </div>
                  </div>

                  {/* Issue text - shown inside quality score card */}
                  {issueText && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="text-sm text-muted-foreground">{issueText}</div>
                    </div>
                  )}
                </div>

                {/* Technical Specs */}
                <div className="bg-muted/30 rounded-lg p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audio Specs</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Codec</span>
                      <span className="font-medium uppercase">{selectedTrackForQuality.codec || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bitrate</span>
                      <span className="font-medium flex items-center">
                        {selectedTrackForQuality.bitrate ? `${Math.round(selectedTrackForQuality.bitrate)} kbps` : 'N/A'}
                        {bitrateLow && <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sample Rate</span>
                      <span className="font-medium">{selectedTrackForQuality.sample_rate ? `${(selectedTrackForQuality.sample_rate / 1000).toFixed(1)} kHz` : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bit Depth</span>
                      <span className="font-medium">{selectedTrackForQuality.bit_depth ? `${selectedTrackForQuality.bit_depth}-bit` : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}

const ArtistCard = memo(({ artist, onClick, showSourceBadge, onFixMatch, onAnalyzeCompleteness }: {
  artist: MusicArtist
  onClick: () => void
  showSourceBadge: boolean
  onFixMatch?: (artistId: number) => void
  onAnalyzeCompleteness?: (artistId: number) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  // Check if this is a local source that can have match fixed
  const isLocalSource = artist.source_type === 'kodi-local' || artist.source_type === 'local'

  // Show menu if any action is available
  const hasMenuActions = (isLocalSource && onFixMatch) || onAnalyzeCompleteness

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && artist.id) {
      onFixMatch(artist.id)
    }
  }

  const handleAnalyzeCompleteness = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeCompleteness && artist.id) {
      setIsAnalyzing(true)
      try {
        await onAnalyzeCompleteness(artist.id)
      } finally {
        setIsAnalyzing(false)
      }
    }
  }

  return (
    <div
      className="group cursor-pointer hover-scale"
      onClick={onClick}
    >
      <div className="relative">
        {/* 3-dot menu button - positioned outside the circular frame */}
        {hasMenuActions && (
          <div ref={menuRef} className="absolute -top-1 -left-1 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px]">
                {onAnalyzeCompleteness && (
                  <button
                    onClick={handleAnalyzeCompleteness}
                    disabled={isAnalyzing}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Completeness'}
                  </button>
                )}
                {isLocalSource && onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Fix Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="aspect-square bg-muted overflow-hidden rounded-full shadow-lg shadow-black/30">
          {showSourceBadge && artist.source_type && (
          <div
            className={`absolute bottom-2 right-2 z-10 ${providerColors[artist.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
          >
            {artist.source_type.charAt(0).toUpperCase()}
          </div>
        )}
        {artist.thumb_url ? (
          <img
            src={artist.thumb_url}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
        </div>
      </div>
      <div className="pt-3 text-center">
        <h4 className="font-medium text-sm truncate">{artist.name}</h4>
        <p className="text-xs text-muted-foreground">
          {artist.album_count} {artist.album_count === 1 ? 'album' : 'albums'}
        </p>
      </div>
    </div>
  )
})

const AlbumCard = memo(({ album, onClick, showArtist = true, showSourceBadge, onAnalyze, onFixMatch, completeness }: {
  album: MusicAlbum
  onClick: () => void
  showArtist?: boolean
  showSourceBadge: boolean
  onAnalyze?: (albumId: number) => void
  onFixMatch?: () => void
  completeness?: AlbumCompletenessData
}) => {
  const hasCompleteness = !!completeness
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (!album.id || !onAnalyze) return

    setIsAnalyzing(true)
    try {
      await onAnalyze(album.id)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    onFixMatch?.()
  }

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(!showMenu)
  }

  return (
    <div
      className="cursor-pointer hover-scale group relative"
      onClick={onClick}
    >
      <div className="aspect-square bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {/* 3-dot menu button - appears on hover */}
        {onAnalyze && (
          <div ref={menuRef} className="absolute top-2 left-2 z-20">
            <button
              onClick={handleMenuClick}
              className={`p-1 rounded-full bg-black/60 text-white transition-opacity ${
                showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              } hover:bg-black/80`}
            >
              {isAnalyzing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <MoreVertical className="w-4 h-4" />
              )}
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px] z-30">
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  {isAnalyzing ? 'Analyzing...' : 'Analyze for missing tracks'}
                </button>
                {onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-4 h-4" />
                    Fix Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quality badges */}
        {(() => {
          const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
          const codec = (album.best_audio_codec || '').toLowerCase()
          const isLossless = losslessCodecs.some(c => codec.includes(c))
          const isHiRes = isLossless && ((album.best_bit_depth || 0) > 16 || (album.best_sample_rate || 0) > 48000)
          if (!isLossless && !isHiRes) return null
          return (
            <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end">
              {isHiRes && (
                <span className="px-1.5 py-0.5 text-xs font-bold bg-purple-600 text-white rounded shadow">Hi-Res</span>
              )}
              {isLossless && !isHiRes && (
                <span className="px-1.5 py-0.5 text-xs font-bold bg-green-600 text-white rounded shadow">Lossless</span>
              )}
            </div>
          )
        })()}

        {showSourceBadge && album.source_type && (
          <div
            className={`absolute bottom-2 left-2 z-10 ${providerColors[album.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
          >
            {album.source_type.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Completeness badge - bottom right */}
        {hasCompleteness && (
          <div className="absolute bottom-2 right-2 z-10">
            <div className="bg-foreground text-background text-xs font-bold px-1.5 py-0.5 rounded shadow-md">
              {completeness!.owned_tracks}/{completeness!.total_tracks}
            </div>
          </div>
        )}

        {album.thumb_url ? (
          <img
            src={album.thumb_url}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="pt-2">
        <h4 className="font-medium text-sm truncate">{album.title}</h4>
        {showArtist && (
          <p className="text-xs text-muted-foreground truncate">{album.artist_name}</p>
        )}
        {album.year && (
          <p className="text-xs text-muted-foreground">{album.year}</p>
        )}
      </div>
    </div>
  )
})

// List item component for artists
const ArtistListItem = memo(({ artist, completeness, onClick, showSourceBadge, onFixMatch, onAnalyzeCompleteness }: {
  artist: MusicArtist
  completeness?: ArtistCompletenessData
  onClick: () => void
  showSourceBadge: boolean
  onFixMatch?: (artistId: number) => void
  onAnalyzeCompleteness?: (artistId: number) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  // Check if this is a local source that can have match fixed
  const isLocalSource = artist.source_type === 'kodi-local' || artist.source_type === 'local'

  // Show menu if any action is available
  const hasMenuActions = (isLocalSource && onFixMatch) || onAnalyzeCompleteness

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && artist.id) {
      onFixMatch(artist.id)
    }
  }

  const handleAnalyzeCompleteness = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeCompleteness && artist.id) {
      setIsAnalyzing(true)
      try {
        await onAnalyzeCompleteness(artist.id)
      } finally {
        setIsAnalyzing(false)
      }
    }
  }

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center"
      onClick={onClick}
    >
      {/* Artist Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-full overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {artist.thumb_url ? (
          <img
            src={artist.thumb_url}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* 3-dot menu button */}
        {hasMenuActions && (
          <div ref={menuRef} className="absolute top-0 left-0 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="w-3 h-3" />
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-7 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px]">
                {onAnalyzeCompleteness && (
                  <button
                    onClick={handleAnalyzeCompleteness}
                    disabled={isAnalyzing}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Completeness'}
                  </button>
                )}
                {isLocalSource && onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Fix Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {/* Source badge */}
        {showSourceBadge && artist.source_type && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[artist.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1 py-0.5 rounded`}
          >
            {artist.source_type.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{artist.name}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {artist.album_count} {artist.album_count === 1 ? 'album' : 'albums'} • {artist.track_count} tracks
        </p>
        {completeness && (
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
              {completeness.owned_albums}/{completeness.total_albums}
            </span>
          </div>
        )}
      </div>
    </div>
  )
})

// List item component for albums
const AlbumListItem = memo(({ album, onClick, showArtist = true, showSourceBadge, completeness }: {
  album: MusicAlbum
  onClick: () => void
  showArtist?: boolean
  showSourceBadge: boolean
  completeness?: AlbumCompletenessData
}) => {
  const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
  const codec = (album.best_audio_codec || '').toLowerCase()
  const isLossless = losslessCodecs.some(c => codec.includes(c))
  const isHiRes = isLossless && ((album.best_bit_depth || 0) > 16 || (album.best_sample_rate || 0) > 48000)

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center"
      onClick={onClick}
    >
      {/* Album Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {album.thumb_url ? (
          <img
            src={album.thumb_url}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* Source badge */}
        {showSourceBadge && album.source_type && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[album.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1 py-0.5 rounded`}
          >
            {album.source_type.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{album.title}</h4>
        {showArtist && (
          <p className="text-xs text-muted-foreground truncate">{album.artist_name}</p>
        )}
        {album.year && (
          <p className="text-xs text-muted-foreground">{album.year}</p>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {isHiRes && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">Hi-Res</span>
          )}
          {isLossless && !isHiRes && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">Lossless</span>
          )}
          {completeness && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
              {completeness.owned_tracks}/{completeness.total_tracks}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})

// List item component for tracks in tracks view
const TrackListItem = memo(({ track, index, artistName, albumTitle, columnWidths, onClickQuality }: {
  track: MusicTrack
  index: number
  artistName?: string
  albumTitle?: string
  columnWidths?: { title: number; artist: number; album: number; quality: number; codec: number; duration: number }
  onClickQuality: () => void
}) => {
  // Quality tier calculation
  const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']

  const isLosslessCodec = (codec?: string): boolean => {
    if (!codec) return false
    const codecLower = codec.toLowerCase()
    return LOSSLESS_CODECS.some(c => codecLower.includes(c))
  }

  const isAACCodec = (codec?: string): boolean => {
    if (!codec) return false
    return codec.toLowerCase().includes('aac')
  }

  const getQualityTier = (): 'ultra' | 'high' | 'medium' | 'low' | null => {
    const bitrateKbps = track.audio_bitrate || 0
    const sampleRate = track.sample_rate || 0
    const bitDepth = track.bit_depth || 16
    const isLossless = track.is_lossless || isLosslessCodec(track.audio_codec)

    if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) return 'ultra'
    if (isLossless) return 'high'
    if (isAACCodec(track.audio_codec)) {
      if (bitrateKbps >= 128) return 'medium'
    } else {
      if (bitrateKbps >= 160) return 'medium'
    }
    if (bitrateKbps > 0) return 'low'
    if (track.audio_codec) {
      const codecLower = track.audio_codec.toLowerCase()
      if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) {
        return 'medium'
      }
    }
    return null
  }

  const qualityTier = getQualityTier()
  const qualityTierConfig: Record<string, { label: string; color: string }> = {
    ultra: { label: 'Ultra', color: 'bg-foreground text-background' },
    high: { label: 'High', color: 'bg-foreground text-background' },
    medium: { label: 'Mid', color: 'bg-foreground text-background' },
    low: { label: 'Low', color: 'bg-foreground text-background' }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '--:--'
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const widths = columnWidths || { title: 200, artist: 160, album: 180, quality: 60, codec: 70, duration: 60 }

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden hover:bg-muted/40 transition-all duration-200 px-4 py-2 flex gap-4 items-center"
      onClick={onClickQuality}
    >
      {/* Track Number */}
      <div className="w-8 text-center text-sm text-muted-foreground">
        {index}
      </div>

      {/* Track Title */}
      <div className="min-w-0 truncate" style={{ width: widths.title }}>
        <h4 className="font-medium text-sm truncate">{track.title}</h4>
      </div>

      {/* Artist */}
      <div className="min-w-0 truncate" style={{ width: widths.artist }}>
        <span className="text-sm text-muted-foreground truncate block">{artistName || '—'}</span>
      </div>

      {/* Album */}
      <div className="min-w-0 truncate" style={{ width: widths.album }}>
        <span className="text-sm text-muted-foreground truncate block">{albumTitle || '—'}</span>
      </div>

      {/* Quality Badge */}
      <div className="flex items-center gap-2" style={{ width: widths.quality }}>
        {qualityTier && (
          <span className={`px-2 py-0.5 text-xs font-bold rounded ${qualityTierConfig[qualityTier].color}`}>
            {qualityTierConfig[qualityTier].label}
          </span>
        )}
        {qualityTier === 'low' && (
          <span title="Quality upgrade recommended">
            <CircleFadingArrowUp className="w-4 h-4 text-red-500" />
          </span>
        )}
      </div>

      {/* Codec */}
      <div className="text-xs text-muted-foreground" style={{ width: widths.codec }}>
        {track.audio_codec?.toUpperCase() || '—'}
      </div>

      {/* Duration */}
      <div className="text-xs text-muted-foreground text-right" style={{ width: widths.duration }}>
        {formatDuration(track.duration)}
      </div>

      {/* Add to Wishlist - for low quality tracks that need upgrade */}
      <div className="w-8 flex justify-center" onClick={(e) => e.stopPropagation()}>
        {qualityTier === 'low' && (
          <AddToWishlistButton
            mediaType="track"
            title={track.title}
            artistName={artistName}
            albumTitle={albumTitle}
            reason="upgrade"
            compact
          />
        )}
      </div>
    </div>
  )
})

const MissingAlbumCard = memo(({ album, artistName }: {
  album: MissingAlbum
  artistName: string
}) => {
  const [imageError, setImageError] = useState(false)

  // Cover Art Archive URL for release group
  const coverUrl = album.musicbrainz_id
    ? `https://coverartarchive.org/release-group/${album.musicbrainz_id}/front-250`
    : null

  return (
    <div className="hover-scale opacity-60 hover:opacity-80 group">
      <div className="aspect-square bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 grayscale">
        {/* Album type badge */}
        {album.album_type !== 'album' && (
          <div className="absolute top-2 right-2 z-10">
            <span className="px-1.5 py-0.5 text-xs font-bold bg-gray-600 text-white rounded shadow capitalize">
              {album.album_type}
            </span>
          </div>
        )}

        {coverUrl && !imageError ? (
          <img
            src={coverUrl}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/80">
            <Disc3 className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="pt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm truncate text-muted-foreground">{album.title}</h4>
          {album.year && (
            <p className="text-xs text-muted-foreground/70">{album.year}</p>
          )}
        </div>
        {/* Wishlist button */}
        <div className="flex-shrink-0 [&_button]:!text-white [&_button]:hover:!text-white/80">
          <AddToWishlistButton
            mediaType="album"
            title={album.title}
            year={album.year}
            musicbrainzId={album.musicbrainz_id}
            artistName={artistName}
            posterUrl={coverUrl || undefined}
            compact
          />
        </div>
      </div>
    </div>
  )
})

// List item component for missing albums
const MissingAlbumListItem = memo(({ album, artistName }: {
  album: MissingAlbum
  artistName: string
}) => {
  const [imageError, setImageError] = useState(false)

  // Cover Art Archive URL for release group
  const coverUrl = album.musicbrainz_id
    ? `https://coverartarchive.org/release-group/${album.musicbrainz_id}/front-250`
    : null

  return (
    <div className="rounded-md overflow-hidden bg-muted/20 p-4 flex gap-4 items-center opacity-60 hover:opacity-80 transition-opacity">
      {/* Album Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0 relative grayscale shadow-md shadow-black/20">
        {coverUrl && !imageError ? (
          <img
            src={coverUrl}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate text-muted-foreground">{album.title}</h4>
        {album.year && (
          <p className="text-xs text-muted-foreground/70">{album.year}</p>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 text-xs font-medium bg-yellow-600 text-white rounded">Missing</span>
          {album.album_type !== 'album' && (
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-600 text-white rounded capitalize">
              {album.album_type}
            </span>
          )}
        </div>
      </div>

      {/* Wishlist button */}
      <div className="flex-shrink-0">
        <AddToWishlistButton
          mediaType="album"
          title={album.title}
          year={album.year}
          musicbrainzId={album.musicbrainz_id}
          artistName={artistName}
          posterUrl={coverUrl || undefined}
          compact
        />
      </div>
    </div>
  )
})
