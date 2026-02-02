// TMDB API v3 Response Type Definitions
// API Documentation: https://developer.themoviedb.org/reference/intro/getting-started

export interface TMDBMovieDetails {
  id: number
  title: string
  original_title: string
  release_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  runtime: number | null
  status: string
  tagline: string | null
  belongs_to_collection: TMDBCollectionBrief | null
  genres: Array<{
    id: number
    name: string
  }>
}

export interface TMDBCollectionBrief {
  id: number
  name: string
  poster_path: string | null
  backdrop_path: string | null
}

export interface TMDBCollection {
  id: number
  name: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  parts: TMDBCollectionPart[]
}

export interface TMDBCollectionPart {
  id: number
  title: string
  original_title: string
  release_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
}

export interface TMDBTVShowDetails {
  id: number
  name: string
  original_name: string
  overview: string
  first_air_date: string
  last_air_date: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  status: string // "Returning Series", "Planned", "In Production", "Ended", "Canceled", "Pilot"
  type: string // "Scripted", "Reality", "Documentary", etc.
  number_of_seasons: number
  number_of_episodes: number
  seasons: TMDBSeasonBrief[]
  genres: Array<{
    id: number
    name: string
  }>
  networks: Array<{
    id: number
    name: string
    logo_path: string | null
    origin_country: string
  }>
}

export interface TMDBSeasonBrief {
  id: number
  season_number: number
  name: string
  overview: string
  air_date: string | null
  episode_count: number
  poster_path: string | null
}

export interface TMDBSeasonDetails {
  id: number
  season_number: number
  name: string
  overview: string
  air_date: string | null
  poster_path: string | null
  episodes: TMDBEpisode[]
}

export interface TMDBEpisode {
  id: number
  episode_number: number
  name: string
  overview: string
  air_date: string | null
  runtime: number | null
  still_path: string | null
  vote_average: number
  vote_count: number
  season_number: number
}

// Search result types
export interface TMDBMovieSearchResult {
  id: number
  title: string
  original_title: string
  release_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  popularity: number
}

export interface TMDBTVSearchResult {
  id: number
  name: string
  original_name: string
  first_air_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  popularity: number
}

export interface TMDBSearchResponse<T> {
  page: number
  results: T[]
  total_pages: number
  total_results: number
}

// Error response
export interface TMDBErrorResponse {
  success: false
  status_code: number
  status_message: string
}

// Configuration
export interface TMDBConfiguration {
  images: {
    base_url: string
    secure_base_url: string
    backdrop_sizes: string[]
    logo_sizes: string[]
    poster_sizes: string[]
    profile_sizes: string[]
    still_sizes: string[]
  }
  change_keys: string[]
}
