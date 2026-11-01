import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Filter, ArrowUpDown, Film, Tv, Music, Loader2, ListTodo, CircleFadingArrowUp, Download, CheckCircle2, Circle, RefreshCw, Search, Plus, Check, Star } from 'lucide-react'
import { useWishlist, WishlistMediaType, WishlistPriority, WishlistReason, WishlistStatus } from '../../contexts/WishlistContext'
import { WishlistItemCard } from './WishlistItemCard'
import { WishlistEmptyState } from './WishlistEmptyState'
import { SETTING_KEYS } from '../../../../shared/settingKeys'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'

interface SearchResult {
  id: string
  title: string
  year?: number
  type: 'movie' | 'tv'
  poster_url?: string
  tmdb_id?: number
  owned?: boolean
  release_date?: string
  physical_release_date?: string
}

function WishlistSearch({ isMobile = false }: { isMobile?: boolean }) {
  const { addItem, items } = useWishlist()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setIsSearching(true)
    try {
      const [movies, tvShows, local] = await Promise.all([
        window.electronAPI.movieSearchTMDB(q).catch(() => []),
        window.electronAPI.seriesSearchTMDB(q).catch(() => []),
        window.electronAPI.mediaSearch(q).catch(() => ({ movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] })),
      ])

      // Build sets of owned TMDB IDs + titles for ownership tagging
      const localMovies = local.movies as Array<{ id: number; title: string; tmdb_id?: string }>
      const localShows = local.tvShows as Array<{ id: number; title: string; tmdb_id?: string }>
      const ownedMovieTmdbIds = new Set(localMovies.filter(m => m.tmdb_id).map(m => m.tmdb_id))
      const ownedMovieTitles = new Set(localMovies.map(m => m.title.toLowerCase()))
      const ownedTVTmdbIds = new Set(localShows.filter(s => s.tmdb_id).map(s => s.tmdb_id))
      const ownedTVTitles = new Set(localShows.map(s => s.title.toLowerCase()))

      const combined: SearchResult[] = []

      for (const m of (movies as Array<{ id: number; title: string; release_date: string; physical_release_date: string | null; poster_url: string | null }>).slice(0, 5)) {
        combined.push({
          id: `movie-${m.id}`,
          title: m.title,
          year: m.release_date ? parseInt(m.release_date.substring(0, 4)) : undefined,
          type: 'movie',
          poster_url: m.poster_url || undefined,
          tmdb_id: m.id,
          owned: ownedMovieTmdbIds.has(String(m.id)) || ownedMovieTitles.has(m.title.toLowerCase()),
          release_date: m.release_date || undefined,
          physical_release_date: m.physical_release_date || undefined,
        })
      }

      for (const s of (tvShows as Array<{ id: number; name: string; first_air_date: string; poster_url: string | null }>).slice(0, 5)) {
        combined.push({
          id: `tv-${s.id}`,
          title: s.name,
          year: s.first_air_date ? parseInt(s.first_air_date.substring(0, 4)) : undefined,
          type: 'tv',
          poster_url: s.poster_url || undefined,
          tmdb_id: s.id,
          owned: ownedTVTmdbIds.has(String(s.id)) || ownedTVTitles.has(s.name.toLowerCase()),
          release_date: s.first_air_date || undefined,
        })
      }

      setResults(combined)
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleInput = useCallback((value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value.trim()), 300)
  }, [doSearch])

  const isInWishlist = useCallback((result: SearchResult) => {
    if (result.tmdb_id) {
      return items.some(w => w.tmdb_id === String(result.tmdb_id))
    }
    return items.some(w => w.title.toLowerCase() === result.title.toLowerCase() && w.media_type === (result.type === 'tv' ? 'season' : result.type))
  }, [items])

  const handleAdd = useCallback(async (result: SearchResult) => {
    const mediaType: WishlistMediaType = result.type === 'tv' ? 'season' : 'movie'

    await addItem({
      title: result.title,
      year: result.year,
      tmdb_id: result.tmdb_id ? String(result.tmdb_id) : undefined,
      poster_url: result.poster_url,
      media_type: mediaType,
      reason: 'missing' as WishlistReason,
      priority: 3 as WishlistPriority,
      status: 'active' as WishlistStatus,
      // For TV shows, set series_title so wishlist completion can match episodes
      ...(result.type === 'tv' ? { series_title: result.title } : {}),
    })
    setAddedIds(prev => new Set(prev).add(result.id))
  }, [addItem])

  const typeIcon = (type: string) =>
    type === 'tv'
      ? <Tv className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      : <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

  const clearSearch = useCallback(() => {
    setQuery('')
    setResults([])
    setAddedIds(new Set())
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  if (isMobile) {
    // Mobile: pill-shaped search matching MobileSearchOverlay style
    return (
      <div>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/50 pointer-events-none z-10" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Add movies, TV shows..."
            className="w-full pl-12 pr-10 py-3.5 bg-muted/50 rounded-full text-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
            autoComplete="off"
          />
          {isSearching ? (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-muted-foreground" />
          ) : query && (
            <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {results.length > 0 && (
          <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-2xl border border-border/30 bg-card">
            {results.map((result) => {
              const alreadyAdded = addedIds.has(result.id) || isInWishlist(result)
              return (
                <div
                  key={result.id}
                  className="flex items-center gap-3 px-4 min-h-[56px] py-2 hover:bg-muted/30 transition-colors"
                >
                  {result.poster_url ? (
                    <img src={result.poster_url} alt="" className="w-10 h-14 object-cover rounded-lg shrink-0" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-10 h-14 bg-muted/50 rounded-lg flex items-center justify-center shrink-0">
                      {typeIcon(result.type)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-body font-medium truncate">{result.title}</div>
                    <div className="text-label text-muted-foreground flex items-center gap-1">
                      {typeIcon(result.type)}
                      <span>{result.type === 'tv' ? 'TV' : 'Movie'}</span>
                      {result.release_date && <span>· {new Date(result.release_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                      {!result.release_date && result.year && <span>· {result.year}</span>}
                    </div>
                    {result.physical_release_date && (
                      <div className="text-caption text-muted-foreground">Blu-ray/Digital: {new Date(result.physical_release_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    )}
                  </div>
                  {result.owned ? (
                    <span className="shrink-0 text-label text-muted-foreground/60 px-1.5">Owned</span>
                  ) : (
                    <button
                      onClick={() => handleAdd(result)}
                      disabled={alreadyAdded}
                      className={`shrink-0 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
                        alreadyAdded
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                      title={alreadyAdded ? 'Already in wishlist' : 'Add to wishlist'}
                    >
                      {alreadyAdded ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Desktop: compact panel search
  return (
    <div className="px-3 pt-2 pb-2 border-b border-border/30">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          inputSize="sm"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Add movies, TV shows..."
          className="pl-8 pr-8"
        />
        {isSearching ? (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
        ) : query && (
          <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-border/30 bg-background">
          {results.map((result) => {
            const alreadyAdded = addedIds.has(result.id) || isInWishlist(result)
            return (
              <div
                key={result.id}
                className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/30 transition-colors"
              >
                {result.poster_url ? (
                  <img src={result.poster_url} alt="" className="w-7 h-10 object-cover rounded shrink-0" loading="lazy" decoding="async" />
                ) : (
                  <div className="w-7 h-10 bg-muted/50 rounded flex items-center justify-center shrink-0">
                    {typeIcon(result.type)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-caption font-medium truncate">{result.title}</div>
                  <div className="text-caption text-muted-foreground flex items-center gap-1">
                    {typeIcon(result.type)}
                    <span>{result.type === 'tv' ? 'TV' : 'Movie'}</span>
                    {result.release_date && <span>· {new Date(result.release_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                    {!result.release_date && result.year && <span>· {result.year}</span>}
                  </div>
                  {result.physical_release_date && (
                    <div className="text-caption text-muted-foreground">Blu-ray/Digital: {new Date(result.physical_release_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  )}
                </div>
                {result.owned ? (
                  <span className="shrink-0 text-caption text-muted-foreground/60 px-1.5">Owned</span>
                ) : (
                  <button
                    onClick={() => handleAdd(result)}
                    disabled={alreadyAdded}
                    className={`shrink-0 p-1 rounded-lg transition-colors ${
                      alreadyAdded
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                    title={alreadyAdded ? 'Already in wishlist' : 'Add to wishlist'}
                  >
                    {alreadyAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export interface WishlistPanelProps {
  isOpen: boolean
  onClose: () => void
  isMobile?: boolean
  inline?: boolean
}

type SortOption = 'priority' | 'added_at' | 'title' | 'year' | 'completed_at'
type FilterType = WishlistMediaType | 'tv' | 'music' | 'all'
type CategoryType = WishlistReason | 'all'
type StatusType = WishlistStatus | 'all'

export function WishlistPanel({ isOpen, onClose, isMobile = false, inline = false }: WishlistPanelProps) {
  const {
    items,
    counts,
    isLoading,
    setFilters,
    removeItem,
    updateItem,
    markCompleted,
    markActive,
    addBulk,
    exportToCsv
  } = useWishlist()

  const [activeCategory, setActiveCategory] = useState<CategoryType>('all')
  const [activeStatus, setActiveStatus] = useState<StatusType>('active')
  const [isExporting, setIsExporting] = useState(false)
  const [showSyncSection, setShowSyncSection] = useState(false)

  // Sync state
  const [syncingPlex, setSyncingPlex] = useState(false)
  const [plexResult, setPlexResult] = useState<string | null>(null)
  const [hasPlexSource, setHasPlexSource] = useState(false)
  const [traktUser, setTraktUser] = useState('')
  const [syncingTrakt, setSyncingTrakt] = useState(false)
  const [traktResult, setTraktResult] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortOption>('priority')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)

  // Sync preview state
  type SyncPreviewItem = { title: string; media_type: string; year?: number; tmdb_id?: string; poster_url?: string }
  const [syncPreview, setSyncPreview] = useState<SyncPreviewItem[] | null>(null)
  const [syncPreviewSource, setSyncPreviewSource] = useState<'plex' | 'trakt' | null>(null)
  const [syncPreviewSelected, setSyncPreviewSelected] = useState<Set<number>>(new Set())
  const [syncPreviewAdding, setSyncPreviewAdding] = useState(false)

  // Auto-focus close button when panel opens + load saved usernames
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => closeButtonRef.current?.focus(), 100)
      window.electronAPI.getSetting(SETTING_KEYS.trakt_username)
        .then(val => { if (val) setTraktUser(val) })
        .catch(() => {})
      window.electronAPI.getSetting(SETTING_KEYS.plex_token)
        .then(val => setHasPlexSource(!!val))
        .catch(() => {})
    }
  }, [isOpen])

  // Handle Escape key to close panel
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [onClose])

  // Apply filters when changed
  useEffect(() => {
    setFilters({
      media_type: activeFilter === 'all' ? undefined : activeFilter,
      reason: activeCategory === 'all' ? undefined : activeCategory,
      status: activeStatus === 'all' ? undefined : activeStatus,
      sortBy,
      sortOrder
    })
  }, [activeCategory, activeStatus, activeFilter, sortBy, sortOrder, setFilters])

  const handleRemove = async (id: number) => {
    try {
      await removeItem(id)
    } catch (err) {
      console.error('Error removing item:', err)
    }
  }

  const handleUpdatePriority = async (id: number, priority: WishlistPriority) => {
    try {
      await updateItem(id, { priority })
    } catch (err) {
      console.error('Error updating priority:', err)
    }
  }

  const handleMarkCompleted = async (id: number) => {
    try {
      await markCompleted(id)
    } catch (err) {
      console.error('Error marking item as completed:', err)
    }
  }

  const handleMarkActive = async (id: number) => {
    try {
      await markActive(id)
    } catch (err) {
      console.error('Error marking item as active:', err)
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const result = await exportToCsv()
      if (result.success && result.path) {
        console.log(`Exported ${result.count} items to ${result.path}`)
      }
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  // Status tabs
  const statusOptions: { type: StatusType; icon: typeof Circle; label: string; count: number }[] = [
    { type: 'active', icon: Circle, label: 'Active', count: counts.active },
    { type: 'completed', icon: CheckCircle2, label: 'Completed', count: counts.completed }
  ]

  // Category options with counts
  const categoryOptions: { type: CategoryType; icon: typeof ListTodo; label: string; count: number }[] = [
    { type: 'all', icon: Filter, label: 'All', count: counts.total },
    { type: 'missing', icon: ListTodo, label: 'Missing', count: counts.missing },
    { type: 'upgrade', icon: CircleFadingArrowUp, label: 'Upgrade', count: counts.upgrade }
  ]

  // Media type filter options (no "All" — category row already has it)
  const filterOptions: { type: FilterType; icon: typeof Film; label: string }[] = [
    { type: 'movie', icon: Film, label: 'Movies' },
    { type: 'tv', icon: Tv, label: 'TV' },
    { type: 'music', icon: Music, label: 'Music' }
  ]

  // Group items by reason for display
  const missingItems = items.filter(item => item.reason === 'missing')
  const upgradeItems = items.filter(item => item.reason === 'upgrade')

  // Mobile inline mode — render as a full page, not a panel
  const isMobileInline = isMobile && inline

  return (
    <>
    {/* Backdrop scrim — hidden in inline mode */}
    {!inline && (
      <div
        className={`fixed inset-0 bg-black/40 z-[45] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
    )}
    <aside
      ref={panelRef}
      id="wishlist-panel"
      className={inline
        ? 'flex flex-col h-full overflow-hidden'
        : `fixed top-[76px] bottom-4 right-4 w-[22rem] bg-card border border-border rounded-2xl shadow-xl z-[46] slide-panel flex flex-col overflow-hidden transition-opacity duration-200 ease-out ${
            isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`
      }
      onKeyDown={handleKeyDown}
      role="complementary"
      aria-label="Shopping wishlist"
    >
      {/* Header — hidden on mobile inline (tab bar already identifies the page) */}
      {!isMobileInline && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-label font-semibold">
              Wishlist
            </h2>
            {counts.active > 0 && (
              <span className="px-1.5 py-0.5 text-caption font-medium bg-muted text-foreground rounded-full">
                {counts.active}
              </span>
            )}
          </div>
          {!inline && (
            <div className="flex items-center gap-1">
              <Button
                variant="tertiary"
                size="icon-sm"
                onClick={() => setShowSyncSection(!showSyncSection)}
                icon={<RefreshCw className="w-4 h-4" />}
                aria-label="Sync watchlists"
                title="Sync from Plex/Trakt"
              />
              {counts.total > 0 && (
                <Button
                  ref={exportButtonRef}
                  variant="tertiary"
                  size="icon-sm"
                  onClick={handleExport}
                  loading={isExporting}
                  icon={<Download className="w-4 h-4" />}
                  aria-label="Export wishlist to CSV"
                  title="Export to CSV"
                />
              )}
              <Button
                ref={closeButtonRef}
                variant="tertiary"
                size="icon-sm"
                onClick={onClose}
                icon={<X className="w-4 h-4" />}
                aria-label="Close wishlist panel"
              />
            </div>
          )}
        </div>
      )}

      {/* Sync sections — hidden in inline/mobile mode, toggled via header button */}
      {!inline && showSyncSection && <div className="px-3 pt-2 pb-1 border-b border-border/30 space-y-1.5">
        {/* Plex watchlist sync */}
        {hasPlexSource && (
          <div className="flex items-center gap-1.5">
            <span className="text-caption text-muted-foreground w-14 shrink-0">Plex</span>
            <span className="flex-1 text-caption text-muted-foreground/60">Plex Watchlist</span>
            <Button
              variant="tertiary"
              size="icon-sm"
              onClick={async () => {
                if (syncingPlex) return
                setSyncingPlex(true); setPlexResult(null)
                try {
                  const items = await window.electronAPI.fetchPlexWatchlist()
                  if (items.length === 0) { setPlexResult('Empty'); return }
                  setSyncPreview(items); setSyncPreviewSource('plex')
                  setSyncPreviewSelected(new Set(items.map((_item: unknown, i: number) => i)))
                } catch { setPlexResult('Error') }
                finally { setSyncingPlex(false) }
              }}
              disabled={syncingPlex}
              icon={syncingPlex ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> : <RefreshCw className="w-3 h-3 text-muted-foreground" />}
              title="Sync Plex watchlist"
              className="shrink-0"
            />
            {plexResult && <span className={`text-caption shrink-0 ${plexResult === 'Error' ? 'text-destructive' : 'text-foreground'}`}>{plexResult}</span>}
          </div>
        )}
        {/* Trakt sync */}
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-muted-foreground w-14 shrink-0">Trakt</span>
          <Input type="text" inputSize="sm" value={traktUser} onChange={e => setTraktUser(e.target.value)}
            onKeyDown={async e => {
              if (e.key === 'Enter' && traktUser.trim() && !syncingTrakt) {
                await window.electronAPI.setSetting(SETTING_KEYS.trakt_username, traktUser.trim())
                setSyncingTrakt(true); setTraktResult(null)
                try {
                  const items = await window.electronAPI.fetchTraktWatchlist(traktUser.trim())
                  if (items.length === 0) { setTraktResult('Empty'); return }
                  setSyncPreview(items); setSyncPreviewSource('trakt')
                  setSyncPreviewSelected(new Set(items.map((_item: unknown, i: number) => i)))
                } catch { setTraktResult('Error') }
                finally { setSyncingTrakt(false) }
              }
            }}
            placeholder="username"
            className="flex-1 min-w-0" />
          <Button
            variant="tertiary"
            size="icon-sm"
            onClick={async () => {
              if (!traktUser.trim() || syncingTrakt) return
              await window.electronAPI.setSetting(SETTING_KEYS.trakt_username, traktUser.trim())
              setSyncingTrakt(true); setTraktResult(null)
              try {
                const items = await window.electronAPI.fetchTraktWatchlist(traktUser.trim())
                if (items.length === 0) { setTraktResult('Empty'); return }
                setSyncPreview(items); setSyncPreviewSource('trakt')
                setSyncPreviewSelected(new Set(items.map((_item: unknown, i: number) => i)))
              } catch { setTraktResult('Error') }
              finally { setSyncingTrakt(false) }
            }}
            disabled={syncingTrakt || !traktUser.trim()}
            icon={syncingTrakt ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> : <RefreshCw className="w-3 h-3 text-muted-foreground" />}
            title="Sync Trakt watchlist"
            className="shrink-0"
          />
          {traktResult && <span className={`text-caption shrink-0 ${traktResult === 'Error' ? 'text-destructive' : 'text-foreground'}`}>{traktResult}</span>}
        </div>
      </div>}

      {/* Sync Preview — hidden in inline mode */}
      {!inline && syncPreview && (
        <div className="flex-1 flex flex-col min-h-0 border-b border-border/30">
          <div className="flex items-center justify-between px-3 py-2 shrink-0">
            <span className="text-caption font-medium">{syncPreview.length} from {syncPreviewSource === 'plex' ? 'Plex' : 'Trakt'}</span>
            <div className="flex items-center gap-2">
              <Button variant="tertiary" size="sm" onClick={() => setSyncPreviewSelected(new Set(syncPreview.map((_, i) => i)))}>All</Button>
              <Button variant="tertiary" size="sm" onClick={() => setSyncPreviewSelected(new Set())}>None</Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {syncPreview.map((item, i) => {
              const selected = syncPreviewSelected.has(i)
              return (
                <button key={`${item.tmdb_id || item.title}-${i}`}
                  onClick={() => setSyncPreviewSelected(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${selected ? 'hover:bg-muted/30' : 'opacity-40 hover:opacity-60'}`}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-primary border-primary' : 'border-border'}`}>
                    {selected && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  {item.poster_url ? (
                    <img src={item.poster_url} alt="" className="w-7 h-10 object-cover rounded shrink-0" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-7 h-10 bg-muted/50 rounded flex items-center justify-center shrink-0">
                      {item.media_type === 'season' ? <Tv className="w-3 h-3 text-muted-foreground" /> : <Film className="w-3 h-3 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-caption font-medium truncate">{item.title}</div>
                    <div className="text-caption text-muted-foreground">{item.media_type === 'season' ? 'TV' : 'Movie'}{item.year ? ` · ${item.year}` : ''}</div>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-t border-border/30">
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                setSyncPreviewAdding(true)
                try {
                  const selected = syncPreview.filter((_, i) => syncPreviewSelected.has(i))
                  const wishlistItems = selected.map(item => ({
                    title: item.title,
                    media_type: item.media_type as WishlistMediaType,
                    year: item.year,
                    tmdb_id: item.tmdb_id,
                    poster_url: item.poster_url,
                    reason: 'missing' as WishlistReason,
                    priority: 3 as WishlistPriority,
                    status: 'active' as WishlistStatus,
                    notes: `Imported from ${syncPreviewSource === 'plex' ? 'Plex' : 'Trakt'}`,
                  }))
                  await addBulk(wishlistItems)
                  const source = syncPreviewSource
                  setSyncPreview(null); setSyncPreviewSource(null)
                  if (source === 'plex') setPlexResult(`+${selected.length}`)
                  else setTraktResult(`+${selected.length}`)
                } catch { /* ignore */ }
                finally { setSyncPreviewAdding(false) }
              }}
              disabled={syncPreviewSelected.size === 0 || syncPreviewAdding}
              loading={syncPreviewAdding}
              className="flex-1"
            >
              {syncPreviewAdding ? 'Adding...' : `Add ${syncPreviewSelected.size} selected`}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => { setSyncPreview(null); setSyncPreviewSource(null) }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Controls — search + filters */}
      {isMobileInline ? (
        // Mobile page layout: search + wrapped filter rows
        <div className="shrink-0 px-4 py-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}>
          <WishlistSearch isMobile={isMobile} />
          {counts.total > 0 && (
            <div className="mt-3 space-y-2">
              {/* Row 1: Status + Sort */}
              <div className="flex items-center gap-2">
                {statusOptions.map(({ type, icon: Icon, label, count }) => (
                  <button
                    key={type}
                    onClick={() => { setActiveStatus(type); setActiveCategory('all'); setActiveFilter('all'); setSortBy(type === 'completed' ? 'completed_at' : 'priority') }}
                    className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-label rounded-lg transition-colors ${
                      activeStatus === type
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                    {count > 0 && <span className="opacity-60">({count})</span>}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1">
                  <Select
                    inputSize="sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="w-auto"
                  >
                    {(activeStatus === 'completed'
                      ? (['completed_at', 'added_at', 'title'] as SortOption[])
                      : (['priority', 'added_at', 'title'] as SortOption[])
                    ).map(field => (
                      <option key={field} value={field}>
                        {field === 'priority' ? 'Priority' : field === 'added_at' ? 'Added' : field === 'title' ? 'Title' : field === 'year' ? 'Year' : 'Completed'}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="tertiary"
                    size="icon-sm"
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    icon={<ArrowUpDown className="w-3 h-3" />}
                    title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                  />
                </div>
              </div>
              {/* Row 2: Category + Media type (only when active) */}
              {activeStatus !== 'completed' && (
                <div className="flex items-center gap-2">
                  {categoryOptions.filter(o => o.type !== 'all').map(({ type, icon: Icon, label }) => (
                    <button
                      key={type}
                      onClick={() => { setActiveCategory(activeCategory === type ? 'all' : type); if (type === 'all') setActiveFilter('all') }}
                      className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-label rounded-lg transition-colors ${
                        activeCategory === type
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{label}</span>
                    </button>
                  ))}
                  <div className="h-5 w-px bg-border/40" />
                  {filterOptions.map(({ type, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => setActiveFilter(activeFilter === type ? 'all' : type)}
                      className={`flex items-center justify-center p-2 min-h-[44px] min-w-[44px] rounded-lg transition-colors ${
                        activeFilter === type
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        // Desktop panel layout: search + stacked filter sections
        <>
          <WishlistSearch isMobile={isMobile} />

          {/* Status toggle — top level view selector */}
          {counts.total > 0 && (
            <div className="border-b border-border/30">
              {/* Row 1: Status + Sort */}
              <div className="px-3 py-2 flex items-center gap-1">
                {statusOptions.map(({ type, icon: Icon, label, count }) => (
                  <button
                    key={type}
                    onClick={() => { setActiveStatus(type); setActiveCategory('all'); setActiveFilter('all'); setSortBy(type === 'completed' ? 'completed_at' : 'priority') }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-caption rounded-lg transition-colors ${
                      activeStatus === type
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                    {count > 0 && <span className="opacity-60">({count})</span>}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1">
                  <Select
                    inputSize="sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="w-auto"
                  >
                    {(activeStatus === 'completed'
                      ? (['completed_at', 'added_at', 'title'] as SortOption[])
                      : (['priority', 'added_at', 'title'] as SortOption[])
                    ).map(field => (
                      <option key={field} value={field}>
                        {field === 'priority' ? 'Priority' : field === 'added_at' ? 'Added' : field === 'title' ? 'Title' : field === 'year' ? 'Year' : 'Completed'}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="tertiary"
                    size="icon-sm"
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    icon={<ArrowUpDown className="w-3 h-3" />}
                    title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                  />
                </div>
              </div>

              {/* Row 2: Category + media type filters */}
              {activeStatus !== 'completed' && (
                <div className="px-3 py-1.5 flex items-center gap-1">
                  {categoryOptions.filter(o => o.type !== 'all').map(({ type, icon: Icon, label }) => (
                    <button
                      key={type}
                      onClick={() => { setActiveCategory(activeCategory === type ? 'all' : type); if (type === 'all') setActiveFilter('all') }}
                      className={`flex items-center gap-1 px-2 py-1 text-caption rounded-lg transition-colors ${
                        activeCategory === type
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      title={label}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                  <div className="h-4 w-px bg-border/40 mx-0.5" />
                  {filterOptions.map(({ type, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => setActiveFilter(activeFilter === type ? 'all' : type)}
                      className={`flex items-center justify-center p-1 rounded-lg transition-colors ${
                        activeFilter === type
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${isMobileInline ? 'px-4 pb-24' : 'p-3'}`}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <WishlistEmptyState />
        ) : activeCategory === 'all' ? (
          // Show grouped by category when viewing all
          <div className="space-y-4">
            {/* Missing Section */}
            {missingItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <ListTodo className="w-3.5 h-3.5 text-muted-foreground" />
                  <h3 className="text-label font-medium text-muted-foreground">
                    Complete collection ({missingItems.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {missingItems.map((item) => (
                    <WishlistItemCard isMobile={isMobile}
                      key={item.id}
                      item={item}
                      onRemove={handleRemove}
                      onUpdatePriority={handleUpdatePriority}
                      onMarkCompleted={handleMarkCompleted}
                      onMarkActive={handleMarkActive}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Upgrade Section */}
            {upgradeItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <CircleFadingArrowUp className="w-3.5 h-3.5 text-muted-foreground" />
                  <h3 className="text-label font-medium text-muted-foreground">
                    Upgrade quality ({upgradeItems.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {upgradeItems.map((item) => (
                    <WishlistItemCard isMobile={isMobile}
                      key={item.id}
                      item={item}
                      onRemove={handleRemove}
                      onUpdatePriority={handleUpdatePriority}
                      onMarkCompleted={handleMarkCompleted}
                      onMarkActive={handleMarkActive}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Show flat list when filtered by category
          <div className="space-y-2">
            {items.map((item) => (
              <WishlistItemCard isMobile={isMobile}
                key={item.id}
                item={item}
                onRemove={handleRemove}
                onUpdatePriority={handleUpdatePriority}
                onMarkCompleted={handleMarkCompleted}
                onMarkActive={handleMarkActive}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
    </>
  )
}
