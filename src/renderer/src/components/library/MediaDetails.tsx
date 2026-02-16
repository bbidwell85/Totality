import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, RefreshCw, Pencil, EyeOff } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import type { WishlistMediaType } from '../../contexts/WishlistContext'
import { useMenuClose } from '../../hooks/useMenuClose'

interface MediaDetailsProps {
  mediaId: number
  onClose: () => void
  onRescan?: (mediaId: number, sourceId: string, libraryId: string | null, filePath: string) => Promise<void>
  onFixMatch?: (mediaItemId: number, title: string, year?: number, filePath?: string) => void
  onDismissUpgrade?: (mediaId: number, title: string) => void
}

interface AudioTrack {
  index: number
  codec: string
  channels: number
  bitrate: number
  language?: string
  title?: string
  profile?: string
  sampleRate?: number
  isDefault?: boolean
  hasObjectAudio?: boolean
}

interface SubtitleTrack {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault?: boolean
  isForced?: boolean
}

interface MediaVersion {
  id: number
  media_item_id: number
  version_source: string
  edition?: string
  label?: string
  file_path: string
  file_size: number
  duration: number
  resolution: string
  width: number
  height: number
  video_codec: string
  video_bitrate: number
  audio_codec: string
  audio_channels: number
  audio_bitrate: number
  video_frame_rate?: number
  color_bit_depth?: number
  hdr_format?: string
  video_profile?: string
  audio_profile?: string
  audio_sample_rate?: number
  has_object_audio?: boolean
  audio_tracks?: string
  subtitle_tracks?: string
  color_space?: string
  container?: string
  quality_tier?: string
  tier_quality?: string
  tier_score?: number
  bitrate_tier_score?: number
  audio_tier_score?: number
  is_best?: boolean
}

interface MediaWithQuality {
  id: number
  title: string
  year?: number
  type: 'movie' | 'episode'
  series_title?: string
  season_number?: number
  episode_number?: number
  source_id: string
  library_id?: string
  file_path: string
  file_size: number
  duration: number
  resolution: string
  width: number
  height: number
  video_codec: string
  video_bitrate: number
  audio_codec: string
  audio_channels: number
  audio_bitrate: number
  imdb_id?: string
  tmdb_id?: string
  poster_url?: string
  episode_thumb_url?: string
  season_poster_url?: string
  video_frame_rate?: number
  color_bit_depth?: number
  hdr_format?: string
  color_space?: string
  video_profile?: string
  video_level?: number
  audio_profile?: string
  audio_sample_rate?: number
  has_object_audio?: boolean
  container?: string
  audio_tracks?: string
  subtitle_tracks?: string
  version_count?: number
  quality_tier?: 'SD' | '720p' | '1080p' | '4K'
  tier_quality?: 'LOW' | 'MEDIUM' | 'HIGH'
  tier_score?: number
  bitrate_tier_score?: number
  audio_tier_score?: number
  overall_score?: number
  needs_upgrade?: boolean
  issues?: string
}

interface QualityThresholds {
  video: { medium: number; high: number }
  audio: { medium: number; high: number }
}

const DEFAULT_THRESHOLDS: Record<string, QualityThresholds> = {
  'SD': { video: { medium: 1500, high: 3500 }, audio: { medium: 128, high: 192 } },
  '720p': { video: { medium: 3000, high: 8000 }, audio: { medium: 192, high: 320 } },
  '1080p': { video: { medium: 6000, high: 15000 }, audio: { medium: 256, high: 640 } },
  '4K': { video: { medium: 15000, high: 40000 }, audio: { medium: 320, high: 1000 } },
}

export function MediaDetails({ mediaId, onClose, onRescan, onFixMatch, onDismissUpgrade }: MediaDetailsProps) {
  const [media, setMedia] = useState<MediaWithQuality | null>(null)
  const [versions, setVersions] = useState<MediaVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [thresholds, setThresholds] = useState<Record<string, QualityThresholds>>(DEFAULT_THRESHOLDS)
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleRescan = async () => {
    if (!media || !onRescan) return
    setShowMenu(false)
    setIsRescanning(true)
    try {
      await onRescan(media.id, media.source_id, media.library_id || null, media.file_path)
    } finally {
      setIsRescanning(false)
    }
  }

  const handleFixMatch = () => {
    if (!media || !onFixMatch) return
    setShowMenu(false)
    onFixMatch(media.id, media.title, media.year, media.file_path)
  }

  const handleDismissUpgrade = () => {
    if (!media || !onDismissUpgrade) return
    setShowMenu(false)
    const title = media.type === 'episode' && media.series_title
      ? `${media.series_title} S${media.season_number}E${media.episode_number}`
      : media.title
    onDismissUpgrade(media.id, title)
    // Update local state so UI reflects immediately
    setMedia(prev => prev ? { ...prev, needs_upgrade: false, tier_quality: prev.tier_quality === 'LOW' ? 'MEDIUM' : prev.tier_quality } : prev)
  }

  useEffect(() => {
    loadMediaDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId])

  const loadMediaDetails = async () => {
    try {
      setLoading(true)
      setError(null)

      // Load quality settings
      const allSettings = await window.electronAPI.getAllSettings()
      const loadedThresholds: Record<string, QualityThresholds> = { ...DEFAULT_THRESHOLDS }

      const tiers = ['sd', '720p', '1080p', '4k']
      const tierKeys: Record<string, string> = { 'sd': 'SD', '720p': '720p', '1080p': '1080p', '4k': '4K' }

      for (const tier of tiers) {
        const key = tierKeys[tier]
        const videoMedium = allSettings[`quality_video_${tier}_medium`]
        const videoHigh = allSettings[`quality_video_${tier}_high`]
        const audioMedium = allSettings[`quality_audio_${tier}_medium`]
        const audioHigh = allSettings[`quality_audio_${tier}_high`]

        loadedThresholds[key] = {
          video: {
            medium: videoMedium ? parseFloat(videoMedium) : DEFAULT_THRESHOLDS[key].video.medium,
            high: videoHigh ? parseFloat(videoHigh) : DEFAULT_THRESHOLDS[key].video.high,
          },
          audio: {
            medium: audioMedium ? parseFloat(audioMedium) : DEFAULT_THRESHOLDS[key].audio.medium,
            high: audioHigh ? parseFloat(audioHigh) : DEFAULT_THRESHOLDS[key].audio.high,
          },
        }
      }
      setThresholds(loadedThresholds)

      const item = await window.electronAPI.getMediaItemById(mediaId) as MediaWithQuality | null
      if (!item) {
        setError('Media item not found')
        return
      }

      const qualityScore = await window.electronAPI.getQualityScoreByMediaId(mediaId) as {
        quality_tier?: 'SD' | '720p' | '1080p' | '4K'
        tier_quality?: 'LOW' | 'MEDIUM' | 'HIGH'
        tier_score?: number
        bitrate_tier_score?: number
        audio_tier_score?: number
        overall_score?: number
        needs_upgrade?: boolean
        issues?: string
      } | null

      const mediaWithQuality: MediaWithQuality = {
        ...item,
        quality_tier: qualityScore?.quality_tier,
        tier_quality: qualityScore?.tier_quality,
        tier_score: qualityScore?.tier_score,
        bitrate_tier_score: qualityScore?.bitrate_tier_score,
        audio_tier_score: qualityScore?.audio_tier_score,
        overall_score: qualityScore?.overall_score,
        needs_upgrade: qualityScore?.needs_upgrade,
        issues: qualityScore?.issues
      }
      setMedia(mediaWithQuality)

      // Fetch versions if there are multiple
      if (item.version_count && item.version_count > 1) {
        try {
          const versionData = await window.electronAPI.getMediaItemVersions(mediaId) as MediaVersion[]
          setVersions(versionData || [])
          // Auto-select the best version
          const best = versionData?.find(v => v.is_best) || versionData?.[0]
          if (best) setSelectedVersionId(best.id)
        } catch {
          // Non-critical: versions just won't show
        }
      }
    } catch (err) {
      console.error('Error loading media details:', err)
      setError('Failed to load media details')
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024)
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  }

  const formatDuration = (milliseconds: number): string => {
    const totalSeconds = Math.floor(milliseconds / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  const formatChannels = (channels: number): string => {
    if (channels > 2) return `${channels - 1}.1`
    return `${channels}.0`
  }

  const formatBitrate = (kbps: number): string => {
    return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`
  }

  const formatThresholdRange = (medium: number, high: number): string => {
    if (medium >= 1000 || high >= 1000) {
      return `${(medium / 1000).toFixed(0)}-${(high / 1000).toFixed(0)} Mbps`
    }
    return `${medium}-${high} kbps`
  }

  const getVideoThresholdRange = (tier?: string): string => {
    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']
    return formatThresholdRange(t.video.medium, t.video.high)
  }

  const getAudioThresholdRange = (tier?: string): string => {
    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']
    return formatThresholdRange(t.audio.medium, t.audio.high)
  }

  const isAudioBitrateLow = (track: AudioTrack, tier?: string): boolean => {
    // Commentary tracks — don't flag
    if (isCommentary(track)) return false

    // Lossless / object audio — bitrate doesn't matter
    if (track.hasObjectAudio) return false
    const c = (track.codec || '').toLowerCase()
    if (c.includes('truehd') || c.includes('flac') || c.includes('pcm') || c.includes('lpcm') ||
        c.includes('alac') || c.includes('dts-hd ma') || c.includes('dtshd_ma')) return false

    // No bitrate reported — can't determine
    if (!track.bitrate || track.bitrate <= 0) return false

    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']

    // Stereo (1-2 channels) — use half the surround threshold
    if (track.channels <= 2) {
      return track.bitrate < Math.round(t.audio.medium / 2)
    }

    // Surround — use full threshold
    return track.bitrate < t.audio.medium
  }

  const isAudioBitrateRawLow = (bitrate: number, tier?: string): boolean => {
    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']
    return bitrate < t.audio.medium
  }

  const LowIndicator = () => (
    <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />
  )

  // Parse quality issues and return abbreviated badge labels
  const tierRank = (tier?: string): number => {
    switch (tier) {
      case '4K': return 4
      case '1080p': return 3
      case '720p': return 2
      default: return 1
    }
  }

  const getVersionInsight = (v: MediaVersion): { type: 'redundant' | 'low-quality'; label: string; color: string } | null => {
    if (v.is_best || versions.length < 2) return null
    const best = versions.find(ver => ver.is_best)
    if (!best) return null

    // Low quality version — regardless of tier
    if (v.tier_quality === 'LOW') {
      return { type: 'low-quality', label: 'Low quality', color: 'bg-yellow-500/20 text-yellow-400' }
    }

    // Redundant: same edition name and best version is same or higher tier
    const sameEdition = (v.edition || '') === (best.edition || '') && v.edition !== undefined
    if (sameEdition && best.quality_tier && v.quality_tier && tierRank(best.quality_tier) >= tierRank(v.quality_tier)) {
      return { type: 'redundant', label: 'Possible redundant', color: 'bg-amber-500/20 text-amber-400' }
    }

    return null
  }

  const parseAudioTracks = (): AudioTrack[] => {
    if (!media?.audio_tracks) return []
    try {
      return JSON.parse(media.audio_tracks)
    } catch {
      return []
    }
  }

  const parseVersionAudioTracks = (v: MediaVersion | null): AudioTrack[] => {
    if (!v?.audio_tracks) return []
    try {
      return JSON.parse(v.audio_tracks) as AudioTrack[]
    } catch {
      return []
    }
  }

  const parseVersionSubtitleTracks = (v: MediaVersion | null): SubtitleTrack[] => {
    if (!v?.subtitle_tracks) return []
    try {
      return JSON.parse(v.subtitle_tracks) as SubtitleTrack[]
    } catch {
      return []
    }
  }

  const parseSubtitleTracks = (): SubtitleTrack[] => {
    if (!media?.subtitle_tracks) return []
    try {
      return JSON.parse(media.subtitle_tracks)
    } catch {
      return []
    }
  }

  const isCommentary = (track: AudioTrack): boolean => {
    if (!track.title) return false
    return track.title.toLowerCase().includes('commentary')
  }

  // Determine which audio track is "primary" (used for scoring) —
  // mirrors backend logic: best non-commentary track by tier > channels > bitrate
  const getBestTrackIndex = (tracks: AudioTrack[]): number => {
    if (tracks.length === 0) return -1
    const nonCommentary = tracks.filter(t => !isCommentary(t))
    const candidates = nonCommentary.length > 0 ? nonCommentary : tracks
    let best = candidates[0]
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i]
      // Simple tier comparison: object audio > lossless > lossy
      const bestScore = getTrackScore(best)
      const cScore = getTrackScore(c)
      if (cScore > bestScore) best = c
      else if (cScore === bestScore && c.channels > best.channels) best = c
      else if (cScore === bestScore && c.channels === best.channels && c.bitrate > best.bitrate) best = c
    }
    return best.index
  }

  const getTrackScore = (track: AudioTrack): number => {
    if (track.hasObjectAudio) return 5
    const c = (track.codec || '').toLowerCase()
    if (c.includes('truehd') || c.includes('flac') || c.includes('pcm') || c.includes('lpcm') || c.includes('alac') || c.includes('dts-hd ma') || c.includes('dtshd_ma')) return 4
    if (c.includes('dts-hd') || c.includes('dtshd')) return 3
    if (c.includes('eac3') || c.includes('dts')) return 2
    return 1
  }

  if (loading) {
    return createPortal(
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150]">
        <div className="bg-card rounded-xl p-8 shadow-2xl">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>,
      document.body
    )
  }

  if (error || !media) {
    return createPortal(
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150]">
        <div className="bg-card rounded-xl p-8 shadow-2xl text-center">
          <div className="text-destructive mb-4">{error || 'Media not found'}</div>
          <button onClick={onClose} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">
            Close
          </button>
        </div>
      </div>,
      document.body
    )
  }

  const audioTracks = parseAudioTracks()
  const subtitleTracks = parseSubtitleTracks()
  const displayTitle = media.type === 'episode' && media.series_title ? media.series_title : media.title

  // Selected version derived data
  const sv = versions.find(v => v.id === selectedVersionId) || null
  const svAudioTracks = sv ? parseVersionAudioTracks(sv) : audioTracks
  const svSubtitleTracks = sv ? parseVersionSubtitleTracks(sv) : subtitleTracks
  const svBestTrackIdx = getBestTrackIndex(svAudioTracks)

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150] p-6" onClick={onClose}>
      <div
        className="bg-card rounded-xl w-full max-w-4xl max-h-[calc(100vh-48px)] overflow-hidden flex flex-col shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header */}
        <div className="flex gap-4 p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-xl">
          {/* Poster */}
          {(media.poster_url || media.episode_thumb_url) && (
            <img
              src={media.type === 'episode' && media.episode_thumb_url ? media.episode_thumb_url : media.poster_url}
              alt=""
              className={`rounded-lg object-cover flex-shrink-0 ${
                media.type === 'episode' && media.episode_thumb_url ? 'w-32 h-20' : 'w-16 h-24'
              }`}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}

          {/* Title & Quick Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-xl font-medium truncate">{displayTitle}</h2>
                {media.type === 'episode' && (
                  <p className="text-sm text-muted-foreground">S{media.season_number}E{media.episode_number} · {media.title}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Add to Wishlist Button */}
                {media.tier_quality && media.tier_quality !== 'HIGH' && (
                  <AddToWishlistButton
                    mediaType={media.type as WishlistMediaType}
                    title={media.title}
                    year={media.year}
                    tmdbId={media.tmdb_id}
                    imdbId={media.imdb_id}
                    seriesTitle={media.series_title}
                    seasonNumber={media.season_number}
                    episodeNumber={media.episode_number}
                    posterUrl={media.poster_url}
                    reason="upgrade"
                    mediaItemId={media.id}
                    currentQualityTier={media.quality_tier}
                    currentQualityLevel={media.tier_quality}
                    currentResolution={media.resolution}
                    currentVideoCodec={media.video_codec}
                    currentAudioCodec={media.audio_codec}
                  />
                )}

                {/* 3-dot menu for Rescan/Fix Match/Dismiss */}
                {(onRescan || onFixMatch || (onDismissUpgrade && media.tier_quality !== 'HIGH')) && (
                  <div ref={menuRef} className="relative">
                    <button
                      onClick={() => setShowMenu(!showMenu)}
                      className="text-muted-foreground hover:text-foreground p-1.5 rounded-full hover:bg-muted/50"
                      title="More options"
                    >
                      {isRescanning ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <MoreVertical className="w-5 h-5" />
                      )}
                    </button>

                    {showMenu && !isRescanning && (
                      <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px] z-50">
                        {onRescan && media.file_path && (
                          <button
                            onClick={handleRescan}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Rescan File
                          </button>
                        )}
                        {onFixMatch && media.type === 'movie' && (
                          <button
                            onClick={handleFixMatch}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Fix Match
                          </button>
                        )}
                        {onDismissUpgrade && media.tier_quality !== 'HIGH' && (
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

                <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Quick Stats Row */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-sm text-muted-foreground">
              {media.year && <span>{media.year}</span>}
              {(sv?.duration ?? media.duration) > 0 && <><span className="mx-0.5">·</span><span>{formatDuration(sv?.duration ?? media.duration)}</span></>}
              {(sv?.file_size ?? media.file_size) > 0 && <><span className="mx-0.5">·</span><span>{formatFileSize(sv?.file_size ?? media.file_size)}</span></>}
              {(sv?.container ?? media.container) && <><span className="mx-0.5">·</span><span className="uppercase">{sv?.container ?? media.container}</span></>}
            </div>

            {/* Version Selector Pills */}
            {versions.length > 1 && (
              <div className="flex gap-1.5 mt-2 overflow-x-auto">
                {versions.map((v) => {
                  const isSelected = selectedVersionId === v.id
                  const qualityColor = v.tier_quality === 'HIGH' ? 'bg-green-500/15 hover:bg-green-500/25' :
                    v.tier_quality === 'LOW' ? 'bg-red-500/15 hover:bg-red-500/25' : ''
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersionId(v.id)}
                      className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : `${qualityColor || 'bg-muted/50'} text-muted-foreground hover:text-foreground hover:bg-muted`
                      }`}
                    >
                      {v.edition || v.label || `${v.resolution} ${v.video_codec}`}
                      {v.tier_score != null && <span className={`ml-1.5 ${isSelected ? 'text-primary-foreground/70' : 'opacity-70'}`}>· {v.tier_score}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Content — flat layout, no tabs */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Quality Score Summary */}
          <div className="rounded-lg border border-border p-3">
            {(sv?.quality_tier ?? media.quality_tier) ? (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{sv?.quality_tier ?? media.quality_tier}</div>
                      <div className={`text-xs font-medium ${
                        (sv?.tier_quality ?? media.tier_quality) === 'HIGH' ? 'text-green-500' :
                        (sv?.tier_quality ?? media.tier_quality) === 'MEDIUM' ? 'text-blue-500' :
                        (sv?.tier_quality ?? media.tier_quality) === 'LOW' ? 'text-red-500' :
                        'text-muted-foreground'
                      }`}>{sv?.tier_quality ?? media.tier_quality}</div>
                    </div>
                    {(sv?.tier_score ?? media.tier_score) != null && (
                      <>
                        <div className="h-10 w-px bg-border" />
                        <div className="text-center">
                          <div className="text-2xl font-bold">{sv?.tier_score ?? media.tier_score}</div>
                          <div className="text-xs text-muted-foreground">Score</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Score Bars */}
                  {((sv?.bitrate_tier_score ?? media.bitrate_tier_score) != null || (sv?.audio_tier_score ?? media.audio_tier_score) != null) && (
                    <div className="flex-1 max-w-sm space-y-2">
                      {(sv?.bitrate_tier_score ?? media.bitrate_tier_score) != null && (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-12">Video</span>
                            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(sv?.bitrate_tier_score ?? media.bitrate_tier_score ?? 0, 100)}%` }} />
                            </div>
                            <span className="text-xs w-8 text-right tabular-nums">{Math.min(sv?.bitrate_tier_score ?? media.bitrate_tier_score ?? 0, 100)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground ml-14 mt-0.5">
                            {formatBitrate(sv?.video_bitrate ?? media.video_bitrate)} · Target: {getVideoThresholdRange(sv?.quality_tier ?? media.quality_tier)}
                          </div>
                        </div>
                      )}
                      {(sv?.audio_tier_score ?? media.audio_tier_score) != null && (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-12">Audio</span>
                            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(sv?.audio_tier_score ?? media.audio_tier_score ?? 0, 100)}%` }} />
                            </div>
                            <span className="text-xs w-8 text-right tabular-nums">{Math.min(sv?.audio_tier_score ?? media.audio_tier_score ?? 0, 100)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground ml-14 mt-0.5">
                            {formatBitrate(sv?.audio_bitrate ?? media.audio_bitrate)} · Target: {getAudioThresholdRange(sv?.quality_tier ?? media.quality_tier)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-2">
                Quality score not available — rescan to analyze
              </div>
            )}
          </div>

          {/* Insight Banner */}
          {sv && (() => {
            const insight = getVersionInsight(sv)
            if (!insight) return null
            return (
              <div className={`text-sm px-3 py-2 rounded-lg ${
                insight.type === 'redundant' ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500' : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-500'
              }`}>
                {insight.type === 'redundant'
                  ? 'A better version exists \u2014 this copy may be safe to remove.'
                  : 'This version scores LOW quality \u2014 consider replacing it.'}
              </div>
            )
          })()}

          {/* Video & Audio — 2-column grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Video */}
            <div className="bg-muted/30 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Video</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dimensions</span>
                  <span className="font-medium">{sv?.width ?? media.width}×{sv?.height ?? media.height}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Codec</span>
                  <span className="font-medium">{sv?.video_codec ?? media.video_codec}</span>
                </div>
                {(sv?.video_bitrate ?? media.video_bitrate) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bitrate</span>
                    <span className="font-medium">{formatBitrate(sv?.video_bitrate ?? media.video_bitrate)}</span>
                  </div>
                )}
                {(sv?.video_frame_rate ?? media.video_frame_rate) != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Frame Rate</span>
                    <span className="font-medium">{(sv?.video_frame_rate ?? media.video_frame_rate)?.toFixed(2)} fps</span>
                  </div>
                )}
                {(sv?.color_space ?? media.color_space) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Color Space</span>
                    <span className="font-medium">{sv?.color_space ?? media.color_space}</span>
                  </div>
                )}
                {(sv?.video_profile ?? media.video_profile) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Profile</span>
                    <span className="font-medium">{sv?.video_profile ?? media.video_profile}</span>
                  </div>
                )}
                {(sv?.color_bit_depth ?? media.color_bit_depth) != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bit Depth</span>
                    <span className="font-medium">{sv?.color_bit_depth ?? media.color_bit_depth}-bit</span>
                  </div>
                )}
                {(sv?.hdr_format ?? media.hdr_format) && (sv?.hdr_format ?? media.hdr_format) !== 'None' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HDR</span>
                    <span className={`font-medium ${
                      (sv?.hdr_format ?? media.hdr_format) === 'Dolby Vision' ? 'text-purple-400' :
                      (sv?.hdr_format ?? media.hdr_format) === 'HDR10' ? 'text-orange-400' :
                      'text-yellow-400'
                    }`}>{sv?.hdr_format ?? media.hdr_format}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Audio */}
            <div className="bg-muted/30 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Audio{svAudioTracks.length > 0 ? ` (${svAudioTracks.length})` : ''}
              </h3>
              {/* Audio Tracks */}
              {svAudioTracks.length > 0 ? (
                <div className="space-y-2">
                  {svAudioTracks.map((track, idx) => {
                    const commentary = isCommentary(track)
                    const isPrimary = track.index === svBestTrackIdx
                    return (
                      <div key={idx} className={`text-sm ${idx > 0 ? 'pt-2 border-t border-border' : ''} ${commentary ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{track.codec?.toUpperCase()} {formatChannels(track.channels)}</span>
                          {track.hasObjectAudio && (
                            <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-300 rounded">Atmos</span>
                          )}
                          {isPrimary && (
                            <span className="px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">Primary</span>
                          )}
                          {commentary && (
                            <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-300 rounded">Commentary</span>
                          )}
                        </div>
                        {track.title && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate" title={track.title}>{track.title}</div>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center">
                          <span>
                            {track.bitrate > 0 ? formatBitrate(track.bitrate) : 'VBR'}
                            {track.sampleRate && ` · ${(track.sampleRate / 1000).toFixed(1)}kHz`}
                            {track.language && ` · ${track.language.toUpperCase()}`}
                          </span>
                          {isAudioBitrateLow(track, sv?.quality_tier ?? media.quality_tier) && <LowIndicator />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-sm">
                  <div className="font-medium">{(sv?.audio_codec ?? media.audio_codec)?.toUpperCase()} {formatChannels(sv?.audio_channels ?? media.audio_channels)}</div>
                  <div className="text-xs text-muted-foreground flex items-center">
                    <span>{formatBitrate(sv?.audio_bitrate ?? media.audio_bitrate)}</span>
                    {isAudioBitrateRawLow(sv?.audio_bitrate ?? media.audio_bitrate, sv?.quality_tier ?? media.quality_tier) && <LowIndicator />}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Subtitles */}
          {svSubtitleTracks.length > 0 && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Subtitles ({svSubtitleTracks.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {svSubtitleTracks.map((track, idx) => (
                  <div
                    key={idx}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-muted/50 rounded"
                    title={track.title || `${track.language || 'Unknown'} (${track.codec})`}
                  >
                    <span className="font-medium">{track.language?.toUpperCase() || 'UND'}</span>
                    <span className="text-muted-foreground">{track.codec}</span>
                    {track.isForced && (
                      <span className="px-1.5 py-0.5 text-xs bg-muted text-muted-foreground rounded leading-none">Forced</span>
                    )}
                    {track.isDefault && (
                      <span className="px-1.5 py-0.5 text-xs bg-muted text-muted-foreground rounded leading-none">Default</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File Info & IDs */}
          <div className="bg-muted/30 rounded-lg p-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">File Information</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground flex-shrink-0">Path</span>
                <span className="font-mono text-xs text-right truncate" title={sv?.file_path ?? media.file_path}>
                  {sv?.file_path ?? media.file_path}
                </span>
              </div>
              {media.imdb_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IMDb</span>
                  <a
                    href={`https://www.imdb.com/title/${media.imdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {media.imdb_id}
                  </a>
                </div>
              )}
              {media.tmdb_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">TMDb</span>
                  <a
                    href={`https://www.themoviedb.org/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {media.tmdb_id}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
