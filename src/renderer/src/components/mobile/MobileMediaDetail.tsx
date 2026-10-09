import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Star, Check, Play } from 'lucide-react'
import { formatFileSize, formatBitrate, formatDuration } from '../library/mediaUtils'
import { getResolutionColors } from '../../utils/qualityColors'

interface MediaDetail {
  id: number
  title: string
  year?: number
  type: string
  series_title?: string
  season_number?: number
  episode_number?: number
  resolution: string
  video_codec: string
  video_bitrate: number
  audio_codec: string
  audio_channels: number
  audio_bitrate: number
  file_size: number
  duration: number
  poster_url?: string
  hdr_format?: string
  summary?: string
  tmdb_id?: string
  tmdb_rating?: number
  play_count?: number
  last_watched_at?: string
  audio_tracks?: string
  source_type?: string
}

interface QualityScore {
  quality_tier: string
  tier_quality: string
  tier_score: number
}

interface MediaVersion {
  id: number
  edition?: string
  label?: string
  resolution: string
  video_codec: string
  video_bitrate: number
  audio_codec: string
  audio_channels: number
  audio_bitrate: number
  file_size: number
  hdr_format?: string
  quality_tier?: string
  tier_quality?: string
  tier_score?: number
  is_best?: boolean
}

interface AudioTrack {
  codec?: string
  channels?: number
  bitrate?: number
  language?: string
  title?: string
}

interface MobileMediaDetailProps {
  mediaId: number
  onClose: () => void
}

const SNAP_HALF = 60
const SNAP_FULL = 92
const DISMISS_THRESHOLD = 35

export function MobileMediaDetail({ mediaId, onClose }: MobileMediaDetailProps) {
  const [media, setMedia] = useState<MediaDetail | null>(null)
  const [quality, setQuality] = useState<QualityScore | null>(null)
  const [versions, setVersions] = useState<MediaVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const [onWishlist, setOnWishlist] = useState(false)
  const [loading, setLoading] = useState(true)

  // Drag state
  const [sheetHeight, setSheetHeight] = useState(SNAP_HALF)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(SNAP_HALF)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [item, score, vers] = await Promise.all([
          window.electronAPI.getMediaItemById(mediaId),
          window.electronAPI.getQualityScoreByMediaId(mediaId),
          window.electronAPI.getMediaItemVersions(mediaId),
        ])
        setMedia(item as MediaDetail | null)
        setQuality(score as QualityScore | null)
        const v = (vers as MediaVersion[]) || []
        setVersions(v)
        if (v.length > 0) setSelectedVersionId(v.find(x => x.is_best)?.id ?? v[0].id)

        const m = item as MediaDetail | null
        if (m?.tmdb_id) {
          const exists = await window.electronAPI.wishlistCheckExists(m.tmdb_id)
          setOnWishlist(!!exists)
        }
      } catch (err) {
        console.error('Failed to load media detail:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [mediaId])

  const handleWishlistToggle = useCallback(async () => {
    if (!media || onWishlist) return
    try {
      await window.electronAPI.wishlistAdd({
        media_type: media.type === 'episode' ? 'episode' : 'movie',
        title: media.type === 'episode' ? media.series_title || media.title : media.title,
        year: media.year,
        tmdb_id: media.tmdb_id,
        reason: 'upgrade',
        media_item_id: media.id,
        poster_url: media.poster_url,
      })
      setOnWishlist(true)
    } catch (err) {
      console.error('Failed to add to wishlist:', err)
    }
  }, [media, onWishlist])

  // Touch drag handlers — only triggered from the handle bar
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true)
    dragStartY.current = e.touches[0].clientY
    dragStartHeight.current = sheetHeight
    e.preventDefault() // Prevent scroll while dragging handle
  }, [sheetHeight])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    const deltaY = dragStartY.current - e.touches[0].clientY
    const deltaPercent = (deltaY / window.innerHeight) * 100
    setSheetHeight(Math.max(10, Math.min(SNAP_FULL, dragStartHeight.current + deltaPercent)))
  }, [isDragging])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    if (sheetHeight < DISMISS_THRESHOLD) {
      onClose()
    } else if (sheetHeight < (SNAP_HALF + SNAP_FULL) / 2) {
      setSheetHeight(SNAP_HALF)
    } else {
      setSheetHeight(SNAP_FULL)
    }
  }, [isDragging, sheetHeight, onClose])

  // Parse audio tracks
  const audioTracks: AudioTrack[] = (() => {
    if (!media?.audio_tracks) return []
    try { return JSON.parse(media.audio_tracks) } catch { return [] }
  })()

  // Active version data (for display)
  const activeVersion = versions.find(v => v.id === selectedVersionId)

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] bg-black/60 flex items-end">
        <div className="w-full bg-card rounded-t-2xl p-6 flex justify-center" style={{ height: `${SNAP_HALF}vh` }}>
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!media) { onClose(); return null }

  // Use active version stats if selected, otherwise media item
  const displayRes = activeVersion?.resolution ?? media.resolution
  const displayVCodec = activeVersion?.video_codec ?? media.video_codec
  const displayVBitrate = activeVersion?.video_bitrate ?? media.video_bitrate
  const displayACodec = activeVersion?.audio_codec ?? media.audio_codec
  const displayACh = activeVersion?.audio_channels ?? media.audio_channels
  const displayABitrate = activeVersion?.audio_bitrate ?? media.audio_bitrate
  const displaySize = activeVersion?.file_size ?? media.file_size
  const displayHdr = activeVersion?.hdr_format ?? media.hdr_format
  const displayQuality = activeVersion?.quality_tier ?? quality?.quality_tier
  const displayTierQuality = activeVersion?.tier_quality ?? quality?.tier_quality
  const displayScore = activeVersion?.tier_score ?? quality?.tier_score

  return (
    <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose}>
      <div
        className={`absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl flex flex-col ${
          isDragging ? '' : 'transition-[height] duration-300 ease-out'
        }`}
        style={{ height: `${sheetHeight}vh` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing shrink-0"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1.5 bg-white/30 rounded-full" />
        </div>

        <button
          onClick={onClose}
          className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Scrollable content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto overscroll-contain">
          <div className="px-5 pb-24">
            {/* Poster + title */}
            <div className="flex gap-4">
              <div className="w-24 aspect-[2/3] bg-muted rounded-lg overflow-hidden shrink-0">
                {media.poster_url ? (
                  <img src={media.poster_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No poster</div>
                )}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <h2 className="text-base font-semibold text-foreground leading-snug">{media.title}</h2>
                {media.type === 'episode' && media.series_title && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {media.series_title} · S{media.season_number}E{media.episode_number}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {media.year && <span className="text-xs text-muted-foreground">{media.year}</span>}
                  {media.duration > 0 && <span className="text-xs text-muted-foreground">{formatDuration(media.duration)}</span>}
                  {media.tmdb_rating != null && media.tmdb_rating > 0 && (
                    <span className="text-xs text-yellow-400 flex items-center gap-0.5">
                      <Star className="w-3 h-3 fill-yellow-400" />
                      {media.tmdb_rating.toFixed(1)}
                    </span>
                  )}
                </div>
                {displayQuality && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${getResolutionColors(displayQuality)}`}>
                      {displayQuality} · {displayTierQuality}
                    </span>
                    {displayScore != null && <span className="text-xs text-muted-foreground">Score {displayScore}</span>}
                  </div>
                )}
                {/* Play count */}
                {(media.play_count ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                    <Play className="w-3 h-3" />
                    <span>Played {media.play_count} time{media.play_count !== 1 ? 's' : ''}</span>
                    {media.last_watched_at && (
                      <span>· {new Date(media.last_watched_at).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Version pills */}
            {versions.length > 1 && (
              <div className="flex gap-1.5 mt-4 overflow-x-auto pb-1">
                {versions.map((v) => {
                  const isSelected = selectedVersionId === v.id
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersionId(v.id)}
                      className={`shrink-0 px-3 min-h-[36px] text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
                        isSelected
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-white/70'
                      }`}
                    >
                      {v.is_best && <Star className="w-3 h-3" />}
                      {v.edition || v.label || `${v.resolution} ${v.video_codec}`}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Summary */}
            {media.summary && (
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed">{media.summary}</p>
            )}

            {/* Technical details */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <DetailItem label="Resolution" value={displayRes} />
              <DetailItem label="Video" value={`${displayVCodec} ${formatBitrate(displayVBitrate)}`} />
              <DetailItem label="Audio" value={`${displayACodec} ${displayACh}ch`} />
              <DetailItem label="Audio Bitrate" value={formatBitrate(displayABitrate)} />
              <DetailItem label="File Size" value={formatFileSize(displaySize)} />
              {displayHdr && displayHdr !== 'None' && displayHdr !== '' && (
                <DetailItem label="HDR" value={displayHdr} />
              )}
            </div>

            {/* Audio tracks */}
            {audioTracks.length > 1 && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Audio Tracks</p>
                <div className="space-y-1.5">
                  {audioTracks.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-foreground">{t.codec || '?'}</span>
                      <span className="text-muted-foreground">{t.channels}ch</span>
                      {t.bitrate && <span className="text-muted-foreground">{formatBitrate(t.bitrate)}</span>}
                      {t.language && <span className="text-muted-foreground uppercase">{t.language}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Wishlist button */}
            <button
              onClick={handleWishlistToggle}
              disabled={onWishlist}
              className={`w-full mt-5 flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-lg text-sm font-medium transition-colors ${
                onWishlist
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-white text-black hover:bg-white/90'
              }`}
            >
              {onWishlist ? (
                <><Check className="w-4 h-4" /> On Wishlist</>
              ) : (
                <><Star className="w-4 h-4" /> Add to Wishlist</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm text-foreground font-mono">{value}</p>
    </div>
  )
}
