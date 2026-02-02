import { X } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'

// Helper function to format season label (Season 0 = Specials)
const formatSeasonLabel = (seasonNumber: number): string => {
  return seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`
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
  onClose
}: MissingItemPopupProps) {
  // Format the subtitle based on type
  const getSubtitle = () => {
    if (type === 'episode' && seasonNumber !== undefined && episodeNumber !== undefined) {
      return `${formatSeasonLabel(seasonNumber)}, Episode ${episodeNumber}`
    }
    if (type === 'season' && seasonNumber !== undefined) {
      return formatSeasonLabel(seasonNumber)
    }
    if (type === 'movie' && year) {
      return `${year}`
    }
    return null
  }

  const subtitle = getSubtitle()
  const placeholderIcon = type === 'movie' ? '🎬' : type === 'season' ? '📁' : '📺'

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Popup */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl max-w-sm w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30 bg-black/30 rounded-t-lg">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-orange-600 text-white text-xs font-bold rounded">
              MISSING
            </span>
            <span className="text-sm text-muted-foreground capitalize">{type}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex gap-4">
          {/* Poster */}
          <div className="w-24 aspect-[2/3] bg-muted rounded-md overflow-hidden flex-shrink-0">
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={title}
                className="w-full h-full object-cover grayscale opacity-70"
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

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate">{title}</h3>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            )}
            {airDate && (
              <p className="text-sm text-muted-foreground mt-1">
                Air date: {new Date(airDate).toLocaleDateString()}
              </p>
            )}
            <p className="text-xs text-orange-500 mt-3">
              This {type} is not in your library
            </p>

            {/* Add to Wishlist */}
            <div className="mt-4">
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
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
