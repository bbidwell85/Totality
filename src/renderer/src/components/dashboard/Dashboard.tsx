/**
 * Dashboard - Home screen summarizing what needs attention
 *
 * Three column layout with scrollable lists for upgrades, collections, and series.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { FixedSizeList as VirtualList, VariableSizeList } from 'react-window'
import { Sparkles, Library, Tv, Film, Music, Disc3, CircleFadingArrowUp, ChevronDown, Plus } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import { useSources } from '../../contexts/SourceContext'
import type { MediaItem, MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData, MusicAlbum } from '../library/types'

// Music album with quality info from the upgrade query
interface MusicAlbumUpgrade extends MusicAlbum {
  quality_tier: string
  tier_quality: string
  tier_score: number
}

// Missing item types for expanded rows
interface MissingMovie {
  tmdb_id: string
  title: string
  year?: number
  poster_url?: string
}

interface MissingEpisode {
  season_number: number
  episode_number: number
  episode_title?: string
}

interface MissingAlbumItem {
  musicbrainz_id: string
  title: string
  year?: number
  album_type: 'album' | 'ep' | 'single'
}

// Grouping interfaces for improved visualization
interface SeasonGroup {
  seasonNumber: number
  isWholeSeason: boolean  // true if ALL episodes in season are missing
  totalEpisodes: number
  missingEpisodes: MissingEpisode[]
}


interface DashboardProps {
  onNavigateToLibrary: (view: 'movies' | 'tv' | 'music') => void
  onAddSource?: () => void
  sidebarCollapsed?: boolean
  hasMovies?: boolean
  hasTV?: boolean
  hasMusic?: boolean
}

type UpgradeTab = 'movies' | 'tv' | 'music'

// Item heights for virtual lists (fixed height rows)
const MOVIE_ITEM_HEIGHT = 80  // poster height + padding
const TV_ITEM_HEIGHT = 80
const MUSIC_ITEM_HEIGHT = 64  // square album art + padding

// Expandable row constants (variable height rows)
const COLLAPSED_HEIGHT = 80  // Base row height for collections/series
const COLLAPSED_HEIGHT_ARTIST = 64  // Smaller for artists

// Connected indent design constants
const EXPANDED_MARGIN = 8           // mt-2 margin above expanded content
const EXPANDED_ITEM_HEIGHT = 40     // py-2 item row with hover
const ITEM_GAP = 4                  // space-y-1 gap between items

// Section-specific heights
const SECTION_HEADER_HEIGHT = 36    // Season/type section header
const TYPE_SECTION_GAP = 12         // space-y-3 gap between album type groups

export function Dashboard({
  onNavigateToLibrary,
  onAddSource,
  sidebarCollapsed = false,
  hasMovies = false,
  hasTV = false,
  hasMusic = false
}: DashboardProps) {
  const { sources } = useSources()
  const [movieUpgrades, setMovieUpgrades] = useState<MediaItem[]>([])
  const [tvUpgrades, setTvUpgrades] = useState<MediaItem[]>([])
  const [musicUpgrades, setMusicUpgrades] = useState<MusicAlbumUpgrade[]>([])
  const [collections, setCollections] = useState<MovieCollectionData[]>([])
  const [series, setSeries] = useState<SeriesCompletenessData[]>([])
  const [artists, setArtists] = useState<ArtistCompletenessData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Default to first available library type
  const [upgradeTab, setUpgradeTab] = useState<UpgradeTab>(() =>
    hasMovies ? 'movies' : hasTV ? 'tv' : hasMusic ? 'music' : 'movies'
  )
  const [upgradeListHeight, setUpgradeListHeight] = useState(400)
  const [collectionsListHeight, setCollectionsListHeight] = useState(400)
  const [seriesListHeight, setSeriesListHeight] = useState(400)
  const [artistsListHeight, setArtistsListHeight] = useState(400)
  const containerRef = useRef<HTMLDivElement>(null)
  const upgradeListRef = useRef<HTMLDivElement>(null)
  const collectionsListRef = useRef<HTMLDivElement>(null)
  const seriesListRef = useRef<HTMLDivElement>(null)
  const artistsListRef = useRef<HTMLDivElement>(null)

  // Expanded state for expandable rows
  const [expandedCollections, setExpandedCollections] = useState<Set<number>>(new Set())
  const [expandedSeries, setExpandedSeries] = useState<Set<number>>(new Set())
  const [expandedArtists, setExpandedArtists] = useState<Set<number>>(new Set())

  // VariableSizeList refs for resetting cached sizes on expand/collapse
  const collectionsListInstanceRef = useRef<VariableSizeList>(null)
  const seriesListInstanceRef = useRef<VariableSizeList>(null)
  const artistsListInstanceRef = useRef<VariableSizeList>(null)

  // Measure list container heights - observe each list container directly
  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        if (entry.target === upgradeListRef.current) setUpgradeListHeight(height)
        else if (entry.target === collectionsListRef.current) setCollectionsListHeight(height)
        else if (entry.target === seriesListRef.current) setSeriesListHeight(height)
        else if (entry.target === artistsListRef.current) setArtistsListHeight(height)
      }
    })

    // Observe all list containers (re-runs when library availability changes)
    if (upgradeListRef.current) resizeObserver.observe(upgradeListRef.current)
    if (collectionsListRef.current) resizeObserver.observe(collectionsListRef.current)
    if (seriesListRef.current) resizeObserver.observe(seriesListRef.current)
    if (artistsListRef.current) resizeObserver.observe(artistsListRef.current)

    return () => resizeObserver.disconnect()
  }, [hasMovies, hasTV, hasMusic]) // Re-run when columns appear/disappear

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [movieUpgradeData, tvUpgradeData, musicUpgradeData, collectionsData, seriesData, artistsData] = await Promise.all([
        window.electronAPI.getMediaItems({
          needsUpgrade: true,
          type: 'movie',
          orderBy: 'tier_score',
          orderDirection: 'asc'
        }) as Promise<MediaItem[]>,
        window.electronAPI.getMediaItems({
          needsUpgrade: true,
          type: 'episode',
          orderBy: 'tier_score',
          orderDirection: 'asc'
        }) as Promise<MediaItem[]>,
        window.electronAPI.musicGetAlbumsNeedingUpgrade() as Promise<MusicAlbumUpgrade[]>,
        window.electronAPI.collectionsGetIncomplete() as Promise<MovieCollectionData[]>,
        window.electronAPI.seriesGetIncomplete() as Promise<SeriesCompletenessData[]>,
        window.electronAPI.musicGetAllArtistCompleteness() as Promise<ArtistCompletenessData[]>
      ])

      // Sort movie upgrades by tier_score ascending (worst first)
      const sortedMovieUpgrades = movieUpgradeData
        .sort((a, b) => (a.tier_score ?? 100) - (b.tier_score ?? 100))
      setMovieUpgrades(sortedMovieUpgrades)

      // Sort TV upgrades by tier_score ascending (worst first)
      const sortedTvUpgrades = tvUpgradeData
        .sort((a, b) => (a.tier_score ?? 100) - (b.tier_score ?? 100))
      setTvUpgrades(sortedTvUpgrades)

      // Music upgrades already sorted by database query
      setMusicUpgrades(musicUpgradeData || [])

      // Filter collections to >50% complete, sort by completeness descending
      const filteredCollections = collectionsData
        .filter(c => c.completeness_percentage >= 50)
        .sort((a, b) => b.completeness_percentage - a.completeness_percentage)
      setCollections(filteredCollections)

      // Sort series by completeness descending (almost complete first)
      const sortedSeries = seriesData
        .sort((a, b) => b.completeness_percentage - a.completeness_percentage)
      setSeries(sortedSeries)

      // Filter artists to incomplete only, sort by completeness descending
      const incompleteArtists = (artistsData || [])
        .filter(a => a.completeness_percentage < 100)
        .sort((a, b) => b.completeness_percentage - a.completeness_percentage)
      setArtists(incompleteArtists)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  // Parse functions for missing items with basic validation
  const parseMissingMovies = useCallback((collection: MovieCollectionData): MissingMovie[] => {
    if (!collection.missing_movies) return []
    try {
      const parsed = JSON.parse(collection.missing_movies)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((m): m is MissingMovie =>
        m && typeof m === 'object' && typeof m.title === 'string'
      )
    } catch {
      return []
    }
  }, [])

  const parseMissingEpisodes = useCallback((s: SeriesCompletenessData): MissingEpisode[] => {
    if (!s.missing_episodes) return []
    try {
      const parsed = JSON.parse(s.missing_episodes)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((ep): ep is MissingEpisode =>
        ep && typeof ep === 'object' &&
        typeof ep.season_number === 'number' &&
        typeof ep.episode_number === 'number'
      )
    } catch {
      return []
    }
  }, [])

  const parseMissingAlbums = useCallback((artist: ArtistCompletenessData): MissingAlbumItem[] => {
    const albums: MissingAlbumItem[] = []
    const isValidAlbum = (a: unknown): a is { title: string; musicbrainz_id?: string; year?: number } =>
      a !== null && typeof a === 'object' && typeof (a as any).title === 'string'

    try {
      if (artist.missing_albums) {
        const parsed = JSON.parse(artist.missing_albums)
        if (Array.isArray(parsed)) {
          parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'album' }))
        }
      }
      if (artist.missing_eps) {
        const parsed = JSON.parse(artist.missing_eps)
        if (Array.isArray(parsed)) {
          parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'ep' }))
        }
      }
      if (artist.missing_singles) {
        const parsed = JSON.parse(artist.missing_singles)
        if (Array.isArray(parsed)) {
          parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'single' }))
        }
      }
    } catch {
      // Ignore parse errors
    }
    return albums
  }, [])

  // Group episodes by season for better visualization
  const groupEpisodesBySeason = useCallback((s: SeriesCompletenessData): SeasonGroup[] => {
    const episodes = parseMissingEpisodes(s)
    if (episodes.length === 0) return []

    // Parse whole missing seasons (seasons with zero owned episodes)
    let wholeMissingSeasons = new Set<number>()
    try {
      if (s.missing_seasons) {
        const parsed = JSON.parse(s.missing_seasons)
        wholeMissingSeasons = new Set(parsed)
      }
    } catch {
      // Ignore parse errors
    }

    // Group episodes by season
    const groups = new Map<number, MissingEpisode[]>()
    episodes.forEach(ep => {
      if (!groups.has(ep.season_number)) {
        groups.set(ep.season_number, [])
      }
      groups.get(ep.season_number)!.push(ep)
    })

    // Convert to array with metadata
    return Array.from(groups.entries())
      .map(([seasonNumber, eps]) => ({
        seasonNumber,
        isWholeSeason: wholeMissingSeasons.has(seasonNumber),
        totalEpisodes: eps.length,
        missingEpisodes: eps.sort((a, b) => a.episode_number - b.episode_number)
      }))
      .sort((a, b) => a.seasonNumber - b.seasonNumber)
  }, [parseMissingEpisodes])

  // Height calculation functions for VariableSizeList (connected indent design)
  const getCollectionRowHeight = useCallback((index: number) => {
    const collection = collections[index]
    if (!collection || !expandedCollections.has(index)) return COLLAPSED_HEIGHT
    const missing = parseMissingMovies(collection)
    if (missing.length === 0) return COLLAPSED_HEIGHT

    let height = COLLAPSED_HEIGHT + EXPANDED_MARGIN
    height += missing.length * EXPANDED_ITEM_HEIGHT
    if (missing.length > 1) {
      height += (missing.length - 1) * ITEM_GAP
    }

    return height
  }, [collections, expandedCollections, parseMissingMovies])

  // Height calculation for series - one row per season
  const getSeriesRowHeight = useCallback((index: number) => {
    const s = series[index]
    if (!s || !expandedSeries.has(index)) return COLLAPSED_HEIGHT

    const groups = groupEpisodesBySeason(s)
    if (groups.length === 0) return COLLAPSED_HEIGHT

    // Base + margin + one row per season + gaps
    let height = COLLAPSED_HEIGHT + EXPANDED_MARGIN
    height += groups.length * EXPANDED_ITEM_HEIGHT
    if (groups.length > 1) {
      height += (groups.length - 1) * ITEM_GAP
    }

    return height
  }, [series, expandedSeries, groupEpisodesBySeason])

  // Height calculation for artists (grouped by type)
  const getArtistRowHeight = useCallback((index: number) => {
    const artist = artists[index]
    if (!artist || !expandedArtists.has(index)) return COLLAPSED_HEIGHT_ARTIST

    const allMissing = parseMissingAlbums(artist)
    if (allMissing.length === 0) return COLLAPSED_HEIGHT_ARTIST

    const albums = allMissing.filter(m => m.album_type === 'album')
    const eps = allMissing.filter(m => m.album_type === 'ep')
    const singles = allMissing.filter(m => m.album_type === 'single')

    let height = COLLAPSED_HEIGHT_ARTIST + EXPANDED_MARGIN

    const nonEmptyGroups = [albums, eps, singles].filter(g => g.length > 0)

    nonEmptyGroups.forEach(group => {
      height += SECTION_HEADER_HEIGHT  // Type header (Albums, EPs, Singles)
      height += group.length * EXPANDED_ITEM_HEIGHT
      if (group.length > 1) {
        height += (group.length - 1) * ITEM_GAP
      }
    })

    if (nonEmptyGroups.length > 1) {
      height += (nonEmptyGroups.length - 1) * TYPE_SECTION_GAP
    }

    return height
  }, [artists, expandedArtists, parseMissingAlbums])

  // Generic toggle expand factory - creates a toggle function for any expandable list
  const createToggleExpand = useCallback(
    (
      setExpanded: React.Dispatch<React.SetStateAction<Set<number>>>,
      listRef: React.RefObject<VariableSizeList>
    ) => (index: number) => {
      setExpanded(prev => {
        const next = new Set(prev)
        next.has(index) ? next.delete(index) : next.add(index)
        return next
      })
      listRef.current?.resetAfterIndex(index)
    },
    []
  )

  const toggleCollectionExpand = createToggleExpand(setExpandedCollections, collectionsListInstanceRef)
  const toggleSeriesExpand = createToggleExpand(setExpandedSeries, seriesListInstanceRef)
  const toggleArtistExpand = createToggleExpand(setExpandedArtists, artistsListInstanceRef)

  // Virtual list row renderers
  const MovieUpgradeRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = movieUpgrades[index]
    if (!item) return null
    return (
      <div style={style} className="px-2">
        <div className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-md transition-colors">
        <div className="w-10 h-14 bg-muted rounded overflow-hidden flex-shrink-0 shadow-md shadow-black/40">
          {item.poster_url ? (
            <img src={item.poster_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{item.title}</div>
          <div className="text-xs text-muted-foreground truncate">{item.year}</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {item.quality_tier} · {item.tier_quality}
          </div>
        </div>
        <AddToWishlistButton
          mediaType="movie"
          title={item.title}
          year={item.year}
          tmdbId={item.tmdb_id}
          posterUrl={item.poster_url}
          reason="upgrade"
          mediaItemId={item.id}
          currentQualityTier={item.quality_tier}
          currentQualityLevel={item.tier_quality}
          currentResolution={item.resolution}
          compact
        />
        </div>
      </div>
    )
  }, [movieUpgrades])

  const TvUpgradeRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = tvUpgrades[index]
    if (!item) return null
    return (
      <div style={style} className="px-2">
        <div className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-md transition-colors">
        <div className="w-10 h-14 bg-muted rounded overflow-hidden flex-shrink-0 shadow-md shadow-black/40">
          {item.poster_url ? (
            <img src={item.poster_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Tv className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{item.series_title || item.title}</div>
          <div className="text-xs text-muted-foreground truncate">
            S{item.season_number}E{item.episode_number} · {item.title}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {item.quality_tier} · {item.tier_quality}
          </div>
        </div>
        <AddToWishlistButton
          mediaType="episode"
          title={item.title}
          year={item.year}
          tmdbId={item.tmdb_id}
          posterUrl={item.poster_url}
          seriesTitle={item.series_title}
          seasonNumber={item.season_number}
          episodeNumber={item.episode_number}
          reason="upgrade"
          mediaItemId={item.id}
          currentQualityTier={item.quality_tier}
          currentQualityLevel={item.tier_quality}
          currentResolution={item.resolution}
          compact
        />
        </div>
      </div>
    )
  }, [tvUpgrades])

  const MusicUpgradeRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const album = musicUpgrades[index]
    if (!album) return null
    return (
      <div style={style} className="px-2">
        <div className="flex items-center gap-3 px-2 py-1 hover:bg-muted/50 rounded-md transition-colors">
          <div className="w-10 h-10 bg-muted rounded overflow-hidden flex-shrink-0">
            {album.thumb_url ? (
              <img src={album.thumb_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Disc3 className="w-5 h-5 text-muted-foreground/50" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{album.title}</div>
            <div className="text-xs text-muted-foreground truncate">{album.artist_name}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {album.quality_tier} · {album.tier_quality}
            </div>
          </div>
          <AddToWishlistButton
            mediaType="album"
            title={album.title}
            year={album.year}
            artistName={album.artist_name}
            musicbrainzId={album.musicbrainz_id}
            reason="upgrade"
            compact
          />
        </div>
      </div>
    )
  }, [musicUpgrades])

  // Collection row renderer with expandable missing items (shows all)
  const CollectionRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const collection = collections[index]
    if (!collection) return null
    const missingCount = collection.total_movies - collection.owned_movies
    const isExpanded = expandedCollections.has(index)
    const missingMovies = isExpanded ? parseMissingMovies(collection) : []

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && missingCount > 0) {
        e.preventDefault()
        toggleCollectionExpand(index)
      }
    }

    return (
      <div style={style} className="px-2 overflow-hidden">
        {/* Header row - clickable/keyboard accessible to expand */}
        <div
          role="button"
          tabIndex={missingCount > 0 ? 0 : -1}
          className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-black"
          onClick={() => missingCount > 0 && toggleCollectionExpand(index)}
          onKeyDown={handleKeyDown}
          aria-expanded={isExpanded}
          aria-label={`${collection.collection_name}, ${collection.owned_movies} of ${collection.total_movies} movies`}
        >
          <div className="w-10 h-14 bg-muted rounded overflow-hidden flex-shrink-0 shadow-md shadow-black/40">
            {collection.poster_url ? (
              <img src={collection.poster_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Library className="w-5 h-5 text-muted-foreground/50" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{collection.collection_name}</div>
            <div className="text-xs text-muted-foreground">
              {collection.owned_movies}/{collection.total_movies} · {Math.round(collection.completeness_percentage)}%
            </div>
            <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${collection.completeness_percentage}%` }} />
            </div>
          </div>
          {missingCount > 0 && (
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </div>

        {/* Expanded: Missing movies */}
        {isExpanded && missingMovies.length > 0 && (
          <div className="ml-14 mt-2 space-y-1">
            {missingMovies.map((movie, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors"
              >
                <span className="text-sm text-muted-foreground truncate flex-1">
                  {movie.title} {movie.year ? `(${movie.year})` : ''}
                </span>
                <AddToWishlistButton
                  mediaType="movie"
                  title={movie.title}
                  year={movie.year}
                  tmdbId={movie.tmdb_id}
                  posterUrl={movie.poster_url}
                  reason="missing"
                  compact
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }, [collections, expandedCollections, parseMissingMovies, toggleCollectionExpand])

  // Series row renderer with season-grouped missing episodes (shows all)
  const SeriesRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const s = series[index]
    if (!s) return null
    const missingCount = s.total_episodes - s.owned_episodes
    const isExpanded = expandedSeries.has(index)
    const seasonGroups = isExpanded ? groupEpisodesBySeason(s) : []

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && missingCount > 0) {
        e.preventDefault()
        toggleSeriesExpand(index)
      }
    }

    return (
      <div style={style} className="px-2 overflow-hidden">
        {/* Header row - clickable/keyboard accessible to expand */}
        <div
          role="button"
          tabIndex={missingCount > 0 ? 0 : -1}
          className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-black"
          onClick={() => missingCount > 0 && toggleSeriesExpand(index)}
          onKeyDown={handleKeyDown}
          aria-expanded={isExpanded}
          aria-label={`${s.series_title}, ${s.owned_seasons} of ${s.total_seasons} seasons, ${s.owned_episodes} of ${s.total_episodes} episodes`}
        >
          <div className="w-10 h-14 bg-muted rounded overflow-hidden flex-shrink-0 shadow-md shadow-black/40">
            {s.poster_url ? (
              <img src={s.poster_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Tv className="w-5 h-5 text-muted-foreground/50" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{s.series_title}</div>
            <div className="text-xs text-muted-foreground">
              {s.owned_seasons}/{s.total_seasons} seasons · {s.owned_episodes}/{s.total_episodes} eps · {Math.round(s.completeness_percentage)}%
            </div>
            <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${s.completeness_percentage}%` }} />
            </div>
          </div>
          {missingCount > 0 && (
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </div>

        {/* Expanded: Missing by season */}
        {isExpanded && seasonGroups.length > 0 && (
          <div className="ml-14 mt-2 space-y-1">
            {seasonGroups.map(group => (
              <div
                key={group.seasonNumber}
                className="flex items-center justify-between py-1.5 rounded-md hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-sm text-foreground/80 flex-shrink-0">
                    S{group.seasonNumber}
                  </span>
                  {group.isWholeSeason ? (
                    <span className="text-xs text-muted-foreground">
                      All {group.totalEpisodes} episodes
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground truncate">
                      E{group.missingEpisodes.map(ep => ep.episode_number).join(', E')}
                    </span>
                  )}
                </div>
                <AddToWishlistButton
                  mediaType="episode"
                  title={`Season ${group.seasonNumber}`}
                  seriesTitle={s.series_title}
                  seasonNumber={group.seasonNumber}
                  tmdbId={s.tmdb_id}
                  posterUrl={s.poster_url}
                  reason="missing"
                  compact
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }, [series, expandedSeries, groupEpisodesBySeason, toggleSeriesExpand])

  // Artist row renderer with grouped missing items by type
  const ArtistRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const artist = artists[index]
    if (!artist) return null
    const totalReleases = artist.total_albums + artist.total_eps + artist.total_singles
    const ownedReleases = artist.owned_albums + artist.owned_eps + artist.owned_singles
    const totalMissing = totalReleases - ownedReleases
    const isExpanded = expandedArtists.has(index)
    const allMissing = isExpanded ? parseMissingAlbums(artist) : []

    // Group missing items by type for expanded view
    const groupedByType = isExpanded ? {
      album: allMissing.filter(m => m.album_type === 'album'),
      ep: allMissing.filter(m => m.album_type === 'ep'),
      single: allMissing.filter(m => m.album_type === 'single')
    } : { album: [], ep: [], single: [] }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && totalMissing > 0) {
        e.preventDefault()
        toggleArtistExpand(index)
      }
    }

    return (
      <div style={style} className="px-2 overflow-hidden">
        {/* Header row - clickable/keyboard accessible to expand */}
        <div
          role="button"
          tabIndex={totalMissing > 0 ? 0 : -1}
          className="flex items-center gap-3 px-2 py-1 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-black"
          onClick={() => totalMissing > 0 && toggleArtistExpand(index)}
          onKeyDown={handleKeyDown}
          aria-expanded={isExpanded}
          aria-label={`${artist.artist_name}, ${ownedReleases} of ${totalReleases} releases`}
        >
          <div className="w-10 h-10 bg-muted rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center">
            {artist.thumb_url ? (
              <img src={artist.thumb_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Music className="w-5 h-5 text-muted-foreground/50" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{artist.artist_name}</div>
            <div className="text-xs text-muted-foreground">
              {ownedReleases}/{totalReleases} releases · {Math.round(artist.completeness_percentage)}%
            </div>
            <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${artist.completeness_percentage}%` }} />
            </div>
          </div>
          {totalMissing > 0 && (
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </div>

        {/* Expanded: Missing releases */}
        {isExpanded && allMissing.length > 0 && (
          <div className="ml-14 mt-2 space-y-3">
            {groupedByType.album.length > 0 && (
              <div>
                <div className="py-2 text-xs font-medium text-foreground/70 uppercase tracking-wider">
                  Albums
                </div>
                <div className="space-y-1">
                  {groupedByType.album.map((item, idx) => (
                    <div
                      key={item.musicbrainz_id || `album-${idx}`}
                      className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm text-muted-foreground truncate flex-1">
                        {item.title} {item.year ? `(${item.year})` : ''}
                      </span>
                      <AddToWishlistButton
                        mediaType="album"
                        title={item.title}
                        year={item.year}
                        artistName={artist.artist_name}
                        musicbrainzId={item.musicbrainz_id}
                        reason="missing"
                        compact
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {groupedByType.ep.length > 0 && (
              <div>
                <div className="py-2 text-xs font-medium text-foreground/70 uppercase tracking-wider">
                  EPs
                </div>
                <div className="space-y-1">
                  {groupedByType.ep.map((item, idx) => (
                    <div
                      key={item.musicbrainz_id || `ep-${idx}`}
                      className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm text-muted-foreground truncate flex-1">
                        {item.title} {item.year ? `(${item.year})` : ''}
                      </span>
                      <AddToWishlistButton
                        mediaType="album"
                        title={item.title}
                        year={item.year}
                        artistName={artist.artist_name}
                        musicbrainzId={item.musicbrainz_id}
                        reason="missing"
                        compact
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {groupedByType.single.length > 0 && (
              <div>
                <div className="py-2 text-xs font-medium text-foreground/70 uppercase tracking-wider">
                  Singles
                </div>
                <div className="space-y-1">
                  {groupedByType.single.map((item, idx) => (
                    <div
                      key={item.musicbrainz_id || `single-${idx}`}
                      className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm text-muted-foreground truncate flex-1">
                        {item.title} {item.year ? `(${item.year})` : ''}
                      </span>
                      <AddToWishlistButton
                        mediaType="album"
                        title={item.title}
                        year={item.year}
                        artistName={artist.artist_name}
                        musicbrainzId={item.musicbrainz_id}
                        reason="missing"
                        compact
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }, [artists, expandedArtists, parseMissingAlbums, toggleArtistExpand])

  const hasMovieUpgrades = hasMovies && movieUpgrades.length > 0
  const hasTvUpgrades = hasTV && tvUpgrades.length > 0
  const hasMusicUpgrades = hasMusic && musicUpgrades.length > 0
  const hasCollections = hasMovies && collections.length > 0
  const hasSeries = hasTV && series.length > 0
  const hasArtists = hasMusic && artists.length > 0

  // Check if any columns will be shown (based on library availability)
  const hasAnyLibrary = hasMovies || hasTV || hasMusic
  const hasNoSources = sources.length === 0
  const hasNothing = !hasAnyLibrary || (!hasMovieUpgrades && !hasTvUpgrades && !hasMusicUpgrades && !hasCollections && !hasSeries && !hasArtists)

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="fixed top-[88px] bottom-4 flex items-center justify-center transition-[left,right] duration-300 ease-out"
        style={{
          left: sidebarCollapsed ? '96px' : '288px',
          right: '16px'
        }}
      >
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        ref={containerRef}
        className="fixed top-[88px] bottom-4 flex flex-col items-center justify-center transition-[left,right] duration-300 ease-out"
        style={{
          left: sidebarCollapsed ? '96px' : '288px',
          right: '16px'
        }}
      >
        <div className="text-destructive mb-4">{error}</div>
        <button
          onClick={loadDashboardData}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="fixed top-[88px] bottom-4 flex flex-col overflow-hidden transition-[left,right] duration-300 ease-out"
      style={{
        left: sidebarCollapsed ? '96px' : '288px',
        right: '16px'
      }}
    >
      {/* Empty states */}
      {hasNothing && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
          {hasNoSources ? (
            <>
              <h2 className="text-xl font-medium mb-2">Add a Media Source</h2>
              <p className="text-muted-foreground max-w-md mb-6">
                Connect your media library to start tracking quality and completeness.
              </p>
              {onAddSource && (
                <button
                  onClick={onAddSource}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Add Source
                </button>
              )}
            </>
          ) : (
            <>
              <Sparkles className="w-16 h-16 text-accent/50 mb-4" />
              <h2 className="text-xl font-medium mb-2">All caught up!</h2>
              <p className="text-muted-foreground max-w-md">
                Your library is in great shape. No urgent upgrades needed and all your collections and series are complete.
              </p>
            </>
          )}
        </div>
      )}

      {/* Multi-column layout - horizontally scrollable on small screens */}
      {!hasNothing && (
        <div className="flex-1 flex gap-4 px-4 pb-4 overflow-x-auto overflow-y-hidden">
          {/* Upgrades Column (Tabbed: Movies / TV / Music) */}
          <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
            <div className="flex-shrink-0 p-4 border-b border-white/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CircleFadingArrowUp className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upgrades</h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {upgradeTab === 'movies' ? movieUpgrades.length : upgradeTab === 'tv' ? tvUpgrades.length : musicUpgrades.length} items
                </span>
              </div>
              {/* Tabs - centered, only show if multiple library types exist */}
              {[hasMovies, hasTV, hasMusic].filter(Boolean).length > 1 && (
                <div className="flex flex-wrap gap-1 justify-center">
                  {hasMovies && (
                    <button
                      onClick={() => setUpgradeTab('movies')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        upgradeTab === 'movies'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Film className="w-3.5 h-3.5" />
                      Movies
                    </button>
                  )}
                  {hasTV && (
                    <button
                      onClick={() => setUpgradeTab('tv')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        upgradeTab === 'tv'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Tv className="w-3.5 h-3.5" />
                      TV
                    </button>
                  )}
                  {hasMusic && (
                    <button
                      onClick={() => setUpgradeTab('music')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        upgradeTab === 'music'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Disc3 className="w-3.5 h-3.5" />
                      Music
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
              <div ref={upgradeListRef} className="absolute inset-0">
                {/* Movies Tab Content */}
                {upgradeTab === 'movies' && (
                  movieUpgrades.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No movie upgrades needed
                    </div>
                  ) : (
                    <VirtualList
                      height={upgradeListHeight}
                      itemCount={movieUpgrades.length}
                      itemSize={MOVIE_ITEM_HEIGHT}
                      width="100%"
                    >
                      {MovieUpgradeRow}
                    </VirtualList>
                  )
                )}
                {/* TV Tab Content */}
                {upgradeTab === 'tv' && (
                  tvUpgrades.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No TV upgrades needed
                    </div>
                  ) : (
                    <VirtualList
                      height={upgradeListHeight}
                      itemCount={tvUpgrades.length}
                      itemSize={TV_ITEM_HEIGHT}
                      width="100%"
                    >
                      {TvUpgradeRow}
                    </VirtualList>
                  )
                )}
                {/* Music Tab Content */}
                {upgradeTab === 'music' && (
                  musicUpgrades.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No music upgrades needed
                    </div>
                  ) : (
                    <VirtualList
                      height={upgradeListHeight}
                      itemCount={musicUpgrades.length}
                      itemSize={MUSIC_ITEM_HEIGHT}
                      width="100%"
                    >
                      {MusicUpgradeRow}
                    </VirtualList>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Collections Column - only show if movies library exists */}
          {hasMovies && (
            <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
              <div className="flex-shrink-0 p-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Collections</h2>
                </div>
                <span className="text-xs text-muted-foreground">{collections.length} incomplete</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
                <div ref={collectionsListRef} className="absolute inset-0">
                  {collections.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      All collections complete
                    </div>
                  ) : (
                    <VariableSizeList
                      ref={collectionsListInstanceRef}
                      height={collectionsListHeight}
                      itemCount={collections.length}
                      itemSize={getCollectionRowHeight}
                      width="100%"
                    >
                      {CollectionRow}
                    </VariableSizeList>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Series Column - only show if TV library exists */}
          {hasTV && (
            <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
              <div className="flex-shrink-0 p-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tv className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">TV Series</h2>
                </div>
                <span className="text-xs text-muted-foreground">{series.length} incomplete</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
                <div ref={seriesListRef} className="absolute inset-0">
                  {series.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      All series complete
                    </div>
                  ) : (
                    <VariableSizeList
                      ref={seriesListInstanceRef}
                      height={seriesListHeight}
                      itemCount={series.length}
                      itemSize={getSeriesRowHeight}
                      width="100%"
                    >
                      {SeriesRow}
                    </VariableSizeList>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Music Column - only show if music library exists */}
          {hasMusic && (
            <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
              <div className="flex-shrink-0 p-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Music</h2>
                </div>
                <span className="text-xs text-muted-foreground">{artists.length} incomplete</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
                <div ref={artistsListRef} className="absolute inset-0">
                  {artists.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      All artists complete
                    </div>
                  ) : (
                    <VariableSizeList
                      ref={artistsListInstanceRef}
                      height={artistsListHeight}
                      itemCount={artists.length}
                      itemSize={getArtistRowHeight}
                      width="100%"
                    >
                      {ArtistRow}
                    </VariableSizeList>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
