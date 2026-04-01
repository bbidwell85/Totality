import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  emitDismissUpgrade,
  emitDismissCollectionMovie,
} from '../../../utils/dismissEvents'
import type {
  MediaItem,
  MissingEpisode,
  MissingAlbum,
  SeriesCompletenessData,
  MovieCollectionData,
  ArtistCompletenessData,
} from '../types'

interface MissingItemPopupState {
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
}

interface ToastOptions {
  type: 'success' | 'error' | 'info'
  title: string
  message: string
  duration?: number
  action?: { label: string; onClick: () => void }
}

interface UseDismissHandlersOptions {
  setPaginatedMovies: Dispatch<SetStateAction<MediaItem[]>>
  setSelectedShowEpisodes: Dispatch<SetStateAction<MediaItem[]>>
  seriesCompleteness: Map<string, SeriesCompletenessData>
  setSeriesCompleteness: Dispatch<SetStateAction<Map<string, SeriesCompletenessData>>>
  selectedCollection: MovieCollectionData | null
  setSelectedCollection: Dispatch<SetStateAction<MovieCollectionData | null>>
  setMovieCollections: Dispatch<SetStateAction<MovieCollectionData[]>>
  setArtistCompleteness: Dispatch<SetStateAction<Map<string, ArtistCompletenessData>>>
  selectedMissingItem: MissingItemPopupState | null
  setSelectedMissingItem: (item: MissingItemPopupState | null) => void
  addToast: (toast: ToastOptions) => void
}

interface UseDismissHandlersReturn {
  handleDismissUpgrade: (item: MediaItem) => Promise<void>
  handleDismissMissingEpisode: (episode: MissingEpisode, seriesTitle: string, tmdbId?: string) => Promise<void>
  handleDismissMissingSeason: (seasonNumber: number, seriesTitle: string, tmdbId?: string) => Promise<void>
  handleDismissCollectionMovie: (tmdbId: string, movieTitle: string) => Promise<void>
  handleDismissMissingAlbum: (album: MissingAlbum, artistName: string, artistMusicbrainzId?: string) => Promise<void>
  handleDismissMissingItem: () => void
}

/**
 * Hook to manage dismiss/exclusion handlers for upgrades, missing episodes,
 * missing seasons, and missing collection movies.
 */
export function useDismissHandlers({
  setPaginatedMovies,
  setSelectedShowEpisodes,
  seriesCompleteness,
  setSeriesCompleteness,
  selectedCollection,
  setSelectedCollection,
  setMovieCollections,
  setArtistCompleteness,
  selectedMissingItem,
  setSelectedMissingItem,
  addToast,
}: UseDismissHandlersOptions): UseDismissHandlersReturn {

  const handleDismissUpgrade = useCallback(async (item: MediaItem) => {
    try {
      const title = item.series_title
        ? `${item.series_title} S${item.season_number}E${item.episode_number}`
        : item.title
      const exclusionId = await window.electronAPI.addExclusion('media_upgrade', item.id, undefined, undefined, title)
      setPaginatedMovies(prev => prev.map(m =>
        m.id === item.id ? { ...m, needs_upgrade: false, tier_quality: m.tier_quality === 'LOW' ? 'MEDIUM' : m.tier_quality } : m
      ))
      setSelectedShowEpisodes(prev => prev.map(e =>
        e.id === item.id ? { ...e, needs_upgrade: false, tier_quality: e.tier_quality === 'LOW' ? 'MEDIUM' : e.tier_quality } : e
      ))
      emitDismissUpgrade({ mediaId: item.id })
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
      addToast({
        type: 'success',
        title: 'Upgrade dismissed',
        message: `"${title}" removed from upgrade recommendations`,
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await window.electronAPI.removeExclusion(exclusionId)
              setPaginatedMovies(prev => prev.map(m =>
                m.id === item.id ? { ...m, needs_upgrade: true } : m
              ))
              setSelectedShowEpisodes(prev => prev.map(e =>
                e.id === item.id ? { ...e, needs_upgrade: true } : e
              ))
              window.dispatchEvent(new CustomEvent('exclusions-changed'))
            } catch { /* ignore */ }
          },
        },
      })
    } catch (err) {
      console.error('Failed to dismiss upgrade:', err)
    }
  }, [setPaginatedMovies, setSelectedShowEpisodes, addToast])

  const handleDismissMissingEpisode = useCallback(async (episode: MissingEpisode, seriesTitle: string, tmdbId?: string) => {
    try {
      const refKey = `S${episode.season_number}E${episode.episode_number}`
      const title = `${seriesTitle} ${refKey}`
      await window.electronAPI.addExclusion('series_episode', undefined, refKey, tmdbId || seriesTitle, title)
      setSeriesCompleteness(prev => {
        const next = new Map(prev)
        const data = next.get(seriesTitle)
        if (data?.missing_episodes) {
          try {
            const missing: MissingEpisode[] = JSON.parse(data.missing_episodes)
            const filtered = missing.filter(e => !(e.season_number === episode.season_number && e.episode_number === episode.episode_number))
            // Also update missing_seasons if no episodes remain for dismissed season
            const remainingSeasonsWithMissing = new Set(filtered.map(e => e.season_number))
            const missSeasons: number[] = JSON.parse(data.missing_seasons || '[]')
            const filteredSeasons = missSeasons.filter(s => remainingSeasonsWithMissing.has(s))
            next.set(seriesTitle, {
              ...data,
              missing_episodes: JSON.stringify(filtered),
              missing_seasons: JSON.stringify(filteredSeasons),
            })
          } catch { /* ignore */ }
        }
        return next
      })
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
      addToast({ type: 'success', title: 'Item dismissed', message: `"${title}" removed from recommendations` })
    } catch (err) {
      console.error('Failed to dismiss missing episode:', err)
    }
  }, [setSeriesCompleteness, addToast])

  const handleDismissMissingSeason = useCallback(async (seasonNumber: number, seriesTitle: string, tmdbId?: string) => {
    try {
      const data = seriesCompleteness.get(seriesTitle)
      if (!data?.missing_episodes) return
      const allMissing: MissingEpisode[] = JSON.parse(data.missing_episodes || '[]')
      const seasonEpisodes = allMissing.filter(e => e.season_number === seasonNumber)
      await Promise.all(seasonEpisodes.map(ep => {
        const refKey = `S${ep.season_number}E${ep.episode_number}`
        return window.electronAPI.addExclusion('series_episode', undefined, refKey, tmdbId || seriesTitle, `${seriesTitle} ${refKey}`)
      }))
      setSeriesCompleteness(prev => {
        const next = new Map(prev)
        const d = next.get(seriesTitle)
        if (d?.missing_episodes) {
          try {
            const missing: MissingEpisode[] = JSON.parse(d.missing_episodes)
            const filtered = missing.filter(e => e.season_number !== seasonNumber)
            // Also remove the season from missing_seasons if no episodes remain for it
            const remainingSeasonsWithMissing = new Set(filtered.map(e => e.season_number))
            const missSeasons: number[] = JSON.parse(d.missing_seasons || '[]')
            const filteredSeasons = missSeasons.filter(s => remainingSeasonsWithMissing.has(s))
            next.set(seriesTitle, {
              ...d,
              missing_episodes: JSON.stringify(filtered),
              missing_seasons: JSON.stringify(filteredSeasons),
            })
          } catch { /* ignore */ }
        }
        return next
      })
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
      addToast({ type: 'success', title: 'Season dismissed', message: `${seasonEpisodes.length} missing episodes from Season ${seasonNumber} removed` })
    } catch (err) {
      console.error('Failed to dismiss missing season:', err)
    }
  }, [seriesCompleteness, setSeriesCompleteness, addToast])

  const handleDismissCollectionMovie = useCallback(async (tmdbId: string, movieTitle: string) => {
    try {
      if (!selectedCollection) return
      const collectionId = selectedCollection.tmdb_collection_id
      await window.electronAPI.addExclusion('collection_movie', undefined, tmdbId, collectionId, movieTitle)

      const updateCollection = (c: MovieCollectionData): MovieCollectionData => {
        try {
          const missing = JSON.parse(c.missing_movies || '[]')
          const filtered = missing.filter((m: { tmdb_id: string }) => m.tmdb_id !== tmdbId)
          const newTotal = c.total_movies - 1
          return {
            ...c,
            missing_movies: JSON.stringify(filtered),
            total_movies: newTotal,
            completeness_percentage: newTotal > 0 ? c.owned_movies / newTotal * 100 : 100
          }
        } catch { return c }
      }

      setSelectedCollection(prev => prev ? updateCollection(prev) : prev)
      setMovieCollections(prev =>
        prev.map(c => c.tmdb_collection_id === collectionId ? updateCollection(c) : c)
            .filter(c => c.total_movies > 1)
      )
      emitDismissCollectionMovie({ collectionId, tmdbId })
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
      addToast({ type: 'success', title: 'Movie dismissed', message: `"${movieTitle}" removed from collection recommendations` })
    } catch (err) {
      console.error('Failed to dismiss collection movie:', err)
    }
  }, [selectedCollection, setSelectedCollection, setMovieCollections, addToast])

  const handleDismissMissingAlbum = useCallback(async (album: MissingAlbum, artistName: string, artistMusicbrainzId?: string) => {
    try {
      await window.electronAPI.addExclusion('artist_album', undefined, album.musicbrainz_id, artistMusicbrainzId || artistName, album.title)
      setArtistCompleteness(prev => {
        const next = new Map(prev)
        const data = next.get(artistName)
        if (!data) return next
        const removeFromJson = (json: string | undefined): string => {
          try {
            const parsed = JSON.parse(json || '[]') as Array<{ musicbrainz_id?: string }>
            return JSON.stringify(parsed.filter(item => item.musicbrainz_id !== album.musicbrainz_id))
          } catch { return json || '[]' }
        }
        const updated = { ...data }
        if (album.album_type === 'album') updated.missing_albums = removeFromJson(data.missing_albums)
        else if (album.album_type === 'ep') updated.missing_eps = removeFromJson(data.missing_eps)
        else if (album.album_type === 'single') updated.missing_singles = removeFromJson(data.missing_singles)
        next.set(artistName, updated)
        return next
      })
      window.dispatchEvent(new CustomEvent('exclusions-changed'))
      addToast({ type: 'success', title: 'Album dismissed', message: `"${album.title}" removed from recommendations` })
    } catch (err) {
      console.error('Failed to dismiss missing album:', err)
    }
  }, [setArtistCompleteness, addToast])

  const handleDismissMissingItem = useCallback(() => {
    if (!selectedMissingItem) return
    const item = selectedMissingItem
    if (item.type === 'episode' && item.seasonNumber !== undefined && item.episodeNumber !== undefined) {
      handleDismissMissingEpisode(
        { season_number: item.seasonNumber, episode_number: item.episodeNumber, title: item.title, air_date: item.airDate },
        item.seriesTitle || '',
        item.tmdbId
      )
    } else if (item.type === 'season' && item.seasonNumber !== undefined) {
      handleDismissMissingSeason(item.seasonNumber, item.seriesTitle || '', item.tmdbId)
    } else if (item.type === 'movie' && item.tmdbId) {
      handleDismissCollectionMovie(item.tmdbId, item.title)
    }
    setSelectedMissingItem(null)
  }, [selectedMissingItem, setSelectedMissingItem, handleDismissMissingEpisode, handleDismissMissingSeason, handleDismissCollectionMovie])

  return {
    handleDismissUpgrade,
    handleDismissMissingEpisode,
    handleDismissMissingSeason,
    handleDismissCollectionMovie,
    handleDismissMissingAlbum,
    handleDismissMissingItem,
  }
}
