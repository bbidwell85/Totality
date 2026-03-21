import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, EyeOff, Copy, Check } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'

// Helper function to format season label (Season 0 = Specials)
const formatSeasonLabel = (seasonNumber: number): string => {
  return seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`
}

interface SeasonDetails {
  overview: string | null
  episodeCount: number
  airDate: string | null
  name: string | null
}

interface MissingItemPopupProps {
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
  onClose: () => void
  onDismiss?: () => void
}

export function MissingItemPopup({
  type,
  title,
  year,
  airDate,
  seasonNumber,
  episodeNumber,
  posterUrl,
  tmdbId,
  imdbId,
  seriesTitle,
  onClose,
  onDismiss
}: MissingItemPopupProps) {
  const [seasonDetails, setSeasonDetails] = useState<SeasonDetails | null>(null)
  const [movieOverview, setMovieOverview] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Fetch details from TMDB when popup opens
  useEffect(() => {
    if (type === 'season' && tmdbId && seasonNumber !== undefined) {
      window.electronAPI.seriesGetSeasonDetails(tmdbId, seasonNumber)
        .then(details => { if (details) setSeasonDetails(details) })
        .catch(() => { /* ignore */ })
    } else if (type === 'movie' && tmdbId) {
      window.electronAPI.tmdbGetMovieDetails(tmdbId)
        .then(details => { if (details?.overview) setMovieOverview(details.overview) })
        .catch(() => { /* ignore */ })
    }
  }, [type, tmdbId, seasonNumber])

  // Format the subtitle based on type
  const getSubtitle = () => {
    if (type === 'episode' && seasonNumber !== undefined && episodeNumber !== undefined) {
      return `${formatSeasonLabel(seasonNumber)}, Episode ${episodeNumber}`
    }
    if (type === 'movie' && year) {
      return `${year}`
    }
    return null
  }

  const subtitle = getSubtitle()
  const placeholderIcon = type === 'movie' ? '🎬' : type === 'season' ? '📁' : '📺'

  // Build info line (episode count + air date)
  const infoItems: string[] = []
  if (seasonDetails?.episodeCount) {
    infoItems.push(`${seasonDetails.episodeCount} episode${seasonDetails.episodeCount !== 1 ? 's' : ''}`)
  }
  const displayAirDate = seasonDetails?.airDate || airDate
  if (displayAirDate) {
    try {
      infoItems.push(new Date(displayAirDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))
    } catch { /* ignore */ }
  }

  return createPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Popup */}
      <div className="relative bg-card border border-border rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-xl">
          <span className="text-sm font-medium capitalize">{type}</span>
          <div className="flex items-center gap-1">
            <AddToWishlistButton
              mediaType={type}
              title={title}
              year={year}
              tmdbId={tmdbId}
              imdbId={imdbId}
              seriesTitle={seriesTitle}
              seasonNumber={seasonNumber}
              episodeNumber={episodeNumber}
              posterUrl={posterUrl}
              compact
            />
            {onDismiss && (
              <button
                onClick={() => { onDismiss(); onClose() }}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Dismiss"
              >
                <EyeOff className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 flex gap-4">
          {/* Poster — fixed size, not squeezed */}
          <div className="w-28 shrink-0">
            <div className="aspect-2/3 bg-muted rounded-md overflow-hidden shadow-lg shadow-black/30">
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt={title}
                  className={`w-full h-full object-cover ${type !== 'movie' ? 'grayscale opacity-70' : ''}`}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl grayscale opacity-50">
                  {placeholderIcon}
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {tmdbId ? (
                <h3
                  className="font-semibold text-lg truncate text-primary hover:underline cursor-pointer"
                  onClick={() => window.electronAPI.openExternal(`https://www.themoviedb.org/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}`)}
                  title="Open on TMDb"
                >
                  {title}
                </h3>
              ) : (
                <h3 className="font-semibold text-lg truncate">{title}</h3>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard.writeText(title)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Copy title"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            )}
            {infoItems.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {infoItems.join(' · ')}
              </p>
            )}
            {(seasonDetails?.overview || movieOverview) && (
              <p className="text-xs text-muted-foreground mt-2 max-h-24 overflow-y-auto leading-relaxed">
                {seasonDetails?.overview || movieOverview}
              </p>
            )}

          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
