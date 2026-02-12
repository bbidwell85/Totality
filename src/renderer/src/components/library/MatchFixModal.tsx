import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Search, Check, Star, Calendar, Loader2 } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface TMDBSearchResult {
  id: number
  name?: string  // TV show
  title?: string // Movie
  first_air_date?: string  // TV show
  release_date?: string    // Movie
  overview: string
  poster_url: string | null
  vote_average: number
}

interface MusicBrainzArtistResult {
  id: string
  name: string
  sort_name?: string
  country?: string
  disambiguation?: string
  score: number
}

interface MusicBrainzReleaseResult {
  id: string
  title: string
  artist_credit?: string
  date?: string
  country?: string
  score: number
}

type SearchResult = TMDBSearchResult | MusicBrainzArtistResult | MusicBrainzReleaseResult

interface MatchFixModalProps {
  isOpen: boolean
  onClose: () => void
  type: 'series' | 'movie' | 'artist' | 'album'
  currentTitle: string
  currentYear?: number
  filePath?: string    // File path for context
  artistName?: string  // For album searches
  sourceId?: string    // For series
  mediaItemId?: number // For movies
  artistId?: number    // For artists
  albumId?: number     // For albums
  onMatchFixed?: () => void
}

export function MatchFixModal({
  isOpen,
  onClose,
  type,
  currentTitle,
  currentYear: _currentYear,
  filePath,
  artistName,
  sourceId,
  mediaItemId,
  artistId,
  albumId,
  onMatchFixed,
}: MatchFixModalProps) {
  const [searchQuery, setSearchQuery] = useState(currentTitle)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isFixing, setIsFixing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Focus trap
  useFocusTrap(isOpen, modalRef)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery(currentTitle)
      setSearchResults([])
      setSelectedResult(null)
      setError(null)
    }
  }, [isOpen, currentTitle])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return

    console.log('[MatchFixModal] Searching for:', searchQuery, 'type:', type)
    setIsSearching(true)
    setError(null)
    setSearchResults([])

    try {
      let results: SearchResult[] = []

      switch (type) {
        case 'series':
          results = await window.electronAPI.seriesSearchTMDB(searchQuery)
          break
        case 'movie':
          // Don't filter by year - let users see all results and select the correct one
          results = await window.electronAPI.movieSearchTMDB(searchQuery)
          break
        case 'artist':
          results = await window.electronAPI.musicSearchMusicBrainzArtist(searchQuery) as MusicBrainzArtistResult[]
          break
        case 'album':
          if (artistName) {
            results = await window.electronAPI.musicSearchMusicBrainzRelease(artistName, searchQuery) as MusicBrainzReleaseResult[]
          }
          break
      }

      console.log('[MatchFixModal] Got results:', results.length, results)
      setSearchResults(results)
    } catch (err: unknown) {
      console.error('[MatchFixModal] Search error:', err)
      setError((err as Error).message || 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }, [searchQuery, type, artistName])

  const handleFixMatch = useCallback(async () => {
    if (!selectedResult) return

    setIsFixing(true)
    setError(null)

    try {
      switch (type) {
        case 'series':
          if (sourceId) {
            await window.electronAPI.seriesFixMatch(
              currentTitle,
              sourceId,
              (selectedResult as TMDBSearchResult).id
            )
          }
          break
        case 'movie':
          if (mediaItemId !== undefined) {
            await window.electronAPI.movieFixMatch(
              mediaItemId,
              (selectedResult as TMDBSearchResult).id
            )
          }
          break
        case 'artist':
          if (artistId !== undefined) {
            await window.electronAPI.musicFixArtistMatch(
              artistId,
              (selectedResult as MusicBrainzArtistResult).id
            )
          }
          break
        case 'album':
          if (albumId !== undefined) {
            await window.electronAPI.musicFixAlbumMatch(
              albumId,
              (selectedResult as MusicBrainzReleaseResult).id
            )
          }
          break
      }

      onMatchFixed?.()
      onClose()
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to fix match')
    } finally {
      setIsFixing(false)
    }
  }, [selectedResult, type, currentTitle, sourceId, mediaItemId, artistId, albumId, onMatchFixed, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && !isSearching) {
      handleSearch()
    }
  }

  const getTypeLabel = () => {
    switch (type) {
      case 'series': return 'TV Show'
      case 'movie': return 'Movie'
      case 'artist': return 'Artist'
      case 'album': return 'Album'
    }
  }

  const getResultTitle = (result: SearchResult): string => {
    if ('name' in result && result.name) return result.name
    if ('title' in result && result.title) return result.title
    return 'Unknown'
  }

  const getResultYear = (result: SearchResult): string | null => {
    if ('first_air_date' in result && result.first_air_date) {
      return result.first_air_date.split('-')[0]
    }
    if ('release_date' in result && result.release_date) {
      return result.release_date.split('-')[0]
    }
    if ('date' in result && result.date) {
      return result.date.split('-')[0]
    }
    return null
  }

  const getResultScore = (result: SearchResult): number => {
    if ('vote_average' in result) return result.vote_average
    if ('score' in result) return result.score / 10 // MusicBrainz score is 0-100
    return 0
  }

  const getResultPoster = (result: SearchResult): string | null => {
    if ('poster_url' in result) return result.poster_url
    return null
  }

  const getResultSubtitle = (result: SearchResult): string | null => {
    if ('disambiguation' in result && result.disambiguation) {
      return result.disambiguation
    }
    if ('country' in result && result.country) {
      return result.country
    }
    if ('artist_credit' in result && result.artist_credit) {
      return result.artist_credit
    }
    return null
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <div className="min-w-0 flex-1 mr-4">
            <h2 className="text-lg font-semibold">Fix {getTypeLabel()} Match</h2>
            <p className="text-sm text-muted-foreground">
              Current: <span className="text-foreground">{currentTitle}</span>
            </p>
            {filePath && (
              <p className="text-xs text-muted-foreground/70 truncate mt-1" title={filePath}>
                {filePath}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-border/30">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search for ${getTypeLabel().toLowerCase()}...`}
                className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Search
            </button>
          </div>

          {error && (
            <p className="mt-2 text-sm text-red-500">{error}</p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {searchResults.length === 0 && !isSearching && (
            <div className="text-center text-muted-foreground py-8">
              {searchQuery ? 'No results found. Try a different search.' : 'Enter a search query to find matches.'}
            </div>
          )}

          <div className="space-y-2">
            {searchResults.map((result, index) => {
              const isSelected = selectedResult === result
              const title = getResultTitle(result)
              const year = getResultYear(result)
              const score = getResultScore(result)
              const poster = getResultPoster(result)
              const subtitle = getResultSubtitle(result)

              return (
                <button
                  key={index}
                  onClick={() => setSelectedResult(result)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors ${
                    isSelected
                      ? 'bg-primary/20 border-2 border-primary'
                      : 'bg-muted/30 hover:bg-muted/50 border-2 border-transparent'
                  }`}
                >
                  {/* Poster/Thumbnail */}
                  <div className="w-12 h-16 flex-shrink-0 bg-muted rounded overflow-hidden">
                    {poster ? (
                      <img
                        src={poster}
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        No Image
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium truncate">{title}</div>
                      {isSelected && (
                        <Check className="w-5 h-5 text-primary flex-shrink-0" />
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      {year && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {year}
                        </span>
                      )}
                      {score > 0 && (
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-500" />
                          {score.toFixed(1)}
                        </span>
                      )}
                      {subtitle && (
                        <span className="truncate">{subtitle}</span>
                      )}
                    </div>

                    {'overview' in result && result.overview && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {result.overview}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border/30">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleFixMatch}
            disabled={!selectedResult || isFixing}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isFixing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Apply Match
          </button>
        </div>
      </div>
    </div>
  )
}
