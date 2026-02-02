import { useState, useCallback, useEffect } from 'react'
import { ShoppingBag, Check, Loader2 } from 'lucide-react'
import { useWishlist, WishlistMediaType, WishlistReason } from '../../contexts/WishlistContext'

interface AddToWishlistButtonProps {
  mediaType: WishlistMediaType
  title: string
  year?: number
  tmdbId?: string
  imdbId?: string
  musicbrainzId?: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  collectionName?: string
  artistName?: string
  albumTitle?: string
  posterUrl?: string
  // Reason for adding (missing = complete collection, upgrade = better quality)
  reason?: WishlistReason
  // Upgrade-specific props
  mediaItemId?: number
  currentQualityTier?: string
  currentQualityLevel?: string
  currentResolution?: string
  currentVideoCodec?: string
  currentAudioCodec?: string
  // Display options
  compact?: boolean
}

export function AddToWishlistButton({
  mediaType,
  title,
  year,
  tmdbId,
  imdbId,
  musicbrainzId,
  seriesTitle,
  seasonNumber,
  episodeNumber,
  collectionName,
  artistName,
  albumTitle,
  posterUrl,
  reason = 'missing',
  mediaItemId,
  currentQualityTier,
  currentQualityLevel,
  currentResolution,
  currentVideoCodec,
  currentAudioCodec,
  compact = false
}: AddToWishlistButtonProps) {
  const { addItem, checkExists, items } = useWishlist()
  const [isInWishlist, setIsInWishlist] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(true)

  // For episodes, we add the season instead (can't buy individual episodes on physical media)
  const isEpisode = mediaType === 'episode'
  const effectiveMediaType: WishlistMediaType = isEpisode ? 'season' : mediaType
  const effectiveTitle = isEpisode ? (seriesTitle || title) : title

  // Check if already in wishlist on mount and when dependencies change
  // For seasons (including episodes which become seasons), check by series_title + season_number
  // This is more accurate than tmdb_id alone since all seasons share the show's tmdb_id
  useEffect(() => {
    const check = async () => {
      setIsChecking(true)
      try {
        // For seasons (or episodes being added as seasons), check by series + season number
        // This handles the case where multiple seasons share the same show tmdb_id
        if ((mediaType === 'season' || isEpisode) && seriesTitle && seasonNumber !== undefined) {
          const seasonExists = items.some(
            item => item.media_type === 'season' &&
                    item.series_title === seriesTitle &&
                    item.season_number === seasonNumber
          )
          if (seasonExists) {
            setIsInWishlist(true)
            setIsChecking(false)
            return
          }
          // If not found by series+season, it's not in the wishlist
          // Don't fall through to checkExists for seasons since tmdb_id is shared across all seasons
          setIsInWishlist(false)
          setIsChecking(false)
          return
        }
        // For non-season items, use the standard check
        const exists = await checkExists(tmdbId, musicbrainzId, mediaItemId)
        setIsInWishlist(exists)
      } catch (err) {
        console.error('Error checking wishlist:', err)
      } finally {
        setIsChecking(false)
      }
    }
    check()
  }, [tmdbId, musicbrainzId, mediaItemId, seriesTitle, seasonNumber, isEpisode, mediaType, items, checkExists])

  const handleAdd = useCallback(async () => {
    if (isInWishlist) return

    setIsLoading(true)
    try {
      await addItem({
        media_type: effectiveMediaType,
        title: effectiveTitle,
        year,
        tmdb_id: tmdbId,
        imdb_id: imdbId,
        musicbrainz_id: musicbrainzId,
        series_title: seriesTitle,
        season_number: seasonNumber,
        // Don't include episode_number when adding a season
        episode_number: isEpisode ? undefined : episodeNumber,
        collection_name: collectionName,
        artist_name: artistName,
        album_title: albumTitle,
        poster_url: posterUrl,
        priority: 3, // Default priority, can be changed in wishlist panel
        reason,
        status: 'active', // New items are always active
        // Upgrade-specific fields - don't link to specific episode's media_item_id for seasons
        media_item_id: isEpisode ? undefined : mediaItemId,
        current_quality_tier: currentQualityTier,
        current_quality_level: currentQualityLevel,
        current_resolution: currentResolution,
        current_video_codec: currentVideoCodec,
        current_audio_codec: currentAudioCodec
      })
      setIsInWishlist(true)
    } catch (err) {
      console.error('Error adding to wishlist:', err)
    } finally {
      setIsLoading(false)
    }
  }, [
    isInWishlist, addItem, effectiveMediaType, effectiveTitle, year, tmdbId, imdbId,
    musicbrainzId, seriesTitle, seasonNumber, episodeNumber, collectionName,
    artistName, albumTitle, posterUrl, reason, mediaItemId, isEpisode,
    currentQualityTier, currentQualityLevel, currentResolution, currentVideoCodec, currentAudioCodec
  ])

  const ButtonIcon = ShoppingBag
  // Indicate that the whole season will be added when adding an episode
  const buttonLabel = isEpisode
    ? `Add Season ${seasonNumber ?? ''} to Wishlist`
    : 'Add to Wishlist'
  const inListLabel = isEpisode
    ? `Season ${seasonNumber ?? ''} in Wishlist`
    : 'In Wishlist'

  if (isChecking) {
    if (compact) {
      return (
        <div className="p-1">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Checking...</span>
      </div>
    )
  }

  if (isInWishlist) {
    if (compact) {
      return (
        <div className="p-1" title={inListLabel}>
          <Check className="w-5 h-5 text-green-500" />
        </div>
      )
    }
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-md text-sm text-gray-700">
        <Check className="w-4 h-4 text-green-500" />
        <span>Added</span>
      </div>
    )
  }

  if (compact) {
    return (
      <button
        onClick={handleAdd}
        disabled={isLoading}
        className="p-1 transition-colors disabled:opacity-50 text-primary hover:text-primary/80"
        title={buttonLabel}
      >
        <ButtonIcon className="w-5 h-5" />
      </button>
    )
  }

  return (
    <button
      onClick={handleAdd}
      disabled={isLoading}
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm disabled:opacity-50 transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
    >
      <ButtonIcon className="w-4 h-4" />
      <span>{buttonLabel}</span>
    </button>
  )
}
