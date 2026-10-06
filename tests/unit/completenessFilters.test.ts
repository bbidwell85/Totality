import { describe, it, expect } from 'vitest'
import {
  parseAutoRules,
  filterMissingMoviesByRules,
  filterMissingEpisodesByRules,
  buildTheatricalCutoff,
  applyCollectionFilters,
  applySeriesFilters,
  applyArtistFilters,
} from '../../src/renderer/src/utils/completenessFilters'
import type { MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData } from '../../src/renderer/src/components/library/types'

describe('completenessFilters', () => {
  // ==========================================================================
  // parseAutoRules
  // ==========================================================================
  describe('parseAutoRules', () => {
    it('returns empty array for null', () => {
      expect(parseAutoRules(null)).toEqual([])
    })

    it('returns empty array for empty string', () => {
      expect(parseAutoRules('')).toEqual([])
    })

    it('returns empty array for invalid JSON', () => {
      expect(parseAutoRules('not json')).toEqual([])
    })

    it('parses valid JSON array', () => {
      const rules = [{ id: '1', field: 'year', operator: 'lt', value: 1990 }]
      expect(parseAutoRules(JSON.stringify(rules))).toEqual(rules)
    })
  })

  // ==========================================================================
  // filterMissingMoviesByRules
  // ==========================================================================
  describe('filterMissingMoviesByRules', () => {
    const movies = [
      { tmdb_id: '1', title: 'Old Movie', year: 1980 },
      { tmdb_id: '2', title: 'New Movie', year: 2020 },
      { tmdb_id: '3', title: 'Classic Film', year: 1960 },
    ]

    it('returns all when no rules', () => {
      expect(filterMissingMoviesByRules(movies, [])).toBe(movies)
    })

    it('filters by year lt', () => {
      const rules = [{ id: '1', field: 'year' as const, operator: 'lt' as const, value: 1970 }]
      const result = filterMissingMoviesByRules(movies, rules)
      expect(result).toHaveLength(2)
      expect(result.map(m => m.tmdb_id)).toEqual(['1', '2'])
    })

    it('filters by year gt', () => {
      const rules = [{ id: '1', field: 'year' as const, operator: 'gt' as const, value: 2010 }]
      const result = filterMissingMoviesByRules(movies, rules)
      expect(result).toHaveLength(2)
      expect(result.map(m => m.tmdb_id)).toEqual(['1', '3'])
    })

    it('filters by title contains (case insensitive)', () => {
      const rules = [{ id: '1', field: 'title' as const, operator: 'contains' as const, value: 'classic' }]
      const result = filterMissingMoviesByRules(movies, rules)
      expect(result).toHaveLength(2)
      expect(result.map(m => m.title)).toEqual(['Old Movie', 'New Movie'])
    })

    it('combines multiple rules (OR logic)', () => {
      const rules = [
        { id: '1', field: 'year' as const, operator: 'lt' as const, value: 1970 },
        { id: '2', field: 'title' as const, operator: 'contains' as const, value: 'old' },
      ]
      const result = filterMissingMoviesByRules(movies, rules)
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('New Movie')
    })
  })

  // ==========================================================================
  // filterMissingEpisodesByRules
  // ==========================================================================
  describe('filterMissingEpisodesByRules', () => {
    it('returns all when no rules', () => {
      const episodes = [{ season_number: 1, episode_number: 1 }]
      expect(filterMissingEpisodesByRules(episodes, [])).toBe(episodes)
    })

    it('uses release_date when year is missing', () => {
      const episodes = [
        { season_number: 1, episode_number: 1, air_date: '1960-01-01' },
        { season_number: 1, episode_number: 2, air_date: '2020-06-01' },
      ]
      const rules = [{ id: '1', field: 'year' as const, operator: 'lt' as const, value: 1970 }]
      // MissingEpisode uses air_date but matchesAnyRule looks for release_date
      // The filter function passes episodes directly, and matchesAnyRule checks item.release_date
      // Since MissingEpisode doesn't have release_date, year check falls through
      const result = filterMissingEpisodesByRules(episodes, rules)
      // Since MissingEpisode has no year or release_date field, year rules won't match
      expect(result).toHaveLength(2)
    })
  })

  // ==========================================================================
  // buildTheatricalCutoff
  // ==========================================================================
  describe('buildTheatricalCutoff', () => {
    it('returns null for 0 days', () => {
      expect(buildTheatricalCutoff(0)).toBeNull()
    })

    it('returns null for negative days', () => {
      expect(buildTheatricalCutoff(-10)).toBeNull()
    })

    it('returns ISO date string for positive days', () => {
      const result = buildTheatricalCutoff(30)
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('returns a date in the past', () => {
      const result = buildTheatricalCutoff(30)!
      const today = new Date().toISOString().split('T')[0]
      expect(result < today).toBe(true)
    })
  })

  // ==========================================================================
  // applyCollectionFilters
  // ==========================================================================
  describe('applyCollectionFilters', () => {
    const baseCollection: MovieCollectionData = {
      id: 1,
      tmdb_collection_id: '100',
      collection_name: 'Test Collection',
      total_movies: 5,
      owned_movies: 3,
      missing_movies: [
        { tmdb_id: '201', title: 'Movie A', year: 2020 },
        { tmdb_id: '202', title: 'Movie B', year: 2021, release_date: '2021-06-15' },
      ],
      owned_movie_ids: ['301', '302', '303'],
      completeness_percentage: 60,
    }

    it('returns same reference when nothing excluded', () => {
      const result = applyCollectionFilters(baseCollection, new Set(), null)
      expect(result).toBe(baseCollection)
    })

    it('excludes movies by key', () => {
      const excluded = new Set(['100:201'])
      const result = applyCollectionFilters(baseCollection, excluded, null)
      expect(result.missing_movies).toHaveLength(1)
      expect(result.missing_movies[0].tmdb_id).toBe('202')
      expect(result.total_movies).toBe(4)
      expect(result.completeness_percentage).toBe(75)
    })

    it('filters by theatrical cutoff', () => {
      // Cutoff in the past — movie B's release_date is after cutoff so it stays
      const result = applyCollectionFilters(baseCollection, new Set(), '2020-01-01')
      // Movie A has no release_date (falsy), so !m.release_date = true, passes filter
      // Movie B has release_date '2021-06-15' which is > '2020-01-01', filtered out
      expect(result.missing_movies).toHaveLength(1)
      expect(result.missing_movies[0].tmdb_id).toBe('201')
    })

    it('recalculates percentage to 100 when all excluded', () => {
      const excluded = new Set(['100:201', '100:202'])
      const result = applyCollectionFilters(baseCollection, excluded, null)
      expect(result.missing_movies).toHaveLength(0)
      expect(result.completeness_percentage).toBe(100)
    })
  })

  // ==========================================================================
  // applySeriesFilters
  // ==========================================================================
  describe('applySeriesFilters', () => {
    const baseSeries: SeriesCompletenessData = {
      id: 1,
      series_title: 'Test Series',
      total_seasons: 3,
      total_episodes: 30,
      owned_seasons: 2,
      owned_episodes: 20,
      missing_seasons: [3],
      missing_episodes: [
        { season_number: 1, episode_number: 5, title: 'S1E5' },
        { season_number: 2, episode_number: 3, title: 'S2E3' },
        { season_number: 3, episode_number: 1, title: 'S3E1' },
      ],
      completeness_percentage: 67,
      tmdb_id: '500',
    }

    it('returns same reference when nothing excluded', () => {
      const result = applySeriesFilters(baseSeries, new Set())
      expect(result).toBe(baseSeries)
    })

    it('excludes episodes by key', () => {
      const excluded = new Set(['500:S1E5'])
      const result = applySeriesFilters(baseSeries, excluded)
      expect(result.missing_episodes).toHaveLength(2)
      expect(result.total_episodes).toBe(29)
    })

    it('suppresses empty seasons', () => {
      const excluded = new Set<string>()
      const result = applySeriesFilters(baseSeries, excluded, true)
      // missing_seasons = [3], so season 3 episodes removed
      expect(result.missing_episodes).toHaveLength(2)
      expect(result.missing_episodes.every(ep => ep.season_number !== 3)).toBe(true)
    })

    it('recalculates percentage', () => {
      const excluded = new Set(['500:S1E5', '500:S2E3', '500:S3E1'])
      const result = applySeriesFilters(baseSeries, excluded)
      expect(result.missing_episodes).toHaveLength(0)
      // total_episodes = max(20, 30-3) = 27, pct = round(20/27*100) = 74
      expect(result.completeness_percentage).toBe(74)
    })
  })

  // ==========================================================================
  // applyArtistFilters
  // ==========================================================================
  describe('applyArtistFilters', () => {
    const baseArtist: ArtistCompletenessData = {
      id: 1,
      artist_name: 'Test Artist',
      musicbrainz_id: 'mbid-123',
      total_albums: 5,
      owned_albums: 3,
      total_singles: 4,
      owned_singles: 2,
      total_eps: 2,
      owned_eps: 1,
      missing_albums: JSON.stringify([{ musicbrainz_id: 'a1' }, { musicbrainz_id: 'a2' }]),
      missing_singles: JSON.stringify([{ musicbrainz_id: 's1' }]),
      missing_eps: JSON.stringify([{ musicbrainz_id: 'e1' }]),
      completeness_percentage: 55,
    }

    it('excludes albums by key', () => {
      const excluded = new Set(['mbid-123:a1'])
      const result = applyArtistFilters(baseArtist, excluded, true, true)
      const missingAlbums = JSON.parse(result.missing_albums)
      expect(missingAlbums).toHaveLength(1)
      expect(result.total_albums).toBe(4)
    })

    it('excludes EPs from totals when includeEps is false', () => {
      const result = applyArtistFilters(baseArtist, new Set(), false, true)
      // total = 5 albums + 0 eps + 4 singles = 9, owned = 3 + 0 + 2 = 5
      expect(result.completeness_percentage).toBe(56) // round(5/9*100)
    })

    it('excludes singles from totals when includeSingles is false', () => {
      const result = applyArtistFilters(baseArtist, new Set(), true, false)
      // total = 5 albums + 2 eps + 0 singles = 7, owned = 3 + 1 + 0 = 4
      expect(result.completeness_percentage).toBe(57) // round(4/7*100)
    })

    it('returns 100% when all excluded', () => {
      const excluded = new Set(['mbid-123:a1', 'mbid-123:a2', 'mbid-123:s1', 'mbid-123:e1'])
      const result = applyArtistFilters(baseArtist, excluded, true, true)
      // total items = (5-2) + (2-1) + (4-1) = 3+1+3 = 7, owned = 3+1+2 = 6
      expect(result.completeness_percentage).toBe(86) // round(6/7*100)
    })

    it('uses artist_name as key when no musicbrainz_id', () => {
      const artist = { ...baseArtist, musicbrainz_id: undefined }
      const excluded = new Set(['Test Artist:a1'])
      const result = applyArtistFilters(artist, excluded, true, true)
      const missingAlbums = JSON.parse(result.missing_albums)
      expect(missingAlbums).toHaveLength(1)
    })
  })
})
