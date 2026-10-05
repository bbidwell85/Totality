import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Filter, ArrowUpDown, Film, Tv, Music, Loader2, ListTodo, CircleFadingArrowUp, Download, CheckCircle2, Circle, RefreshCw, Search, Plus, Check, Star } from 'lucide-react'
import { useWishlist, WishlistMediaType, WishlistPriority, WishlistReason, WishlistStatus } from '../../contexts/WishlistContext'
import { WishlistItemCard } from './WishlistItemCard'
import { WishlistEmptyState } from './WishlistEmptyState'
import { SETTING_KEYS } from '../../../../shared/settingKeys'

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

function WishlistSearch() {
  const { addItem, items } = useWishlist()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setIsSearching(true)
    try {
      const [movies, tvShows, local] = await Promise.all([
        window.electronAPI.movieSearchTMDB(q).catch(() => []),
        window.electronAPI.seriesSearchTMDB(q).catch(() => []),
        window.electronAPI.mediaSearch(q).catch(() => ({ movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] })),
      ])

      // Build sets of owned titles for ownership tagging
      const ownedMovieTitles = new Set(local.movies.map(m => m.title.toLowerCase()))
      const ownedTVTitles = new Set(local.tvShows.map(s => s.title.toLowerCase()))

      const combined: SearchResult[] = []

      for (const m of (movies as Array<{ id: number; title: string; release_date: string; physical_release_date: string | null; poster_url: string | null }>).slice(0, 5)) {
        combined.push({
          id: `movie-${m.id}`,
          title: m.title,
          year: m.release_date ? parseInt(m.release_date.substring(0, 4)) : undefined,
          type: 'movie',
          poster_url: m.poster_url || undefined,
          tmdb_id: m.id,
          owned: ownedMovieTitles.has(m.title.toLowerCase()),
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
          owned: ownedTVTitles.has(s.name.toLowerCase()),
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

  return (
    <div className="px-3 pt-2 pb-2 border-b border-border/30">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Search movies, TV shows..."
          className="w-full pl-8 pr-8 py-1.5 bg-background border border-border/30 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
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
                  <img src={result.poster_url} alt="" className="w-7 h-10 object-cover rounded shrink-0" />
                ) : (
                  <div className="w-7 h-10 bg-muted/50 rounded flex items-center justify-center shrink-0">
                    {typeIcon(result.type)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{result.title}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {typeIcon(result.type)}
                    <span>{result.type === 'tv' ? 'TV' : 'Movie'}</span>
                    {result.release_date && <span>· {new Date(result.release_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                    {!result.release_date && result.year && <span>· {result.year}</span>}
                  </div>
                  {result.physical_release_date && (
                    <div className="text-[10px] text-primary/70">Blu-ray/Digital: {new Date(result.physical_release_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  )}
                </div>
                {result.owned ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground/60 px-1.5">Owned</span>
                ) : (
                  <button
                    onClick={() => handleAdd(result)}
                    disabled={alreadyAdded}
                    className={`shrink-0 p-1 rounded transition-colors ${
                      alreadyAdded
                        ? 'text-green-500'
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
}

type SortOption = 'priority' | 'added_at' | 'title' | 'year' | 'completed_at'
type FilterType = WishlistMediaType | 'all'
type CategoryType = WishlistReason | 'all'
type StatusType = WishlistStatus | 'all'

export function WishlistPanel({ isOpen, onClose }: WishlistPanelProps) {
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
      sortBy: activeStatus === 'completed' && sortBy === 'priority' ? 'completed_at' : sortBy,
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

  const toggleSort = (field: SortOption) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder(field === 'priority' ? 'desc' : 'asc')
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
    { type: 'episode', icon: Tv, label: 'TV' },
    { type: 'album', icon: Music, label: 'Music' }
  ]

  // Group items by reason for display
  const missingItems = items.filter(item => item.reason === 'missing')
  const upgradeItems = items.filter(item => item.reason === 'upgrade')

  return (
    <>
    <div
      className={`fixed inset-0 bg-black/40 z-[45] transition-opacity duration-300 ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={onClose}
    />
    <aside
      ref={panelRef}
      id="wishlist-panel"
      className={`fixed top-[76px] bottom-4 right-4 w-80 bg-sidebar-gradient rounded-2xl shadow-xl z-[46] flex flex-col overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-[transform,opacity] ${
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
      }`}
      onKeyDown={handleKeyDown}
      role="complementary"
      aria-label="Shopping wishlist"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            Wishlist
          </h2>
          {counts.total > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">
              {counts.total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {counts.total > 0 && (
            <button
              ref={exportButtonRef}
              onClick={handleExport}
              disabled={isExporting}
              className="p-1.5 rounded-md hover:bg-muted transition-colors focus:outline-hidden disabled:opacity-50"
              aria-label="Export wishlist to CSV"
              title="Export to CSV"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <Download className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          )}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary"
            aria-label="Close wishlist panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sync sections */}
      <div className="px-3 pt-2 pb-1 border-b border-border/30 space-y-1.5">
        {/* Plex watchlist sync */}
        {hasPlexSource && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground w-14 shrink-0">Plex</span>
            <span className="flex-1 text-[11px] text-muted-foreground/60">Plex Watchlist</span>
            <button onClick={async () => {
              if (syncingPlex) return
              setSyncingPlex(true); setPlexResult(null)
              try {
                const items = await window.electronAPI.fetchPlexWatchlist()
                if (items.length === 0) { setPlexResult('Empty'); return }
                setSyncPreview(items); setSyncPreviewSource('plex')
                setSyncPreviewSelected(new Set(items.map((_item: unknown, i: number) => i)))
              } catch { setPlexResult('Error') }
              finally { setSyncingPlex(false) }
            }} disabled={syncingPlex}
              className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50 shrink-0" title="Sync Plex watchlist">
              {syncingPlex ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> : <RefreshCw className="w-3 h-3 text-muted-foreground" />}
            </button>
            {plexResult && <span className={`text-[10px] shrink-0 ${plexResult === 'Error' ? 'text-destructive' : 'text-primary'}`}>{plexResult}</span>}
          </div>
        )}
        {/* Trakt sync */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground w-14 shrink-0">Trakt</span>
          <input type="text" value={traktUser} onChange={e => setTraktUser(e.target.value)}
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
            className="flex-1 px-2 py-1 bg-background border border-border/30 rounded text-[11px] focus:outline-hidden focus:ring-1 focus:ring-primary min-w-0" />
          <button onClick={async () => {
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
          }} disabled={syncingTrakt || !traktUser.trim()}
            className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50 shrink-0" title="Sync Trakt watchlist">
            {syncingTrakt ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> : <RefreshCw className="w-3 h-3 text-muted-foreground" />}
          </button>
          {traktResult && <span className={`text-[10px] shrink-0 ${traktResult === 'Error' ? 'text-destructive' : 'text-primary'}`}>{traktResult}</span>}
        </div>
      </div>

      {/* Sync Preview */}
      {syncPreview && (
        <div className="flex-1 flex flex-col min-h-0 border-b border-border/30">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/20 shrink-0">
            <span className="text-xs font-medium">{syncPreview.length} from {syncPreviewSource === 'plex' ? 'Plex' : 'Trakt'}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSyncPreviewSelected(new Set(syncPreview.map((_, i) => i)))}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">All</button>
              <button onClick={() => setSyncPreviewSelected(new Set())}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">None</button>
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
                    <img src={item.poster_url} alt="" className="w-7 h-10 object-cover rounded shrink-0" />
                  ) : (
                    <div className="w-7 h-10 bg-muted/50 rounded flex items-center justify-center shrink-0">
                      {item.media_type === 'season' ? <Tv className="w-3 h-3 text-muted-foreground" /> : <Film className="w-3 h-3 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{item.title}</div>
                    <div className="text-[10px] text-muted-foreground">{item.media_type === 'season' ? 'TV' : 'Movie'}{item.year ? ` · ${item.year}` : ''}</div>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-t border-border/30">
            <button
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
              className="flex-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {syncPreviewAdding ? 'Adding...' : `Add ${syncPreviewSelected.size} Selected`}
            </button>
            <button
              onClick={() => { setSyncPreview(null); setSyncPreviewSource(null) }}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search to add */}
      <WishlistSearch />

      {/* Status Tabs (Active / Completed) */}
      {counts.total > 0 && (
        <div className="px-3 pt-3 pb-2 border-b border-border/30">
          <div className="flex gap-1">
            {statusOptions.map(({ type, icon: Icon, label, count }) => (
              <button
                key={type}
                onClick={() => setActiveStatus(type)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs rounded-lg transition-colors ${
                  activeStatus === type
                    ? type === 'completed' ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground'
                    : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
                {count > 0 && (
                  <span className={`text-xs ${activeStatus === type ? 'opacity-80' : 'text-muted-foreground/60'}`}>
                    ({count})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Combined filter row: Category + Media type */}
      {counts.total > 0 && activeStatus !== 'completed' && (
        <div className="px-3 pt-2 pb-2 border-b border-border/30 space-y-1.5">
          {/* Category pills */}
          <div className="flex gap-1">
            {categoryOptions.map(({ type, icon: Icon, label, count }) => (
              <button
                key={type}
                onClick={() => { setActiveCategory(type); if (type === 'all') setActiveFilter('all') }}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full transition-colors ${
                  activeCategory === type
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted/20 text-muted-foreground hover:bg-muted/30'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
                {count > 0 && (
                  <span className={`text-xs ${activeCategory === type ? 'text-primary/80' : 'text-muted-foreground/60'}`}>
                    ({count})
                  </span>
                )}
              </button>
            ))}
            <span className="text-border/60 self-center mx-0.5">·</span>
            {/* Media type pills inline */}
            {filterOptions.map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => setActiveFilter(activeFilter === type ? 'all' : type)}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full transition-colors ${
                  activeFilter === type
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters & Sort */}
      {counts.total > 0 && (
        <div className="p-3 border-b border-border/30">

          {/* Sort options */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            <div className="flex gap-1">
              {(['priority', 'added_at', 'title'] as SortOption[]).map((field) => (
                <button
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                    sortBy === field
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {field === 'priority' ? 'Priority' : field === 'added_at' ? 'Date' : 'Title'}
                  {sortBy === field && (
                    <ArrowUpDown className={`w-3 h-3 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
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
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Complete Collection ({missingItems.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {missingItems.map((item) => (
                    <WishlistItemCard
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
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Upgrade Quality ({upgradeItems.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {upgradeItems.map((item) => (
                    <WishlistItemCard
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
              <WishlistItemCard
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
