/**
 * Dashboard - Home screen summarizing what needs attention
 *
 * Three column layout with scrollable lists for upgrades, collections, and series.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { FixedSizeList as VirtualList, VariableSizeList } from 'react-window'
import { Sparkles, Library, Tv, Film, Music, Disc3, CircleFadingArrowUp, ChevronDown, Plus, EyeOff } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import { ArrButtons } from '../arr/AddToArrButton'
import { MediaDetails } from '../library/MediaDetails'
import { useSources } from '../../contexts/SourceContext'
import type { MediaItem, MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData, MusicAlbum, MissingMovie, MissingEpisode } from '../library/types'
import { SETTING_KEYS } from '../../../../shared/settingKeys'
import {
  emitDismissUpgrade,
  emitDismissCollectionMovie,
} from '../../utils/dismissEvents'
import { applyCollectionFilters, applySeriesFilters, applyArtistFilters, parseAutoRules, filterMissingMoviesByRules, filterMissingEpisodesByRules } from '../../utils/completenessFilters'

// Music album with quality info from the upgrade query
interface MusicAlbumUpgrade extends MusicAlbum {
  quality_tier: string
  tier_quality: string
  tier_score: number
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
const EXPANDED_ITEM_HEIGHT = 44     // w-8 h-8 icon (32px) + py-1.5 (12px) = 44px
const EXPANDED_BOTTOM_PAD = 8       // Bottom padding after expanded content
const ITEM_GAP = 4                  // space-y-1 gap between items

// Section-specific heights
const SECTION_HEADER_HEIGHT = 36    // Season/type section header
const TYPE_SECTION_GAP = 12         // space-y-3 gap between album type groups

export function Dashboard({
  onNavigateToLibrary: _onNavigateToLibrary,
  onAddSource,
  sidebarCollapsed = false,
  hasMovies = false,
  hasTV = false,
  hasMusic = false
}: DashboardProps) {
  const { sources, activeSourceId } = useSources()
  const { addToast } = useToast()
  const [movieUpgrades, setMovieUpgrades] = useState<MediaItem[]>([])
  const [tvUpgrades, setTvUpgrades] = useState<MediaItem[]>([])
  const [musicUpgrades, setMusicUpgrades] = useState<MusicAlbumUpgrade[]>([])
  const [collections, setCollections] = useState<MovieCollectionData[]>([])
  const [series, setSeries] = useState<SeriesCompletenessData[]>([])
  const [artists, setArtists] = useState<ArtistCompletenessData[]>([])
  const [arrApps, setArrApps] = useState<{ radarr: boolean; sonarr: boolean; lidarr: boolean }>({ radarr: false, sonarr: false, lidarr: false })
  const [duplicateCount, setDuplicateCount] = useState(0)
  const [recentlyUpgraded, setRecentlyUpgraded] = useState<Array<{
    id: number; title: string; year: number | null; type: string
    poster_url: string | null; quality_tier: string
    previous_quality_tier: string; upgraded_at: string
  }>>([])
  const [storageAnalytics, setStorageAnalytics] = useState<{
    totalSize: number; totalItems: number
    byCodec: Array<{ codec: string; count: number; size: number }>
    byTier: Array<{ tier: string; count: number; size: number }>
    codecMigration: { h264Count: number; modernCount: number; totalCount: number }
  } | null>(null)
  const [personCompleteness, setPersonCompleteness] = useState<Array<{
    id: number; person_type: string; person_name: string; tmdb_person_id: number
    total_movies: number; owned_movies: number; missing_movies: string
    completeness_percentage: number; profile_url: string | null
  }>>([])
  const [expandedPersons, setExpandedPersons] = useState<Set<number>>(new Set())
  const [personSortBy, setPersonSortBy] = useState<'completeness' | 'name'>('completeness')
  const [completenessTab, setCompletenessTab] = useState<'collections' | 'series' | 'music' | 'filmography'>('collections')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)
  // Default to first available library type
  const [upgradeTab, setUpgradeTab] = useState<UpgradeTab>(() =>
    hasMovies ? 'movies' : hasTV ? 'tv' : hasMusic ? 'music' : 'movies'
  )
  const [upgradeListHeight, setUpgradeListHeight] = useState(400)
  const [completenessListHeight, setCompletenessListHeight] = useState(400)
  const containerRef = useRef<HTMLDivElement>(null)
  const upgradeListRef = useRef<HTMLDivElement>(null)
  const completenessListRef = useRef<HTMLDivElement>(null)

  // Detail modal state
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null)

  // Sort state for dashboard columns
  const [upgradeSortBy, setUpgradeSortBy] = useState<'quality' | 'recent' | 'title' | 'watch_priority'>('quality')
  const [collectionSortBy, setCollectionSortBy] = useState<'completeness' | 'name' | 'recent'>('completeness')
  const [seriesSortBy, setSeriesSortBy] = useState<'completeness' | 'name' | 'recent'>('completeness')
  const [artistSortBy, setArtistSortBy] = useState<'completeness' | 'name'>('completeness')

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
        else if (entry.target === completenessListRef.current) setCompletenessListHeight(height)
      }
    })

    // Observe list containers
    if (upgradeListRef.current) resizeObserver.observe(upgradeListRef.current)
    if (completenessListRef.current) resizeObserver.observe(completenessListRef.current)

    return () => resizeObserver.disconnect()
  }, [hasMovies, hasTV, hasMusic, isLoading, completenessTab])

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load arr configured apps on mount and when settings change
  useEffect(() => {
    window.electronAPI.arrGetConfiguredApps().then(apps => setArrApps(apps as { radarr: boolean; sonarr: boolean; lidarr: boolean })).catch(() => {})
    const cleanup = window.electronAPI.onSettingsChanged?.((ev: { key: string }) => {
      if (ev.key.startsWith('radarr_') || ev.key.startsWith('sonarr_') || ev.key.startsWith('lidarr_')) {
        window.electronAPI.arrGetConfiguredApps().then(apps => setArrApps(apps as { radarr: boolean; sonarr: boolean; lidarr: boolean })).catch(() => {})
      }
    })
    return () => cleanup?.()
  }, [])

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Filter by active source if one is selected
      const sourceId = activeSourceId || undefined

      // All IPC calls in one parallel batch — settings, data, and exclusions together
      const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback

      const allResults = await Promise.allSettled([
        // Settings (0-5)
        window.electronAPI.getSetting(SETTING_KEYS.completeness_include_eps),
        window.electronAPI.getSetting(SETTING_KEYS.completeness_include_singles),
        window.electronAPI.getSetting(SETTING_KEYS.dashboard_upgrade_sort),
        window.electronAPI.getSetting(SETTING_KEYS.dashboard_collection_sort),
        window.electronAPI.getSetting(SETTING_KEYS.dashboard_series_sort),
        window.electronAPI.getSetting(SETTING_KEYS.dashboard_artist_sort),
        // Data (6-11)
        window.electronAPI.getMediaItems({ needsUpgrade: true, type: 'movie', sortBy: 'tier_score', sortOrder: 'asc', sourceId }),
        window.electronAPI.getMediaItems({ needsUpgrade: true, type: 'episode', sortBy: 'tier_score', sortOrder: 'asc', sourceId }),
        window.electronAPI.musicGetAlbumsNeedingUpgrade(undefined, sourceId),
        window.electronAPI.collectionsGetIncomplete(sourceId),
        window.electronAPI.seriesGetIncomplete(sourceId),
        window.electronAPI.musicGetAllArtistCompleteness(sourceId),
        // Exclusions (12-15)
        window.electronAPI.getExclusions('collection_movie'),
        window.electronAPI.getExclusions('series_episode'),
        window.electronAPI.getExclusions('artist_album'),
        window.electronAPI.getExclusions('media_upgrade'),
        // Dashboard features (16-20)
        window.electronAPI.getDuplicateMedia(),
        window.electronAPI.getRecentlyUpgraded(30),
        window.electronAPI.getStorageAnalytics(),
        window.electronAPI.personGetCompleteness(),
        window.electronAPI.getSetting(SETTING_KEYS.auto_dismiss_rules),
        window.electronAPI.getSetting(SETTING_KEYS.dashboard_person_sort),
      ])

      const epsSettingVal = val(allResults[0], null)
      const singlesSettingVal = val(allResults[1], null)
      const upgSort = val(allResults[2], null)
      const collSort = val(allResults[3], null)
      const serSort = val(allResults[4], null)
      const artSort = val(allResults[5], null)

      const epsEnabled = epsSettingVal !== 'false'
      const singlesEnabled = singlesSettingVal !== 'false'
      setIncludeEps(epsEnabled)
      setIncludeSingles(singlesEnabled)
      const effectiveUpgSort = (upgSort as 'quality' | 'recent' | 'title' | 'watch_priority') || 'quality'
      const effectiveCollSort = (collSort as 'completeness' | 'name' | 'recent') || 'completeness'
      const effectiveSerSort = (serSort as 'completeness' | 'name' | 'recent') || 'completeness'
      const effectiveArtSort = (artSort as 'completeness' | 'name') || 'completeness'
      setUpgradeSortBy(effectiveUpgSort)
      setCollectionSortBy(effectiveCollSort)
      setSeriesSortBy(effectiveSerSort)
      setArtistSortBy(effectiveArtSort)

      const movieUpgradeData = val(allResults[6], []) as MediaItem[]
      const tvUpgradeData = val(allResults[7], []) as MediaItem[]
      const musicUpgradeData = val(allResults[8], []) as MusicAlbumUpgrade[]
      const collectionsData = val(allResults[9], []) as MovieCollectionData[]
      const seriesData = val(allResults[10], []) as SeriesCompletenessData[]
      const artistsData = val(allResults[11], []) as ArtistCompletenessData[]

      const collectionExclusions = val(allResults[12], []) as Array<{ parent_key: string | null; reference_key: string | null; reference_id: number | null }>
      const seriesExclusions = val(allResults[13], []) as Array<{ parent_key: string | null; reference_key: string | null; reference_id: number | null }>
      const artistExclusions = val(allResults[14], []) as Array<{ parent_key: string | null; reference_key: string | null; reference_id: number | null }>
      const upgradeExclusions = val(allResults[15], []) as Array<{ parent_key: string | null; reference_key: string | null; reference_id: number | null }>

      // Build exclusion lookup sets
      const excludedCollectionMovies = new Set(collectionExclusions.map(e => `${e.parent_key}:${e.reference_key}`))
      const excludedSeriesEpisodes = new Set(seriesExclusions.map(e => `${e.parent_key}:${e.reference_key}`))
      const excludedArtistAlbums = new Set(artistExclusions.map(e => `${e.parent_key}:${e.reference_key}`))
      const excludedUpgradeIds = new Set(upgradeExclusions.map(e => e.reference_id))

      // Dashboard features
      const dupData = val(allResults[16], []) as Array<{ copies: unknown[] }>
      const upgradeData = val(allResults[17], []) as typeof recentlyUpgraded
      const storData = val(allResults[18], null) as typeof storageAnalytics
      const personData = val(allResults[19], []) as typeof personCompleteness
      const autoRulesJson = val(allResults[20], null) as string | null
      const autoRules = parseAutoRules(autoRulesJson)
      const personSort = val(allResults[21], null) as string | null
      const effectivePersonSort = (personSort as 'completeness' | 'name') || 'completeness'
      setPersonSortBy(effectivePersonSort)
      setDuplicateCount(dupData.length)
      setRecentlyUpgraded(upgradeData)
      setStorageAnalytics(storData)
      setPersonCompleteness(personData.filter(p => p.completeness_percentage < 100)
        .sort((a, b) => effectivePersonSort === 'completeness'
          ? b.completeness_percentage - a.completeness_percentage
          : a.person_name.localeCompare(b.person_name)))

      // Filter and sort upgrades, excluding dismissed items
      const sortUpgrades = <T extends MediaItem>(items: T[]): T[] => items.sort((a, b) => {
        if (effectiveUpgSort === 'quality') return (a.tier_score ?? 100) - (b.tier_score ?? 100)
        if (effectiveUpgSort === 'recent') return (((b as unknown as Record<string, string>).created_at) || '').localeCompare(((a as unknown as Record<string, string>).created_at) || '')
        if (effectiveUpgSort === 'watch_priority') {
          const pcA = ((a as unknown as Record<string, number>).play_count || 0)
          const pcB = ((b as unknown as Record<string, number>).play_count || 0)
          // Primary: items with play count first, sorted by weighted score
          if (pcA > 0 || pcB > 0) {
            const scoreA = (100 - (a.tier_score ?? 100)) * Math.log2(pcA + 2)
            const scoreB = (100 - (b.tier_score ?? 100)) * Math.log2(pcB + 2)
            if (scoreA !== scoreB) return scoreB - scoreA
          }
          // Tiebreaker: watched items above unwatched, then by quality
          if (pcA !== pcB) return pcB - pcA
          return (a.tier_score ?? 100) - (b.tier_score ?? 100)
        }
        return a.title.localeCompare(b.title)
      })
      setMovieUpgrades(sortUpgrades(movieUpgradeData.filter(m => !excludedUpgradeIds.has(m.id))))
      setTvUpgrades(sortUpgrades(tvUpgradeData.filter(e => !excludedUpgradeIds.has(e.id))))
      setMusicUpgrades((musicUpgradeData || []).filter(m => !excludedUpgradeIds.has(m.id)))

      // Filter collections, series, and artists using shared utility functions + auto rules
      const filteredCollections = collectionsData
        .map(c => {
          const filtered = applyCollectionFilters(c, excludedCollectionMovies, null)
          if (autoRules.length === 0) return filtered
          const ruledMissing = filterMissingMoviesByRules(filtered.missing_movies || [], autoRules)
          if (ruledMissing.length === (filtered.missing_movies || []).length) return filtered
          const removed = (filtered.missing_movies || []).length - ruledMissing.length
          const newTotal = filtered.total_movies - removed
          return { ...filtered, missing_movies: ruledMissing, total_movies: newTotal, completeness_percentage: newTotal > 0 ? Math.round((filtered.owned_movies / newTotal) * 100) : 100 }
        })
        .filter(c => c.total_movies > 1 && c.completeness_percentage < 100)
        .sort((a, b) => {
          if (effectiveCollSort === 'completeness') return b.completeness_percentage - a.completeness_percentage
          if (effectiveCollSort === 'recent') return (((b as unknown as Record<string, string>).created_at) || '').localeCompare(((a as unknown as Record<string, string>).created_at) || '')
          return a.collection_name.localeCompare(b.collection_name)
        })
      setCollections(filteredCollections)

      const sortedSeries = seriesData
        .map(s => {
          const filtered = applySeriesFilters(s, excludedSeriesEpisodes)
          if (autoRules.length === 0) return filtered
          const ruledMissing = filterMissingEpisodesByRules(filtered.missing_episodes || [], autoRules)
          if (ruledMissing.length === (filtered.missing_episodes || []).length) return filtered
          const removed = (filtered.missing_episodes || []).length - ruledMissing.length
          const newTotal = Math.max(filtered.owned_episodes, filtered.total_episodes - removed)
          return { ...filtered, missing_episodes: ruledMissing, total_episodes: newTotal, completeness_percentage: newTotal > 0 ? Math.round((filtered.owned_episodes / newTotal) * 100) : 100 }
        })
        .filter(s => s.completeness_percentage < 100)
        .sort((a, b) => {
          if (effectiveSerSort === 'completeness') return b.completeness_percentage - a.completeness_percentage
          if (effectiveSerSort === 'recent') return (((b as unknown as Record<string, string>).created_at) || '').localeCompare(((a as unknown as Record<string, string>).created_at) || '')
          return a.series_title.localeCompare(b.series_title)
        })
      setSeries(sortedSeries)

      const incompleteArtists = (artistsData || [])
        .map(a => applyArtistFilters(a, excludedArtistAlbums, epsEnabled, singlesEnabled))
        .filter(a => a.completeness_percentage < 100)
        .sort((a, b) => {
          if (effectiveArtSort === 'completeness') return b.completeness_percentage - a.completeness_percentage
          return a.artist_name.localeCompare(b.artist_name)
        })
      setArtists(incompleteArtists)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [activeSourceId])

  // Debounced reload coalesces rapid event-driven refreshes (300ms)
  const debouncedReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(() => loadDashboardData(), 300)
  }, [loadDashboardData])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  // Event-driven reloads use debounced version to coalesce rapid events
  useEffect(() => {
    const cleanup = window.electronAPI.onSettingsChanged?.((data) => {
      if (data.key === 'completeness_include_eps' || data.key === 'completeness_include_singles') {
        debouncedReload()
      }
    })
    return () => cleanup?.()
  }, [debouncedReload])

  useEffect(() => {
    const cleanup = window.electronAPI.onScanCompleted?.(() => debouncedReload())
    return () => cleanup?.()
  }, [debouncedReload])

  useEffect(() => {
    const cleanup = window.electronAPI.onLibraryUpdated?.(() => debouncedReload())
    return () => cleanup?.()
  }, [debouncedReload])

  useEffect(() => {
    const handler = () => debouncedReload()
    window.addEventListener('exclusions-changed', handler)
    return () => window.removeEventListener('exclusions-changed', handler)
  }, [debouncedReload])

  const parseMissingMovies = useCallback((collection: MovieCollectionData): MissingMovie[] =>
    collection.missing_movies || [], [])

  const parseMissingEpisodes = useCallback((s: SeriesCompletenessData): MissingEpisode[] =>
    s.missing_episodes || [], [])

  const parseMissingAlbums = useCallback((artist: ArtistCompletenessData): MissingAlbumItem[] => {
    const albums: MissingAlbumItem[] = []
    const isValidAlbum = (a: unknown): a is { title: string; musicbrainz_id?: string; year?: number } =>
      a !== null && typeof a === 'object' && typeof (a as { title?: string }).title === 'string'

    try {
      if (artist.missing_albums) {
        const parsed = JSON.parse(artist.missing_albums)
        if (Array.isArray(parsed)) {
          parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'album' }))
        }
      }
      if (includeEps && artist.missing_eps) {
        const parsed = JSON.parse(artist.missing_eps)
        if (Array.isArray(parsed)) {
          parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'ep' }))
        }
      }
      if (includeSingles && artist.missing_singles) {
        const parsed = JSON.parse(artist.missing_singles)
        if (Array.isArray(parsed)) {
          parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'single' }))
        }
      }
    } catch {
      // Ignore parse errors
    }
    return albums
  }, [includeEps, includeSingles])

  // Group episodes by season for better visualization
  const groupEpisodesBySeason = useCallback((s: SeriesCompletenessData): SeasonGroup[] => {
    const episodes = parseMissingEpisodes(s)
    if (episodes.length === 0) return []

    const wholeMissingSeasons = new Set<number>(s.missing_seasons || [])

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

    height += EXPANDED_BOTTOM_PAD

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

  // Dismiss handlers for exclusions
  const dismissMovieUpgrade = useCallback(async (index: number) => {
    const item = movieUpgrades[index]
    if (!item) return
    const exclusionId = await window.electronAPI.addExclusion('media_upgrade', item.id, undefined, undefined, item.title)
    setMovieUpgrades(prev => prev.filter((_, i) => i !== index))
    emitDismissUpgrade({ mediaId: item.id })
    addToast({ type: 'info', message: `Hidden: ${item.title}`, action: { label: 'Undo', onClick: async () => {
      await window.electronAPI.removeExclusion(exclusionId)
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
    }}})
  }, [movieUpgrades, addToast])

  const dismissTvUpgrade = useCallback(async (index: number) => {
    const item = tvUpgrades[index]
    if (!item) return
    const label = `${item.series_title} S${item.season_number}E${item.episode_number}`
    const exclusionId = await window.electronAPI.addExclusion('media_upgrade', item.id, undefined, undefined, label)
    setTvUpgrades(prev => prev.filter((_, i) => i !== index))
    emitDismissUpgrade({ mediaId: item.id })
    addToast({ type: 'info', message: `Hidden: ${label}`, action: { label: 'Undo', onClick: async () => {
      await window.electronAPI.removeExclusion(exclusionId)
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
    }}})
  }, [tvUpgrades, addToast])

  const dismissMusicUpgrade = useCallback(async (index: number) => {
    const album = musicUpgrades[index]
    if (!album) return
    const label = `${album.artist_name} - ${album.title}`
    const exclusionId = await window.electronAPI.addExclusion('media_upgrade', album.id, undefined, undefined, label)
    setMusicUpgrades(prev => prev.filter((_, i) => i !== index))
    addToast({ type: 'info', message: `Hidden: ${label}`, action: { label: 'Undo', onClick: async () => {
      await window.electronAPI.removeExclusion(exclusionId)
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
    }}})
  }, [musicUpgrades, addToast])

  const dismissCollectionMovie = useCallback(async (collectionIndex: number, movie: MissingMovie) => {
    const collection = collections[collectionIndex]
    if (!collection) return
    const exclusionId = await window.electronAPI.addExclusion('collection_movie', undefined, movie.tmdb_id, collection.tmdb_collection_id, movie.title)
    // Update the collection's missing movies, totals, and remove trivial collections
    setCollections(prev => prev.map((c, i) => {
      if (i !== collectionIndex) return c
      const filtered = (c.missing_movies || []).filter(m => m.tmdb_id !== movie.tmdb_id)
      const newTotal = c.total_movies - 1
      return {
        ...c,
        missing_movies: filtered,
        total_movies: newTotal,
        completeness_percentage: newTotal > 0 ? c.owned_movies / newTotal * 100 : 100,
      }
    }).filter(c => c.total_movies > 1))
    collectionsListInstanceRef.current?.resetAfterIndex(0)
    emitDismissCollectionMovie({ collectionId: collection.tmdb_collection_id, tmdbId: movie.tmdb_id })
    addToast({ type: 'info', message: `Hidden: ${movie.title}`, action: { label: 'Undo', onClick: async () => {
      await window.electronAPI.removeExclusion(exclusionId)
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
    }}})
  }, [collections, addToast])

  const dismissSeriesEpisode = useCallback(async (seriesIndex: number, episode: MissingEpisode) => {
    const s = series[seriesIndex]
    if (!s) return
    const refKey = `S${episode.season_number}E${episode.episode_number}`
    const label = `${s.series_title} ${refKey}`
    const exclusionId = await window.electronAPI.addExclusion('series_episode', undefined, refKey, s.tmdb_id || s.series_title, label)
    setSeries(prev => prev.map((ser, i) => {
      if (i !== seriesIndex) return ser
      const filtered = (ser.missing_episodes || []).filter(ep => !(ep.season_number === episode.season_number && ep.episode_number === episode.episode_number))
      return { ...ser, missing_episodes: filtered }
    }))
    addToast({ type: 'info', message: `Hidden: ${label}`, action: { label: 'Undo', onClick: async () => {
      await window.electronAPI.removeExclusion(exclusionId)
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
    }}})
  }, [series, addToast])

  const dismissArtistAlbum = useCallback(async (artistIndex: number, album: MissingAlbumItem) => {
    const artist = artists[artistIndex]
    if (!artist) return
    const exclusionId = await window.electronAPI.addExclusion('artist_album', undefined, album.musicbrainz_id, artist.musicbrainz_id || artist.artist_name, album.title)
    // Remove from the appropriate missing list in state
    setArtists(prev => prev.map((a, i) => {
      if (i !== artistIndex) return a
      const removeFromJson = (json: string | undefined): string => {
        try {
          const parsed = JSON.parse(json || '[]') as Array<{ musicbrainz_id?: string; title?: string }>
          return JSON.stringify(parsed.filter(item => item.musicbrainz_id !== album.musicbrainz_id))
        } catch { return json || '[]' }
      }
      if (album.album_type === 'album') return { ...a, missing_albums: removeFromJson(a.missing_albums) }
      if (album.album_type === 'ep') return { ...a, missing_eps: removeFromJson(a.missing_eps) }
      if (album.album_type === 'single') return { ...a, missing_singles: removeFromJson(a.missing_singles) }
      return a
    }))
    addToast({ type: 'info', message: `Hidden: ${album.title}`, action: { label: 'Undo', onClick: async () => {
      await window.electronAPI.removeExclusion(exclusionId)
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
    }}})
  }, [artists, addToast])

  // Re-sort data when sort option changes
  // Helper to access created_at from DB row data (present in DB but not typed)
  const getCreatedAt = (item: unknown): string => ((item as Record<string, unknown>).created_at as string) || ''
  const formatMusicTier = (tier: string): string => {
    switch (tier) {
      case 'HI_RES': return 'Hi-Res'
      case 'LOSSLESS': return 'Lossless'
      case 'LOSSY_HIGH': return 'High Lossy'
      case 'LOSSY_MID': return 'Medium Lossy'
      case 'LOSSY_LOW': return 'Low Lossy'
      default: return tier
    }
  }

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortByWatchPriority = (a: any, b: any) => {
      const pcA = a.play_count || 0
      const pcB = b.play_count || 0
      if (pcA > 0 || pcB > 0) {
        const scoreA = (100 - (a.tier_score ?? 100)) * Math.log2(pcA + 2)
        const scoreB = (100 - (b.tier_score ?? 100)) * Math.log2(pcB + 2)
        if (scoreA !== scoreB) return scoreB - scoreA
      }
      if (pcA !== pcB) return pcB - pcA
      return (a.tier_score ?? 100) - (b.tier_score ?? 100)
    }
    setMovieUpgrades(prev => [...prev].sort((a, b) => {
      if (upgradeSortBy === 'quality') return (a.tier_score ?? 100) - (b.tier_score ?? 100)
      if (upgradeSortBy === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
      if (upgradeSortBy === 'watch_priority') return sortByWatchPriority(a, b)
      return a.title.localeCompare(b.title)
    }))
    setTvUpgrades(prev => [...prev].sort((a, b) => {
      if (upgradeSortBy === 'quality') return (a.tier_score ?? 100) - (b.tier_score ?? 100)
      if (upgradeSortBy === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
      if (upgradeSortBy === 'watch_priority') return sortByWatchPriority(a, b)
      return (a.series_title || a.title).localeCompare(b.series_title || b.title)
    }))
    setMusicUpgrades(prev => [...prev].sort((a, b) => {
      if (upgradeSortBy === 'quality') return (a.tier_score ?? 100) - (b.tier_score ?? 100)
      if (upgradeSortBy === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
      if (upgradeSortBy === 'watch_priority') return sortByWatchPriority(a, b)
      return a.title.localeCompare(b.title)
    }))
  }, [upgradeSortBy])

  useEffect(() => {
    setCollections(prev => [...prev].sort((a, b) => {
      if (collectionSortBy === 'completeness') return b.completeness_percentage - a.completeness_percentage
      if (collectionSortBy === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
      return a.collection_name.localeCompare(b.collection_name)
    }))
    // Reset expanded state and cached heights when sort changes
    setExpandedCollections(new Set())
    collectionsListInstanceRef.current?.resetAfterIndex(0)
  }, [collectionSortBy])

  useEffect(() => {
    setSeries(prev => [...prev].sort((a, b) => {
      if (seriesSortBy === 'completeness') return b.completeness_percentage - a.completeness_percentage
      if (seriesSortBy === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
      return a.series_title.localeCompare(b.series_title)
    }))
    setExpandedSeries(new Set())
    seriesListInstanceRef.current?.resetAfterIndex(0)
  }, [seriesSortBy])

  useEffect(() => {
    setArtists(prev => [...prev].sort((a, b) => {
      if (artistSortBy === 'completeness') return b.completeness_percentage - a.completeness_percentage
      return a.artist_name.localeCompare(b.artist_name)
    }))
    setExpandedArtists(new Set())
    artistsListInstanceRef.current?.resetAfterIndex(0)
  }, [artistSortBy])

  useEffect(() => {
    setPersonCompleteness(prev => [...prev].sort((a, b) => {
      if (personSortBy === 'completeness') return b.completeness_percentage - a.completeness_percentage
      return a.person_name.localeCompare(b.person_name)
    }))
    setExpandedPersons(new Set())
  }, [personSortBy])

  // Virtual list row renderers
  const MovieUpgradeRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = movieUpgrades[index]
    if (!item) return null
    return (
      <div style={style} className="px-2">
        <div
          className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-md transition-colors group/row cursor-pointer"
          onClick={() => setSelectedMediaId(item.id)}
        >
        <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40">
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
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <ArrButtons arrApps={arrApps} tmdbId={item.tmdb_id} title={item.title} year={item.year} mediaType="movie" compact />
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
          <button
            onClick={() => dismissMovieUpgrade(index)}
            className="opacity-0 group-hover/row:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
            title="Hide from view"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
        </div>
      </div>
    )
  }, [movieUpgrades, dismissMovieUpgrade, arrApps])

  const TvUpgradeRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = tvUpgrades[index]
    if (!item) return null
    return (
      <div style={style} className="px-2">
        <div
          className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-md transition-colors group/row cursor-pointer"
          onClick={() => setSelectedMediaId(item.id)}
        >
        <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40">
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
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <ArrButtons arrApps={arrApps} title={item.series_title || item.title} year={item.year} mediaType="tv" compact />
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
          <button
            onClick={() => dismissTvUpgrade(index)}
            className="opacity-0 group-hover/row:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
            title="Hide from view"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
        </div>
      </div>
    )
  }, [tvUpgrades, dismissTvUpgrade, arrApps])

  const MusicUpgradeRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const album = musicUpgrades[index]
    if (!album) return null
    return (
      <div style={style} className="px-2">
        <div
          className="flex items-center gap-3 px-2 py-1 hover:bg-muted/50 rounded-md transition-colors group/row cursor-pointer"
          onClick={() => setSelectedMediaId(album.id)}
        >
          <div className="w-10 h-10 bg-muted rounded overflow-hidden shrink-0">
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
              {formatMusicTier(album.quality_tier)}{album.best_bitrate ? ` · ${Math.round(album.best_bitrate)} kbps` : ''}
            </div>
          </div>
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <ArrButtons arrApps={arrApps} title={album.artist_name || album.title} mbId={album.musicbrainz_id} mediaType="music" compact />
            <AddToWishlistButton
              mediaType="album"
              title={album.title}
              year={album.year}
              artistName={album.artist_name}
              musicbrainzId={album.musicbrainz_id}
              reason="upgrade"
              compact
            />
            <button
              onClick={() => dismissMusicUpgrade(index)}
              className="opacity-0 group-hover/row:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
              title="Hide from view"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    )
  }, [musicUpgrades, dismissMusicUpgrade, arrApps])

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
          className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-hidden"
          onClick={() => missingCount > 0 && toggleCollectionExpand(index)}
          onKeyDown={handleKeyDown}
          aria-expanded={isExpanded}
          aria-label={`${collection.collection_name}, ${collection.owned_movies} of ${collection.total_movies} movies`}
        >
          <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40">
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
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </div>

        {/* Expanded: Missing movies */}
        {isExpanded && missingMovies.length > 0 && (
          <div className="ml-14 mt-1 mb-1 space-y-0.5 bg-muted/20 rounded-md px-2 py-1.5">
            {missingMovies.map((movie, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors group/item"
              >
                {movie.tmdb_id ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(`https://www.themoviedb.org/movie/${movie.tmdb_id}`) }}
                    className="text-sm text-muted-foreground truncate flex-1 text-left hover:text-primary hover:underline cursor-pointer transition-colors"
                    title="Open on TMDB"
                  >
                    {movie.title} {movie.year ? `(${movie.year})` : ''}
                  </button>
                ) : (
                  <span className="text-sm text-muted-foreground truncate flex-1">
                    {movie.title} {movie.year ? `(${movie.year})` : ''}
                  </span>
                )}
                <ArrButtons arrApps={arrApps} tmdbId={movie.tmdb_id} title={movie.title} year={movie.year} mediaType="movie" compact />
                <AddToWishlistButton
                  mediaType="movie"
                  title={movie.title}
                  year={movie.year}
                  tmdbId={movie.tmdb_id}
                  posterUrl={movie.poster_path}
                  reason="missing"
                  compact
                />
                <button
                  onClick={(e) => { e.stopPropagation(); dismissCollectionMovie(index, movie) }}
                  className="opacity-0 group-hover/item:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
                  title="Hide from view"
                >
                  <EyeOff className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }, [collections, expandedCollections, parseMissingMovies, toggleCollectionExpand, dismissCollectionMovie, arrApps])

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
          className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-hidden"
          onClick={() => missingCount > 0 && toggleSeriesExpand(index)}
          onKeyDown={handleKeyDown}
          aria-expanded={isExpanded}
          aria-label={`${s.series_title}, ${s.owned_seasons} of ${s.total_seasons} seasons, ${s.owned_episodes} of ${s.total_episodes} episodes`}
        >
          <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40">
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
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </div>

        {/* Expanded: Missing by season */}
        {isExpanded && seasonGroups.length > 0 && (
          <div className="ml-14 mt-1 mb-1 space-y-0.5 bg-muted/20 rounded-md px-2 py-1.5">
            {seasonGroups.map(group => (
              <div
                key={group.seasonNumber}
                className="flex items-center justify-between py-1.5 rounded-md hover:bg-muted/30 transition-colors group/item"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {s.tmdb_id ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(`https://www.themoviedb.org/tv/${s.tmdb_id}/season/${group.seasonNumber}`) }}
                      className="text-sm text-foreground/80 shrink-0 hover:text-primary hover:underline cursor-pointer transition-colors"
                      title="Open on TMDB"
                    >
                      S{group.seasonNumber}
                    </button>
                  ) : (
                    <span className="text-sm text-foreground/80 shrink-0">
                      S{group.seasonNumber}
                    </span>
                  )}
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
                <ArrButtons arrApps={arrApps} title={s.series_title} mediaType="tv" compact />
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
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    group.missingEpisodes.forEach(ep => dismissSeriesEpisode(index, ep))
                  }}
                  className="opacity-0 group-hover/item:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
                  title="Hide season from view"
                >
                  <EyeOff className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }, [series, expandedSeries, groupEpisodesBySeason, toggleSeriesExpand, dismissSeriesEpisode, arrApps])

  // Artist row renderer with grouped missing items by type
  const ArtistRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const artist = artists[index]
    if (!artist) return null
    const totalReleases = artist.total_albums
      + (includeEps ? artist.total_eps : 0)
      + (includeSingles ? artist.total_singles : 0)
    const ownedReleases = artist.owned_albums
      + (includeEps ? artist.owned_eps : 0)
      + (includeSingles ? artist.owned_singles : 0)
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
          className="flex items-center gap-3 px-2 py-1 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-hidden"
          onClick={() => totalMissing > 0 && toggleArtistExpand(index)}
          onKeyDown={handleKeyDown}
          aria-expanded={isExpanded}
          aria-label={`${artist.artist_name}, ${ownedReleases} of ${totalReleases} releases`}
        >
          <div className="w-10 h-10 bg-muted rounded-full overflow-hidden shrink-0 flex items-center justify-center shadow-md shadow-black/40">
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
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </div>

        {/* Expanded: Missing releases */}
        {isExpanded && allMissing.length > 0 && (
          <div className="ml-14 mt-1 mb-1 space-y-3 bg-muted/20 rounded-md px-2 py-1.5">
            {([
              { items: groupedByType.album, label: 'Albums', prefix: 'album' },
              { items: groupedByType.ep, label: 'EPs', prefix: 'ep' },
              { items: groupedByType.single, label: 'Singles', prefix: 'single' },
            ] as const).filter(g => g.items.length > 0).map(group => (
              <div key={group.prefix}>
                <div className="py-2 text-xs font-medium text-foreground/70 uppercase tracking-wider">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map((item, idx) => {
                    const coverUrl = item.musicbrainz_id
                      ? `https://coverartarchive.org/release-group/${item.musicbrainz_id}/front-250`
                      : null
                    return (
                    <div
                      key={item.musicbrainz_id || `${group.prefix}-${idx}`}
                      className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors group/item"
                    >
                      <div className="w-8 h-8 bg-muted rounded overflow-hidden shrink-0">
                        {coverUrl ? (
                          <img src={coverUrl} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-4 h-4 text-muted-foreground/50" />
                          </div>
                        )}
                      </div>
                      {item.musicbrainz_id ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(`https://musicbrainz.org/release-group/${item.musicbrainz_id}`) }}
                          className="text-sm text-muted-foreground truncate flex-1 text-left hover:text-primary hover:underline cursor-pointer transition-colors"
                          title="Open on MusicBrainz"
                        >
                          {item.title} {item.year ? `(${item.year})` : ''}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground truncate flex-1">
                          {item.title} {item.year ? `(${item.year})` : ''}
                        </span>
                      )}
                      <ArrButtons arrApps={arrApps} title={item.title} mbId={item.musicbrainz_id} mediaType="music" compact />
                      <AddToWishlistButton
                        mediaType="album"
                        title={item.title}
                        year={item.year}
                        artistName={artist.artist_name}
                        musicbrainzId={item.musicbrainz_id}
                        posterUrl={coverUrl || undefined}
                        reason="missing"
                        compact
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissArtistAlbum(index, item) }}
                        className="opacity-0 group-hover/item:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
                        title="Hide from view"
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }, [artists, expandedArtists, parseMissingAlbums, toggleArtistExpand, dismissArtistAlbum, includeEps, includeSingles, arrApps])

  const hasMovieUpgrades = hasMovies && movieUpgrades.length > 0
  const hasTvUpgrades = hasTV && tvUpgrades.length > 0
  const hasMusicUpgrades = hasMusic && musicUpgrades.length > 0
  const hasCollections = hasMovies && collections.length > 0
  const hasSeries = hasTV && series.length > 0
  const hasArtists = hasMusic && artists.length > 0
  const hasPersons = personCompleteness.length > 0

  // Check if any columns will be shown (based on library availability)
  const hasAnyLibrary = hasMovies || hasTV || hasMusic
  const hasNoSources = sources.length === 0
  const hasNothing = !hasAnyLibrary || (!hasMovieUpgrades && !hasTvUpgrades && !hasMusicUpgrades && !hasCollections && !hasSeries && !hasArtists && !hasPersons)

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="fixed top-[76px] bottom-4 flex flex-col overflow-hidden transition-[left,right] duration-300 ease-out"
        style={{
          left: sidebarCollapsed ? '96px' : '288px',
          right: '16px'
        }}
      >
        <div className="flex-1 flex gap-4 px-4 pb-4 overflow-x-auto overflow-y-hidden">
          {[0, 1, 2].map((col) => (
            <div key={col} className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
              <div className="shrink-0 p-4 border-b border-border/30">
                <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
              </div>
              <div className="flex-1 p-3 space-y-2 overflow-hidden">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-lg">
                    <div className="w-8 h-8 bg-muted/50 rounded animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted/50 rounded animate-pulse" style={{ width: `${55 + ((i * 17 + col * 11) % 35)}%` }} />
                      <div className="h-2.5 bg-muted/40 rounded animate-pulse" style={{ width: `${30 + ((i * 13 + col * 7) % 25)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        ref={containerRef}
        className="fixed top-[76px] bottom-4 flex flex-col items-center justify-center transition-[left,right] duration-300 ease-out"
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
      className="fixed top-[76px] bottom-4 flex flex-col overflow-hidden transition-[left,right] duration-300 ease-out"
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

      {/* Recently Upgraded poster strip */}
      {!hasNothing && recentlyUpgraded.length > 0 && (
        <div className="shrink-0 px-4 pb-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recently Upgraded</h2>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {recentlyUpgraded.map(item => (
              <button key={item.id} onClick={() => setSelectedMediaId(item.id)}
                className="shrink-0 w-[100px] group cursor-pointer text-left"
                title={`${item.title}${item.year ? ` (${item.year})` : ''}`}>
                <div className="aspect-2/3 bg-muted/50 rounded-md overflow-hidden mb-1 relative">
                  {item.poster_url ? (
                    <img src={item.poster_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {item.type === 'episode' ? <Tv className="w-5 h-5 text-muted-foreground/30" /> : <Film className="w-5 h-5 text-muted-foreground/30" />}
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 right-1 bg-black/70 rounded text-[9px] text-center text-emerald-400 font-medium py-0.5">
                    {item.previous_quality_tier} → {item.quality_tier}
                  </div>
                </div>
                <p className="text-[11px] font-medium truncate leading-tight group-hover:text-accent transition-colors">{item.title}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout — Upgrades | Completeness */}
      {!hasNothing && (
        <div className="flex-1 flex gap-4 px-4 pb-4 overflow-hidden">
          {/* Left: Upgrades Column */}
          <div className="flex-1 min-w-0 flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
            <div className="shrink-0 p-4 border-b border-border/30">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CircleFadingArrowUp className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Upgrades</h2>
                  {duplicateCount > 0 && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded-full font-medium"
                      title={`${duplicateCount} duplicate ${duplicateCount === 1 ? 'movie' : 'movies'} across sources`}>
                      {duplicateCount} dupe{duplicateCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={upgradeSortBy}
                    onChange={e => { const v = e.target.value as 'quality' | 'recent' | 'title' | 'watch_priority'; setUpgradeSortBy(v); window.electronAPI.setSetting(SETTING_KEYS.dashboard_upgrade_sort, v) }}
                    className="text-xs bg-background text-foreground border border-border/50 rounded px-2 py-0.5 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary"
                  >
                    <option value="quality">Quality</option>
                    <option value="watch_priority">Watch Priority</option>
                    <option value="recent">Recent</option>
                    <option value="title">Name</option>
                  </select>
                  <span className="text-xs text-muted-foreground">
                    {upgradeTab === 'movies' ? movieUpgrades.length : upgradeTab === 'tv' ? tvUpgrades.length : musicUpgrades.length}
                  </span>
                </div>
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

          {/* Right: Completeness Column (tabbed) */}
          {(hasCollections || hasSeries || hasArtists || hasPersons) && (() => {
            const tabs: Array<{ key: 'collections' | 'series' | 'music' | 'filmography'; label: string; count: number; icon: typeof Film }> = []
            if (hasMovies) tabs.push({ key: 'collections', label: 'Collections', count: collections.length, icon: Film })
            if (hasTV) tabs.push({ key: 'series', label: 'Series', count: series.length, icon: Tv })
            if (hasMusic) tabs.push({ key: 'music', label: 'Music', count: artists.length, icon: Music })
            if (hasPersons) tabs.push({ key: 'filmography', label: 'Filmography', count: personCompleteness.length, icon: Film })
            const activeTab = tabs.find(t => t.key === completenessTab) ? completenessTab : tabs[0]?.key || 'collections'
            if (activeTab !== completenessTab) setCompletenessTab(activeTab)

            // Per-tab sort dropdown
            const sortDropdown = activeTab === 'collections' ? (
              <select value={collectionSortBy} onChange={e => { const v = e.target.value as 'completeness' | 'name' | 'recent'; setCollectionSortBy(v); window.electronAPI.setSetting(SETTING_KEYS.dashboard_collection_sort, v) }}
                className="text-xs bg-background text-foreground border border-border/50 rounded px-2 py-0.5 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary">
                <option value="completeness">Completeness</option><option value="name">Name</option><option value="recent">Recent</option>
              </select>
            ) : activeTab === 'series' ? (
              <select value={seriesSortBy} onChange={e => { const v = e.target.value as 'completeness' | 'name' | 'recent'; setSeriesSortBy(v); window.electronAPI.setSetting(SETTING_KEYS.dashboard_series_sort, v) }}
                className="text-xs bg-background text-foreground border border-border/50 rounded px-2 py-0.5 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary">
                <option value="completeness">Completeness</option><option value="name">Name</option><option value="recent">Recent</option>
              </select>
            ) : activeTab === 'music' ? (
              <select value={artistSortBy} onChange={e => { const v = e.target.value as 'completeness' | 'name'; setArtistSortBy(v); window.electronAPI.setSetting(SETTING_KEYS.dashboard_artist_sort, v) }}
                className="text-xs bg-background text-foreground border border-border/50 rounded px-2 py-0.5 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary">
                <option value="completeness">Completeness</option><option value="name">Name</option>
              </select>
            ) : (
              <select value={personSortBy} onChange={e => { const v = e.target.value as 'completeness' | 'name'; setPersonSortBy(v); window.electronAPI.setSetting(SETTING_KEYS.dashboard_person_sort, v) }}
                className="text-xs bg-background text-foreground border border-border/50 rounded px-2 py-0.5 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary">
                <option value="completeness">Completeness</option><option value="name">Name</option>
              </select>
            )

            const activeCount = tabs.find(t => t.key === activeTab)?.count ?? 0

            return (
              <div className="flex-1 min-w-0 flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
                <div className="shrink-0 p-4 border-b border-border/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Library className="w-4 h-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">Completeness</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      {sortDropdown}
                      <span className="text-xs text-muted-foreground">{activeCount}</span>
                    </div>
                  </div>
                  {tabs.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      {tabs.map(tab => (
                        <button key={tab.key}
                          onClick={() => setCompletenessTab(tab.key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            activeTab === tab.key
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                          }`}>
                          <tab.icon className="w-3 h-3" />
                          <span>{tab.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
                  <div ref={completenessListRef} className="absolute inset-0">
                    {/* Collections tab */}
                    {activeTab === 'collections' && (
                      collections.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">All collections complete</div>
                      ) : (
                        <VariableSizeList ref={collectionsListInstanceRef} height={completenessListHeight} itemCount={collections.length} itemSize={getCollectionRowHeight} width="100%">
                          {CollectionRow}
                        </VariableSizeList>
                      )
                    )}
                    {/* Series tab */}
                    {activeTab === 'series' && (
                      series.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">All series complete</div>
                      ) : (
                        <VariableSizeList ref={seriesListInstanceRef} height={completenessListHeight} itemCount={series.length} itemSize={getSeriesRowHeight} width="100%">
                          {SeriesRow}
                        </VariableSizeList>
                      )
                    )}
                    {/* Music tab */}
                    {activeTab === 'music' && (
                      artists.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">All artists complete</div>
                      ) : (
                        <VariableSizeList ref={artistsListInstanceRef} height={completenessListHeight} itemCount={artists.length} itemSize={getArtistRowHeight} width="100%">
                          {ArtistRow}
                        </VariableSizeList>
                      )
                    )}
                    {/* Filmography tab */}
                    {activeTab === 'filmography' && (
                      <div className="overflow-y-auto h-full scrollbar-visible">
                        {personCompleteness.map(person => {
                          const isExpanded = expandedPersons.has(person.id)
                          const missingMovies: Array<{ tmdb_id: string; title: string; year: number | null; poster_path?: string }> = (() => {
                            try { return JSON.parse(person.missing_movies || '[]') } catch { return [] }
                          })()
                          return (
                            <div key={person.id}>
                              <div className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors"
                                onClick={() => { setExpandedPersons(prev => { const next = new Set(prev); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next }) }}>
                                {person.profile_url ? (
                                  <img src={person.profile_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                                ) : (
                                  <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0">
                                    <Film className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{person.person_name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    <span className="capitalize">{person.person_type}</span> · {person.owned_movies}/{person.total_movies} ({person.completeness_percentage}%)
                                  </p>
                                </div>
                                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </div>
                              {isExpanded && missingMovies.length > 0 && (
                                <div className="ml-4 pl-2 border-l border-border/30 space-y-1 py-1 mb-2 bg-muted/20 rounded-md">
                                  {missingMovies.slice(0, 20).map(movie => (
                                    <div key={movie.tmdb_id} className="flex items-center gap-2 px-2 py-1">
                                      <div className="w-6 h-8 bg-muted rounded overflow-hidden shrink-0">
                                        {movie.poster_path ? (
                                          <img src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center"><Film className="w-3 h-3 text-muted-foreground/30" /></div>
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium truncate">{movie.title}</p>
                                        {movie.year && <p className="text-[10px] text-muted-foreground">{movie.year}</p>}
                                      </div>
                                      <AddToWishlistButton mediaType="movie" title={movie.title} year={movie.year || undefined} tmdbId={movie.tmdb_id} compact />
                                    </div>
                                  ))}
                                  {missingMovies.length > 20 && (
                                    <p className="text-[10px] text-muted-foreground px-2 py-1">+ {missingMovies.length - 20} more</p>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}


      {/* Storage analytics status bar */}
      {!hasNothing && storageAnalytics && storageAnalytics.totalItems > 0 && (
        <div className="shrink-0 px-4 pb-1">
          <div className="flex items-center gap-3 px-4 py-2 bg-sidebar-gradient rounded-xl text-[11px] text-muted-foreground overflow-x-auto scrollbar-hide">
            {/* Total size */}
            <span className="shrink-0 font-medium text-foreground/70">
              {storageAnalytics.totalSize >= 1e12
                ? `${(storageAnalytics.totalSize / 1e12).toFixed(1)} TB`
                : `${(storageAnalytics.totalSize / 1e9).toFixed(1)} GB`}
            </span>
            <span className="text-border shrink-0">|</span>
            {/* Items count */}
            <span className="shrink-0">{storageAnalytics.totalItems.toLocaleString()} items</span>
            <span className="text-border shrink-0">|</span>
            {/* Quality tiers */}
            {storageAnalytics.byTier.map(t => (
              <span key={t.tier} className="shrink-0">{t.tier}: {t.count}</span>
            ))}
            <span className="text-border shrink-0">|</span>
            {/* Top codecs */}
            {storageAnalytics.byCodec.slice(0, 4).map(c => (
              <span key={c.codec} className="shrink-0 font-mono">{c.codec}: {c.count}</span>
            ))}
            {/* Duplicates */}
            {duplicateCount > 0 && (
              <>
                <span className="text-border shrink-0">|</span>
                <span className="shrink-0 text-amber-500">{duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''}</span>
              </>
            )}
            {/* Recently upgraded */}
            {recentlyUpgraded.length > 0 && (
              <>
                <span className="text-border shrink-0">|</span>
                <span className="shrink-0 text-emerald-500">{recentlyUpgraded.length} upgraded</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Media Detail Modal */}
      {selectedMediaId !== null && (
        <MediaDetails
          mediaId={selectedMediaId}
          onClose={() => setSelectedMediaId(null)}
          onDismissUpgrade={(mediaId, title) => {
            // Find and dismiss from the appropriate upgrade list
            const movieIdx = movieUpgrades.findIndex(m => m.id === mediaId)
            if (movieIdx !== -1) { dismissMovieUpgrade(movieIdx); setSelectedMediaId(null); return }
            const tvIdx = tvUpgrades.findIndex(e => e.id === mediaId)
            if (tvIdx !== -1) { dismissTvUpgrade(tvIdx); setSelectedMediaId(null); return }
            const musicIdx = musicUpgrades.findIndex(m => m.id === mediaId)
            if (musicIdx !== -1) { dismissMusicUpgrade(musicIdx); setSelectedMediaId(null); return }
            // Item not in upgrade lists, dismiss directly
            window.electronAPI.addExclusion('media_upgrade', mediaId, undefined, undefined, title)
            setSelectedMediaId(null)
          }}
        />
      )}
    </div>
  )
}
