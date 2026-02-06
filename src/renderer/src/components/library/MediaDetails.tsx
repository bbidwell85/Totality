import { useEffect, useState, useCallback } from 'react'
import { MoreVertical, RefreshCw, Pencil } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import type { WishlistMediaType } from '../../contexts/WishlistContext'
import { useMenuClose } from '../../hooks/useMenuClose'

interface MediaDetailsProps {
  mediaId: number
  onClose: () => void
  onRescan?: (mediaId: number, sourceId: string, libraryId: string | null, filePath: string) => Promise<void>
  onFixMatch?: (mediaItemId: number, title: string, year?: number, filePath?: string) => void
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

export function MediaDetails({ mediaId, onClose, onRescan, onFixMatch }: MediaDetailsProps) {
  const [media, setMedia] = useState<MediaWithQuality | null>(null)
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
    return `${t.audio.medium}-${t.audio.high} kbps`
  }

  const getQualityColor = (quality?: 'LOW' | 'MEDIUM' | 'HIGH'): string => {
    switch (quality) {
      case 'HIGH': return 'text-green-500'
      case 'MEDIUM': return 'text-blue-500'
      case 'LOW': return 'text-red-500'
      default: return 'text-muted-foreground'
    }
  }

  const isVideoBitrateLow = (bitrate: number, tier?: string): boolean => {
    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']
    return bitrate < t.video.medium
  }

  const isAudioBitrateLow = (bitrate: number, tier?: string): boolean => {
    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']
    return bitrate < t.audio.medium
  }

  const LowIndicator = () => (
    <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />
  )

  const parseIssues = (issuesJson?: string): string[] => {
    if (!issuesJson) return []
    try {
      return JSON.parse(issuesJson)
    } catch {
      return []
    }
  }

  // Parse quality issues and return abbreviated badge labels
  const getIssueBadges = (issuesJson?: string): { label: string; title: string }[] => {
    if (!issuesJson) return []
    try {
      const issues = JSON.parse(issuesJson) as string[]
      const badges: { label: string; title: string }[] = []
      for (const issue of issues) {
        const issueLower = issue.toLowerCase()
        if (issueLower.includes('low bitrate')) {
          badges.push({ label: 'Low BR', title: issue })
        } else if (issueLower.includes('without hdr') || issueLower.includes('no hdr')) {
          badges.push({ label: 'No HDR', title: issue })
        } else if (issueLower.includes('8-bit')) {
          badges.push({ label: '8-bit', title: issue })
        } else if (issueLower.includes('mono audio')) {
          badges.push({ label: 'Mono', title: issue })
        } else if (issueLower.includes('no premium audio')) {
          badges.push({ label: 'No Atmos', title: issue })
        } else if (issueLower.includes('low audio')) {
          badges.push({ label: 'Low Audio', title: issue })
        }
      }
      return badges
    } catch {
      return []
    }
  }

  const parseAudioTracks = (): AudioTrack[] => {
    if (!media?.audio_tracks) return []
    try {
      return JSON.parse(media.audio_tracks)
    } catch {
      return []
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150]">
        <div className="bg-card rounded-xl p-8 shadow-2xl">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  if (error || !media) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150]">
        <div className="bg-card rounded-xl p-8 shadow-2xl text-center">
          <div className="text-destructive mb-4">{error || 'Media not found'}</div>
          <button onClick={onClose} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">
            Close
          </button>
        </div>
      </div>
    )
  }

  const audioTracks = parseAudioTracks()
  const issues = parseIssues(media.issues)
  const displayTitle = media.type === 'episode' && media.series_title ? media.series_title : media.title

  return (
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
                <h2 className="text-xl font-bold truncate">{displayTitle}</h2>
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

                {/* 3-dot menu for Rescan/Fix Match */}
                {(onRescan || onFixMatch) && (
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
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {media.year && <span className="text-sm text-muted-foreground">{media.year}</span>}
              <span className="text-muted-foreground/40">·</span>
              <span className="text-sm text-muted-foreground">{formatDuration(media.duration)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-sm text-muted-foreground">{formatFileSize(media.file_size)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="px-2 py-0.5 text-xs font-medium bg-muted rounded">{media.resolution}</span>
              {media.container && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground uppercase">{media.container}</span>
                </>
              )}
              {/* Quality Issue Badges */}
              {getIssueBadges(media.issues).length > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  {getIssueBadges(media.issues).map((badge, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-xs font-medium bg-muted rounded"
                      title={badge.title}
                    >
                      {badge.label}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Quality Score Card */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{media.quality_tier}</div>
                  <div className={`text-xs font-medium ${getQualityColor(media.tier_quality)}`}>{media.tier_quality}</div>
                </div>
                {media.tier_score != null && (
                <>
                  <div className="h-10 w-px bg-border" />
                  <div className="text-center">
                    <div className="text-2xl font-bold">{media.tier_score}</div>
                    <div className="text-xs text-muted-foreground">Score</div>
                  </div>
                </>
              )}
              </div>

              {/* Score Bars with Targets */}
              {(media.bitrate_tier_score != null || media.audio_tier_score != null) && (
                <div className="flex-1 max-w-sm space-y-2">
                  {media.bitrate_tier_score != null && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-12">Video</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${media.bitrate_tier_score}%` }} />
                        </div>
                        <span className="text-xs w-8 text-right">{media.bitrate_tier_score}</span>
                      </div>
                      <div className="text-[0.625rem] text-muted-foreground ml-14 mt-0.5">
                        {formatBitrate(media.video_bitrate)} → Target: {getVideoThresholdRange(media.quality_tier)}
                      </div>
                    </div>
                  )}
                  {media.audio_tier_score != null && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-12">Audio</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${media.audio_tier_score}%` }} />
                        </div>
                        <span className="text-xs w-8 text-right">{media.audio_tier_score}</span>
                      </div>
                      <div className="text-[0.625rem] text-muted-foreground ml-14 mt-0.5">
                        {media.audio_channels}.{media.audio_channels > 6 ? '1' : '0'} @ {formatBitrate(media.audio_bitrate)} → Target: {getAudioThresholdRange(media.quality_tier)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Premium Badges */}
              <div className="flex flex-wrap gap-1.5">
                {!!media.hdr_format && media.hdr_format !== 'None' && (
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                    media.hdr_format === 'Dolby Vision' ? 'bg-purple-500/20 text-purple-400' :
                    media.hdr_format === 'HDR10' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>{media.hdr_format}</span>
                )}
                {!!media.has_object_audio && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-500/20 text-blue-400">Atmos</span>
                )}
                {media.color_bit_depth != null && media.color_bit_depth >= 10 && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-500/20 text-green-400">{media.color_bit_depth}-bit</span>
                )}
              </div>
            </div>

            {/* Issues - shown inside quality score card */}
            {issues.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="text-sm text-muted-foreground">
                  {issues.map((issue, i) => (
                    <span key={i}>{issue}{i < issues.length - 1 ? ' · ' : ''}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Technical Specs Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Video Section */}
            <div className="bg-muted/30 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Video</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Codec</span>
                  <span className="font-medium">{media.video_codec}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dimensions</span>
                  <span className="font-medium">{media.width}×{media.height}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bitrate</span>
                  <span className="font-medium flex items-center">
                    {formatBitrate(media.video_bitrate)}
                    {isVideoBitrateLow(media.video_bitrate, media.quality_tier) && <LowIndicator />}
                  </span>
                </div>
                {media.video_frame_rate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Frame Rate</span>
                    <span className="font-medium">{media.video_frame_rate.toFixed(2)} fps</span>
                  </div>
                )}
                {media.video_profile && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Profile</span>
                    <span className="font-medium">{media.video_profile}</span>
                  </div>
                )}
                {media.color_space && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Color</span>
                    <span className="font-medium">{media.color_space}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Audio Section */}
            <div className="bg-muted/30 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audio</h3>

              {/* All Audio Tracks */}
              {audioTracks.length > 0 ? (
                <div className="space-y-2">
                  {audioTracks.map((track, idx) => (
                    <div key={idx} className={`text-sm ${idx === 0 ? '' : 'pt-2 border-t border-border'}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{track.codec?.toUpperCase()} {track.channels}.{track.channels > 6 ? '1' : '0'}</span>
                        {track.hasObjectAudio && (
                          <span className="px-1 py-0.5 text-[0.625rem] bg-blue-500/20 text-blue-400 rounded">Atmos</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center">
                        <span>
                          {track.bitrate > 0 ? formatBitrate(track.bitrate) : 'VBR'}
                          {track.sampleRate && ` · ${(track.sampleRate / 1000).toFixed(1)}kHz`}
                          {track.language && ` · ${track.language.toUpperCase()}`}
                        </span>
                        {track.bitrate > 0 && isAudioBitrateLow(track.bitrate, media.quality_tier) && <LowIndicator />}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm">
                  <div className="font-medium">{media.audio_codec?.toUpperCase()} {media.audio_channels}.0</div>
                  <div className="text-xs text-muted-foreground flex items-center">
                    <span>{formatBitrate(media.audio_bitrate)}</span>
                    {isAudioBitrateLow(media.audio_bitrate, media.quality_tier) && <LowIndicator />}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* File Path - Collapsible */}
          <details className="text-xs">
            <summary className="text-muted-foreground cursor-pointer hover:text-foreground">File Path & IDs</summary>
            <div className="mt-2 space-y-1.5 pl-3 border-l border-border">
              <div className="font-mono text-muted-foreground break-all">{media.file_path}</div>
              {(media.imdb_id || media.tmdb_id) && (
                <div className="flex gap-3">
                  {media.imdb_id && (
                    <a
                      href={`https://www.imdb.com/title/${media.imdb_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      IMDb: {media.imdb_id}
                    </a>
                  )}
                  {media.tmdb_id && (
                    <a
                      href={`https://www.themoviedb.org/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdb_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      TMDb: {media.tmdb_id}
                    </a>
                  )}
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
