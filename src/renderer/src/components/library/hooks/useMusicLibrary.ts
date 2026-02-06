import { useState, useCallback } from 'react'
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicStats,
  MusicCompletenessStats,
  ArtistCompletenessData,
  AlbumCompletenessData,
} from '../types'

type MusicViewMode = 'artists' | 'albums' | 'tracks'

interface UseMusicLibraryOptions {
  activeSourceId: string | null
}

interface UseMusicLibraryReturn {
  // Music data
  musicArtists: MusicArtist[]
  musicAlbums: MusicAlbum[]
  allMusicTracks: MusicTrack[]
  musicStats: MusicStats | null
  // Selection state
  selectedArtist: MusicArtist | null
  setSelectedArtist: (artist: MusicArtist | null) => void
  selectedAlbum: MusicAlbum | null
  setSelectedAlbum: (album: MusicAlbum | null) => void
  albumTracks: MusicTrack[]
  selectedAlbumCompleteness: AlbumCompletenessData | null
  musicViewMode: MusicViewMode
  setMusicViewMode: (mode: MusicViewMode) => void
  // Completeness data
  musicCompletenessStats: MusicCompletenessStats | null
  artistCompleteness: Map<string, ArtistCompletenessData>
  allAlbumCompleteness: Map<number, AlbumCompletenessData>
  // Data loading
  loadMusicData: () => Promise<void>
  loadAlbumTracks: (albumId: number) => Promise<void>
  loadAlbumCompleteness: (albumId: number) => Promise<void>
  loadMusicCompletenessData: () => Promise<void>
  // Analysis actions
  analyzeAlbumCompleteness: (albumId: number) => Promise<void>
  analyzeArtistCompleteness: (artistId: number) => Promise<void>
}

/**
 * Hook to manage music library state and operations
 *
 * Handles loading artists, albums, and tracks, as well as
 * completeness analysis and selection state.
 *
 * @param options Music library configuration
 * @returns Music library state and actions
 */
export function useMusicLibrary({
  activeSourceId,
}: UseMusicLibraryOptions): UseMusicLibraryReturn {
  // Music data state
  const [musicArtists, setMusicArtists] = useState<MusicArtist[]>([])
  const [musicAlbums, setMusicAlbums] = useState<MusicAlbum[]>([])
  const [allMusicTracks, setAllMusicTracks] = useState<MusicTrack[]>([])
  const [musicStats, setMusicStats] = useState<MusicStats | null>(null)

  // Selection state
  const [selectedArtist, setSelectedArtist] = useState<MusicArtist | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<MusicAlbum | null>(null)
  const [albumTracks, setAlbumTracks] = useState<MusicTrack[]>([])
  const [selectedAlbumCompleteness, setSelectedAlbumCompleteness] =
    useState<AlbumCompletenessData | null>(null)
  const [musicViewMode, setMusicViewMode] = useState<MusicViewMode>('artists')

  // Completeness state
  const [musicCompletenessStats, setMusicCompletenessStats] =
    useState<MusicCompletenessStats | null>(null)
  const [artistCompleteness, setArtistCompleteness] = useState<
    Map<string, ArtistCompletenessData>
  >(new Map())
  const [allAlbumCompleteness, setAllAlbumCompleteness] = useState<
    Map<number, AlbumCompletenessData>
  >(new Map())

  // Load music data (non-blocking background load)
  const loadMusicData = useCallback(async () => {
    try {
      const filters = activeSourceId ? { sourceId: activeSourceId } : undefined
      const [artists, albums, tracks, mStats] = await Promise.all([
        window.electronAPI.musicGetArtists(filters),
        window.electronAPI.musicGetAlbums(filters),
        window.electronAPI.musicGetTracks(filters),
        window.electronAPI.musicGetStats(activeSourceId || undefined),
      ])

      setMusicArtists(artists as MusicArtist[])
      setMusicAlbums(albums as MusicAlbum[])
      setAllMusicTracks(tracks as MusicTrack[])
      setMusicStats(mStats as MusicStats)
    } catch (err) {
      console.warn('Failed to load music data:', err)
    }
  }, [activeSourceId])

  // Load tracks for a specific album
  const loadAlbumTracks = useCallback(async (albumId: number) => {
    try {
      const tracks = await window.electronAPI.musicGetTracksByAlbum(albumId)
      setAlbumTracks(tracks as MusicTrack[])
    } catch (err) {
      console.warn('Failed to load album tracks:', err)
      setAlbumTracks([])
    }
  }, [])

  // Load album completeness data
  const loadAlbumCompleteness = useCallback(async (albumId: number) => {
    try {
      const completeness = await window.electronAPI.musicGetAlbumCompleteness(albumId)
      setSelectedAlbumCompleteness(completeness as AlbumCompletenessData | null)
    } catch (err) {
      console.warn('Failed to load album completeness:', err)
      setSelectedAlbumCompleteness(null)
    }
  }, [])

  // Load music completeness data
  const loadMusicCompletenessData = useCallback(async () => {
    try {
      const completenessData =
        (await window.electronAPI.musicGetAllArtistCompleteness()) as ArtistCompletenessData[]

      // Index by artist name
      const completenessMap = new Map<string, ArtistCompletenessData>()
      completenessData.forEach((c) => {
        completenessMap.set(c.artist_name, c)
      })
      setArtistCompleteness(completenessMap)

      // Load album completeness data
      const albumCompletenessData =
        (await window.electronAPI.musicGetAllAlbumCompleteness()) as AlbumCompletenessData[]
      const albumCompletenessMap = new Map<number, AlbumCompletenessData>()
      albumCompletenessData.forEach((c) => {
        albumCompletenessMap.set(c.album_id, c)
      })
      setAllAlbumCompleteness(albumCompletenessMap)

      // Calculate stats
      const totalArtists = musicArtists.length
      const analyzedArtists = completenessData.length
      const completeArtists = completenessData.filter(
        (c) => c.completeness_percentage >= 100
      ).length
      const incompleteArtists = analyzedArtists - completeArtists

      // Count total missing albums
      let totalMissingAlbums = 0
      for (const c of completenessData) {
        try {
          const missingAlbums = JSON.parse(c.missing_albums || '[]')
          totalMissingAlbums += missingAlbums.length
        } catch {
          /* ignore */
        }
      }

      const avgCompleteness =
        analyzedArtists > 0
          ? Math.round(
              completenessData.reduce((sum, c) => sum + c.completeness_percentage, 0) /
                analyzedArtists
            )
          : 0

      setMusicCompletenessStats({
        totalArtists,
        analyzedArtists,
        completeArtists,
        incompleteArtists,
        totalMissingAlbums,
        averageCompleteness: avgCompleteness,
      })
    } catch (err) {
      console.warn('Failed to load music completeness data:', err)
    }
  }, [musicArtists.length])

  // Analyze a single album for missing tracks
  const analyzeAlbumCompleteness = useCallback(
    async (albumId: number) => {
      try {
        console.log(`[useMusicLibrary] Analyzing album ${albumId} for missing tracks...`)
        const result = await window.electronAPI.musicAnalyzeAlbumTrackCompleteness(albumId)
        console.log(`[useMusicLibrary] Analysis result:`, result)

        // Reload selected album completeness if this is the selected album
        await loadAlbumCompleteness(albumId)

        // Also reload the all album completeness map for the grid view badges
        const albumCompletenessData =
          (await window.electronAPI.musicGetAllAlbumCompleteness()) as AlbumCompletenessData[]
        const albumCompletenessMap = new Map<number, AlbumCompletenessData>()
        albumCompletenessData.forEach((c) => {
          albumCompletenessMap.set(c.album_id, c)
        })
        setAllAlbumCompleteness(albumCompletenessMap)
      } catch (err) {
        console.error('Failed to analyze album completeness:', err)
      }
    },
    [loadAlbumCompleteness]
  )

  // Analyze a single artist for missing albums
  const analyzeArtistCompleteness = useCallback(
    async (artistId: number) => {
      try {
        console.log(`[useMusicLibrary] Analyzing artist ${artistId} for missing albums...`)
        const result = await window.electronAPI.musicAnalyzeArtistCompleteness(artistId)
        console.log(`[useMusicLibrary] Artist analysis result:`, result)

        // Reload all artist completeness data to refresh the UI
        await loadMusicCompletenessData()
      } catch (err) {
        console.error('Failed to analyze artist completeness:', err)
      }
    },
    [loadMusicCompletenessData]
  )

  return {
    // Music data
    musicArtists,
    musicAlbums,
    allMusicTracks,
    musicStats,
    // Selection state
    selectedArtist,
    setSelectedArtist,
    selectedAlbum,
    setSelectedAlbum,
    albumTracks,
    selectedAlbumCompleteness,
    musicViewMode,
    setMusicViewMode,
    // Completeness data
    musicCompletenessStats,
    artistCompleteness,
    allAlbumCompleteness,
    // Data loading
    loadMusicData,
    loadAlbumTracks,
    loadAlbumCompleteness,
    loadMusicCompletenessData,
    // Analysis actions
    analyzeAlbumCompleteness,
    analyzeArtistCompleteness,
  }
}
