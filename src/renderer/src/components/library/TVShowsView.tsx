import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { RefreshCw, MoreVertical, Pencil, X, Folder, CircleFadingArrowUp, EyeOff } from 'lucide-react'
import { QualityBadges } from './QualityBadges'
import { TvPlaceholder, EpisodePlaceholder } from '../ui/MediaPlaceholders'
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

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-none"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster Thumbnail */}
      <div className="w-16 h-24 bg-muted rounded-md overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {show.poster_url ? (
          <img
            src={show.poster_url}
            alt={show.series_title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><TvPlaceholder className="w-8 h-8 text-muted-foreground" /></div>
        )}
        {/* 3-dot menu button */}
        <div className="absolute top-1 left-1 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isAnalyzing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <MoreVertical className="w-3 h-3" />
            )}
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute top-7 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
              <button
                onClick={handleAnalyze}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Analyze Series
              </button>
              {onFixMatch && (
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
        {/* Source badge */}
        {showSourceBadge && sourceType && (
          <div
            className={`absolute bottom-0 left-0 right-0 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-xs font-bold text-center py-0.5`}
          >
            {sourceType.toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{show.series_title}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'} • {totalEpisodes} Episodes
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {completenessData && (
            <span className="text-xs text-muted-foreground">
              {completenessData.owned_episodes}/{completenessData.total_episodes} episodes
            </span>
          )}
          {completenessData?.status && (
            <span className="px-2 py-0.5 text-xs font-medium bg-muted rounded">
              {getStatusBadge(completenessData.status)?.text || completenessData.status}
            </span>
          )}
        </div>
      </div>

      {/* Completion Badge */}
      {completenessData && (
        <div
          className="flex-shrink-0 flex items-center"
          title={`${completenessData.owned_episodes} of ${completenessData.total_episodes} episodes`}
        >
          {completenessData.completeness_percentage === 100 ? (
            <div className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              100%
            </div>
          ) : (
            <div className="bg-foreground text-background text-xs font-bold px-2 py-1 rounded shadow-md border border-border">
              {Math.round(completenessData.completeness_percentage)}%
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// Episode row component with keyboard navigation
const EpisodeRow = memo(({ episode, onClick, onRescan, onDismissUpgrade }: {
  episode: MediaItem
  onClick: () => void
  onRescan?: (episode: MediaItem) => Promise<void>
  onDismissUpgrade?: (episode: MediaItem) => void
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

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group flex gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer outline-none"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Episode Thumbnail - 16:9 aspect ratio with shadow */}
      <div className="w-44 aspect-video bg-muted flex-shrink-0 relative overflow-hidden rounded-md shadow-md shadow-black/20">
        {episode.episode_thumb_url ? (
          <img
            src={episode.episode_thumb_url}
            alt={episode.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><EpisodePlaceholder className="w-10 h-10 text-muted-foreground" /></div>
        )}

        {/* 3-dot menu button */}
        {showMenuButton && (
          <div ref={menuRef} className="absolute top-1 left-1 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className={`w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity ${isRescanning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              {isRescanning ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <MoreVertical className="w-3 h-3" />
              )}
            </button>

            {showMenu && !isRescanning && (
              <div className="absolute top-7 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                {onRescan && episode.file_path && (
                  <button
                    onClick={handleRescan}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rescan File
                  </button>
                )}
                {onDismissUpgrade && needsUpgrade && (
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
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground flex-shrink-0">
            E{episode.episode_number}
          </span>
          <h4 className="font-semibold truncate">{episode.title}</h4>
        </div>
        <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
          <span>{episode.resolution}</span>
          <span>{(episode.video_bitrate / 1000).toFixed(1)} Mbps</span>
          <span>{episode.audio_channels}.0 Audio</span>
        </div>

        {/* Quality badges - white bg with black text */}
        <div className="mt-2 flex flex-wrap gap-1">
          <QualityBadges item={episode} whiteBg />
        </div>
      </div>

      {/* Upgrade indicator */}
      {(episode.tier_quality === 'LOW' || !!episode.needs_upgrade) && (
        <div
          className="flex-shrink-0 flex items-center"
          title="Quality upgrade recommended"
        >
          <CircleFadingArrowUp className="w-6 h-6 text-red-500" />
        </div>
      )}
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
  filterItem,
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
}) {
  // Breadcrumb navigation
  const handleBack = () => {
    if (selectedSeason !== null) {
      onSelectSeason(null)
    } else if (selectedShow !== null) {
      onSelectShow(null)
    }
  }

  // IntersectionObserver for infinite scroll
  const showSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showSentinelRef.current || selectedShow) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) onLoadMoreShows() },
      { rootMargin: '400px' }
    )
    observer.observe(showSentinelRef.current)
    return () => observer.disconnect()
  }, [onLoadMoreShows, selectedShow])

  // Map scale to minimum poster width (same as movies)
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120,  // Smallest posters
      2: 140,
      3: 160,
      4: 180,
      5: 200,  // Default
      6: 240,
      7: 300   // Largest posters
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Show list view (top level - all shows)
  if (!selectedShow) {
    if (shows.length === 0 && !showsLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <TvPlaceholder className="w-20 h-20 text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-lg">No TV shows found</p>
          <p className="text-sm text-muted-foreground mt-2">
            Scan a TV library from the sidebar to get started
          </p>
        </div>
      )
    }

    const statsBar = (
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span>{totalShowCount.toLocaleString()} Shows</span>
        <span className="text-muted-foreground/50">•</span>
        <span>{totalEpisodeCount.toLocaleString()} Episodes</span>
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
              return <ShowListItem key={show.series_title} show={show} onClick={() => onSelectShow(show.series_title)} completenessData={completeness} showSourceBadge={showSourceBadge} onAnalyzeSeries={async () => { await onAnalyzeSeries(show.series_title) }} onFixMatch={onFixMatch ? (sourceId, folderPath) => onFixMatch(show.series_title, sourceId, folderPath) : undefined} />
            })}
          </div>
          <div ref={showSentinelRef} className="h-1" />
          {showsLoading && <div className="flex justify-center py-4"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {totalShowCount > 0 && (
            <div className="text-center text-sm text-muted-foreground py-2">
              {shows.length} of {totalShowCount} TV shows
            </div>
          )}
        </>
      )
    }

    // Grid view (default)
    return (
      <>
        {statsBar}
        <div
          className="grid gap-8 mt-4"
          style={{
            gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)`
          }}
        >
          {shows.map((show) => {
            const completeness = seriesCompleteness.get(show.series_title)
            return <ShowCard key={show.series_title} show={show} onClick={() => onSelectShow(show.series_title)} completenessData={completeness} showSourceBadge={showSourceBadge} onAnalyzeSeries={() => onAnalyzeSeries(show.series_title)} onFixMatch={onFixMatch ? (sourceId, folderPath) => onFixMatch(show.series_title, sourceId, folderPath) : undefined} />
          })}
        </div>
        <div ref={showSentinelRef} className="h-1" />
        {showsLoading && <div className="flex justify-center py-4"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {totalShowCount > 0 && (
          <div className="text-center text-sm text-muted-foreground py-2">
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
          <button onClick={handleBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to TV Shows
          </button>
          <p className="text-muted-foreground">No episodes found for this show</p>
        </div>
      )
    }

    const ownedSeasons = Array.from(selectedShowData.seasons.values()).sort((a, b) => a.seasonNumber - b.seasonNumber)
    const completenessData = seriesCompleteness.get(selectedShow)

    // Parse missing seasons from completeness data
    let missingSeasonNumbers: number[] = []
    if (completenessData?.missing_seasons) {
      try {
        missingSeasonNumbers = JSON.parse(completenessData.missing_seasons) || []
      } catch {
        missingSeasonNumbers = []
      }
    }

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
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to TV Shows
        </button>

        <div className="flex items-start gap-4 mb-6">
          {selectedShowData.poster_url && (
            <div className="w-32 aspect-[2/3] bg-muted rounded-lg overflow-hidden flex-shrink-0 shadow-lg shadow-black/30">
              <img
                src={selectedShowData.poster_url}
                alt={selectedShowData.title}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
          )}
          <div>
            <h3 className="text-2xl font-bold mb-1">{selectedShowData.title}</h3>
            {completenessData?.status && (
              <div className="mb-2">
                <span className="inline-block px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
                  {getStatusBadge(completenessData.status)?.text || completenessData.status}
                </span>
              </div>
            )}
            <p className="text-muted-foreground">
              {ownedSeasons.length} of {totalSeasons} Seasons
              {missingSeasonNumbers.length > 0 && (
                <span className="text-orange-500 ml-2">({missingSeasonNumbers.length} missing)</span>
              )}
            </p>
            <button
              onClick={() => onAnalyzeSeries(selectedShow)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors mt-3"
            >
              <RefreshCw className="w-4 h-4" />
              Analyze Series
            </button>
          </div>
        </div>

        <div
          className="grid gap-8"
          style={{
            gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)`
          }}
        >
          {allSeasonItems.map((item) => (
            item.type === 'owned' && item.season ? (
              <SeasonCard
                key={item.seasonNumber}
                season={item.season as SeasonInfo}
                showTitle={selectedShowData.title}
                onClick={() => onSelectSeason(item.seasonNumber)}
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

    // Get owned episodes for this season
    const ownedEpisodes = season ? season.episodes.filter(filterItem) : []
    const ownedEpisodeNumbers = new Set(ownedEpisodes.map(e => e.episode_number))

    // Parse missing episodes from completeness data, filter by current season
    let missingEpisodesForSeason: MissingEpisode[] = []
    if (completenessData?.missing_episodes) {
      try {
        const allMissing: MissingEpisode[] = JSON.parse(completenessData.missing_episodes) || []
        missingEpisodesForSeason = allMissing.filter(
          ep => ep.season_number === selectedSeason && !ownedEpisodeNumbers.has(ep.episode_number)
        )
      } catch {
        missingEpisodesForSeason = []
      }
    }

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
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to {selectedShowData.title}
        </button>

        <div className="flex items-center gap-4">
          <h3 className="text-xl font-bold">
            {selectedShowData.title} - {formatSeasonLabel(selectedSeason!)}
          </h3>
          {missingEpisodesForSeason.length > 0 && (
            <span className="text-sm text-orange-500">
              ({missingEpisodesForSeason.length} missing)
            </span>
          )}
        </div>

        <div className="divide-y divide-border/50">
          {allEpisodeItems.map((item) => (
            item.type === 'owned' ? (
              <EpisodeRow
                key={item.episode.id}
                episode={item.episode}
                onClick={() => onSelectEpisode(item.episode.id)}
                onRescan={onRescanEpisode}
                onDismissUpgrade={onDismissUpgrade}
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
      className="focus-poster-only cursor-pointer hover-scale relative group outline-none"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
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

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
              <button
                onClick={handleAnalyze}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Analyze Series
              </button>
              {onFixMatch && (
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

        {/* Source Badge */}
        {showSourceBadge && sourceType && (
          <div
            className={`absolute bottom-2 left-2 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
            title={sourceType.charAt(0).toUpperCase() + sourceType.slice(1)}
          >
            {sourceType.charAt(0).toUpperCase()}
          </div>
        )}

        {show.poster_url ? (
          <img
            src={show.poster_url}
            alt={show.series_title}
            loading="lazy"
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
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{show.series_title}</h4>
          <p className="text-xs text-muted-foreground">
            {show.season_count} {show.season_count === 1 ? 'Season' : 'Seasons'} • {totalEpisodes} Episodes
          </p>
        </div>
        {completenessData && (
          <div
            className="flex-shrink-0"
            title={`${completenessData.owned_episodes} of ${completenessData.total_episodes} episodes`}
          >
            {completenessData.completeness_percentage === 100 ? (
              <div className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                100%
              </div>
            ) : (
              <div className="bg-foreground text-background text-xs font-bold px-2 py-1 rounded shadow-md border border-border">
                {Math.round(completenessData.completeness_percentage)}%
              </div>
            )}
          </div>
        )}
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
  onDismiss
}: {
  episode: MissingEpisode
  tmdbId?: string
  fallbackPosterUrl?: string
  onClick: () => void
  onDismiss?: () => void
}) => {
  const [stillUrl, setStillUrl] = useState<string | undefined>(fallbackPosterUrl)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tmdbId) {
      window.electronAPI.seriesGetEpisodeStill(tmdbId, episode.season_number, episode.episode_number)
        .then((url) => {
          if (url) setStillUrl(url)
        })
        .catch((err) => {
          console.warn(`Failed to fetch episode still for S${episode.season_number}E${episode.episode_number}:`, err)
        })
    }
  }, [tmdbId, episode.season_number, episode.episode_number])

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="flex gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer outline-none"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Missing Episode Thumbnail - 16:9 aspect ratio with shadow */}
      <div className="w-44 aspect-video bg-muted flex-shrink-0 relative overflow-hidden rounded-md shadow-md shadow-black/20">
        {stillUrl ? (
          <img
            src={stillUrl}
            alt={episode.title || `Episode ${episode.episode_number}`}
            loading="lazy"
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
          <span className="text-sm font-semibold text-muted-foreground flex-shrink-0">
            E{episode.episode_number}
          </span>
          <h4 className="font-semibold truncate text-muted-foreground">
            {episode.title || 'Unknown Title'}
          </h4>
        </div>
        {episode.air_date && (
          <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
            <span>Aired: {new Date(episode.air_date).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Missing indicator and dismiss */}
      <div className="flex-shrink-0 flex items-center gap-2">
        <span className="text-orange-500 text-xs font-bold uppercase">Missing</span>
        {onDismiss && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss() }}
            className="w-7 h-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
})

const SeasonCard = memo(({ season, showTitle, onClick }: { season: SeasonInfo; showTitle: string; onClick: () => void }) => {
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only group cursor-pointer hover-scale outline-none"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="aspect-[2/3] bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {season.posterUrl ? (
          <img
            src={season.posterUrl}
            alt={`${showTitle} - ${formatSeasonLabel(season.seasonNumber)}`}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><Folder className="w-16 h-16 text-white/30" strokeWidth={1.5} /></div>
        )}
      </div>

      {/* Title below poster */}
      <div className="pt-2">
        <h4 className="font-medium text-sm truncate">{formatSeasonLabel(season.seasonNumber)}</h4>
        <p className="text-xs text-muted-foreground">
          {season.episodes.length} {season.episodes.length === 1 ? 'Episode' : 'Episodes'}
        </p>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.season.seasonNumber === nextProps.season.seasonNumber &&
         prevProps.showTitle === nextProps.showTitle &&
         prevProps.season.posterUrl === nextProps.season.posterUrl &&
         prevProps.season.episodes === nextProps.season.episodes
})
