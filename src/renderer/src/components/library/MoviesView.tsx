import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { Layers, RefreshCw, MoreVertical, Pencil, CircleFadingArrowUp, EyeOff } from 'lucide-react'
import { QualityBadges } from './QualityBadges'
import { MoviePlaceholder } from '../ui/MediaPlaceholders'
import { useMenuClose } from '../../hooks/useMenuClose'
import { providerColors } from './mediaUtils'
import type { MediaItem, MovieCollectionData } from './types'

// Display item type for grouped movies view
type MovieDisplayItem =
  | { type: 'collection'; collection: MovieCollectionData }
  | { type: 'movie'; movie: MediaItem }

export function MoviesView({
  movies,
  onSelectMovie,
  onSelectCollection,
  viewType,
  gridScale,
  getCollectionForMovie,
  movieCollections,
  showSourceBadge,
  onFixMatch,
  onRescan,
  onDismissUpgrade,
  totalMovieCount,
  moviesLoading,
  onLoadMoreMovies,
  collectionsOnly = false
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
  onDismissUpgrade?: (movie: MediaItem) => void
  totalMovieCount: number
  moviesLoading: boolean
  onLoadMoreMovies: () => void
  collectionsOnly?: boolean
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

  const movieSentinelRef = useRef<HTMLDivElement>(null)

  // IntersectionObserver for movie grid infinite scroll
  useEffect(() => {
    if (!movieSentinelRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMoreMovies()
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(movieSentinelRef.current)
    return () => observer.disconnect()
  }, [onLoadMoreMovies])

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

    // Add individual movies not in any collection (unless collections-only filter is active)
    if (!collectionsOnly) {
      for (const movie of movies) {
        if (!moviesInCollections.has(movie.id)) {
          items.push({ type: 'movie', movie })
        }
      }
    }

    // Sort all items alphabetically together (collections and movies interleaved)
    items.sort((a, b) => {
      const titleA = a.type === 'collection' ? a.collection.collection_name : a.movie.title
      const titleB = b.type === 'collection' ? b.collection.collection_name : b.movie.title
      return titleA.localeCompare(titleB)
    })

    return items
  }, [movies, movieCollections, getCollectionForMovie, collectionsOnly])

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

  const statsBar = (
    <div className="flex items-center gap-6 text-sm text-muted-foreground">
      <span>{totalMovieCount.toLocaleString()} Movies</span>
    </div>
  )

  if (viewType === 'list') {
    return (
      <div>
        {statsBar}
        <div className="space-y-2 mt-4">
          {displayItems.map((item) => {
            if (item.type === 'collection') {
              return (
                <CollectionListItem
                  key={`collection-${item.collection.id}`}
                  collection={item.collection}
                  onClick={() => onSelectCollection(item.collection)}
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
                onDismissUpgrade={onDismissUpgrade}
                             />
            )
          })}
        </div>
        <div ref={movieSentinelRef} className="h-1" />
        <div className="px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
          {moviesLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
          <span>
            {movies.length === totalMovieCount
              ? `${totalMovieCount.toLocaleString()} movies`
              : `${movies.length.toLocaleString()} of ${totalMovieCount.toLocaleString()} movies`}
          </span>
        </div>
      </div>
    )
  }

  // Grid view using standard grid (VirtualizedGrid doesn't support mixed item types well)
  return (
    <div>
      {statsBar}
      <div
        className="grid gap-8 mt-4"
        style={{
          gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)`
        }}
      >
        {displayItems.map((item) => {
          if (item.type === 'collection') {
            return (
              <CollectionCard
                key={`collection-${item.collection.id}`}
                collection={item.collection}
                onClick={() => onSelectCollection(item.collection)}
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
              onDismissUpgrade={onDismissUpgrade}
                         />
          )
        })}
      </div>
      <div ref={movieSentinelRef} className="h-1" />
      <div className="px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
        {moviesLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
        <span>
          {movies.length === totalMovieCount
            ? `${totalMovieCount.toLocaleString()} movies`
            : `${movies.length.toLocaleString()} of ${totalMovieCount.toLocaleString()} movies`}
        </span>
      </div>
    </div>
  )
}

// Collection card for grid view
const CollectionCard = memo(({ collection, onClick }: { collection: MovieCollectionData; onClick: () => void }) => {
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only cursor-pointer hover-scale outline-none"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster */}
      <div className="aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
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
         prevProps.collection.poster_url === nextProps.collection.poster_url
})

// Collection list item for list view
function CollectionListItem({ collection, onClick }: { collection: MovieCollectionData; onClick: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-none"
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

const MovieCard = memo(({ movie, onClick, collectionData, showSourceBadge, onFixMatch, onRescan, onDismissUpgrade }: { movie: MediaItem; onClick: () => void; collectionData?: MovieCollectionData; showSourceBadge?: boolean; onFixMatch?: (mediaItemId: number) => void; onRescan?: (mediaItemId: number) => Promise<void>; onDismissUpgrade?: (movie: MediaItem) => void }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

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

  const handleDismissUpgrade = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onDismissUpgrade) {
      onDismissUpgrade(movie)
    }
  }

  const needsUpgrade = movie.tier_quality === 'LOW' || !!movie.needs_upgrade
  const showMenuButton = onFixMatch || onRescan || (onDismissUpgrade && needsUpgrade)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only group cursor-pointer hover-scale outline-none"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster */}
      <div className="aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {/* 3-dot menu button */}
        {showMenuButton && (
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
                {onDismissUpgrade && needsUpgrade && (
                  <button
                    onClick={handleDismissUpgrade}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    Dismiss Upgrade
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Version Count Badge */}
        {movie.version_count && movie.version_count > 1 && (
          <div
            className="absolute top-2 right-2 z-10 bg-primary text-primary-foreground text-[0.625rem] font-bold px-1.5 py-0.5 rounded shadow-md"
            title={`${movie.version_count} versions available`}
          >
            {movie.version_count}x
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
         prevProps.movie.version_count === nextProps.movie.version_count &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.collectionData?.id === nextProps.collectionData?.id &&
         prevProps.collectionData?.completeness_percentage === nextProps.collectionData?.completeness_percentage
})

const MovieListItem = memo(({ movie, onClick, showSourceBadge, collectionData, onFixMatch, onRescan, onDismissUpgrade }: { movie: MediaItem; onClick: () => void; showSourceBadge?: boolean; collectionData?: MovieCollectionData; onFixMatch?: (mediaItemId: number) => void; onRescan?: (mediaItemId: number) => Promise<void>; onDismissUpgrade?: (movie: MediaItem) => void }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })
  const needsUpgrade = movie.tier_quality === 'LOW' || !!movie.needs_upgrade

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

  const handleDismissUpgrade = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onDismissUpgrade) {
      onDismissUpgrade(movie)
    }
  }

  const showMenuButton = onFixMatch || onRescan || (onDismissUpgrade && needsUpgrade)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-none"
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
        {showMenuButton && (
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
                {onDismissUpgrade && needsUpgrade && (
                  <button
                    onClick={handleDismissUpgrade}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    Dismiss Upgrade
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
          {movie.version_count && movie.version_count > 1 && ` • ${movie.version_count} versions`}
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
         prevProps.movie.version_count === nextProps.movie.version_count &&
         prevProps.showSourceBadge === nextProps.showSourceBadge
})
