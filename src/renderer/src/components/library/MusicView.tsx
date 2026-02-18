import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FixedSizeList as VirtualList } from 'react-window'
import { Music, Disc3, User, MoreVertical, RefreshCw, X, Pencil, CircleFadingArrowUp } from 'lucide-react'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import { useMenuClose } from '../../hooks/useMenuClose'
import { providerColors } from './mediaUtils'
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicStats,
  MissingAlbum,
  MissingTrack,
  ArtistCompletenessData,
  AlbumCompletenessData
} from './types'

// ============================================================================
// MUSIC VIEW COMPONENTS
// ============================================================================

export function MusicView({
  artists,
  totalArtistCount,
  artistsLoading,
  onLoadMoreArtists,
  albums,
  tracks,
  allTracks,
  totalTrackCount,
  tracksLoading,
  onLoadMoreTracks,
  totalAlbumCount,
  albumsLoading,
  onLoadMoreAlbums,
  albumSortColumn,
  albumSortDirection,
  onAlbumSortChange,
  stats,
  selectedArtist,
  selectedAlbum,
  artistCompleteness,
  albumCompleteness,
  allAlbumCompleteness,
  musicViewMode,
  trackSortColumn,
  trackSortDirection,
  onTrackSortChange,
  onSelectArtist,
  onSelectAlbum,
  onBack,
  gridScale,
  viewType,
  searchQuery,
  alphabetFilter,
  qualityFilter,
  showSourceBadge,
  onAnalyzeAlbum,
  onAnalyzeArtist,
  onArtistCompletenessUpdated,
  onFixArtistMatch,
  onFixAlbumMatch,
  onRescanTrack,
  includeEps,
  includeSingles
}: {
  artists: MusicArtist[]
  totalArtistCount: number
  artistsLoading: boolean
  onLoadMoreArtists: () => void
  albums: MusicAlbum[]
  tracks: MusicTrack[]
  allTracks: MusicTrack[]
  totalTrackCount: number
  tracksLoading: boolean
  onLoadMoreTracks: () => void
  totalAlbumCount: number
  albumsLoading: boolean
  onLoadMoreAlbums: () => void
  albumSortColumn: 'title' | 'artist'
  albumSortDirection: 'asc' | 'desc'
  onAlbumSortChange: (column: 'title' | 'artist', direction: 'asc' | 'desc') => void
  stats: MusicStats | null
  selectedArtist: MusicArtist | null
  selectedAlbum: MusicAlbum | null
  artistCompleteness: Map<string, ArtistCompletenessData>
  albumCompleteness: AlbumCompletenessData | null
  allAlbumCompleteness: Map<number, AlbumCompletenessData>
  musicViewMode: 'artists' | 'albums' | 'tracks'
  trackSortColumn: 'title' | 'artist' | 'album' | 'codec' | 'duration'
  trackSortDirection: 'asc' | 'desc'
  onTrackSortChange: (column: 'title' | 'artist' | 'album' | 'codec' | 'duration', direction: 'asc' | 'desc') => void
  onSelectArtist: (artist: MusicArtist) => void
  onSelectAlbum: (album: MusicAlbum) => void
  onBack: () => void
  gridScale: number
  viewType: 'grid' | 'list'
  searchQuery: string
  alphabetFilter: string | null
  qualityFilter: 'all' | 'low' | 'medium' | 'high'
  showSourceBadge: boolean
  onAnalyzeAlbum: (albumId: number) => Promise<void>
  onAnalyzeArtist: (artistId: number) => Promise<void>
  onArtistCompletenessUpdated: () => void
  onFixArtistMatch?: (artistId: number, artistName: string) => void
  onFixAlbumMatch?: (albumId: number, albumTitle: string, artistName: string) => void
  onRescanTrack?: (track: MusicTrack) => Promise<void>
  includeEps: boolean
  includeSingles: boolean
}) {
  const [isAnalyzingAlbum, setIsAnalyzingAlbum] = useState(false)
  const [isAnalyzingArtist, setIsAnalyzingArtist] = useState(false)
  const [trackMenuOpen, setTrackMenuOpen] = useState<string | number | null>(null)
  const [rescanningTrackId, setRescanningTrackId] = useState<string | number | null>(null)
  const trackMenuRef = useRef<HTMLDivElement>(null)
  const albumSentinelRef = useRef<HTMLDivElement>(null)
  const artistSentinelRef = useRef<HTMLDivElement>(null)

  // IntersectionObserver for artist grid infinite scroll
  useEffect(() => {
    if (!artistSentinelRef.current || musicViewMode !== 'artists') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMoreArtists()
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(artistSentinelRef.current)
    return () => observer.disconnect()
  }, [onLoadMoreArtists, musicViewMode])

  // IntersectionObserver for album grid infinite scroll
  useEffect(() => {
    if (!albumSentinelRef.current || musicViewMode !== 'albums' || viewType !== 'grid') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMoreAlbums()
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(albumSentinelRef.current)
    return () => observer.disconnect()
  }, [onLoadMoreAlbums, musicViewMode, viewType])

  // Click-outside handler for track menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (trackMenuRef.current && !trackMenuRef.current.contains(event.target as Node)) {
        setTrackMenuOpen(null)
      }
    }
    if (trackMenuOpen !== null) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [trackMenuOpen])

  // Escape key handler for track menu
  useEffect(() => {
    if (trackMenuOpen === null) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTrackMenuOpen(null)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [trackMenuOpen])

  // Handle track rescan
  const handleTrackRescan = async (trackId: string | number, originalTrack: MusicTrack | undefined) => {
    if (!originalTrack || !onRescanTrack) return
    setTrackMenuOpen(null)
    setRescanningTrackId(trackId)
    try {
      await onRescanTrack(originalTrack)
    } finally {
      setRescanningTrackId(null)
    }
  }
  const [selectedTrackForQuality, setSelectedTrackForQuality] = useState<{
    title: string
    codec?: string
    bitrate?: number
    sample_rate?: number
    bit_depth?: number
    is_lossless?: boolean
    qualityTier: string | null
    artist_name?: string
    album_title?: string
  } | null>(null)

  // Track list column state
  const [trackColumnWidths, setTrackColumnWidths] = useState({
    title: 200,
    artist: 160,
    album: 180,
    quality: 60,
    codec: 70,
    duration: 60
  })
  // trackSortColumn and trackSortDirection are now passed as props from parent

  // Album sort state is now passed from parent (for server-side pagination)
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  // Column resize handlers - use refs to avoid re-renders during drag
  const pendingWidthRef = useRef<number>(0)
  const rafIdRef = useRef<number | null>(null)

  const handleResizeStart = (column: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingColumn(column)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = trackColumnWidths[column as keyof typeof trackColumnWidths]
    pendingWidthRef.current = resizeStartWidth.current
  }

  useEffect(() => {
    if (!resizingColumn) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current
      pendingWidthRef.current = Math.max(50, resizeStartWidth.current + delta)

      // Use RAF to batch updates and update only the header visually during drag
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(() => {
        const header = document.querySelector(`[data-resize-column="${resizingColumn}"]`) as HTMLElement
        if (header) header.style.width = `${pendingWidthRef.current}px`
      })
    }

    const handleMouseUp = () => {
      // Only update state once on mouse up
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      setTrackColumnWidths(prev => ({ ...prev, [resizingColumn]: pendingWidthRef.current }))
      setResizingColumn(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [resizingColumn])

  // Column sort handler for tracks (delegates to parent via prop)
  const handleTrackSort = (column: 'title' | 'artist' | 'album' | 'codec' | 'duration') => {
    if (trackSortColumn === column) {
      onTrackSortChange(column, trackSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onTrackSortChange(column, 'asc')
    }
  }

  // Column sort handler for albums (delegates to parent via prop)
  const handleAlbumSort = (column: 'title' | 'artist') => {
    if (albumSortColumn === column) {
      onAlbumSortChange(column, albumSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onAlbumSortChange(column, 'asc')
    }
  }

  // Wrapper to handle analyze with loading state
  const handleAnalyzeAlbum = async (albumId: number) => {
    setIsAnalyzingAlbum(true)
    try {
      await onAnalyzeAlbum(albumId)
    } finally {
      setIsAnalyzingAlbum(false)
    }
  }

  // Wrapper to handle artist analysis with loading state
  const handleAnalyzeArtist = async (artistId: number) => {
    setIsAnalyzingArtist(true)
    try {
      await onAnalyzeArtist(artistId)
      onArtistCompletenessUpdated()
    } finally {
      setIsAnalyzingArtist(false)
    }
  }

  // Map scale to minimum poster width
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120, 2: 140, 3: 160, 4: 180, 5: 200, 6: 240, 7: 300
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Create lookup maps for artist and album names
  const artistNameMap = useMemo(() => {
    const map = new Map<number, string>()
    artists.forEach(a => map.set(a.id, a.name))
    return map
  }, [artists])

  const albumInfoMap = useMemo(() => {
    const map = new Map<number, { title: string; artistName?: string }>()
    albums.forEach(a => map.set(a.id, { title: a.title, artistName: a.artist_name }))
    return map
  }, [albums])

  // Artists are now filtered and sorted server-side via pagination

  // Filter albums for selected artist or all albums
  const filteredAlbums = useMemo(() => {
    let filtered = selectedArtist
      ? albums.filter(a => a.artist_id === selectedArtist.id)
      : albums

    // Apply search filter when not viewing a specific artist
    if (!selectedArtist && searchQuery.trim()) {
      filtered = filtered.filter(album =>
        album.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        album.artist_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Apply alphabet filter when not viewing a specific artist
    if (!selectedArtist && alphabetFilter) {
      filtered = filtered.filter(album => {
        const firstChar = album.title.charAt(0).toUpperCase()
        if (alphabetFilter === '#') {
          return !/[A-Z]/.test(firstChar)
        }
        return firstChar === alphabetFilter
      })
    }

    return filtered.sort((a, b) => (a.year || 0) - (b.year || 0))
  }, [albums, selectedArtist, searchQuery, alphabetFilter])

  // Albums are now filtered/sorted server-side via loadPaginatedAlbums
  const allFilteredAlbums = albums

  // Tracks are now loaded from the server pre-filtered/sorted/paginated.
  // Quality filter is still applied client-side on the loaded page (lightweight).
  const filteredTracks = useMemo(() => {
    if (qualityFilter === 'all') return allTracks

    const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']
    const isLosslessCodec = (codec?: string): boolean => {
      if (!codec) return false
      return LOSSLESS_CODECS.some(c => codec.toLowerCase().includes(c))
    }
    const getTrackQualityTier = (track: MusicTrack): 'ultra' | 'high' | 'medium' | 'low' | null => {
      const bitrateKbps = track.audio_bitrate || 0
      const sampleRate = track.sample_rate || 0
      const bitDepth = track.bit_depth || 16
      const isLossless = track.is_lossless || isLosslessCodec(track.audio_codec)
      if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) return 'ultra'
      if (isLossless) return 'high'
      if (track.audio_codec?.toLowerCase().includes('aac')) {
        if (bitrateKbps >= 128) return 'medium'
      } else {
        if (bitrateKbps >= 160) return 'medium'
      }
      if (bitrateKbps > 0) return 'low'
      if (track.audio_codec) {
        const cl = track.audio_codec.toLowerCase()
        if (cl.includes('mp3') || cl.includes('aac') || cl.includes('ogg')) return 'medium'
      }
      return null
    }
    return allTracks.filter(track => {
      const tier = getTrackQualityTier(track)
      if (qualityFilter === 'high') return tier === 'ultra' || tier === 'high'
      if (qualityFilter === 'medium') return tier === 'medium'
      if (qualityFilter === 'low') return tier === 'low'
      return true
    })
  }, [allTracks, qualityFilter])

  // Album detail view
  if (selectedAlbum) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to {selectedArtist ? selectedArtist.name : 'Albums'}
        </button>

        {/* Album Header */}
        <div className="flex items-start gap-6">
          <div className="w-48 aspect-square bg-muted rounded-lg overflow-hidden flex-shrink-0 shadow-lg">
            {selectedAlbum.thumb_url ? (
              <img
                src={selectedAlbum.thumb_url}
                alt={selectedAlbum.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Disc3 className="w-16 h-16 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{selectedAlbum.title}</h2>
            <p className="text-lg text-muted-foreground">{selectedAlbum.artist_name}</p>
            {selectedAlbum.year && (
              <p className="text-sm text-muted-foreground mt-1">{selectedAlbum.year}</p>
            )}
            {(() => {
              const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
              const codec = (selectedAlbum.best_audio_codec || '').toLowerCase()
              const isLossless = losslessCodecs.some(c => codec.includes(c))
              const isHiRes = isLossless && ((selectedAlbum.best_bit_depth || 0) > 16 || (selectedAlbum.best_sample_rate || 0) > 48000)
              return (
                <div className="flex flex-wrap gap-2 mt-3">
                  {isHiRes && (
                    <span className="px-2 py-1 text-xs font-bold bg-purple-600 text-white rounded">Hi-Res</span>
                  )}
                  {isLossless && !isHiRes && (
                    <span className="px-2 py-1 text-xs font-bold bg-green-600 text-white rounded">Lossless</span>
                  )}
                  {(selectedAlbum.best_bit_depth ?? 0) > 16 && (
                    <span className="px-2 py-1 text-xs font-bold bg-orange-600 text-white rounded">
                      {selectedAlbum.best_bit_depth}-bit
                    </span>
                  )}
                  {selectedAlbum.album_type && selectedAlbum.album_type !== 'album' && (
                    <span className="px-2 py-1 text-xs font-bold bg-gray-600 text-white rounded capitalize">
                      {selectedAlbum.album_type}
                    </span>
                  )}
                </div>
              )
            })()}
            <p className="text-sm text-muted-foreground mt-3">
              {selectedAlbum.track_count}{albumCompleteness ? ` of ${albumCompleteness.total_tracks}` : ''} tracks
              {selectedAlbum.duration_ms && (
                <> • {Math.floor(selectedAlbum.duration_ms / 60000)} min</>
              )}
            </p>
            {/* Analyze button */}
            <button
              onClick={() => selectedAlbum.id && handleAnalyzeAlbum(selectedAlbum.id)}
              disabled={isAnalyzingAlbum}
              className="mt-3 flex items-center gap-2 px-3 py-1.5 text-sm bg-foreground text-background hover:bg-foreground/80 rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isAnalyzingAlbum ? 'animate-spin' : ''}`} />
              {isAnalyzingAlbum ? 'Analyzing...' : 'Analyze for missing tracks'}
            </button>
          </div>
        </div>

        {/* Track List - Combined owned and missing tracks */}
        {(() => {
          // Parse missing tracks from completeness data
          let missingTracks: MissingTrack[] = []
          if (albumCompleteness) {
            try {
              missingTracks = JSON.parse(albumCompleteness.missing_tracks || '[]')
            } catch { /* ignore */ }
          }

          // Create unified track list with type marker
          type UnifiedTrack = {
            id: string | number
            title: string
            track_number?: number
            disc_number?: number
            duration_ms?: number
            codec?: string
            bitrate?: number
            sample_rate?: number
            bit_depth?: number
            is_hi_res?: boolean
            is_lossless?: boolean
            isMissing: boolean
            musicbrainz_id?: string
            // For rescan functionality
            source_id?: string
            library_id?: string
            file_path?: string
            originalTrack?: MusicTrack
          }

          // Quality tier calculation based on audio file specs
          // Tiers: Ultra (Hi-Res) > High (CD Lossless) > Medium (Transparent Lossy) > Low
          type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | null

          // Lossless codecs
          const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']

          const isLosslessCodec = (codec?: string): boolean => {
            if (!codec) return false
            const codecLower = codec.toLowerCase()
            return LOSSLESS_CODECS.some(c => codecLower.includes(c))
          }

          const isAACCodec = (codec?: string): boolean => {
            if (!codec) return false
            return codec.toLowerCase().includes('aac')
          }

          const getQualityTier = (track: UnifiedTrack): QualityTier => {
            if (track.isMissing) return null

            // Plex returns bitrate in kbps already
            const bitrateKbps = track.bitrate || 0
            const sampleRate = track.sample_rate || 0
            const bitDepth = track.bit_depth || 16
            const isLossless = track.is_lossless || isLosslessCodec(track.codec)

            // ULTRA / HI-RES: Lossless with bit depth >= 24-bit OR sample rate > 48kHz
            if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) {
              return 'ultra'
            }

            // HIGH (CD-QUALITY LOSSLESS): Lossless at standard resolution (44.1/48kHz, 16-bit)
            if (isLossless) {
              return 'high'
            }

            // MEDIUM: Lossy with bitrate >= 160 kbps (MP3) OR AAC >= 128 kbps
            if (isAACCodec(track.codec)) {
              // AAC is more efficient - 128+ kbps is considered transparent
              if (bitrateKbps >= 128) return 'medium'
            } else {
              // MP3/other lossy - 160+ kbps for transparent quality
              if (bitrateKbps >= 160) return 'medium'
            }

            // LOW: Lossy with bitrate < 160 kbps (or < 128 for AAC)
            if (bitrateKbps > 0) {
              return 'low'
            }

            // If no bitrate info but we have a codec, try to infer quality
            if (track.codec) {
              // If it's a known lossy codec without bitrate, assume medium quality
              const codecLower = track.codec.toLowerCase()
              if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) {
                return 'medium'
              }
            }

            return null
          }

          const qualityTierConfig: Record<QualityTier & string, { label: string; class: string; title: string }> = {
            'ultra': { label: 'Ultra', class: 'bg-foreground text-background', title: 'Hi-Res lossless: 24-bit or >48kHz sample rate' },
            'high': { label: 'High', class: 'bg-foreground text-background', title: 'CD-quality lossless: FLAC/ALAC/WAV at 16-bit/44.1-48kHz' },
            'medium': { label: 'Medium', class: 'bg-foreground text-background', title: 'Transparent lossy: MP3 >=160kbps or AAC >=128kbps' },
            'low': { label: 'Low', class: 'bg-foreground text-background', title: 'Low bitrate lossy: below transparent threshold' },
          }

          const unifiedTracks: UnifiedTrack[] = [
            // Owned tracks
            ...tracks.map(t => ({
              id: t.id,
              title: t.title,
              track_number: t.track_number,
              disc_number: t.disc_number,
              duration_ms: t.duration,
              codec: t.audio_codec,
              bitrate: t.audio_bitrate,
              sample_rate: t.sample_rate,
              bit_depth: t.bit_depth,
              is_hi_res: t.is_hi_res,
              is_lossless: t.is_lossless,
              isMissing: false,
              // For rescan functionality
              source_id: t.source_id,
              library_id: t.library_id,
              file_path: t.file_path,
              originalTrack: t
            })),
            // Missing tracks
            ...missingTracks.map((t, idx) => ({
              id: t.musicbrainz_id || `missing-${idx}`,
              title: t.title,
              track_number: t.track_number,
              disc_number: t.disc_number,
              duration_ms: t.duration_ms,
              codec: undefined,
              bitrate: undefined,
              is_hi_res: undefined,
              is_lossless: undefined,
              isMissing: true,
              musicbrainz_id: t.musicbrainz_id
            }))
          ]

          // Sort by disc number, then track number
          unifiedTracks.sort((a, b) => {
            const discA = a.disc_number || 1
            const discB = b.disc_number || 1
            if (discA !== discB) return discA - discB
            const trackA = a.track_number || 999
            const trackB = b.track_number || 999
            return trackA - trackB
          })

          return (
            <div className="divide-y divide-border/50">
              {unifiedTracks.map((track) => {
                const qualityTier = getQualityTier(track)
                const tierConfig = qualityTier ? qualityTierConfig[qualityTier] : null

                return (
                  <div
                    key={track.id}
                    className={`flex items-center gap-4 py-3 px-2 transition-colors group ${
                      track.isMissing
                        ? 'opacity-40'
                        : 'hover:bg-muted/30 cursor-pointer'
                    }`}
                    onClick={() => {
                      if (!track.isMissing) {
                        setSelectedTrackForQuality({
                          title: track.title,
                          codec: track.codec,
                          bitrate: track.bitrate,
                          sample_rate: track.sample_rate,
                          bit_depth: track.bit_depth,
                          is_lossless: track.is_lossless,
                          qualityTier: qualityTier,
                          artist_name: selectedAlbum.artist_name,
                          album_title: selectedAlbum.title
                        })
                      }
                    }}
                  >
                    <span className={`w-8 text-sm text-right ${
                      track.isMissing ? 'text-muted-foreground/50' : 'text-muted-foreground'
                    }`}>
                      {track.track_number || '-'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-medium truncate ${
                          track.isMissing ? 'text-muted-foreground' : ''
                        }`}>
                          {track.title}
                        </h4>
                      </div>
                      <div className={`flex items-center gap-3 text-xs mt-0.5 ${
                        track.isMissing ? 'text-muted-foreground/50' : 'text-muted-foreground'
                      }`}>
                        {tierConfig && (
                          <span
                            className={`px-1.5 py-0.5 text-xs font-bold rounded ${tierConfig.class}`}
                            title={tierConfig.title}
                          >
                            {tierConfig.label}
                          </span>
                        )}
                        {track.duration_ms && (
                          <span>{Math.floor(track.duration_ms / 60000)}:{String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}</span>
                        )}
                        {!track.isMissing && track.codec && <span className="uppercase">{track.codec}</span>}
                        {!track.isMissing && !!track.bitrate && <span>{Math.round(track.bitrate)} kbps</span>}
                        {!track.isMissing && !!track.sample_rate && <span>{track.sample_rate >= 1000 ? `${(track.sample_rate / 1000).toFixed(1)}kHz` : `${track.sample_rate}Hz`}</span>}
                        {!track.isMissing && !!track.bit_depth && <span>{track.bit_depth}-bit</span>}
                      </div>
                    </div>
                    {/* 3-dot menu for owned tracks with file_path */}
                    {!track.isMissing && track.file_path && onRescanTrack && (
                      <div className="relative flex-shrink-0" ref={trackMenuOpen === track.id ? trackMenuRef : undefined}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setTrackMenuOpen(trackMenuOpen === track.id ? null : track.id)
                          }}
                          className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {rescanningTrackId === track.id ? (
                            <RefreshCw className="w-3.5 h-3.5 text-white animate-spin" />
                          ) : (
                            <MoreVertical className="w-3.5 h-3.5 text-white" />
                          )}
                        </button>
                        {trackMenuOpen === track.id && rescanningTrackId !== track.id && (
                          <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px] z-50">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleTrackRescan(track.id, track.originalTrack)
                              }}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Rescan File
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Add to wishlist button for missing tracks */}
                    {track.isMissing && (
                      <div className="flex-shrink-0">
                        <AddToWishlistButton
                          mediaType="track"
                          title={track.title}
                          musicbrainzId={track.musicbrainz_id}
                          artistName={selectedAlbum.artist_name}
                          albumTitle={selectedAlbum.title}
                          posterUrl={selectedAlbum.thumb_url || undefined}
                          compact
                        />
                      </div>
                    )}
                  </div>
                )
              })}
              {unifiedTracks.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  No tracks found
                </div>
              )}
            </div>
          )
        })()}

        {/* Track Quality Details Modal */}
        {selectedTrackForQuality && (() => {
          const tier = selectedTrackForQuality.qualityTier
          const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Unknown'
          const tierDescription = tier === 'ultra' ? 'Hi-Res Lossless' :
                                  tier === 'high' ? 'CD-Quality Lossless' :
                                  tier === 'medium' ? 'Transparent Lossy' :
                                  tier === 'low' ? 'Low Bitrate Lossy' : 'Unknown'
          const tierColor = tier === 'ultra' ? 'text-purple-500' :
                           tier === 'high' ? 'text-green-500' :
                           tier === 'medium' ? 'text-blue-500' :
                           tier === 'low' ? 'text-red-500' : 'text-muted-foreground'

          // Calculate a score based on the tier (for visual consistency with video modal)
          const tierScore = tier === 'ultra' ? 100 :
                           tier === 'high' ? 85 :
                           tier === 'medium' ? 60 :
                           tier === 'low' ? 30 : 0

          // Check if bitrate is low (for lossy codecs, below 160kbps for MP3 or 128kbps for AAC)
          const isLossyCodec = !selectedTrackForQuality.is_lossless
          const codec = (selectedTrackForQuality.codec || '').toLowerCase()
          const isAAC = codec.includes('aac')
          const bitrateLow = isLossyCodec && selectedTrackForQuality.bitrate &&
            (isAAC ? selectedTrackForQuality.bitrate < 128 : selectedTrackForQuality.bitrate < 160)

          // Get explanation text for low/medium tiers
          const getIssueText = () => {
            if (tier === 'low') {
              return `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps may have audible artifacts. Consider 256+ kbps for transparent quality, or lossless for archival.`
            }
            if (tier === 'medium') {
              return `Good for everyday listening. Lossless (FLAC) available for critical listening or archival.`
            }
            return null
          }
          const issueText = getIssueText()

          return createPortal(
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-6"
              onClick={() => setSelectedTrackForQuality(null)}
            >
              <div
                className="bg-card rounded-xl w-full max-w-lg overflow-hidden shadow-2xl border border-border"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-4 border-b border-border/30 bg-black/30 rounded-t-xl">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold truncate">{selectedTrackForQuality.title}</h2>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedTrackForQuality.artist_name && selectedTrackForQuality.album_title
                        ? `${selectedTrackForQuality.artist_name} · ${selectedTrackForQuality.album_title}`
                        : 'Track Quality Analysis'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Add to Wishlist Button for low quality tracks */}
                    {(tier === 'low' || tier === 'medium') && selectedTrackForQuality.artist_name && (
                      <AddToWishlistButton
                        mediaType="track"
                        title={selectedTrackForQuality.title}
                        artistName={selectedTrackForQuality.artist_name}
                        albumTitle={selectedTrackForQuality.album_title}
                        posterUrl={selectedAlbum?.thumb_url || undefined}
                        reason="upgrade"
                      />
                    )}
                    <button
                      onClick={() => setSelectedTrackForQuality(null)}
                      className="text-muted-foreground hover:text-foreground p-1"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                  {/* Quality Score Card */}
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{tierLabel}</div>
                          <div className={`text-xs font-medium ${tierColor}`}>{tierDescription}</div>
                        </div>
                        <div className="h-10 w-px bg-border" />
                        <div className="text-center">
                          <div className="text-2xl font-bold">{tierScore}</div>
                          <div className="text-xs text-muted-foreground">Score</div>
                        </div>
                      </div>

                      {/* Premium Badges */}
                      <div className="flex flex-wrap gap-1.5">
                        {!!selectedTrackForQuality.is_lossless && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-500/20 text-green-400">Lossless</span>
                        )}
                        {(selectedTrackForQuality.bit_depth ?? 0) >= 24 && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Hi-Res</span>
                        )}
                      </div>
                    </div>

                    {/* Score Bar */}
                    <div className="mt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-14">Quality</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${tierScore}%` }} />
                        </div>
                        <span className="text-xs w-8 text-right">{tierScore}</span>
                      </div>
                    </div>

                    {/* Issue text - shown inside quality score card */}
                    {issueText && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="text-sm text-muted-foreground">{issueText}</div>
                      </div>
                    )}
                  </div>

                  {/* Technical Specs */}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audio Specs</h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Codec</span>
                        <span className="font-medium uppercase">{selectedTrackForQuality.codec || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bitrate</span>
                        <span className="font-medium flex items-center">
                          {selectedTrackForQuality.bitrate ? `${Math.round(selectedTrackForQuality.bitrate)} kbps` : 'N/A'}
                          {bitrateLow && <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sample Rate</span>
                        <span className="font-medium">{selectedTrackForQuality.sample_rate ? `${(selectedTrackForQuality.sample_rate / 1000).toFixed(1)} kHz` : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bit Depth</span>
                        <span className="font-medium">{selectedTrackForQuality.bit_depth ? `${selectedTrackForQuality.bit_depth}-bit` : 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        })()}
      </div>
    )
  }

  // Artist detail view (showing albums)
  if (selectedArtist) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Artists
        </button>

        {/* Artist Header */}
        <div className="flex items-start gap-6">
          <div className="w-40 h-40 bg-muted rounded-full overflow-hidden flex-shrink-0 shadow-lg">
            {selectedArtist.thumb_url ? (
              <img
                src={selectedArtist.thumb_url}
                alt={selectedArtist.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-16 h-16 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{selectedArtist.name}</h2>
            <p className="text-muted-foreground mt-1">
              {selectedArtist.album_count} albums • {selectedArtist.track_count} tracks
            </p>
            {/* Completeness info */}
            {artistCompleteness.has(selectedArtist.name) && (
              <p className="text-sm text-muted-foreground mt-2">
                {artistCompleteness.get(selectedArtist.name)!.owned_albums} of {artistCompleteness.get(selectedArtist.name)!.total_albums} albums in discography
              </p>
            )}
            {/* Analyze button */}
            <button
              onClick={() => handleAnalyzeArtist(selectedArtist.id)}
              disabled={isAnalyzingArtist}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors mt-3"
            >
              <RefreshCw className={`w-4 h-4 ${isAnalyzingArtist ? 'animate-spin' : ''}`} />
              {isAnalyzingArtist ? 'Analyzing...' : 'Analyze Completeness'}
            </button>
          </div>
        </div>

        {/* Albums Grid/List */}
        <div>
          <h3 className="text-lg font-semibold mb-4">Your Albums</h3>
          {filteredAlbums.length === 0 ? (
            <div className="p-12 text-center">
              <Disc3 className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No albums found</p>
            </div>
          ) : viewType === 'list' ? (
            <div className="space-y-2">
              {filteredAlbums.map(album => (
                <AlbumListItem
                  key={album.id}
                  album={album}
                  onClick={() => onSelectAlbum(album)}
                  showArtist={false}
                  showSourceBadge={showSourceBadge}
                  completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                />
              ))}
            </div>
          ) : (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
            >
              {filteredAlbums.map(album => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onClick={() => onSelectAlbum(album)}
                  showArtist={false}
                  showSourceBadge={showSourceBadge}
                  onAnalyze={onAnalyzeAlbum}
                  onFixMatch={onFixAlbumMatch && album.id ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name || '') : undefined}
                  completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* Missing Albums Section */}
        {artistCompleteness.has(selectedArtist.name) && (() => {
          const completeness = artistCompleteness.get(selectedArtist.name)!
          let missingAlbums: MissingAlbum[] = []
          let missingEps: MissingAlbum[] = []
          let missingSingles: MissingAlbum[] = []
          try {
            missingAlbums = JSON.parse(completeness.missing_albums || '[]')
            missingEps = JSON.parse(completeness.missing_eps || '[]')
            missingSingles = JSON.parse(completeness.missing_singles || '[]')
          } catch { /* ignore */ }

          const allMissing = [
            ...missingAlbums,
            ...(includeEps ? missingEps : []),
            ...(includeSingles ? missingSingles : []),
          ]
          if (allMissing.length === 0) return null

          return (
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4 text-yellow-400">
                Missing ({allMissing.length})
              </h3>
              {viewType === 'list' ? (
                <div className="space-y-2">
                  {allMissing.map((album, idx) => (
                    <MissingAlbumListItem
                      key={album.musicbrainz_id || idx}
                      album={album}
                      artistName={selectedArtist.name}
                    />
                  ))}
                </div>
              ) : (
                <div
                  className="grid gap-6"
                  style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
                >
                  {allMissing.map((album, idx) => (
                    <MissingAlbumCard
                      key={album.musicbrainz_id || idx}
                      album={album}
                      artistName={selectedArtist.name}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    )
  }

  // Main view - check for empty state
  const hasNoMusic = artists.length === 0 && totalArtistCount === 0 && albums.length === 0 && (stats?.totalTracks || 0) === 0
  if (hasNoMusic) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Music className="w-16 h-16 text-muted-foreground mb-4" strokeWidth={1.5} />
        <p className="text-muted-foreground text-lg">No music found</p>
        <p className="text-sm text-muted-foreground mt-2">
          Scan a music library from the sidebar to get started
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Stats Bar */}
      {stats && (
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <span>{stats.totalArtists} Artists</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{stats.totalAlbums} Albums</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{stats.totalTracks} Tracks</span>
          {stats.losslessAlbums > 0 && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="text-green-500">{stats.losslessAlbums} Lossless</span>
            </>
          )}
          {stats.hiResAlbums > 0 && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="text-purple-500">{stats.hiResAlbums} Hi-Res</span>
            </>
          )}
        </div>
      )}

      {/* Artists View Mode */}
      {musicViewMode === 'artists' && artists.length > 0 && (
        <div>
          {viewType === 'list' ? (
            <div className="space-y-2">
              {artists.map(artist => (
                <ArtistListItem
                  key={artist.id}
                  artist={artist}
                  completeness={artistCompleteness.get(artist.name)}
                  onClick={() => onSelectArtist(artist)}
                  showSourceBadge={showSourceBadge}
                  onFixMatch={onFixArtistMatch ? () => onFixArtistMatch(artist.id, artist.name) : undefined}
                  onAnalyzeCompleteness={onAnalyzeArtist}
                />
              ))}
            </div>
          ) : (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
            >
              {artists.map(artist => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  onClick={() => onSelectArtist(artist)}
                  showSourceBadge={showSourceBadge}
                  onFixMatch={onFixArtistMatch ? () => onFixArtistMatch(artist.id, artist.name) : undefined}
                  onAnalyzeCompleteness={onAnalyzeArtist}
                />
              ))}
            </div>
          )}
          {/* Infinite scroll sentinel + loading indicator */}
          <div ref={artistSentinelRef} className="h-1" />
          {artistsLoading && (
            <div className="flex justify-center py-4">
              <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {artists.length < totalArtistCount && !artistsLoading && (
            <div className="text-center py-2 text-xs text-muted-foreground">
              {artists.length.toLocaleString()} of {totalArtistCount.toLocaleString()} artists
            </div>
          )}
        </div>
      )}

      {/* Albums View Mode */}
      {musicViewMode === 'albums' && (
        <div>
          {allFilteredAlbums.length === 0 ? (
            <div className="p-12 text-center">
              <Disc3 className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No albums found</p>
            </div>
          ) : viewType === 'list' ? (
            <div>
              {/* Column Headers */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider select-none">
                {/* Thumbnail placeholder */}
                <div className="w-16" />

                {/* Title column */}
                <div
                  className="flex-1 flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => handleAlbumSort('title')}
                >
                  <span>Album</span>
                  {albumSortColumn === 'title' && (
                    <span className="text-primary">{albumSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>

                {/* Artist column */}
                <div
                  className="w-48 flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => handleAlbumSort('artist')}
                >
                  <span>Artist</span>
                  {albumSortColumn === 'artist' && (
                    <span className="text-primary">{albumSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </div>

              {/* Virtualized Album List */}
              <VirtualList
                height={Math.max(400, window.innerHeight - 280)}
                itemCount={allFilteredAlbums.length}
                itemSize={88}
                width="100%"
                className="scrollbar-visible"
                itemData={{
                  albums: allFilteredAlbums,
                  onSelectAlbum,
                  showSourceBadge,
                  allAlbumCompleteness
                }}
                onItemsRendered={({ visibleStopIndex }) => {
                  if (visibleStopIndex >= allFilteredAlbums.length - 20) {
                    onLoadMoreAlbums()
                  }
                }}
              >
                {({ index, style, data }: { index: number; style: React.CSSProperties; data: {
                  albums: MusicAlbum[];
                  onSelectAlbum: (album: MusicAlbum) => void;
                  showSourceBadge: boolean;
                  allAlbumCompleteness: Map<number, AlbumCompletenessData>;
                }}) => {
                  const album = data.albums[index]
                  return (
                    <div style={style}>
                      <AlbumListItem
                        album={album}
                        onClick={() => data.onSelectAlbum(album)}
                        showArtist={true}
                        showSourceBadge={data.showSourceBadge}
                        completeness={album.id ? data.allAlbumCompleteness.get(album.id) : undefined}
                      />
                    </div>
                  )
                }}
              </VirtualList>
            </div>
          ) : (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)` }}
            >
              {allFilteredAlbums.map(album => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onClick={() => onSelectAlbum(album)}
                  showArtist={true}
                  showSourceBadge={showSourceBadge}
                  onAnalyze={onAnalyzeAlbum}
                  onFixMatch={onFixAlbumMatch && album.id ? () => onFixAlbumMatch(album.id!, album.title, album.artist_name || '') : undefined}
                  completeness={album.id ? allAlbumCompleteness.get(album.id) : undefined}
                />
              ))}
            </div>
          )}
          {/* Sentinel for album grid infinite scroll */}
          <div ref={albumSentinelRef} className="h-1" />
          {/* Album count footer */}
          <div className="px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
            {albumsLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
            <span>
              {allFilteredAlbums.length === totalAlbumCount
                ? `${totalAlbumCount.toLocaleString()} albums`
                : `${allFilteredAlbums.length.toLocaleString()} of ${totalAlbumCount.toLocaleString()} albums`}
            </span>
          </div>
        </div>
      )}

      {/* Tracks View Mode */}
      {musicViewMode === 'tracks' && (
        <div>
          {filteredTracks.length === 0 && !tracksLoading ? (
            <div className="p-12 text-center">
              <Music className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No tracks found</p>
            </div>
          ) : (
            <div>
              {/* Column Headers */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider select-none">
                {/* # column */}
                <div className="w-8 text-center">#</div>

                {/* Title column */}
                <div
                  data-resize-column="title"
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.title, minWidth: 50 }}
                  onClick={() => handleTrackSort('title')}
                >
                  <span>Title</span>
                  {trackSortColumn === 'title' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <div
                    className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded"
                    onMouseDown={(e) => handleResizeStart('title', e)}
                  />
                </div>

                {/* Artist column */}
                <div
                  data-resize-column="artist"
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.artist, minWidth: 50 }}
                  onClick={() => handleTrackSort('artist')}
                >
                  <span>Artist</span>
                  {trackSortColumn === 'artist' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <div
                    className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded"
                    onMouseDown={(e) => handleResizeStart('artist', e)}
                  />
                </div>

                {/* Album column */}
                <div
                  data-resize-column="album"
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.album, minWidth: 50 }}
                  onClick={() => handleTrackSort('album')}
                >
                  <span>Album</span>
                  {trackSortColumn === 'album' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <div
                    className="ml-auto w-1 h-4 cursor-col-resize hover:bg-primary/50 rounded"
                    onMouseDown={(e) => handleResizeStart('album', e)}
                  />
                </div>

                {/* Quality column */}
                <div style={{ width: trackColumnWidths.quality, minWidth: 50 }}>
                  <span>Quality</span>
                </div>

                {/* Codec column */}
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                  style={{ width: trackColumnWidths.codec, minWidth: 50 }}
                  onClick={() => handleTrackSort('codec')}
                >
                  <span>Codec</span>
                  {trackSortColumn === 'codec' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>

                {/* Duration column */}
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors text-right"
                  style={{ width: trackColumnWidths.duration, minWidth: 50 }}
                  onClick={() => handleTrackSort('duration')}
                >
                  <span>Time</span>
                  {trackSortColumn === 'duration' && (
                    <span className="text-primary">{trackSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </div>

              {/* Virtualized Track List */}
              <VirtualList
                height={Math.max(400, window.innerHeight - 280)}
                itemCount={filteredTracks.length}
                itemSize={40}
                width="100%"
                className="scrollbar-visible"
                onItemsRendered={({ visibleStopIndex }: { visibleStopIndex: number }) => {
                  // Load more tracks when scrolling near the end
                  if (visibleStopIndex >= filteredTracks.length - 50) {
                    onLoadMoreTracks()
                  }
                }}
                itemData={{
                  tracks: filteredTracks,
                  artistNameMap,
                  albumInfoMap,
                  columnWidths: trackColumnWidths,
                  setSelectedTrackForQuality
                }}
              >
                {({ index, style, data }: { index: number; style: React.CSSProperties; data: {
                  tracks: MusicTrack[]
                  artistNameMap: Map<number, string>
                  albumInfoMap: Map<number, { title: string; artistName?: string }>
                  columnWidths: typeof trackColumnWidths
                  setSelectedTrackForQuality: typeof setSelectedTrackForQuality
                }}) => {
                  const track = data.tracks[index]
                  const albumInfo = track.album_id ? data.albumInfoMap.get(track.album_id) : undefined
                  const artistName = track.artist_id
                    ? data.artistNameMap.get(track.artist_id)
                    : albumInfo?.artistName
                  return (
                    <div style={style}>
                      <TrackListItem
                        track={track}
                        index={index + 1}
                        artistName={artistName}
                        albumTitle={albumInfo?.title}
                        columnWidths={data.columnWidths}
                        onClickQuality={() => {
                          // Compute quality tier
                          const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']
                          const codecLower = (track.audio_codec || '').toLowerCase()
                          const isLossless = track.is_lossless || LOSSLESS_CODECS.some(c => codecLower.includes(c))
                          const bitrateKbps = track.audio_bitrate || 0
                          const sampleRate = track.sample_rate || 0
                          const bitDepth = track.bit_depth || 16
                          const isAAC = codecLower.includes('aac')

                          let qualityTier: 'ultra' | 'high' | 'medium' | 'low' | null = null
                          if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) qualityTier = 'ultra'
                          else if (isLossless) qualityTier = 'high'
                          else if (isAAC && bitrateKbps >= 128) qualityTier = 'medium'
                          else if (!isAAC && bitrateKbps >= 160) qualityTier = 'medium'
                          else if (bitrateKbps > 0) qualityTier = 'low'
                          else if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) qualityTier = 'medium'

                          data.setSelectedTrackForQuality({
                            title: track.title,
                            codec: track.audio_codec,
                            bitrate: track.audio_bitrate,
                            sample_rate: track.sample_rate,
                            bit_depth: track.bit_depth,
                            is_lossless: track.is_lossless,
                            qualityTier,
                            artist_name: artistName,
                            album_title: albumInfo?.title
                          })
                        }}
                      />
                    </div>
                  )
                }}
              </VirtualList>
              {/* Track count / loading indicator */}
              <div className="px-4 py-1.5 text-xs text-muted-foreground border-t border-border flex items-center gap-2">
                {tracksLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>
                  {filteredTracks.length === totalTrackCount
                    ? `${totalTrackCount.toLocaleString()} tracks`
                    : `${filteredTracks.length.toLocaleString()} of ${totalTrackCount.toLocaleString()} tracks`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state for artists view */}
      {musicViewMode === 'artists' && artists.length === 0 && (
        <div className="p-12 text-center">
          <User className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No artists found</p>
        </div>
      )}

      {/* Track Quality Details Modal */}
      {selectedTrackForQuality && (() => {
        const tier = selectedTrackForQuality.qualityTier
        const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Unknown'
        const tierDescription = tier === 'ultra' ? 'Hi-Res Lossless' :
                                tier === 'high' ? 'CD-Quality Lossless' :
                                tier === 'medium' ? 'Transparent Lossy' :
                                tier === 'low' ? 'Low Bitrate Lossy' : 'Unknown'
        const tierColor = tier === 'ultra' ? 'text-purple-500' :
                         tier === 'high' ? 'text-green-500' :
                         tier === 'medium' ? 'text-blue-500' :
                         tier === 'low' ? 'text-red-500' : 'text-muted-foreground'
        const tierScore = tier === 'ultra' ? 100 :
                         tier === 'high' ? 85 :
                         tier === 'medium' ? 60 :
                         tier === 'low' ? 30 : 0

        // Check if bitrate is low (for lossy codecs, below 160kbps for MP3 or 128kbps for AAC)
        const isLossyCodec = !selectedTrackForQuality.is_lossless
        const codec = (selectedTrackForQuality.codec || '').toLowerCase()
        const isAAC = codec.includes('aac')
        const bitrateLow = isLossyCodec && selectedTrackForQuality.bitrate &&
          (isAAC ? selectedTrackForQuality.bitrate < 128 : selectedTrackForQuality.bitrate < 160)

        // Get explanation text for low/medium tiers
        const getIssueText = () => {
          if (tier === 'low') {
            return `${Math.round(selectedTrackForQuality.bitrate || 0)} kbps may have audible artifacts. Consider 256+ kbps for transparent quality, or lossless for archival.`
          }
          if (tier === 'medium') {
            return `Good for everyday listening. Lossless (FLAC) available for critical listening or archival.`
          }
          return null
        }
        const issueText = getIssueText()

        return createPortal(
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-6"
            onClick={() => setSelectedTrackForQuality(null)}
          >
            <div
              className="bg-card rounded-xl w-full max-w-lg overflow-hidden shadow-2xl border border-border"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 p-4 border-b border-border/30 bg-black/30 rounded-t-xl">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold truncate">{selectedTrackForQuality.title}</h2>
                  <p className="text-sm text-muted-foreground truncate">
                    {selectedTrackForQuality.artist_name && selectedTrackForQuality.album_title
                      ? `${selectedTrackForQuality.artist_name} · ${selectedTrackForQuality.album_title}`
                      : 'Track Quality Analysis'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Add to Wishlist Button for low quality tracks */}
                  {(tier === 'low' || tier === 'medium') && (
                    <AddToWishlistButton
                      mediaType="track"
                      title={selectedTrackForQuality.title}
                      artistName={selectedTrackForQuality.artist_name}
                      albumTitle={selectedTrackForQuality.album_title}
                      reason="upgrade"
                    />
                  )}
                  <button
                    onClick={() => setSelectedTrackForQuality(null)}
                    className="text-muted-foreground hover:text-foreground p-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                {/* Quality Score Card */}
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierLabel}</div>
                        <div className={`text-xs font-medium ${tierColor}`}>{tierDescription}</div>
                      </div>
                      <div className="h-10 w-px bg-border" />
                      <div className="text-center">
                        <div className="text-2xl font-bold">{tierScore}</div>
                        <div className="text-xs text-muted-foreground">Score</div>
                      </div>
                    </div>

                    {/* Premium Badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {!!selectedTrackForQuality.is_lossless && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-500/20 text-green-400">Lossless</span>
                      )}
                      {(selectedTrackForQuality.bit_depth ?? 0) >= 24 && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Hi-Res</span>
                      )}
                    </div>
                  </div>

                  {/* Score Bar */}
                  <div className="mt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-14">Quality</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${tierScore}%` }} />
                      </div>
                      <span className="text-xs w-8 text-right">{tierScore}</span>
                    </div>
                  </div>

                  {/* Issue text - shown inside quality score card */}
                  {issueText && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="text-sm text-muted-foreground">{issueText}</div>
                    </div>
                  )}
                </div>

                {/* Technical Specs */}
                <div className="bg-muted/30 rounded-lg p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audio Specs</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Codec</span>
                      <span className="font-medium uppercase">{selectedTrackForQuality.codec || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bitrate</span>
                      <span className="font-medium flex items-center">
                        {selectedTrackForQuality.bitrate ? `${Math.round(selectedTrackForQuality.bitrate)} kbps` : 'N/A'}
                        {bitrateLow && <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1.5" title="Below quality threshold" />}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sample Rate</span>
                      <span className="font-medium">{selectedTrackForQuality.sample_rate ? `${(selectedTrackForQuality.sample_rate / 1000).toFixed(1)} kHz` : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bit Depth</span>
                      <span className="font-medium">{selectedTrackForQuality.bit_depth ? `${selectedTrackForQuality.bit_depth}-bit` : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}

const ArtistCard = memo(({ artist, onClick, showSourceBadge, onFixMatch, onAnalyzeCompleteness }: {
  artist: MusicArtist
  onClick: () => void
  showSourceBadge: boolean
  onFixMatch?: (artistId: number) => void
  onAnalyzeCompleteness?: (artistId: number) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  // Check if this is a local source that can have match fixed
  const isLocalSource = artist.source_type === 'kodi-local' || artist.source_type === 'local'

  // Show menu if any action is available
  const hasMenuActions = (isLocalSource && onFixMatch) || onAnalyzeCompleteness

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && artist.id) {
      onFixMatch(artist.id)
    }
  }

  const handleAnalyzeCompleteness = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeCompleteness && artist.id) {
      setIsAnalyzing(true)
      try {
        await onAnalyzeCompleteness(artist.id)
      } finally {
        setIsAnalyzing(false)
      }
    }
  }

  return (
    <div
      className="group cursor-pointer hover-scale"
      onClick={onClick}
    >
      <div className="relative">
        {/* 3-dot menu button - positioned outside the circular frame */}
        {hasMenuActions && (
          <div ref={menuRef} className="absolute -top-1 -left-1 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px]">
                {onAnalyzeCompleteness && (
                  <button
                    onClick={handleAnalyzeCompleteness}
                    disabled={isAnalyzing}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Completeness'}
                  </button>
                )}
                {isLocalSource && onFixMatch && (
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
        <div className="aspect-square bg-muted overflow-hidden rounded-full shadow-lg shadow-black/30">
          {showSourceBadge && artist.source_type && (
          <div
            className={`absolute bottom-2 right-2 z-10 ${providerColors[artist.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
          >
            {artist.source_type.charAt(0).toUpperCase()}
          </div>
        )}
        {artist.thumb_url ? (
          <img
            src={artist.thumb_url}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
        </div>
      </div>
      <div className="pt-3 text-center">
        <h4 className="font-medium text-sm truncate">{artist.name}</h4>
        <p className="text-xs text-muted-foreground">
          {artist.album_count} {artist.album_count === 1 ? 'album' : 'albums'}
        </p>
      </div>
    </div>
  )
})

const AlbumCard = memo(({ album, onClick, showArtist = true, showSourceBadge, onAnalyze, onFixMatch, completeness }: {
  album: MusicAlbum
  onClick: () => void
  showArtist?: boolean
  showSourceBadge: boolean
  onAnalyze?: (albumId: number) => void
  onFixMatch?: () => void
  completeness?: AlbumCompletenessData
}) => {
  const hasCompleteness = !!completeness
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (!album.id || !onAnalyze) return

    setIsAnalyzing(true)
    try {
      await onAnalyze(album.id)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    onFixMatch?.()
  }

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(!showMenu)
  }

  return (
    <div
      className="cursor-pointer hover-scale group relative"
      onClick={onClick}
    >
      <div className="aspect-square bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {/* 3-dot menu button - appears on hover */}
        {onAnalyze && (
          <div ref={menuRef} className="absolute top-2 left-2 z-20">
            <button
              onClick={handleMenuClick}
              className={`p-1 rounded-full bg-black/60 text-white transition-opacity ${
                showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              } hover:bg-black/80`}
            >
              {isAnalyzing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <MoreVertical className="w-4 h-4" />
              )}
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px] z-30">
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  {isAnalyzing ? 'Analyzing...' : 'Analyze for missing tracks'}
                </button>
                {onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-4 h-4" />
                    Fix Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quality badges */}
        {(() => {
          const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
          const codec = (album.best_audio_codec || '').toLowerCase()
          const isLossless = losslessCodecs.some(c => codec.includes(c))
          const isHiRes = isLossless && ((album.best_bit_depth || 0) > 16 || (album.best_sample_rate || 0) > 48000)
          if (!isLossless && !isHiRes) return null
          return (
            <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end">
              {isHiRes && (
                <span className="px-1.5 py-0.5 text-xs font-bold bg-purple-600 text-white rounded shadow">Hi-Res</span>
              )}
              {isLossless && !isHiRes && (
                <span className="px-1.5 py-0.5 text-xs font-bold bg-green-600 text-white rounded shadow">Lossless</span>
              )}
            </div>
          )
        })()}

        {showSourceBadge && album.source_type && (
          <div
            className={`absolute bottom-2 left-2 z-10 ${providerColors[album.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
          >
            {album.source_type.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Completeness badge - bottom right */}
        {hasCompleteness && (
          <div className="absolute bottom-2 right-2 z-10">
            <div className="bg-foreground text-background text-xs font-bold px-1.5 py-0.5 rounded shadow-md">
              {completeness!.owned_tracks}/{completeness!.total_tracks}
            </div>
          </div>
        )}

        {album.thumb_url ? (
          <img
            src={album.thumb_url}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="pt-2">
        <h4 className="font-medium text-sm truncate">{album.title}</h4>
        {showArtist && (
          <p className="text-xs text-muted-foreground truncate">{album.artist_name}</p>
        )}
        {album.year && (
          <p className="text-xs text-muted-foreground">{album.year}</p>
        )}
      </div>
    </div>
  )
})

// List item component for artists
const ArtistListItem = memo(({ artist, completeness, onClick, showSourceBadge, onFixMatch, onAnalyzeCompleteness }: {
  artist: MusicArtist
  completeness?: ArtistCompletenessData
  onClick: () => void
  showSourceBadge: boolean
  onFixMatch?: (artistId: number) => void
  onAnalyzeCompleteness?: (artistId: number) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  // Check if this is a local source that can have match fixed
  const isLocalSource = artist.source_type === 'kodi-local' || artist.source_type === 'local'

  // Show menu if any action is available
  const hasMenuActions = (isLocalSource && onFixMatch) || onAnalyzeCompleteness

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && artist.id) {
      onFixMatch(artist.id)
    }
  }

  const handleAnalyzeCompleteness = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeCompleteness && artist.id) {
      setIsAnalyzing(true)
      try {
        await onAnalyzeCompleteness(artist.id)
      } finally {
        setIsAnalyzing(false)
      }
    }
  }

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center"
      onClick={onClick}
    >
      {/* Artist Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-full overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {artist.thumb_url ? (
          <img
            src={artist.thumb_url}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* 3-dot menu button */}
        {hasMenuActions && (
          <div ref={menuRef} className="absolute top-0 left-0 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="w-3 h-3" />
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-7 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px]">
                {onAnalyzeCompleteness && (
                  <button
                    onClick={handleAnalyzeCompleteness}
                    disabled={isAnalyzing}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Completeness'}
                  </button>
                )}
                {isLocalSource && onFixMatch && (
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
        {/* Source badge */}
        {showSourceBadge && artist.source_type && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[artist.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1 py-0.5 rounded`}
          >
            {artist.source_type.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{artist.name}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {artist.album_count} {artist.album_count === 1 ? 'album' : 'albums'} • {artist.track_count} tracks
        </p>
        {completeness && (
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
              {completeness.owned_albums}/{completeness.total_albums}
            </span>
          </div>
        )}
      </div>
    </div>
  )
})

// List item component for albums
const AlbumListItem = memo(({ album, onClick, showArtist = true, showSourceBadge, completeness }: {
  album: MusicAlbum
  onClick: () => void
  showArtist?: boolean
  showSourceBadge: boolean
  completeness?: AlbumCompletenessData
}) => {
  const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
  const codec = (album.best_audio_codec || '').toLowerCase()
  const isLossless = losslessCodecs.some(c => codec.includes(c))
  const isHiRes = isLossless && ((album.best_bit_depth || 0) > 16 || (album.best_sample_rate || 0) > 48000)

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center"
      onClick={onClick}
    >
      {/* Album Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0 relative shadow-md shadow-black/20">
        {album.thumb_url ? (
          <img
            src={album.thumb_url}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* Source badge */}
        {showSourceBadge && album.source_type && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[album.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1 py-0.5 rounded`}
          >
            {album.source_type.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{album.title}</h4>
        {showArtist && (
          <p className="text-xs text-muted-foreground truncate">{album.artist_name}</p>
        )}
        {album.year && (
          <p className="text-xs text-muted-foreground">{album.year}</p>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {isHiRes && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">Hi-Res</span>
          )}
          {isLossless && !isHiRes && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">Lossless</span>
          )}
          {completeness && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
              {completeness.owned_tracks}/{completeness.total_tracks}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})

// List item component for tracks in tracks view
const TrackListItem = memo(({ track, index, artistName, albumTitle, columnWidths, onClickQuality }: {
  track: MusicTrack
  index: number
  artistName?: string
  albumTitle?: string
  columnWidths?: { title: number; artist: number; album: number; quality: number; codec: number; duration: number }
  onClickQuality: () => void
}) => {
  // Quality tier calculation
  const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']

  const isLosslessCodec = (codec?: string): boolean => {
    if (!codec) return false
    const codecLower = codec.toLowerCase()
    return LOSSLESS_CODECS.some(c => codecLower.includes(c))
  }

  const isAACCodec = (codec?: string): boolean => {
    if (!codec) return false
    return codec.toLowerCase().includes('aac')
  }

  const getQualityTier = (): 'ultra' | 'high' | 'medium' | 'low' | null => {
    const bitrateKbps = track.audio_bitrate || 0
    const sampleRate = track.sample_rate || 0
    const bitDepth = track.bit_depth || 16
    const isLossless = track.is_lossless || isLosslessCodec(track.audio_codec)

    if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) return 'ultra'
    if (isLossless) return 'high'
    if (isAACCodec(track.audio_codec)) {
      if (bitrateKbps >= 128) return 'medium'
    } else {
      if (bitrateKbps >= 160) return 'medium'
    }
    if (bitrateKbps > 0) return 'low'
    if (track.audio_codec) {
      const codecLower = track.audio_codec.toLowerCase()
      if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) {
        return 'medium'
      }
    }
    return null
  }

  const qualityTier = getQualityTier()
  const qualityTierConfig: Record<string, { label: string; color: string }> = {
    ultra: { label: 'Ultra', color: 'bg-foreground text-background' },
    high: { label: 'High', color: 'bg-foreground text-background' },
    medium: { label: 'Mid', color: 'bg-foreground text-background' },
    low: { label: 'Low', color: 'bg-foreground text-background' }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '--:--'
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const widths = columnWidths || { title: 200, artist: 160, album: 180, quality: 60, codec: 70, duration: 60 }

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden hover:bg-muted/40 transition-all duration-200 px-4 py-2 flex gap-4 items-center"
      onClick={onClickQuality}
    >
      {/* Track Number */}
      <div className="w-8 text-center text-sm text-muted-foreground">
        {index}
      </div>

      {/* Track Title */}
      <div className="min-w-0 truncate" style={{ width: widths.title }}>
        <h4 className="font-medium text-sm truncate">{track.title}</h4>
      </div>

      {/* Artist */}
      <div className="min-w-0 truncate" style={{ width: widths.artist }}>
        <span className="text-sm text-muted-foreground truncate block">{artistName || '—'}</span>
      </div>

      {/* Album */}
      <div className="min-w-0 truncate" style={{ width: widths.album }}>
        <span className="text-sm text-muted-foreground truncate block">{albumTitle || '—'}</span>
      </div>

      {/* Quality Badge */}
      <div className="flex items-center gap-2" style={{ width: widths.quality }}>
        {qualityTier && (
          <span className={`px-2 py-0.5 text-xs font-bold rounded ${qualityTierConfig[qualityTier].color}`}>
            {qualityTierConfig[qualityTier].label}
          </span>
        )}
        {qualityTier === 'low' && (
          <span title="Quality upgrade recommended">
            <CircleFadingArrowUp className="w-4 h-4 text-red-500" />
          </span>
        )}
      </div>

      {/* Codec */}
      <div className="text-xs text-muted-foreground" style={{ width: widths.codec }}>
        {track.audio_codec?.toUpperCase() || '—'}
      </div>

      {/* Duration */}
      <div className="text-xs text-muted-foreground text-right" style={{ width: widths.duration }}>
        {formatDuration(track.duration)}
      </div>

      {/* Add to Wishlist - for low quality tracks that need upgrade */}
      <div className="w-8 flex justify-center" onClick={(e) => e.stopPropagation()}>
        {qualityTier === 'low' && (
          <AddToWishlistButton
            mediaType="track"
            title={track.title}
            artistName={artistName}
            albumTitle={albumTitle}
            reason="upgrade"
            compact
          />
        )}
      </div>
    </div>
  )
})

const MissingAlbumCard = memo(({ album, artistName }: {
  album: MissingAlbum
  artistName: string
}) => {
  const [imageError, setImageError] = useState(false)

  // Cover Art Archive URL for release group
  const coverUrl = album.musicbrainz_id
    ? `https://coverartarchive.org/release-group/${album.musicbrainz_id}/front-250`
    : null

  return (
    <div className="hover-scale opacity-60 hover:opacity-80 group">
      <div className="aspect-square bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 grayscale">
        {/* Album type badge */}
        {album.album_type !== 'album' && (
          <div className="absolute top-2 right-2 z-10">
            <span className="px-1.5 py-0.5 text-xs font-bold bg-gray-600 text-white rounded shadow capitalize">
              {album.album_type}
            </span>
          </div>
        )}

        {coverUrl && !imageError ? (
          <img
            src={coverUrl}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/80">
            <Disc3 className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="pt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm truncate text-muted-foreground">{album.title}</h4>
          {album.year && (
            <p className="text-xs text-muted-foreground/70">{album.year}</p>
          )}
        </div>
        {/* Wishlist button */}
        <div className="flex-shrink-0 [&_button]:!text-white [&_button]:hover:!text-white/80">
          <AddToWishlistButton
            mediaType="album"
            title={album.title}
            year={album.year}
            musicbrainzId={album.musicbrainz_id}
            artistName={artistName}
            posterUrl={coverUrl || undefined}
            compact
          />
        </div>
      </div>
    </div>
  )
})

// List item component for missing albums
const MissingAlbumListItem = memo(({ album, artistName }: {
  album: MissingAlbum
  artistName: string
}) => {
  const [imageError, setImageError] = useState(false)

  // Cover Art Archive URL for release group
  const coverUrl = album.musicbrainz_id
    ? `https://coverartarchive.org/release-group/${album.musicbrainz_id}/front-250`
    : null

  return (
    <div className="rounded-md overflow-hidden bg-muted/20 p-4 flex gap-4 items-center opacity-60 hover:opacity-80 transition-opacity">
      {/* Album Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0 relative grayscale shadow-md shadow-black/20">
        {coverUrl && !imageError ? (
          <img
            src={coverUrl}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate text-muted-foreground">{album.title}</h4>
        {album.year && (
          <p className="text-xs text-muted-foreground/70">{album.year}</p>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 text-xs font-medium bg-yellow-600 text-white rounded">Missing</span>
          {album.album_type !== 'album' && (
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-600 text-white rounded capitalize">
              {album.album_type}
            </span>
          )}
        </div>
      </div>

      {/* Wishlist button */}
      <div className="flex-shrink-0">
        <AddToWishlistButton
          mediaType="album"
          title={album.title}
          year={album.year}
          musicbrainzId={album.musicbrainz_id}
          artistName={artistName}
          posterUrl={coverUrl || undefined}
          compact
        />
      </div>
    </div>
  )
})
