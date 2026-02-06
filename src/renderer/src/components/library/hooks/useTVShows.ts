import { useState, useCallback, useMemo } from 'react'
import type { MediaItem, TVShow } from '../types'

interface UseTVShowsReturn {
  selectedShow: string | null
  setSelectedShow: (show: string | null) => void
  selectedSeason: number | null
  setSelectedSeason: (season: number | null) => void
  tvShows: Map<string, TVShow>
  filteredShows: [string, TVShow][]
}

/**
 * Hook to organize TV shows hierarchically from episode items
 *
 * Takes a flat list of episode MediaItems and organizes them into a
 * show -> season -> episode hierarchy. Also provides filtered/sorted shows
 * based on alphabet filter and search query.
 *
 * @param items All media items (will filter to episodes)
 * @param alphabetFilter Current alphabet filter (null, '#', or 'A'-'Z')
 * @param searchQuery Current search query
 * @returns TV show organization state and data
 */
export function useTVShows(
  items: MediaItem[],
  alphabetFilter: string | null,
  searchQuery: string
): UseTVShowsReturn {
  // TV Show navigation state
  const [selectedShow, setSelectedShow] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)

  // Organize TV shows hierarchically
  const organizeShows = useCallback((): Map<string, TVShow> => {
    const shows = new Map<string, TVShow>()

    items
      .filter((item) => item.type === 'episode')
      .forEach((episode) => {
        const showTitle = episode.series_title || 'Unknown Series'

        if (!shows.has(showTitle)) {
          shows.set(showTitle, {
            title: showTitle,
            poster_url: episode.poster_url,
            seasons: new Map(),
          })
        }

        const show = shows.get(showTitle)!
        const seasonNum = episode.season_number || 0

        // Update show poster if not set yet but this episode has one
        if (!show.poster_url && episode.poster_url) {
          show.poster_url = episode.poster_url
        }

        if (!show.seasons.has(seasonNum)) {
          show.seasons.set(seasonNum, {
            seasonNumber: seasonNum,
            episodes: [],
            posterUrl: episode.season_poster_url,
          })
        }

        // Update season poster if not set yet
        const season = show.seasons.get(seasonNum)!
        if (!season.posterUrl && episode.season_poster_url) {
          season.posterUrl = episode.season_poster_url
        }

        season.episodes.push(episode)
      })

    // Sort episodes within each season
    shows.forEach((show) => {
      show.seasons.forEach((season) => {
        season.episodes.sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
      })
    })

    return shows
  }, [items])

  const tvShows = useMemo(() => organizeShows(), [organizeShows])

  // Filter TV shows by alphabet and search, then sort alphabetically
  const filteredShows = useMemo(
    () =>
      Array.from(tvShows.entries())
        .filter(([title]) => {
          // Alphabet filter
          if (alphabetFilter) {
            const firstChar = title.charAt(0).toUpperCase()
            if (alphabetFilter === '#') {
              if (/[A-Z]/.test(firstChar)) return false
            } else {
              if (firstChar !== alphabetFilter) return false
            }
          }

          // Search filter
          if (!searchQuery.trim()) return true
          return title.toLowerCase().includes(searchQuery.toLowerCase())
        })
        .sort((a, b) => a[0].localeCompare(b[0])),
    [tvShows, alphabetFilter, searchQuery]
  )

  return {
    selectedShow,
    setSelectedShow,
    selectedSeason,
    setSelectedSeason,
    tvShows,
    filteredShows,
  }
}
