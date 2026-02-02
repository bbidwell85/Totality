import { memo, useRef, useEffect } from 'react'
import { Tv } from 'lucide-react'
import { useKeyboardNavigation } from '../../contexts/KeyboardNavigationContext'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import type { WishlistMediaType } from '../../contexts/WishlistContext'

interface MissingItemCardProps {
  type: 'episode' | 'season' | 'movie'
  title: string
  subtitle?: string // e.g., "S2 E5" or "2012"
  posterUrl?: string
  onClick: () => void
  focusIndex?: number
  focusId?: string
  // Wishlist props
  tmdbId?: string
  seriesTitle?: string
  seasonNumber?: number
  year?: number
}

export const MissingItemCard = memo(function MissingItemCard({
  type,
  title,
  subtitle,
  posterUrl,
  onClick,
  focusIndex,
  focusId: providedFocusId,
  tmdbId,
  seriesTitle,
  seasonNumber,
  year
}: MissingItemCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const focusId = providedFocusId || `content-missing-${type}-${title}`
  const isFocused = focusedId === focusId && isNavigationActive

  useEffect(() => {
    if (cardRef.current && focusIndex !== undefined) {
      registerFocusable(focusId, cardRef.current, 'content', focusIndex)
    }
    return () => unregisterFocusable(focusId)
  }, [focusId, focusIndex, registerFocusable, unregisterFocusable])

  // Map type to wishlist media type
  const wishlistMediaType: WishlistMediaType = type === 'movie' ? 'movie' : type === 'season' ? 'season' : 'episode'

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`group cursor-pointer hover-scale outline-none ${isFocused ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className={`aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 ${isFocused ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
        {/* Grayscale poster or placeholder */}
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover grayscale opacity-50"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50">
            <Tv className="w-16 h-16 text-white/30" strokeWidth={1.5} />
          </div>
        )}
      </div>

      {/* Title and wishlist button below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate text-muted-foreground">{title}</h4>
          {subtitle && (
            <p className="text-xs text-muted-foreground/70">{subtitle}</p>
          )}
        </div>
        {/* Wishlist button */}
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <AddToWishlistButton
            mediaType={wishlistMediaType}
            title={type === 'season' ? (seriesTitle || title) : title}
            year={year}
            tmdbId={tmdbId}
            seriesTitle={seriesTitle}
            seasonNumber={seasonNumber}
            posterUrl={posterUrl}
            compact
          />
        </div>
      </div>
    </div>
  )
})
