/**
 * TopBar - Shared top navigation bar across the application
 *
 * Contains logo, search, library tabs, and panel toggles.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Home, Film, Tv, Music, Library, Star, Settings, RefreshCw, Disc3, User } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'
import { useWishlist } from '../../contexts/WishlistContext'
import { ActivityPanel } from '../ui/ActivityPanel'
import logoImage from '../../assets/totality_header_logo.png'
import type { MediaViewType } from '../library/types'

// Search results type
interface SearchResults {
  movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
  tvShows: Array<{ id: number; title: string; poster_url?: string }>
  episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
  artists: Array<{ id: number; name: string; thumb_url?: string }>
  albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
  tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string }>
}

interface TopBarProps {
  currentView: 'dashboard' | 'library'
  libraryTab: MediaViewType
  onNavigateHome: () => void
  onNavigateToLibrary: (tab: MediaViewType) => void
  onOpenSettings: () => void
  onToggleCompleteness: () => void
  onToggleWishlist: () => void
  showCompletenessPanel: boolean
  showWishlistPanel: boolean
  isAutoRefreshing?: boolean
  hasMovies?: boolean
  hasTV?: boolean
  hasMusic?: boolean
}

export function TopBar({
  currentView,
  libraryTab,
  onNavigateHome,
  onNavigateToLibrary,
  onOpenSettings,
  onToggleCompleteness,
  onToggleWishlist,
  showCompletenessPanel,
  showWishlistPanel,
  isAutoRefreshing = false,
  hasMovies = false,
  hasTV = false,
  hasMusic = false
}: TopBarProps) {
  const { sources } = useSources()
  const { count: wishlistCount } = useWishlist()

  // Theme accent color for alerts
  const [themeAccentColor, setThemeAccentColor] = useState('')
  useEffect(() => {
    const updateAccentColor = () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      setThemeAccentColor(accent ? `hsl(${accent})` : '')
    }
    updateAccentColor()
    const observer = new MutationObserver(updateAccentColor)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Check TMDB API key status
  const [tmdbApiKeySet, setTmdbApiKeySet] = useState(false)
  useEffect(() => {
    window.electronAPI.getSetting('tmdb_api_key').then(value => {
      setTmdbApiKeySet(!!value)
    })
    const unsubscribe = window.electronAPI.onSettingsChanged(({ key, hasValue }) => {
      if (key === 'tmdb_api_key') setTmdbApiKeySet(hasValue)
    })
    return unsubscribe
  }, [])

  const showEmptyState = sources.length === 0

  // Search state
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [searchResultIndex, setSearchResultIndex] = useState(-1)
  const [isSearching, setIsSearching] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout>()

  // Debounced search
  const performSearch = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults(null)
      return
    }

    setIsSearching(true)
    try {
      const results = await window.electronAPI.mediaSearch(query)
      setSearchResults(results)
    } catch (error) {
      console.error('Search failed:', error)
      setSearchResults(null)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Handle search input change with debounce
  const handleSearchInputChange = (value: string) => {
    setSearchInput(value)
    setShowSearchResults(true)
    setSearchResultIndex(-1)

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    searchDebounceRef.current = setTimeout(() => {
      performSearch(value)
    }, 200)
  }

  // Check if we have any results
  const hasResults = searchResults && (
    searchResults.movies.length > 0 ||
    searchResults.tvShows.length > 0 ||
    searchResults.episodes.length > 0 ||
    searchResults.artists.length > 0 ||
    searchResults.albums.length > 0 ||
    searchResults.tracks.length > 0
  )

  // Flatten results for keyboard navigation
  const flattenedResults = searchResults ? [
    ...searchResults.movies.map(m => ({ type: 'movie' as const, id: m.id })),
    ...searchResults.tvShows.map(s => ({ type: 'tv' as const, id: s.id, title: s.title })),
    ...searchResults.episodes.map(e => ({ type: 'episode' as const, id: e.id, series_title: e.series_title })),
    ...searchResults.artists.map(a => ({ type: 'artist' as const, id: a.id })),
    ...searchResults.albums.map(a => ({ type: 'album' as const, id: a.id })),
    ...searchResults.tracks.map(t => ({ type: 'track' as const, id: t.id, album_id: t.album_id })),
  ] : []

  // Handle result selection
  const handleResultClick = (type: 'movie' | 'tv' | 'episode' | 'artist' | 'album' | 'track', _id: number, _extra?: { series_title?: string; album_id?: number; title?: string }) => {
    setShowSearchResults(false)
    setSearchInput('')
    setSearchResults(null)

    // Navigate to appropriate library tab
    if (type === 'movie') {
      onNavigateToLibrary('movies')
    } else if (type === 'tv' || type === 'episode') {
      onNavigateToLibrary('tv')
    } else {
      onNavigateToLibrary('music')
    }
  }

  // Keyboard navigation
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showSearchResults || !hasResults) {
      if (e.key === 'Escape') {
        setShowSearchResults(false)
        searchInputRef.current?.blur()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSearchResultIndex(prev => prev < flattenedResults.length - 1 ? prev + 1 : 0)
        break
      case 'ArrowUp':
        e.preventDefault()
        setSearchResultIndex(prev => prev > 0 ? prev - 1 : flattenedResults.length - 1)
        break
      case 'Enter':
        e.preventDefault()
        if (searchResultIndex >= 0 && searchResultIndex < flattenedResults.length) {
          const result = flattenedResults[searchResultIndex]
          handleResultClick(result.type, result.id, result as { series_title?: string; album_id?: number; title?: string })
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

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isDashboard = currentView === 'dashboard'

  // Get actual theme from document (to escape TopBar's forced dark mode)
  const getActiveTheme = () => {
    const themes = ['frost', 'slate-light', 'ember-light', 'forest-light',
                    'ocean-light', 'lavender-light', 'rose-light', 'sand-light',
                    'mint-light', 'coral-light', 'dark']
    for (const theme of themes) {
      if (document.documentElement.classList.contains(theme)) return theme
    }
    return 'dark'
  }

  return (
    <header
      id="top-bar"
      className="dark fixed top-4 left-4 right-4 z-[100] bg-black rounded-2xl shadow-xl px-4 py-3"
      role="banner"
      aria-label="Main navigation"
    >
      <div className="flex items-center gap-4">
        {/* Left Section: Logo + Search */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Logo */}
          <img src={logoImage} alt="Totality" className="h-10 flex-shrink-0" />

          {/* Search */}
          <div ref={searchContainerRef} className="relative flex-shrink min-w-24 max-w-80 w-64">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search all libraries..."
              value={searchInput}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              onFocus={() => setShowSearchResults(true)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-10 pr-8 py-2 bg-input border border-border/50 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search all libraries"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput('')
                  setSearchResults(null)
                  setShowSearchResults(false)
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Search Results Dropdown */}
            {showSearchResults && searchInput.length >= 2 && (
              <div className={`${getActiveTheme()} absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-lg shadow-2xl overflow-hidden z-[9999] max-h-[400px] overflow-y-auto`}>
                {isSearching && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">Searching...</div>
                )}

                {!isSearching && !hasResults && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">No results found</div>
                )}

                {!isSearching && hasResults && searchResults && (
                  <>
                    {/* Movies */}
                    {searchResults.movies.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Film className="w-3 h-3" />
                          Movies
                        </div>
                        {searchResults.movies.map((movie, idx) => {
                          const flatIndex = idx
                          return (
                            <button
                              key={`movie-${movie.id}`}
                              onClick={() => handleResultClick('movie', movie.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-8 h-12 bg-muted rounded overflow-hidden flex-shrink-0">
                                {movie.poster_url ? (
                                  <img src={movie.poster_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Film className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{movie.title}</div>
                                {movie.year && <div className="text-xs text-muted-foreground">{movie.year}</div>}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* TV Shows */}
                    {searchResults.tvShows.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Tv className="w-3 h-3" />
                          TV Shows
                        </div>
                        {searchResults.tvShows.map((show, idx) => {
                          const flatIndex = searchResults.movies.length + idx
                          return (
                            <button
                              key={`tv-${show.id}`}
                              onClick={() => handleResultClick('tv', show.id, { title: show.title })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-8 h-12 bg-muted rounded overflow-hidden flex-shrink-0">
                                {show.poster_url ? (
                                  <img src={show.poster_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Tv className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-medium truncate">{show.title}</div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Episodes */}
                    {searchResults.episodes.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Tv className="w-3 h-3" />
                          Episodes
                        </div>
                        {searchResults.episodes.map((episode, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + idx
                          return (
                            <button
                              key={`episode-${episode.id}`}
                              onClick={() => handleResultClick('episode', episode.id, { series_title: episode.series_title })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-8 h-12 bg-muted rounded overflow-hidden flex-shrink-0">
                                {episode.poster_url ? (
                                  <img src={episode.poster_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Tv className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{episode.title}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {episode.series_title} · S{episode.season_number}E{episode.episode_number}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Artists */}
                    {searchResults.artists.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <User className="w-3 h-3" />
                          Artists
                        </div>
                        {searchResults.artists.map((artist, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + searchResults.episodes.length + idx
                          return (
                            <button
                              key={`artist-${artist.id}`}
                              onClick={() => handleResultClick('artist', artist.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-10 h-10 bg-muted rounded-full overflow-hidden flex-shrink-0">
                                {artist.thumb_url ? (
                                  <img src={artist.thumb_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <User className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-medium truncate">{artist.name}</div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Albums */}
                    {searchResults.albums.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Disc3 className="w-3 h-3" />
                          Albums
                        </div>
                        {searchResults.albums.map((album, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + searchResults.episodes.length + searchResults.artists.length + idx
                          return (
                            <button
                              key={`album-${album.id}`}
                              onClick={() => handleResultClick('album', album.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-10 h-10 bg-muted rounded overflow-hidden flex-shrink-0">
                                {album.thumb_url ? (
                                  <img src={album.thumb_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Disc3 className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{album.title}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {album.artist_name}{album.year && ` · ${album.year}`}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Tracks */}
                    {searchResults.tracks.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Music className="w-3 h-3" />
                          Tracks
                        </div>
                        {searchResults.tracks.map((track, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + searchResults.episodes.length + searchResults.artists.length + searchResults.albums.length + idx
                          return (
                            <button
                              key={`track-${track.id}`}
                              onClick={() => handleResultClick('track', track.id, { album_id: track.album_id })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-10 h-10 bg-muted rounded overflow-hidden flex-shrink-0">
                                {track.album_thumb_url ? (
                                  <img src={track.album_thumb_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Music className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{track.title}</div>
                                {track.artist_name && (
                                  <div className="text-xs text-muted-foreground truncate">{track.artist_name}</div>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Library Buttons - Centered */}
        {!showEmptyState && (
          <div className="flex-shrink-0" role="tablist" aria-label="Navigation">
            <div className="flex gap-1">
              {/* Home Button */}
              <button
                onClick={onNavigateHome}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 ${
                  isDashboard
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
                role="tab"
                aria-selected={isDashboard}
                aria-label="Dashboard"
              >
                <Home className="w-4 h-4" />
              </button>

              {/* Divider - only show if any library buttons will render */}
              {(hasMovies || hasTV || hasMusic) && (
                <div className="w-px bg-border/50 mx-1" />
              )}

              {/* Movies Button - only render if movies library exists */}
              {hasMovies && (
                <button
                  onClick={() => onNavigateToLibrary('movies')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 ${
                    !isDashboard && libraryTab === 'movies'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                  role="tab"
                  aria-selected={!isDashboard && libraryTab === 'movies'}
                >
                  <Film className="w-4 h-4" />
                  <span>Movies</span>
                </button>
              )}

              {/* TV Shows Button - only render if TV library exists */}
              {hasTV && (
                <button
                  onClick={() => onNavigateToLibrary('tv')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 ${
                    !isDashboard && libraryTab === 'tv'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                  role="tab"
                  aria-selected={!isDashboard && libraryTab === 'tv'}
                >
                  <Tv className="w-4 h-4" />
                  <span>TV Shows</span>
                </button>
              )}

              {/* Music Button - only render if music library exists */}
              {hasMusic && (
                <button
                  onClick={() => onNavigateToLibrary('music')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none flex items-center gap-2 ${
                    !isDashboard && libraryTab === 'music'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                  role="tab"
                  aria-selected={!isDashboard && libraryTab === 'music'}
                >
                  <Music className="w-4 h-4" />
                  <span>Music</span>
                </button>
              )}

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

        {/* Right Section: Panel Toggles & Settings */}
        <div className="flex items-center justify-end flex-1 gap-2">
          {/* Completeness Panel Toggle */}
          <button
            onClick={onToggleCompleteness}
            className={`relative p-2 rounded-md transition-colors ${
              showCompletenessPanel
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
            title={!tmdbApiKeySet ? "TMDB API key needed for completeness" : "Collection Completeness"}
            aria-label="Toggle completeness panel"
            aria-pressed={showCompletenessPanel}
          >
            <Library className="w-5 h-5" />
            {!tmdbApiKeySet && (
              <span
                className="absolute top-1 right-1 w-2 h-2 rounded-full"
                style={{ backgroundColor: themeAccentColor }}
              />
            )}
          </button>

          {/* Wishlist Panel Toggle */}
          <button
            onClick={onToggleWishlist}
            className={`relative p-2 rounded-md transition-colors ${
              showWishlistPanel
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
            title="Wishlist (W)"
            aria-label="Toggle wishlist panel"
            aria-pressed={showWishlistPanel}
          >
            <Star className="w-5 h-5" />
            {wishlistCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {wishlistCount > 99 ? '99+' : wishlistCount}
              </span>
            )}
          </button>

          {/* Activity Panel */}
          <ActivityPanel />

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-md transition-colors bg-card text-muted-foreground hover:bg-muted"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  )
}
