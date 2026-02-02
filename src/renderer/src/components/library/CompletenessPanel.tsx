import { useState, useEffect, useRef, useCallback } from 'react'
import { X, RefreshCw, Tv, Film, Music, Square, Settings, Clock, Loader2 } from 'lucide-react'

type CompletenessTaskType = 'series-completeness' | 'collection-completeness' | 'music-completeness'

interface SeriesStats {
  totalSeries: number
  completeSeries: number
  incompleteSeries: number
  totalMissingEpisodes: number
  averageCompleteness: number
}

interface CollectionStats {
  total: number
  complete: number
  incomplete: number
  totalMissing: number
  avgCompleteness: number
}

interface MusicStats {
  totalArtists: number
  analyzedArtists: number
  completeArtists: number
  incompleteArtists: number
  totalMissingAlbums: number
  averageCompleteness: number
}

interface AnalysisProgress {
  current: number
  total: number
  currentItem: string
  phase: string
  // Enhanced fields for music analysis
  artistsTotal?: number
  albumsTotal?: number
  phaseIndex?: number
  skipped?: number  // Number of items skipped (already recently analyzed)
}

interface CompletenessPanelProps {
  isOpen: boolean
  onClose: () => void
  seriesStats: SeriesStats | null
  collectionStats: CollectionStats | null
  musicStats: MusicStats | null
  onAnalyzeSeries: () => Promise<void>
  onAnalyzeCollections: () => Promise<void>
  onAnalyzeMusic: () => Promise<void>
  onCancel: (type: 'series' | 'collections' | 'music') => Promise<void>
  isAnalyzing: boolean
  analysisProgress: AnalysisProgress | null
  analysisType: 'series' | 'collections' | 'music' | null
  onDataRefresh: () => void
  hasTV: boolean
  hasMovies: boolean
  hasMusic: boolean
  onOpenSettings?: (initialTab?: string) => void
}

export function CompletenessPanel({
  isOpen,
  onClose,
  seriesStats,
  collectionStats,
  musicStats,
  onAnalyzeSeries,
  onAnalyzeCollections,
  onAnalyzeMusic,
  onCancel,
  isAnalyzing,
  analysisProgress,
  analysisType,
  onDataRefresh,
  hasTV,
  hasMovies,
  hasMusic,
  onOpenSettings
}: CompletenessPanelProps) {
  const [isKeyConfigured, setIsKeyConfigured] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [queueState, setQueueState] = useState<any>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Helper to check if a task type is queued or running
  const getTaskStatus = useCallback((taskType: CompletenessTaskType): 'queued' | 'running' | null => {
    if (!queueState) return null

    // Check if currently running
    if (queueState.currentTask?.type === taskType && queueState.currentTask.status === 'running') {
      return 'running'
    }

    // Check if queued
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isQueued = queueState.queue?.some((task: any) => task.type === taskType)
    if (isQueued) return 'queued'

    return null
  }, [queueState])

  // Load queue state and subscribe to updates
  useEffect(() => {
    const loadQueueState = async () => {
      try {
        const state = await window.electronAPI.taskQueueGetState()
        setQueueState(state)
      } catch (err) {
        console.error('Failed to load queue state:', err)
      }
    }

    loadQueueState()

    // Subscribe to queue updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleanup = window.electronAPI.onTaskQueueUpdated?.((state: any) => {
      setQueueState(state)
    })

    return () => cleanup?.()
  }, [])

  // Auto-focus close button when panel opens
  useEffect(() => {
    if (isOpen) {
      loadApiKey()
      // Focus the close button after a small delay to ensure panel is rendered
      setTimeout(() => {
        closeButtonRef.current?.focus()
      }, 100)
    }
  }, [isOpen])

  // Listen for settings changes (e.g., API key saved in Settings modal)
  useEffect(() => {
    const cleanup = window.electronAPI.onSettingsChanged?.((data) => {
      if (data.key === 'tmdb_api_key') {
        setIsKeyConfigured(data.hasValue)
      }
    })
    return () => cleanup?.()
  }, [])

  // Handle Escape key to close panel
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [onClose])

  const loadApiKey = async () => {
    try {
      const key = await window.electronAPI.getSetting('tmdb_api_key')
      setIsKeyConfigured(!!key)
    } catch (err) {
      console.error('Error loading API key:', err)
    }
  }

  const handleAnalyzeSeries = async () => {
    await onAnalyzeSeries()
    onDataRefresh()
  }

  const handleAnalyzeCollections = async () => {
    await onAnalyzeCollections()
    onDataRefresh()
  }

  const handleAnalyzeMusic = async () => {
    await onAnalyzeMusic()
    onDataRefresh()
  }

  // Get phase-specific label and description for each analysis type
  const getAnalysisInfo = () => {
    if (!analysisProgress) {
      return {
        label: analysisType === 'series' ? 'Analyzing TV Shows...' :
               analysisType === 'collections' ? 'Analyzing Collections...' :
               'Analyzing Music...',
        description: ''
      }
    }

    if (analysisType === 'series') {
      return {
        label: 'Analyzing TV Shows',
        description: 'Fetching episode data from TMDB to identify missing episodes in your library.'
      }
    }

    if (analysisType === 'collections') {
      if (analysisProgress.phase === 'lookup') {
        return {
          label: 'Looking up movie metadata',
          description: 'Finding TMDB IDs for movies without metadata.'
        }
      }
      if (analysisProgress.phase === 'scanning') {
        return {
          label: 'Scanning movie library',
          description: 'Identifying movies that belong to collections.'
        }
      }
      if (analysisProgress.phase === 'fetching') {
        return {
          label: 'Fetching collection data',
          description: 'Retrieving collection information from TMDB.'
        }
      }
      return {
        label: 'Analyzing Collections',
        description: 'Finding missing movies in your collections.'
      }
    }

    if (analysisType === 'music') {
      const { artistsTotal, albumsTotal, phaseIndex, currentItem, skipped } = analysisProgress
      const skippedText = skipped && skipped > 0 ? ` (${skipped} skipped - recently analyzed)` : ''

      if (analysisProgress.phase === 'artists') {
        const artistCount = artistsTotal ? `(${phaseIndex || 0} of ${artistsTotal})` : ''
        return {
          label: `Analyzing artist discographies ${artistCount}`,
          description: currentItem
            ? `Searching MusicBrainz for "${currentItem}" and checking for missing albums, EPs, and singles.`
            : 'Searching MusicBrainz for artist discographies...'
        }
      }
      if (analysisProgress.phase === 'albums') {
        const albumCount = albumsTotal ? `(${phaseIndex || 0} of ${albumsTotal})` : ''
        return {
          label: `Analyzing album tracks ${albumCount}`,
          description: currentItem
            ? `Checking track list for "${currentItem}" against MusicBrainz.`
            : 'Checking for missing tracks on each album...'
        }
      }
      if (analysisProgress.phase === 'complete') {
        const analyzed = (artistsTotal || 0) + (albumsTotal || 0) - (skipped || 0)
        return {
          label: 'Analysis Complete',
          description: `Analyzed ${analyzed} items.${skippedText}`
        }
      }
      return {
        label: 'Analyzing Music',
        description: 'Checking completeness against MusicBrainz database.'
      }
    }

    return { label: 'Analyzing...', description: '' }
  }

  return (
    <aside
      ref={panelRef}
      id="completeness-panel"
      className={`fixed top-[88px] bottom-4 right-4 w-80 bg-card rounded-2xl shadow-xl z-40 flex flex-col overflow-hidden transition-all duration-300 ease-out ${
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
      }`}
      onKeyDown={handleKeyDown}
      role="complementary"
      aria-label="Collection completeness analysis"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" id="completeness-panel-title">
          Completeness
        </h2>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Close completeness panel"
        >
          <X className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* TMDB API Key Required - show when not configured (unless user only has music) */}
        {!isKeyConfigured && !(hasMusic && !hasTV && !hasMovies) && (
          <div className="bg-muted/30 rounded-lg p-4">
            <h3 className="font-medium text-foreground mb-2">TMDB API Key Required</h3>
            <p className="text-xs text-muted-foreground mb-3">
              To analyze TV/movie completeness, you need to configure a TMDB API key in Settings.
            </p>
            <button
              onClick={() => onOpenSettings?.('services')}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
            >
              <Settings className="w-4 h-4" />
              Open Settings
            </button>
          </div>
        )}

        {/* No libraries message - show when no libraries and API key is configured */}
        {!hasTV && !hasMovies && !hasMusic && isKeyConfigured && (
          <div className="text-sm text-muted-foreground text-center py-8">
            No libraries available for completeness analysis.
          </div>
        )}

        {/* Analysis Progress - show for any analysis (music doesn't need TMDB key) */}
        {isAnalyzing && analysisProgress && (
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            {/* Header with label and count */}
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-foreground">
                  {getAnalysisInfo().label}
                </h4>
                {getAnalysisInfo().description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {getAnalysisInfo().description}
                  </p>
                )}
              </div>
              {analysisProgress.total > 0 && analysisType !== 'music' && (
                <span className="text-sm font-medium text-muted-foreground ml-2 whitespace-nowrap">
                  {analysisProgress.current} / {analysisProgress.total}
                </span>
              )}
            </div>

            {/* Progress bar */}
            {analysisProgress.total > 0 && (
              <div className="space-y-1">
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min((analysisProgress.current / analysisProgress.total) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{Math.round((analysisProgress.current / analysisProgress.total) * 100)}%</span>
                </div>
              </div>
            )}

            {/* Current item - hide for music since it's in the description */}
            {analysisProgress.currentItem && analysisType !== 'music' && (
              <div className="pt-1 border-t border-border/30">
                <p className="text-xs text-muted-foreground">
                  <span className="text-muted-foreground/70">Current: </span>
                  <span className="font-medium text-foreground truncate block">{analysisProgress.currentItem}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* TV Series Section - only show when API key is configured */}
        {isKeyConfigured && hasTV && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Tv className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">TV Series</h3>
            </div>

            {seriesStats ? (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium">{seriesStats.totalSeries}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Complete</span>
                  <span className="font-medium text-green-500">{seriesStats.completeSeries}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Incomplete</span>
                  <span className="font-medium text-yellow-500">{seriesStats.incompleteSeries}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Missing</span>
                  <span className="font-medium text-orange-500">{seriesStats.totalMissingEpisodes}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No series data yet</p>
            )}

            {(() => {
              const taskStatus = getTaskStatus('series-completeness')
              if (isAnalyzing && analysisType === 'series') {
                return (
                  <button
                    onClick={() => onCancel('series')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 text-sm"
                  >
                    <Square className="w-4 h-4" />
                    Stop Analysis
                  </button>
                )
              }
              if (taskStatus === 'running') {
                return (
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/70 text-primary-foreground rounded-md text-sm cursor-not-allowed"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </button>
                )
              }
              if (taskStatus === 'queued') {
                return (
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm cursor-not-allowed"
                  >
                    <Clock className="w-4 h-4" />
                    Queued
                  </button>
                )
              }
              return (
                <button
                  onClick={handleAnalyzeSeries}
                  disabled={!isKeyConfigured}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Analyze Series
                </button>
              )
            })()}
          </div>
        )}

        {/* Movie Collections Section - only show when API key is configured */}
        {isKeyConfigured && hasMovies && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">Movie Collections</h3>
            </div>

            {collectionStats ? (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium">{collectionStats.total}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Complete</span>
                  <span className="font-medium text-green-500">{collectionStats.complete}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Incomplete</span>
                  <span className="font-medium text-yellow-500">{collectionStats.incomplete}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Missing</span>
                  <span className="font-medium text-orange-500">{collectionStats.totalMissing}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No collection data yet</p>
            )}

            {(() => {
              const taskStatus = getTaskStatus('collection-completeness')
              if (isAnalyzing && analysisType === 'collections') {
                return (
                  <button
                    onClick={() => onCancel('collections')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 text-sm"
                  >
                    <Square className="w-4 h-4" />
                    Stop Analysis
                  </button>
                )
              }
              if (taskStatus === 'running') {
                return (
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/70 text-primary-foreground rounded-md text-sm cursor-not-allowed"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </button>
                )
              }
              if (taskStatus === 'queued') {
                return (
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm cursor-not-allowed"
                  >
                    <Clock className="w-4 h-4" />
                    Queued
                  </button>
                )
              }
              return (
                <button
                  onClick={handleAnalyzeCollections}
                  disabled={!isKeyConfigured}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Analyze Collections
                </button>
              )
            })()}
          </div>
        )}

        {/* Music Section - uses MusicBrainz, doesn't need TMDB API key */}
        {hasMusic && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Music className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">Music</h3>
            </div>

            {musicStats ? (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium">{musicStats.totalArtists}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Complete</span>
                  <span className="font-medium text-green-500">{musicStats.completeArtists}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Incomplete</span>
                  <span className="font-medium text-yellow-500">{musicStats.incompleteArtists}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Missing</span>
                  <span className="font-medium text-orange-500">{musicStats.totalMissingAlbums}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No music data yet</p>
            )}

            {(() => {
              const taskStatus = getTaskStatus('music-completeness')
              if (isAnalyzing && analysisType === 'music') {
                return (
                  <button
                    onClick={() => onCancel('music')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 text-sm"
                  >
                    <Square className="w-4 h-4" />
                    Stop Analysis
                  </button>
                )
              }
              if (taskStatus === 'running') {
                return (
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/70 text-primary-foreground rounded-md text-sm cursor-not-allowed"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </button>
                )
              }
              if (taskStatus === 'queued') {
                return (
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm cursor-not-allowed"
                  >
                    <Clock className="w-4 h-4" />
                    Queued
                  </button>
                )
              }
              return (
                <button
                  onClick={handleAnalyzeMusic}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Analyze Music
                </button>
              )
            })()}

            <p className="text-xs text-muted-foreground">
              Analyzes artist discographies and album track completeness using the public MusicBrainz API.
              May take time due to rate limits.
            </p>
          </div>
        )}

        {/* Info Note - show when any section is visible */}
        {(hasMusic || (isKeyConfigured && (hasTV || hasMovies))) && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
            <p>
              Completeness analysis uses TMDB for TV/movies and MusicBrainz for music to find missing content.
              Run analysis after adding new content to your library.
            </p>
          </div>
        )}
      </div>

    </aside>
  )
}
