import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { RefreshCw, MoreVertical, Pencil, Folder, CircleFadingArrowUp, EyeOff, ChevronDown, ChevronUp, ChevronLeft, Copy, Check, Star } from 'lucide-react'
import { TvPlaceholder, EpisodePlaceholder } from '../ui/MediaPlaceholders'
import { DropdownMenu, DropdownMenuItem } from '../ui/DropdownMenu'
import { Button } from '../ui/Button'
import { AnimatedNumber } from '../ui/AnimatedNumber'
import { MissingItemCard } from './MissingItemCard'
import { useMenuClose } from '../../hooks/useMenuClose'
import { providerColors, formatSeasonLabel, getStatusBadge } from './mediaUtils'
import type { MediaItem, TVShow, TVShowSummary, SeasonInfo, TVSeason, SeriesCompletenessData, MissingEpisode } from './types'
import type { ProviderType } from '../../contexts/SourceContext'

// List item component for TV shows
const ShowListItem = memo(({ show, onClick, completenessData, showSourceBadge, onAnalyzeSeries, onFixMatch }: {
  show: TVShowSummary
  onClick: () => void
  completenessData?: SeriesCompletenessData
  showSourceBadge?: boolean
  onAnalyzeSeries?: () => Promise<void>
  onFixMatch?: (sourceId: string, folderPath?: string) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const totalEpisodes = show.episode_count
  const seasonCount = show.season_count
  const sourceType = show.source_type as ProviderType | undefined
  const sourceId = show.source_id
  const folderPath: string | undefined = undefined

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeSeries) {
      setIsAnalyzing(true)
      await onAnalyzeSeries()
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && sourceId) {
      onFixMatch(sourceId, folderPath)
    }
  }

  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group cursor-pointer rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors duration-200 p-4 flex gap-4 items-center outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster Thumbnail */}
      <div className="w-16 h-24 bg-muted rounded-lg overflow-hidden shrink-0 relative shadow-md shadow-black/20">
        {show.poster_url ? (
          <img
            src={show.poster_url}
            alt={show.series_title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><TvPlaceholder className="w-8 h-8 text-muted-foreground" /></div>
        )}
        {/* Completeness badge — flush to poster edge */}
        {completenessData && (
          <div className="absolute bottom-0 right-0 z-10 bg-foreground text-background text-caption font-semibold px-1.5 py-0.5 rounded-tl-lg">
            {completenessData.owned_episodes}/{completenessData.total_episodes}
          </div>
        )}
        {/* Source badge */}
        {showSourceBadge && sourceType && !completenessData && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-caption font-semibold px-1 py-0.5 rounded`}
          >
            {sourceType.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-label truncate">{show.series_title}</h4>
        <p className="text-caption text-muted-foreground mt-0.5">
          {seasonCount} {seasonCount === 1 ? 'season' : 'seasons'} · {totalEpisodes} episodes
          {completenessData?.status && ` · ${getStatusBadge(completenessData.status)?.text || completenessData.status}`}
        </p>
      </div>

      {/* 3-dot menu */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {isAnalyzing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <MoreVertical className="w-4 h-4" />
          )}
        </button>

        {showMenu && (
          <DropdownMenu>
            <DropdownMenuItem onClick={handleAnalyze} icon={<RefreshCw className="w-3.5 h-3.5" />}>
              Analyze Series
            </DropdownMenuItem>
            {onFixMatch && (
              <DropdownMenuItem onClick={handleFixMatch} icon={<Pencil className="w-3.5 h-3.5" />}>
                Fix Match
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        )}
      </div>
    </div>
  )
})

// Episode row component with keyboard navigation
const EpisodeRow = memo(({ episode, onClick, onRescan, onDismissUpgrade, onAddToWishlist, isMobile = false }: {
  episode: MediaItem
  onClick: () => void
  onRescan?: (episode: MediaItem) => Promise<void>
  onDismissUpgrade?: (episode: MediaItem) => void
  onAddToWishlist?: (episode: MediaItem) => void
  isMobile?: boolean
}) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan) {
      setIsRescanning(true)
      try {
        await onRescan(episode)
      } finally {
        setIsRescanning(false)
      }
    }
  }

  const handleDismissUpgrade = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onDismissUpgrade) {
      onDismissUpgrade(episode)
    }
  }

  const needsUpgrade = episode.tier_quality === 'LOW' || !!episode.needs_upgrade
  const showMenuButton = (onRescan && episode.file_path) || (onDismissUpgrade && needsUpgrade)

  // Format audio channels to standard labels (6ch = 5.1, 8ch = 7.1, etc.)
  const formatChannels = (ch: number): string => {
    if (ch <= 1) return 'Mono'
    if (ch === 2) return 'Stereo'
    return `${ch - 1}.1`
  }
  const audioDisplay = episode.audio_channels ? formatChannels(episode.audio_channels) : ''

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`group flex ${isMobile ? 'gap-2.5 p-2.5' : 'gap-4 p-4'} items-center hover:bg-muted/30 transition-colors cursor-pointer outline-hidden`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Episode Thumbnail */}
      <div className={`${isMobile ? 'w-24' : 'w-44'} aspect-video bg-muted overflow-hidden rounded-lg shadow-md shadow-black/20 shrink-0`}>
        {episode.episode_thumb_url ? (
          <img
            src={episode.episode_thumb_url}
            alt={episode.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><EpisodePlaceholder className="w-10 h-10 text-muted-foreground" /></div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-label font-semibold text-muted-foreground shrink-0">
            E{episode.episode_number}
          </span>
          <h4 className={`font-semibold truncate ${isMobile ? 'text-label' : ''}`}>{episode.title}</h4>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-caption text-muted-foreground">
          {episode.resolution && <span>{episode.resolution}</span>}
          {audioDisplay && <><span>·</span><span>{audioDisplay}</span></>}
          {needsUpgrade && (
            <span title="Quality upgrade recommended"><CircleFadingArrowUp className="w-3.5 h-3.5 text-destructive shrink-0 ml-0.5" /></span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Add to wishlist shortcut for upgrade items */}
        {needsUpgrade && onAddToWishlist && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddToWishlist(episode) }}
            className={`${isMobile ? 'min-h-[44px] min-w-[44px]' : 'p-1.5'} flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors`}
            title="Add to wishlist"
          >
            <Star className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          </button>
        )}

        {/* 3-dot menu */}
        {showMenuButton && (
          <div ref={menuRef} className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className={`${isMobile ? 'min-h-[44px] min-w-[44px]' : 'p-1.5'} flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors`}
            >
              {isRescanning ? (
                <RefreshCw className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} animate-spin`} />
              ) : (
                <MoreVertical className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
              )}
            </button>

            {showMenu && !isRescanning && (
              <DropdownMenu>
                {onRescan && episode.file_path && (
                  <DropdownMenuItem onClick={handleRescan} icon={<RefreshCw className={isMobile ? 'w-4 h-4' : 'w-3.5 h-3.5'} />}>
                    Rescan File
                  </DropdownMenuItem>
                )}
                {onDismissUpgrade && needsUpgrade && (
                  <DropdownMenuItem onClick={handleDismissUpgrade} icon={<EyeOff className={isMobile ? 'w-4 h-4' : 'w-3.5 h-3.5'} />}>
                    Dismiss Upgrade
                  </DropdownMenuItem>
                )}
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export function TVShowsView({
  shows,
  selectedShow,
  selectedSeason,
  selectedShowData,
  selectedShowLoading,
  onSelectShow,
  onSelectSeason,
  onSelectEpisode,
  filterItem: _filterItem,
  gridScale,
  viewType,
  seriesCompleteness,
  onMissingItemClick,
  showSourceBadge,
  onAnalyzeSeries,
  onFixMatch,
  onRescanEpisode,
  onDismissUpgrade,
  onDismissMissingEpisode,
  onDismissMissingSeason,
  totalShowCount,
  totalEpisodeCount,
  showsLoading,
  onLoadMoreShows,
  tvSortBy = 'title',
  onTvSortChange,
  isMobile = false,
  isTablet = false,
}: {
  shows: TVShowSummary[]
  selectedShow: string | null
  selectedSeason: number | null
  selectedShowData: TVShow | null
  selectedShowLoading: boolean
  onSelectShow: (show: string | null) => void
  onSelectSeason: (season: number | null) => void
  onSelectEpisode: (id: number) => void
  filterItem: (item: MediaItem) => boolean
  gridScale: number
  viewType: 'grid' | 'list'
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onMissingItemClick: (item: {
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
  } | null) => void
  showSourceBadge: boolean
  onAnalyzeSeries: (seriesTitle: string) => void
  onFixMatch?: (title: string, sourceId: string, folderPath?: string) => void
  onRescanEpisode?: (episode: MediaItem) => Promise<void>
  onDismissUpgrade?: (item: MediaItem) => void
  onDismissMissingEpisode?: (episode: MissingEpisode, seriesTitle: string, tmdbId?: string) => void
  onDismissMissingSeason?: (seasonNumber: number, seriesTitle: string, tmdbId?: string) => void
  totalShowCount: number
  totalEpisodeCount: number
  showsLoading: boolean
  onLoadMoreShows: () => void
  tvSortBy?: string
  onTvSortChange?: (sort: string) => void
  isMobile?: boolean
  isTablet?: boolean
}) {
  // Breadcrumb navigation
  const handleBack = () => {
    if (selectedSeason !== null) {
      onSelectSeason(null)
    } else if (selectedShow !== null) {
      onSelectShow(null)
    }
  }

  // Escape key to go back in drill-down
  useEffect(() => {
    if (!selectedShow) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShow, selectedSeason])

  // Episode-level filters (local to this view, reset on season/show change)
  const [episodeTierFilter, setEpisodeTierFilter] = useState<'all' | 'SD' | '720p' | '1080p' | '4K'>('all')
  const [episodeQualityFilter, setEpisodeQualityFilter] = useState<'all' | 'low' | 'medium' | 'high'>('all')
  useEffect(() => { setEpisodeTierFilter('all'); setEpisodeQualityFilter('all') }, [selectedSeason, selectedShow])

  // Show detail view menu
  const [showDetailMenu, setShowDetailMenu] = useState(false)
  const [showOverviewExpanded, setShowOverviewExpanded] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  useEffect(() => { setShowOverviewExpanded(false); setCopiedTitle(false) }, [selectedShow])
  const showDetailMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showDetailMenu) return
    const handleClick = (e: MouseEvent) => {
      if (showDetailMenuRef.current && !showDetailMenuRef.current.contains(e.target as Node)) {
        setShowDetailMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showDetailMenu])

  // Fetch show summary from TMDB when a show is selected
  const [showOverview, setShowOverview] = useState<string | null>(null)
  useEffect(() => {
    setShowOverview(null)
    if (selectedShow && !selectedSeason) {
      const completenessData = seriesCompleteness.get(selectedShow)
      if (completenessData?.tmdb_id) {
        window.electronAPI.tmdbGetTVShowDetails(completenessData.tmdb_id)
          .then(details => { if (details?.overview) setShowOverview(details.overview) })
          .catch(() => { /* ignore */ })
      }
    }
  }, [selectedShow, selectedSeason, seriesCompleteness])

  // IntersectionObserver for infinite scroll
  const showSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (viewType !== 'list' || !showSentinelRef.current || selectedShow) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) onLoadMoreShows() },
      { rootMargin: '400px' }
    )
    observer.observe(showSentinelRef.current)
    return () => observer.disconnect()
  }, [viewType, onLoadMoreShows, selectedShow])

  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120, 2: 140, 3: 160, 4: 180, 5: 200, 6: 240, 7: 300
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  const gridClassName = isMobile
    ? 'grid grid-cols-3 gap-3'
    : isTablet
      ? 'grid grid-cols-4 gap-4'
      : 'grid gap-6'

  const gridStyle = (!isMobile && !isTablet)
    ? { gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }
    : undefined

  // Show list view (top level - all shows)
  if (!selectedShow) {
    if (shows.length === 0 && showsLoading) {
      if (viewType === 'list') {
        return (
          <div className="space-y-2 mt-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg">
                <div className="w-10 h-14 bg-muted/50 rounded animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-muted/50 rounded animate-pulse w-2/5" />
                  <div className="h-3 bg-muted/40 rounded animate-pulse w-1/4" />
                </div>
              </div>
            ))}
          </div>
        )
      }
      return (
        <div className={`${gridClassName} mt-4`} style={gridStyle}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-2/3 bg-muted/50 rounded-lg animate-pulse" />
              <div className="mt-2 h-3 bg-muted/50 rounded animate-pulse" />
              <div className="mt-1 h-3 w-2/3 bg-muted/40 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )
    }

    if (shows.length === 0 && !showsLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <TvPlaceholder className="w-20 h-20 text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-title">No TV shows found</p>
          <p className="text-label text-muted-foreground mt-2">
            Scan a TV library from the sidebar to get started
          </p>
        </div>
      )
    }

    const statsBar = (
      <div className="flex items-center gap-4 text-label text-muted-foreground">
        <span><AnimatedNumber value={totalShowCount} locale /> Shows</span>
        <span className="text-muted-foreground/50">•</span>
        <span>{totalEpisodeCount.toLocaleString()} Episodes</span>
        {onTvSortChange && (
          <div className="flex items-center gap-1.5 ml-auto">
            <select
              value={tvSortBy}
              onChange={(e) => onTvSortChange(e.target.value)}
              className="bg-transparent text-caption text-muted-foreground border-none outline-none cursor-pointer hover:text-foreground transition-colors"
            >
              <option value="title">Title</option>
              <option value="play_count">Most Watched</option>
              <option value="last_watched_at">Recently Watched</option>
            </select>
          </div>
        )}
      </div>
    )

    // List view
    if (viewType === 'list') {
      return (
        <>
          {statsBar}
          <div className="space-y-2 mt-4">
            {shows.map((show) => {
              const completeness = seriesCompleteness.get(show.series_title)
              return <div key={`${show.source_id || ''}-${show.series_title}`} data-title={show.series_title}><ShowListItem show={show} onClick={() => onSelectShow(show.series_title)} completenessData={completeness} showSourceBadge={showSourceBadge} onAnalyzeSeries={async () => { await onAnalyzeSeries(show.series_title) }} onFixMatch={onFixMatch ? (sourceId, folderPath) => onFixMatch(show.series_title, sourceId, folderPath) : undefined} /></div>
            })}
          </div>
          <div ref={showSentinelRef} className="h-1" />
          {showsLoading && <div className="flex justify-center py-4"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {totalShowCount > 0 && (
            <div className="text-center text-label text-muted-foreground py-2">
              {shows.length} of {totalShowCount} TV shows
            </div>
          )}
        </>
      )
    }

    // Grid view — native CSS Grid
    return (
      <>
        {statsBar}
        <div className={`${gridClassName} mt-4`} style={gridStyle}>
          {shows.map((show) => {
            const completeness = seriesCompleteness.get(show.series_title)
            return <div key={`${show.source_id || ''}-${show.series_title}`} data-title={show.series_title}><ShowCard show={show} onClick={() => onSelectShow(show.series_title)} completenessData={completeness} showSourceBadge={showSourceBadge} onAnalyzeSeries={() => onAnalyzeSeries(show.series_title)} onFixMatch={onFixMatch ? (sourceId: string, folderPath?: string) => onFixMatch(show.series_title, sourceId, folderPath) : undefined} /></div>
          })}
        </div>
        {/* Skeleton placeholders — show while more items are available */}
        {isMobile && shows.length < totalShowCount && (
          <div className={gridClassName} style={gridStyle}>
            {Array.from({ length: Math.min(12, totalShowCount - shows.length) }).map((_, i) => (
              <div key={`skel-${i}`}>
                <div className="aspect-2/3 bg-muted/30 rounded-lg animate-pulse" />
                <div className="mt-2 h-3 bg-muted/30 rounded animate-pulse" />
              </div>
            ))}
          </div>
        )}
        <div ref={showSentinelRef} className="h-1" />
        {showsLoading && <div className="flex justify-center py-4"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {totalShowCount > 0 && (
          <div className="text-center text-label text-muted-foreground py-2">
            {shows.length} of {totalShowCount} TV shows
          </div>
        )}
      </>
    )
  }

  // Season list view — use selectedShowData (loaded on demand)
  if (selectedShow && selectedSeason === null) {
    if (selectedShowLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh]">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Loading episodes...</p>
        </div>
      )
    }

    if (!selectedShowData) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
          <Button variant="tertiary" size="sm" onClick={handleBack} icon={<ChevronLeft className="w-4 h-4" />} className="mb-4">
            Back to TV shows
          </Button>
          <p className="text-muted-foreground">No episodes found for this show</p>
        </div>
      )
    }

    const ownedSeasons = Array.from(selectedShowData.seasons.values()).sort((a, b) => a.seasonNumber - b.seasonNumber)
    const completenessData = seriesCompleteness.get(selectedShow)

    const missingSeasonNumbers = completenessData?.missing_seasons || []

    // Build combined list of owned and missing seasons
    const ownedSeasonNumbers = new Set(ownedSeasons.map(s => s.seasonNumber))
    const allSeasonItems: Array<{ type: 'owned' | 'missing'; seasonNumber: number; season?: TVSeason }> = [
      ...ownedSeasons.map(s => ({ type: 'owned' as const, seasonNumber: s.seasonNumber, season: s })),
      ...missingSeasonNumbers
        .filter(num => !ownedSeasonNumbers.has(num))
        .map(num => ({ type: 'missing' as const, seasonNumber: num }))
    ].sort((a, b) => a.seasonNumber - b.seasonNumber)

    const totalSeasons = completenessData?.total_seasons || ownedSeasons.length

    return (
      <div className={isMobile ? '' : 'space-y-6'}>
        {/* Show Header */}
        {isMobile ? (
          <div className="relative px-4 pb-3 mb-4 -mx-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)', minHeight: '200px' }}>
            {(selectedShowData.art_url || selectedShowData.poster_url) && (
              <div className="absolute top-0 right-0 w-3/4 will-change-transform" style={{ height: '130%', transform: 'translateY(var(--parallax-y, 0px))' }}>
                <img src={(selectedShowData.art_url || selectedShowData.poster_url)!} alt="" className="w-full h-full object-cover object-top" />
                <div className="absolute inset-0 bg-gradient-to-r from-background to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
              </div>
            )}
            {/* Breadcrumb — inside backdrop on mobile */}
            <div className="relative z-[1] mb-4">
              <Button
                variant="tertiary"
                size="sm"
                onClick={handleBack}
                icon={<ChevronLeft className="w-4 h-4" />}
                className="text-white"
              >
                Back to TV shows
              </Button>
            </div>
            <div className="relative z-[1]">
              <div className="flex items-center gap-1.5">
                <h3 className="text-h2 font-semibold">{selectedShowData.title}</h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(selectedShowData.title)
                    setCopiedTitle(true)
                    setTimeout(() => setCopiedTitle(false), 1500)
                  }}
                  className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy title"
                >
                  {copiedTitle ? <Check className="w-4 h-4 text-foreground" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-label text-muted-foreground">
                <span>{ownedSeasons.length} of {totalSeasons} seasons</span>
                {completenessData?.status && (
                  <>
                    <span>•</span>
                    <span>{getStatusBadge(completenessData.status)?.text || completenessData.status}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 mt-3" ref={showDetailMenuRef}>
                <Button
                  onClick={() => selectedShow && onAnalyzeSeries(selectedShow)}
                  size="sm"
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  title="Analyze series"
                >
                  Analyze series
                </Button>
                {onFixMatch && (
                  <Button
                    variant="tertiary"
                    size="icon-sm"
                    onClick={() => selectedShow && onFixMatch(selectedShow, '', undefined)}
                    icon={<Pencil className="w-4 h-4" />}
                    title="Fix match"
                  />
                )}
              </div>
              {showOverview && (
                <div className="mt-3">
                  <p className={`text-label text-muted-foreground leading-relaxed ${showOverviewExpanded ? '' : 'line-clamp-2'}`}>
                    {showOverview}
                  </p>
                  <button
                    onClick={() => setShowOverviewExpanded(!showOverviewExpanded)}
                    className="flex items-center gap-1 text-label text-muted-foreground hover:text-foreground mt-1 transition-colors"
                  >
                    {showOverviewExpanded ? (
                      <><span>Less</span><ChevronUp className="w-4 h-4" /></>
                    ) : (
                      <><span>More</span><ChevronDown className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-6">
            <div>
              <Button
                variant="tertiary"
                size="sm"
                onClick={handleBack}
                icon={<ChevronLeft className="w-4 h-4" />}
              >
                Back to TV shows
              </Button>
            </div>
            <div className="flex gap-6 mt-3">
              {/* Poster */}
              {selectedShowData.poster_url && (
                <div className="w-44 shrink-0">
                  <img
                    src={selectedShowData.poster_url}
                    alt={selectedShowData.title}
                    loading="lazy"
                    className="w-full h-auto rounded-lg shadow-lg shadow-black/30"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
              {/* Title */}
              <div className="flex items-center gap-1.5">
                <h3 className="text-h1 font-semibold">{selectedShowData.title}</h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(selectedShowData.title)
                    setCopiedTitle(true)
                    setTimeout(() => setCopiedTitle(false), 1500)
                  }}
                  className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy title"
                >
                  {copiedTitle ? <Check className="w-4 h-4 text-foreground" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              {/* Metadata line */}
              <div className="flex items-center gap-2 mt-1 text-label text-muted-foreground">
                <span>{ownedSeasons.length} of {totalSeasons} seasons</span>
                {completenessData?.status && (
                  <>
                    <span>•</span>
                    <span>{getStatusBadge(completenessData.status)?.text || completenessData.status}</span>
                  </>
                )}
              </div>

              {/* Action buttons row */}
              <div className="flex items-center gap-3 mt-3" ref={showDetailMenuRef}>
                <Button
                  onClick={() => selectedShow && onAnalyzeSeries(selectedShow)}
                  size="sm"
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  title="Analyze series"
                >
                  Analyze series
                </Button>
                {onFixMatch && (
                  <Button
                    variant="tertiary"
                    size="icon-sm"
                    onClick={() => selectedShow && onFixMatch(selectedShow, '', undefined)}
                    icon={<Pencil className="w-4 h-4" />}
                    title="Fix match"
                  />
                )}
              </div>

              {/* Overview */}
              {showOverview && (
                <div className="mt-3 max-w-2xl">
                  <p className={`text-label text-muted-foreground leading-relaxed ${showOverviewExpanded ? '' : 'line-clamp-3'}`}>
                    {showOverview}
                  </p>
                  <button
                    onClick={() => setShowOverviewExpanded(!showOverviewExpanded)}
                    className="flex items-center gap-1 text-label text-muted-foreground hover:text-foreground mt-1 transition-colors"
                  >
                    {showOverviewExpanded ? (
                      <><span>Less</span><ChevronUp className="w-4 h-4" /></>
                    ) : (
                      <><span>More</span><ChevronDown className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>
        )}

        <div
          className={`${gridClassName} ${isMobile ? 'relative z-[1]' : ''}`}
          style={gridStyle}
        >
          {allSeasonItems.map((item) => (
            item.type === 'owned' && item.season ? (
              <SeasonCard
                key={item.seasonNumber}
                season={item.season as SeasonInfo}
                showTitle={selectedShowData.title}
                onClick={() => onSelectSeason(item.seasonNumber)}
                missingCount={(completenessData?.missing_episodes || []).filter(ep => ep.season_number === item.seasonNumber).length}
              />
            ) : (
              <MissingSeasonCardWithArtwork
                key={`missing-${item.seasonNumber}`}
                seasonNumber={item.seasonNumber}
                showTitle={selectedShowData.title}
                tmdbId={completenessData?.tmdb_id}
                fallbackPosterUrl={completenessData?.poster_url || selectedShowData.poster_url}
                onClick={() => onMissingItemClick({
                  type: 'season',
                  title: formatSeasonLabel(item.seasonNumber),
                  seasonNumber: item.seasonNumber,
                  posterUrl: completenessData?.poster_url || selectedShowData.poster_url,
                  tmdbId: completenessData?.tmdb_id,
                  seriesTitle: selectedShowData.title
                })}
                onDismiss={onDismissMissingSeason ? () => onDismissMissingSeason(item.seasonNumber, selectedShowData.title, completenessData?.tmdb_id) : undefined}
                             />
            )
          ))}
        </div>
      </div>
    )
  }

  // Episode list view
  if (selectedShow && selectedSeason !== null && selectedShowData) {
    const season = selectedShowData.seasons.get(selectedSeason)
    const completenessData = seriesCompleteness.get(selectedShow)

    // Get owned episodes for this season, filtered by resolution/quality
    const allOwnedEpisodes = season ? season.episodes : []
    const ownedEpisodes = allOwnedEpisodes.filter(ep => {
      if (episodeTierFilter !== 'all' && ep.quality_tier !== episodeTierFilter) return false
      if (episodeQualityFilter !== 'all' && (ep.tier_quality || 'MEDIUM').toLowerCase() !== episodeQualityFilter) return false
      return true
    })
    const ownedEpisodeNumbers = new Set(allOwnedEpisodes.map(e => e.episode_number))

    const missingEpisodesForSeason = (completenessData?.missing_episodes || []).filter(
      ep => ep.season_number === selectedSeason && !ownedEpisodeNumbers.has(ep.episode_number)
    )

    // Get fallback poster for missing episodes (season poster > series poster)
    const missingEpisodePoster = season?.posterUrl || completenessData?.poster_url || selectedShowData.poster_url

    // Build combined list sorted by episode number
    type EpisodeItem = { type: 'owned'; episode: MediaItem } | { type: 'missing'; missing: MissingEpisode }
    const allEpisodeItems: EpisodeItem[] = [
      ...ownedEpisodes.map(e => ({ type: 'owned' as const, episode: e })),
      ...missingEpisodesForSeason.map(m => ({ type: 'missing' as const, missing: m }))
    ].sort((a, b) => {
      const aNum = a.type === 'owned' ? (a.episode.episode_number || 0) : a.missing.episode_number
      const bNum = b.type === 'owned' ? (b.episode.episode_number || 0) : b.missing.episode_number
      return aNum - bNum
    })

    return (
      <div className={isMobile ? '' : 'space-y-6'}>
        {isMobile ? (
          <div className="relative px-4 pb-3 mb-4 -mx-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)', minHeight: '200px' }}>
            {(() => { const url = selectedShowData.art_url || season?.posterUrl || completenessData?.poster_url || selectedShowData.poster_url; return url ? (
              <div className="absolute top-0 right-0 w-3/4 h-full will-change-transform" style={{ transform: 'translateY(var(--parallax-y, 0px))' }}>
                <img src={url} alt="" className="w-full h-full object-cover object-top" />
                <div className="absolute inset-0 bg-gradient-to-r from-background to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
              </div>
            ) : null })()}
            {/* Breadcrumb inside backdrop */}
            <div className="relative z-[1] mb-4">
              <Button variant="tertiary" size="sm" onClick={handleBack} icon={<ChevronLeft className="w-4 h-4" />} className="text-white">
                Back to {selectedShowData.title}
              </Button>
            </div>
            <div className="relative z-[1]">
              {/* Season poster art */}
              {(season?.posterUrl || selectedShowData.poster_url) && (
                <div className="w-24 h-36 rounded-lg overflow-hidden shadow-lg shadow-black/30 mb-3">
                  <img src={season?.posterUrl || selectedShowData.poster_url!} alt={formatSeasonLabel(selectedSeason!)} className="w-full h-full object-cover" />
                </div>
              )}
              <h3 className="text-h2 font-semibold">{formatSeasonLabel(selectedSeason!)}</h3>
              <p className="text-label text-muted-foreground mt-0.5">
                {selectedShowData.title} · {allOwnedEpisodes.length} episode{allOwnedEpisodes.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-4">
            <Button variant="tertiary" size="sm" onClick={handleBack} icon={<ChevronLeft className="w-4 h-4" />}>
              Back to {selectedShowData.title}
            </Button>
            <div className="flex gap-5 mt-3">
              {(season?.posterUrl || selectedShowData.poster_url) && (
                <div className="w-24 h-36 shrink-0 rounded-lg overflow-hidden shadow-lg shadow-black/30">
                  <img src={season?.posterUrl || selectedShowData.poster_url!} alt={formatSeasonLabel(selectedSeason!)} className="w-full h-full object-cover" />
                </div>
              )}
              <div>
                <h3 className="text-h2 font-semibold">{formatSeasonLabel(selectedSeason!)}</h3>
                <p className="text-label text-muted-foreground mt-0.5">
                  {selectedShowData.title} · {allOwnedEpisodes.length} episode{allOwnedEpisodes.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Episode filters — desktop only (mobile shows resolution/quality inline per episode row) */}
        {!isMobile && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted-foreground">Resolution</span>
            <div className="flex gap-1">
              {(['all', '4K', '1080p', '720p', 'SD'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setEpisodeTierFilter(tier)}
                  className={`px-2.5 py-1 rounded-lg text-caption transition-colors ${
                    episodeTierFilter === tier
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {tier === 'all' ? 'All' : tier}
                </button>
              ))}
            </div>
          </div>
          <div className="h-6 w-px bg-border/50" />
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted-foreground">Quality</span>
            <div className="flex gap-1">
              {(['all', 'high', 'medium', 'low'] as const).map((quality) => (
                <button
                  key={quality}
                  onClick={() => setEpisodeQualityFilter(quality)}
                  className={`px-2.5 py-1 rounded-lg text-caption transition-colors ${
                    episodeQualityFilter === quality
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {quality.charAt(0).toUpperCase() + quality.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {(episodeTierFilter !== 'all' || episodeQualityFilter !== 'all') && (
            <span className="text-caption text-muted-foreground">
              {ownedEpisodes.length} of {allOwnedEpisodes.length} episodes
            </span>
          )}
        </div>
        )}

        <div className={`divide-y divide-border/50 ${isMobile ? 'relative z-[1]' : ''}`}>
          {allEpisodeItems.map((item) => (
            item.type === 'owned' ? (
              <EpisodeRow
                key={item.episode.id}
                episode={item.episode}
                onClick={() => onSelectEpisode(item.episode.id)}
                onRescan={onRescanEpisode}
                onDismissUpgrade={onDismissUpgrade}
                isMobile={isMobile}
                             />
            ) : (
              <MissingEpisodeRowWithArtwork
                key={`missing-${item.missing.season_number}-${item.missing.episode_number}`}
                episode={item.missing}
                tmdbId={completenessData?.tmdb_id}
                fallbackPosterUrl={missingEpisodePoster}
                onClick={() => onMissingItemClick({
                  type: 'episode',
                  title: item.missing.title || `Episode ${item.missing.episode_number}`,
                  airDate: item.missing.air_date,
                  seasonNumber: item.missing.season_number,
                  episodeNumber: item.missing.episode_number,
                  posterUrl: missingEpisodePoster,
                  tmdbId: completenessData?.tmdb_id,
                  seriesTitle: selectedShowData.title
                })}
                onDismiss={onDismissMissingEpisode ? () => onDismissMissingEpisode(item.missing, selectedShowData.title, completenessData?.tmdb_id) : undefined}
                isMobile={isMobile}
                             />
            )
          ))}
        </div>
      </div>
    )
  }

  return null
}

const ShowCard = memo(({ show, onClick, completenessData, showSourceBadge, onAnalyzeSeries, onFixMatch }: { show: TVShowSummary; onClick: () => void; completenessData?: SeriesCompletenessData; showSourceBadge?: boolean; onAnalyzeSeries?: () => void; onFixMatch?: (sourceId: string, folderPath?: string) => void }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const totalEpisodes = show.episode_count
  const sourceType = show.source_type as ProviderType | undefined
  const sourceId = show.source_id
  const folderPath: string | undefined = undefined

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeSeries) {
      setIsAnalyzing(true)
      await onAnalyzeSeries()
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && sourceId) {
      onFixMatch(sourceId, folderPath)
    }
  }

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only cursor-pointer hover-scale relative group outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-lg shadow-lg shadow-black/30">
        {/* 3-dot menu button */}
        <div ref={menuRef} className="absolute top-2 left-2 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isAnalyzing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <MoreVertical className="w-4 h-4" />
            )}
          </button>

          {showMenu && (
            <DropdownMenu align="left">
              <DropdownMenuItem onClick={handleAnalyze} icon={<RefreshCw className="w-3.5 h-3.5" />}>
                Analyze Series
              </DropdownMenuItem>
              {onFixMatch && (
                <DropdownMenuItem onClick={handleFixMatch} icon={<Pencil className="w-3.5 h-3.5" />}>
                  Fix Match
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          )}
        </div>

        {/* Source Badge — hidden when completeness badge present */}
        {showSourceBadge && sourceType && !completenessData && (
          <div
            className={`absolute bottom-2 left-2 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-caption font-semibold px-1.5 py-0.5 rounded shadow-md`}
            title={sourceType.charAt(0).toUpperCase() + sourceType.slice(1)}
          >
            {sourceType.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Completeness badge — flush to poster edge */}
        {completenessData && (
          <div className="absolute bottom-0 right-0 z-10 bg-foreground text-background text-caption font-semibold px-1.5 py-0.5 rounded-tl-lg">
            {completenessData.owned_episodes}/{completenessData.total_episodes}
          </div>
        )}

        {show.poster_url ? (
          <img
            src={show.poster_url}
            alt={show.series_title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><TvPlaceholder className="w-20 h-20 text-muted-foreground" /></div>
        )}
      </div>

      {/* Title and info below poster */}
      <div className="pt-2">
        <h4 className="font-medium text-label truncate">{show.series_title}</h4>
        <p className="text-caption text-muted-foreground">
          {show.season_count} {show.season_count === 1 ? 'season' : 'seasons'} · {totalEpisodes} episodes
        </p>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.show.series_title === nextProps.show.series_title &&
         prevProps.show.poster_url === nextProps.show.poster_url &&
         prevProps.show.episode_count === nextProps.show.episode_count &&
         prevProps.show.season_count === nextProps.show.season_count &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.completenessData?.id === nextProps.completenessData?.id &&
         prevProps.completenessData?.completeness_percentage === nextProps.completenessData?.completeness_percentage &&
         prevProps.onAnalyzeSeries === nextProps.onAnalyzeSeries
})

// Component to fetch and display missing season with actual TMDB artwork
const MissingSeasonCardWithArtwork = memo(({
  seasonNumber,
  showTitle,
  tmdbId,
  fallbackPosterUrl,
  onClick,
  onDismiss
}: {
  seasonNumber: number
  showTitle: string
  tmdbId?: string
  fallbackPosterUrl?: string
  onClick: () => void
  onDismiss?: () => void
}) => {
  const [posterUrl, setPosterUrl] = useState<string | undefined>(fallbackPosterUrl)

  useEffect(() => {
    if (tmdbId) {
      window.electronAPI.seriesGetSeasonPoster(tmdbId, seasonNumber)
        .then((url) => {
          if (url) setPosterUrl(url)
        })
        .catch((err) => {
          console.warn(`Failed to fetch ${formatSeasonLabel(seasonNumber)} poster:`, err)
        })
    }
  }, [tmdbId, seasonNumber])

  return (
    <MissingItemCard
      type="season"
      title={formatSeasonLabel(seasonNumber)}
      subtitle={showTitle}
      posterUrl={posterUrl}
      onClick={onClick}
      onDismiss={onDismiss}
      tmdbId={tmdbId}
      seriesTitle={showTitle}
      seasonNumber={seasonNumber}
    />
  )
})

// Component to fetch and display missing episode with actual TMDB artwork
const MissingEpisodeRowWithArtwork = memo(({
  episode,
  tmdbId,
  fallbackPosterUrl,
  onClick,
  onDismiss,
  isMobile = false,
}: {
  episode: MissingEpisode
  tmdbId?: string
  fallbackPosterUrl?: string
  onClick: () => void
  onDismiss?: () => void
  isMobile?: boolean
}) => {
  const [stillUrl, setStillUrl] = useState<string | undefined>(fallbackPosterUrl)
  const [showMenu, setShowMenu] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  // Skip individual TMDB still fetches on mobile — use fallback poster to avoid N RPC round trips
  useEffect(() => {
    if (tmdbId && !isMobile) {
      window.electronAPI.seriesGetEpisodeStill(tmdbId, episode.season_number, episode.episode_number)
        .then((url) => {
          if (url) setStillUrl(url)
        })
        .catch((err) => {
          console.warn(`Failed to fetch episode still for S${episode.season_number}E${episode.episode_number}:`, err)
        })
    }
  }, [tmdbId, episode.season_number, episode.episode_number, isMobile])

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`group flex ${isMobile ? 'gap-2.5 p-2.5' : 'gap-4 p-4'} items-center hover:bg-muted/30 transition-colors cursor-pointer outline-hidden`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Missing Episode Thumbnail - 16:9 aspect ratio with shadow */}
      <div className={`${isMobile ? 'w-24' : 'w-44'} aspect-video bg-muted shrink-0 overflow-hidden rounded-lg shadow-md shadow-black/20`}>
        {stillUrl ? (
          <img
            src={stillUrl}
            alt={episode.title || `Episode ${episode.episode_number}`}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover grayscale opacity-50"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50">
            <EpisodePlaceholder className="w-10 h-10 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-label font-semibold text-muted-foreground shrink-0">
            E{episode.episode_number}
          </span>
          <h4 className="font-semibold truncate text-muted-foreground">
            {episode.title || 'Unknown Title'}
          </h4>
        </div>
        {episode.air_date && (
          <p className="text-caption text-muted-foreground mt-0.5">
            Aired: {new Date(episode.air_date).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* 3-dot menu */}
      {onDismiss && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <DropdownMenu>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDismiss() }} icon={<EyeOff className="w-3.5 h-3.5" />}>
                Dismiss
              </DropdownMenuItem>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
})

const SeasonCard = memo(({ season, showTitle, onClick, missingCount = 0 }: { season: SeasonInfo; showTitle: string; onClick: () => void; missingCount?: number }) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const owned = season.episodes.length
  const total = owned + missingCount

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only group cursor-pointer hover-scale outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-lg shadow-lg shadow-black/30">
        {season.posterUrl ? (
          <img
            src={season.posterUrl}
            alt={`${showTitle} - ${formatSeasonLabel(season.seasonNumber)}`}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><Folder className="w-16 h-16 text-white/30" strokeWidth={1.5} /></div>
        )}
        {/* Completeness badge — flush to poster edge */}
        {total > 0 && missingCount > 0 && (
          <div className="absolute bottom-0 right-0 z-10 bg-foreground text-background text-caption font-semibold px-1.5 py-0.5 rounded-tl-lg">
            {owned}/{total}
          </div>
        )}
      </div>

      {/* Title below poster */}
      <div className="pt-2">
        <h4 className="font-medium text-label truncate">{formatSeasonLabel(season.seasonNumber)}</h4>
        <p className="text-caption text-muted-foreground">
          {total > 0 && owned < total
            ? `${owned} of ${total} ${total === 1 ? 'Episode' : 'Episodes'}`
            : `${owned} ${owned === 1 ? 'Episode' : 'Episodes'}`
          }
        </p>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.season.seasonNumber === nextProps.season.seasonNumber &&
         prevProps.showTitle === nextProps.showTitle &&
         prevProps.season.posterUrl === nextProps.season.posterUrl &&
         prevProps.season.episodes === nextProps.season.episodes &&
         prevProps.missingCount === nextProps.missingCount
})
