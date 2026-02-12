import { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react'
import { X, CircleFadingArrowUp, EyeOff } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { MissingItemPopup } from './MissingItemPopup'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'

interface MissingMovie {
  tmdb_id: string
  title: string
  year?: number
  poster_path?: string
}

interface MovieCollectionData {
  id: number
  tmdb_collection_id: string
  collection_name: string
  total_movies: number
  owned_movies: number
  missing_movies: string // JSON array
  owned_movie_ids: string // JSON array
  completeness_percentage: number
  poster_url?: string
}

interface OwnedMovie {
  id: number
  title: string
  year?: number
  poster_url?: string
  tmdb_id?: string
  needs_upgrade?: boolean
  tier_quality?: string
}

interface CollectionModalProps {
  collection: MovieCollectionData
  ownedMovies: OwnedMovie[]
  onClose: () => void
  onMovieClick: (movieId: number) => void
  onDismissCollectionMovie?: (tmdbId: string, movieTitle: string) => void
}

export const CollectionModal = memo(function CollectionModal({
  collection,
  ownedMovies,
  onClose,
  onMovieClick,
  onDismissCollectionMovie
}: CollectionModalProps) {
  const [selectedMissing, setSelectedMissing] = useState<MissingMovie | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Focus trap
  useFocusTrap(true, modalRef)

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Parse missing movies from JSON
  const missingMovies = useMemo<MissingMovie[]>(() => {
    try {
      return JSON.parse(collection.missing_movies || '[]')
    } catch {
      return []
    }
  }, [collection.missing_movies])

  // Create a Set for O(1) lookup of missing movie tmdb_ids
  const missingMovieMap = useMemo(() => {
    const map = new Map<string, MissingMovie>()
    missingMovies.forEach(m => map.set(m.tmdb_id, m))
    return map
  }, [missingMovies])

  // Memoized click handler to avoid creating new functions on each render
  const handleMovieItemClick = useCallback((movie: {
    type: 'owned' | 'missing'
    id: number | null
    tmdb_id?: string
  }) => {
    if (movie.type === 'owned' && movie.id) {
      onMovieClick(movie.id)
    } else if (movie.type === 'missing' && movie.tmdb_id) {
      const missingMovie = missingMovieMap.get(movie.tmdb_id)
      if (missingMovie) setSelectedMissing(missingMovie)
    }
  }, [onMovieClick, missingMovieMap])


  // Build combined list of all movies (owned + missing), sorted by year
  const allMovies = useMemo(() => {
    const owned = ownedMovies.map(m => ({
      type: 'owned' as const,
      id: m.id,
      tmdb_id: m.tmdb_id,
      title: m.title,
      year: m.year,
      poster_url: m.poster_url,
      needs_upgrade: m.needs_upgrade || m.tier_quality === 'LOW'
    }))

    const missing = missingMovies.map(m => ({
      type: 'missing' as const,
      id: null,
      tmdb_id: m.tmdb_id,
      title: m.title,
      year: m.year,
      poster_url: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : undefined,
      needs_upgrade: false
    }))

    return [...owned, ...missing].sort((a, b) => (a.year || 0) - (b.year || 0))
  }, [ownedMovies, missingMovies])

  return (
    <>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/70"
          onClick={onClose}
        />

        {/* Modal */}
        <div ref={modalRef} className="relative bg-card border border-border rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-lg flex-shrink-0">
            <div>
              <h2 className="text-xl font-semibold">{collection.collection_name}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {collection.owned_movies} of {collection.total_movies} movies owned
                <span className="mx-2">•</span>
                <span className={collection.completeness_percentage === 100 ? 'text-green-500' : 'text-orange-500'}>
                  {Math.round(collection.completeness_percentage)}% complete
                </span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
              {allMovies.map((movie) => (
                <div
                  key={`${movie.type}-${movie.tmdb_id}`}
                  className="cursor-pointer hover-scale"
                  onClick={() => handleMovieItemClick(movie)}
                >
                  <div className="aspect-[2/3] bg-muted relative overflow-hidden rounded-md">
                    {/* Poster */}
                    {movie.poster_url ? (
                      <img
                        src={movie.poster_url}
                        alt={movie.title}
                        loading="lazy"
                        className={`w-full h-full object-cover ${
                          movie.type === 'missing' ? 'grayscale opacity-60' : ''
                        }`}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center text-4xl ${
                        movie.type === 'missing' ? 'grayscale opacity-60' : ''
                      }`}>
                        🎬
                      </div>
                    )}
                  </div>

                  {/* Title, year, and action icons below poster */}
                  <div className="mt-1.5 flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-medium text-sm truncate">{movie.title}</h4>
                      {movie.year && <p className="text-xs text-muted-foreground">{movie.year}</p>}
                    </div>
                    {movie.type === 'missing' && (
                      <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0 flex items-center gap-1">
                        {onDismissCollectionMovie && movie.tmdb_id && (
                          <button
                            onClick={() => onDismissCollectionMovie(movie.tmdb_id!, movie.title)}
                            className="w-7 h-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                            title="Dismiss"
                          >
                            <EyeOff className="w-4 h-4" />
                          </button>
                        )}
                        <AddToWishlistButton
                          mediaType="movie"
                          title={movie.title}
                          year={movie.year}
                          tmdbId={movie.tmdb_id}
                          posterUrl={movie.poster_url}
                          collectionName={collection.collection_name}
                          reason="missing"
                          compact
                        />
                      </div>
                    )}
                    {movie.type === 'owned' && movie.needs_upgrade && (
                      <div className="flex-shrink-0 mt-0.5" title="Needs upgrade">
                        <CircleFadingArrowUp className="w-5 h-5 text-orange-500" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Missing item popup */}
      {selectedMissing && (
        <MissingItemPopup
          type="movie"
          title={selectedMissing.title}
          year={selectedMissing.year}
          tmdbId={selectedMissing.tmdb_id}
          posterUrl={selectedMissing.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMissing.poster_path}` : undefined}
          onClose={() => setSelectedMissing(null)}
          onDismiss={onDismissCollectionMovie ? () => {
            onDismissCollectionMovie(selectedMissing.tmdb_id, selectedMissing.title)
            setSelectedMissing(null)
          } : undefined}
        />
      )}
    </>
  )
})
