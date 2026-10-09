import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, X, Film, Tv, Music, User, Disc3 } from 'lucide-react'

interface SearchResults {
  movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
  tvShows: Array<{ id: number; title: string; poster_url?: string }>
  episodes: Array<{ id: number; title: string; series_title?: string; season_number?: number; episode_number?: number; poster_url?: string }>
  artists: Array<{ id: number; name: string; thumb_url?: string }>
  albums: Array<{ id: number; title: string; artist_name?: string; thumb_url?: string }>
  tracks: Array<{ id: number; title: string; artist_name?: string; album_id?: number; album_thumb_url?: string }>
}

interface MobileSearchOverlayProps {
  onClose: () => void
  onSelectMovie: (id: number) => void
  onSelectShow: (title: string) => void
  onSelectEpisode: (id: number) => void
  onSelectArtist: (id: number, name: string) => void
  onSelectAlbum: (id: number) => void
}

export function MobileSearchOverlay({
  onClose,
  onSelectMovie,
  onSelectShow,
  onSelectEpisode,
  onSelectArtist,
  onSelectAlbum,
}: MobileSearchOverlayProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number>(0)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null)
      return
    }
    setLoading(true)
    try {
      const res = await window.electronAPI.mediaSearch(q)
      setResults(res as SearchResults)
    } catch {
      setResults(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (value: string) => {
    setQuery(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => performSearch(value), 300)
  }

  useEffect(() => {
    return () => clearTimeout(debounceRef.current)
  }, [])

  const hasResults = results && (
    results.movies.length > 0 ||
    results.tvShows.length > 0 ||
    results.episodes.length > 0 ||
    results.artists.length > 0 ||
    results.albums.length > 0 ||
    results.tracks.length > 0
  )

  const showDropdown = query.trim().length > 0

  return (
    <>
      {/* Dimmed backdrop */}
      <div className="fixed inset-0 z-[58] bg-black/40 backdrop-blur-md" onClick={onClose} />

      {/* Floating search panel — fixed at top */}
      <div className="fixed left-4 right-4 z-[59] flex flex-col items-stretch" style={{ top: 'max(env(safe-area-inset-top, 0px), 16px)' }}>
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/50 z-10" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search all libraries..."
            className="w-full pl-12 pr-10 py-3.5 bg-white/10 border border-white/15 rounded-full text-base text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-white/25 shadow-2xl backdrop-blur-sm"
            autoComplete="off"
          />
          {query ? (
            <button onClick={() => { setQuery(''); setResults(null) }} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 p-1">
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={onClose} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 text-sm font-medium">
              Cancel
            </button>
          )}
        </div>

        {/* Results — matching glass style, below the search bar */}
        {showDropdown && (
          <div className="bg-white/10 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl mt-3 max-h-[70vh] overflow-y-auto overscroll-contain">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loading && !hasResults && (
              <div className="text-center py-8 text-sm text-muted-foreground">No results found</div>
            )}

            {!loading && hasResults && results && (
              <>
                {results.movies.length > 0 && (
                  <ResultSection icon={Film} label="Movies">
                    {results.movies.map((movie) => (
                      <ResultRow key={`movie-${movie.id}`} thumb={movie.poster_url} thumbIcon={Film} title={movie.title} subtitle={movie.year ? String(movie.year) : undefined} onClick={() => { onSelectMovie(movie.id); onClose() }} />
                    ))}
                  </ResultSection>
                )}

                {results.tvShows.length > 0 && (
                  <ResultSection icon={Tv} label="TV Shows">
                    {results.tvShows.map((show) => (
                      <ResultRow key={`tv-${show.id}`} thumb={show.poster_url} thumbIcon={Tv} title={show.title} onClick={() => { onSelectShow(show.title); onClose() }} />
                    ))}
                  </ResultSection>
                )}

                {results.episodes.length > 0 && (
                  <ResultSection icon={Tv} label="Episodes">
                    {results.episodes.map((ep) => (
                      <ResultRow key={`ep-${ep.id}`} thumb={ep.poster_url} thumbIcon={Tv} title={ep.title} subtitle={`${ep.series_title} · S${ep.season_number}E${ep.episode_number}`} onClick={() => { onSelectEpisode(ep.id); onClose() }} />
                    ))}
                  </ResultSection>
                )}

                {results.artists.length > 0 && (
                  <ResultSection icon={User} label="Artists">
                    {results.artists.map((artist) => (
                      <ResultRow key={`artist-${artist.id}`} thumb={artist.thumb_url} thumbIcon={User} thumbRound title={artist.name} onClick={() => { onSelectArtist(artist.id, artist.name); onClose() }} />
                    ))}
                  </ResultSection>
                )}

                {results.albums.length > 0 && (
                  <ResultSection icon={Disc3} label="Albums">
                    {results.albums.map((album) => (
                      <ResultRow key={`album-${album.id}`} thumb={album.thumb_url} thumbIcon={Disc3} title={album.title} subtitle={album.artist_name} onClick={() => { onSelectAlbum(album.id); onClose() }} />
                    ))}
                  </ResultSection>
                )}

                {results.tracks.length > 0 && (
                  <ResultSection icon={Music} label="Tracks">
                    {results.tracks.map((track) => (
                      <ResultRow key={`track-${track.id}`} thumb={track.album_thumb_url} thumbIcon={Music} title={track.title} subtitle={track.artist_name} onClick={() => { if (track.album_id) onSelectAlbum(track.album_id); onClose() }} />
                    ))}
                  </ResultSection>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function ResultSection({ icon: Icon, label, children }: { icon: typeof Film; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-4 py-2.5 text-xs font-bold text-white/90 uppercase tracking-wider bg-black/70 backdrop-blur-2xl flex items-center gap-2 sticky top-0 z-10 border-b border-white/10">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      {children}
    </div>
  )
}

function ResultRow({ thumb, thumbIcon: Icon, thumbRound, title, subtitle, onClick }: {
  thumb?: string
  thumbIcon: typeof Film
  thumbRound?: boolean
  title: string
  subtitle?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 min-h-[56px] py-2 text-left active:bg-white/5"
    >
      <div className={`${thumbRound ? 'w-12 h-12 rounded-full' : 'w-10 h-14 rounded-md'} bg-muted overflow-hidden shrink-0`}>
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Icon className="w-5 h-5 text-muted-foreground/50" /></div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium truncate">{title}</div>
        {subtitle && <div className="text-sm text-white/50 truncate">{subtitle}</div>}
      </div>
    </button>
  )
}
