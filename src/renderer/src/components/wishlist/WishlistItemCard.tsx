import { useState, useEffect, memo } from 'react'
import { Trash2, Film, Tv, Music, Disc, CircleFadingArrowUp, CheckCircle2, RotateCcw } from 'lucide-react'
import { StarRating } from './StarRating'
import { StoreLinksMenu } from './StoreLinksMenu'
import type { WishlistItem, StoreLink, WishlistPriority } from '../../contexts/WishlistContext'
import { useWishlist } from '../../contexts/WishlistContext'

// Quality tier colors
const qualityTierColors: Record<string, string> = {
  'SD': 'bg-red-500/20 text-red-400',
  '720p': 'bg-yellow-500/20 text-yellow-400',
  '1080p': 'bg-blue-500/20 text-blue-400',
  '4K': 'bg-green-500/20 text-green-400'
}

interface WishlistItemCardProps {
  item: WishlistItem
  onRemove: (id: number) => void
  onUpdatePriority: (id: number, priority: WishlistPriority) => void
  onMarkCompleted: (id: number) => void
  onMarkActive: (id: number) => void
}

// Media type icons
const mediaTypeIcons = {
  movie: Film,
  episode: Tv,
  season: Tv,
  album: Disc,
  track: Music
}

// Placeholder icons by type
const placeholderIcons: Record<string, string> = {
  movie: '',
  episode: '',
  season: '',
  album: '',
  track: ''
}

export const WishlistItemCard = memo(function WishlistItemCard({
  item,
  onRemove,
  onUpdatePriority,
  onMarkCompleted,
  onMarkActive
}: WishlistItemCardProps) {
  const { getStoreLinks, openStoreLink } = useWishlist()
  const [storeLinks, setStoreLinks] = useState<StoreLink[]>([])
  const [isLoadingLinks, setIsLoadingLinks] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  // Load store links on mount
  useEffect(() => {
    loadStoreLinks()
  }, [item])

  const loadStoreLinks = async () => {
    setIsLoadingLinks(true)
    try {
      const links = await getStoreLinks(item)
      setStoreLinks(links)
    } catch (err) {
      console.error('Error loading store links:', err)
    } finally {
      setIsLoadingLinks(false)
    }
  }

  const handleRemove = () => {
    if (showConfirmDelete) {
      onRemove(item.id)
    } else {
      setShowConfirmDelete(true)
      // Auto-hide confirm after 3 seconds
      setTimeout(() => setShowConfirmDelete(false), 3000)
    }
  }

  // Get subtitle based on type
  const getSubtitle = () => {
    if (item.media_type === 'episode') {
      const parts = []
      if (item.series_title) parts.push(item.series_title)
      if (item.season_number !== undefined) parts.push(`S${item.season_number}`)
      if (item.episode_number !== undefined) parts.push(`E${item.episode_number}`)
      return parts.join(' ')
    }
    if (item.media_type === 'season' && item.series_title) {
      return `${item.series_title} Season ${item.season_number || 1}`
    }
    if (item.media_type === 'album' || item.media_type === 'track') {
      return item.artist_name || ''
    }
    if (item.year) {
      return item.year.toString()
    }
    return item.subtitle || ''
  }

  // Get current quality display for upgrade items
  const getQualityDisplay = () => {
    if (item.reason !== 'upgrade') return null

    const parts: string[] = []
    if (item.current_resolution) parts.push(item.current_resolution)
    if (item.current_video_codec) parts.push(item.current_video_codec.toUpperCase())
    if (item.current_audio_codec) parts.push(item.current_audio_codec.toUpperCase())

    return parts.length > 0 ? parts.join(' / ') : null
  }

  const MediaIcon = mediaTypeIcons[item.media_type]
  const subtitle = getSubtitle()
  const placeholderIcon = placeholderIcons[item.media_type]
  const qualityDisplay = getQualityDisplay()
  const isUpgrade = item.reason === 'upgrade'
  const tierColorClass = item.current_quality_tier ? qualityTierColors[item.current_quality_tier] || 'bg-muted text-muted-foreground' : ''
  const isMusic = item.media_type === 'album' || item.media_type === 'track'
  const isCompleted = item.status === 'completed'

  // Format completion date
  const getCompletedDate = () => {
    if (!item.completed_at) return null
    const date = new Date(item.completed_at)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="relative flex gap-2 p-2 rounded-lg transition-colors group bg-muted/30 hover:bg-muted/50">
      {/* Completed checkmark - top right */}
      {isCompleted && (
        <div className="absolute top-1.5 right-1.5 z-10">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        </div>
      )}

      {/* Poster/Album Art */}
      <div className={`w-10 ${isMusic ? 'h-10' : 'h-[60px]'} bg-muted rounded overflow-hidden flex-shrink-0`}>
        {item.poster_url ? (
          <img
            src={item.poster_url}
            alt={item.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl bg-muted/50">
            {placeholderIcon}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Title row with type icon */}
        <div className="flex items-start gap-1.5">
          <MediaIcon className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 pr-5">
            <div className="flex items-center gap-1.5">
              <h4 className="font-medium text-sm truncate leading-tight">{item.title}</h4>
              {isUpgrade && !isCompleted && (
                <span title="Upgrade">
                  <CircleFadingArrowUp className="w-3 h-3 text-amber-500 flex-shrink-0" />
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Current quality info for upgrade items */}
        {isUpgrade && item.current_quality_tier && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${tierColorClass}`}>
              {item.current_quality_tier}
              {item.current_quality_level && ` (${item.current_quality_level})`}
            </span>
            {qualityDisplay && (
              <span className="text-[10px] text-muted-foreground truncate">
                {qualityDisplay}
              </span>
            )}
          </div>
        )}

        {/* Completed items: date on left, actions on right */}
        {isCompleted && (
          <div className="flex items-center justify-between mt-1">
            {item.completed_at && (
              <span className="text-[10px] text-muted-foreground">
                Completed {getCompletedDate()}
              </span>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => onMarkActive(item.id)}
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Move back to active"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={handleRemove}
                className={`p-1.5 rounded-md transition-colors ${
                  showConfirmDelete
                    ? 'bg-destructive text-destructive-foreground'
                    : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                }`}
                title={showConfirmDelete ? 'Click again to confirm' : 'Remove from wishlist'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Active items: rating and actions */}
        {!isCompleted && (
          <div className="flex items-center justify-between mt-auto pt-1.5">
            <StarRating
              rating={item.priority}
              onChange={(rating) => onUpdatePriority(item.id, rating)}
              size="sm"
            />
            <div className="flex items-center gap-1">
              <StoreLinksMenu
                storeLinks={storeLinks}
                onOpenLink={openStoreLink}
                isLoading={isLoadingLinks}
              />
              <button
                onClick={() => onMarkCompleted(item.id)}
                className="p-1.5 rounded-md hover:bg-green-500/20 transition-colors text-muted-foreground hover:text-green-500"
                title="Mark as completed"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRemove}
                className={`p-1.5 rounded-md transition-colors ${
                  showConfirmDelete
                    ? 'bg-destructive text-destructive-foreground'
                    : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                }`}
                title={showConfirmDelete ? 'Click again to confirm' : 'Remove from wishlist'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
