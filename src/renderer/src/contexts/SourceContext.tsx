/* eslint-disable react-refresh/only-export-components */
/**
 * SourceContext
 *
 * React Context for managing media sources state across the application.
 * Provides access to sources, scanning state, and source operations.
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type {
  MediaSourceResponse,
  MediaLibraryResponse,
  ServerInstanceResponse,
  ScanResultResponse,
  ConnectionTestResult,
} from '../../../preload/index'

// Types for source context
export type ProviderType = 'plex' | 'jellyfin' | 'emby' | 'kodi' | 'kodi-local' | 'local'

export interface ScanProgress {
  sourceId: string
  sourceName?: string
  libraryId?: string
  current: number
  total: number
  phase: 'fetching' | 'processing' | 'analyzing' | 'saving'
  currentItem?: string
  percentage: number
}

export interface SourceStats {
  totalSources: number
  enabledSources: number
  totalItems: number
  bySource: Array<{
    sourceId: string
    displayName: string
    sourceType: string
    itemCount: number
    lastScanAt?: string
  }>
}


// Context type definition
interface SourceContextType {
  // State
  sources: MediaSourceResponse[]
  activeSources: MediaSourceResponse[]
  isLoading: boolean
  error: string | null
  scanProgress: Map<string, ScanProgress>
  isScanning: boolean
  stats: SourceStats | null

  // Library type availability (detected from enabled libraries)
  hasMovies: boolean
  hasTV: boolean
  hasMusic: boolean
  refreshLibraryTypes: () => Promise<void>

  // Connection status (real-time online/offline status per source)
  connectionStatus: Map<string, boolean>

  // Active source selection (for server-based navigation)
  activeSourceId: string | null
  setActiveSource: (sourceId: string | null) => void

  // Source CRUD
  addSource: (config: {
    sourceType: ProviderType
    displayName: string
    connectionConfig: Record<string, unknown>
  }) => Promise<MediaSourceResponse>
  updateSource: (sourceId: string, updates: {
    displayName?: string
    connectionConfig?: Record<string, unknown>
  }) => Promise<void>
  removeSource: (sourceId: string) => Promise<void>
  toggleSource: (sourceId: string, enabled: boolean) => Promise<void>

  // Operations
  refreshSources: () => Promise<void>
  testConnection: (sourceId: string) => Promise<ConnectionTestResult>
  getLibraries: (sourceId: string) => Promise<MediaLibraryResponse[]>

  // Scanning
  scanSource: (sourceId: string, libraryId: string) => Promise<ScanResultResponse>
  scanAllSources: () => Promise<void>
  stopScan: () => Promise<void>

  // Plex-specific
  plexStartAuth: () => Promise<{ pinId: number; code: string; authUrl: string }>
  plexCheckAuth: (pinId: number) => Promise<string | null>
  plexAuthenticateAndDiscover: (token: string, displayName: string) => Promise<{
    source: MediaSourceResponse
    servers: ServerInstanceResponse[]
  }>
  plexSelectServer: (sourceId: string, serverId: string) => Promise<{
    success: boolean
    libraries?: MediaLibraryResponse[]
  }>
  plexGetServers: (sourceId: string) => Promise<ServerInstanceResponse[]>

  // Supported providers
  supportedProviders: ProviderType[]

  // New items tracking (for sidebar badges)
  newItemCounts: Map<string, number>
  markLibraryAsNew: (libraryKey: string, count: number) => void
  clearNewItems: (libraryKey: string) => void
}

// Create context with undefined default
const SourceContext = createContext<SourceContextType | undefined>(undefined)

// Provider component
interface SourceProviderProps {
  children: ReactNode
}

export function SourceProvider({ children }: SourceProviderProps) {
  const [sources, setSources] = useState<MediaSourceResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState<Map<string, ScanProgress>>(new Map())
  const [isScanning, setIsScanning] = useState(false)
  const [stats, setStats] = useState<SourceStats | null>(null)
  const [supportedProviders, setSupportedProviders] = useState<ProviderType[]>(['plex'])
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<Map<string, boolean>>(new Map())
  const [newItemCounts, setNewItemCounts] = useState<Map<string, number>>(new Map())

  // Library type availability
  const [hasMovies, setHasMovies] = useState(false)
  const [hasTV, setHasTV] = useState(false)
  const [hasMusic, setHasMusic] = useState(false)

  // Computed: active (enabled) sources
  const activeSources = sources.filter(s => s.is_enabled)

  // Set active source for server-based navigation
  const setActiveSource = useCallback((sourceId: string | null) => {
    setActiveSourceId(sourceId)
  }, [])

  // Mark library as having new items (for sidebar badge)
  const markLibraryAsNew = useCallback((libraryKey: string, count: number) => {
    if (count > 0) {
      setNewItemCounts(prev => new Map(prev).set(libraryKey, count))
    }
  }, [])

  // Clear new items badge when user views library
  const clearNewItems = useCallback((libraryKey: string) => {
    setNewItemCounts(prev => {
      const next = new Map(prev)
      next.delete(libraryKey)
      return next
    })
  }, [])

  // Check connection status for all enabled sources
  const checkAllConnections = useCallback(async () => {
    const enabledSources = sources.filter(s => s.is_enabled)
    const newStatus = new Map<string, boolean>()

    await Promise.all(
      enabledSources.map(async (source) => {
        try {
          const result = await window.electronAPI.sourcesTestConnection(source.source_id)
          newStatus.set(source.source_id, result.success)
        } catch {
          newStatus.set(source.source_id, false)
        }
      })
    )

    setConnectionStatus(newStatus)
  }, [sources])

  // Load sources on mount
  useEffect(() => {
    refreshSources()
    loadSupportedProviders()
    loadStats()

    // Set up progress listener with optimized state updates
    const handleProgress = (progress: ScanProgress) => {
      setScanProgress(prev => {
        const existing = prev.get(progress.sourceId)
        // Skip update if no meaningful change (avoids Map recreation and re-renders)
        if (existing &&
            Math.floor(existing.percentage || 0) === Math.floor(progress.percentage || 0) &&
            existing.phase === progress.phase) {
          return prev
        }
        const next = new Map(prev)
        next.set(progress.sourceId, progress)
        return next
      })
    }

    window.electronAPI.onSourcesScanProgress(handleProgress as (progress: unknown) => void)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Check connections when sources change and periodically
  useEffect(() => {
    if (sources.length > 0) {
      // Check immediately
      checkAllConnections()

      // Check every 30 seconds
      const interval = setInterval(checkAllConnections, 30000)
      return () => clearInterval(interval)
    }
  }, [sources, checkAllConnections])

  // Auto-select first enabled source when sources load
  useEffect(() => {
    if (activeSourceId === null && sources.length > 0) {
      const firstEnabled = sources.find(s => s.is_enabled)
      if (firstEnabled) {
        setActiveSourceId(firstEnabled.source_id)
      }
    }
  }, [sources, activeSourceId])

  // Load supported providers
  const loadSupportedProviders = async () => {
    try {
      const providers = await window.electronAPI.sourcesGetSupportedProviders()
      setSupportedProviders(providers as ProviderType[])
    } catch (err) {
      console.error('Failed to load supported providers:', err)
    }
  }

  // Load stats
  const loadStats = async () => {
    try {
      const sourceStats = await window.electronAPI.sourcesGetStats()
      setStats(sourceStats)
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }

  // Detect which library types are available from enabled sources
  const detectLibraryTypesFromList = async (sourceList: MediaSourceResponse[]) => {
    let movies = false, tv = false, music = false

    try {
      for (const source of sourceList) {
        if (!source.is_enabled) continue

        const libraries = await window.electronAPI.sourcesGetLibrariesWithStatus(source.source_id)
        for (const lib of libraries) {
          if (lib.isEnabled) {
            if (lib.type === 'movie') movies = true
            if (lib.type === 'show') tv = true
            if (lib.type === 'music') music = true
          }
        }

        // Early exit if we've found all types
        if (movies && tv && music) break
      }
    } catch (err) {
      console.warn('Failed to detect library types:', err)
    }

    setHasMovies(movies)
    setHasTV(tv)
    setHasMusic(music)
  }

  // Public function to refresh library types (e.g., after toggling a library)
  const refreshLibraryTypes = useCallback(async () => {
    await detectLibraryTypesFromList(sources)
  }, [sources])

  // Refresh sources from backend
  const refreshSources = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const sourceList = await window.electronAPI.sourcesList()
      setSources(sourceList)
      await loadStats()
      // Detect library types immediately after loading sources
      await detectLibraryTypesFromList(sourceList)
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load sources')
      console.error('Failed to refresh sources:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Refresh source data when a scan completes (updates last_scan_at)
  useEffect(() => {
    const cleanup = window.electronAPI.onScanCompleted?.(() => {
      refreshSources()
    })
    return () => cleanup?.()
  }, [refreshSources])

  // Add a new source
  const addSource = useCallback(async (config: {
    sourceType: ProviderType
    displayName: string
    connectionConfig: Record<string, unknown>
  }): Promise<MediaSourceResponse> => {
    try {
      const source = await window.electronAPI.sourcesAdd(config)
      await refreshSources()
      return source
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to add source')
      throw err
    }
  }, [refreshSources])

  // Update a source
  const updateSource = useCallback(async (sourceId: string, updates: {
    displayName?: string
    connectionConfig?: Record<string, unknown>
  }) => {
    try {
      await window.electronAPI.sourcesUpdate(sourceId, updates)
      await refreshSources()
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to update source')
      throw err
    }
  }, [refreshSources])

  // Remove a source
  const removeSource = useCallback(async (sourceId: string) => {
    try {
      await window.electronAPI.sourcesRemove(sourceId)
      await refreshSources()
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to remove source')
      throw err
    }
  }, [refreshSources])

  // Toggle source enabled status
  const toggleSource = useCallback(async (sourceId: string, enabled: boolean) => {
    try {
      await window.electronAPI.sourcesToggle(sourceId, enabled)
      await refreshSources()
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to toggle source')
      throw err
    }
  }, [refreshSources])

  // Test connection
  const testConnection = useCallback(async (sourceId: string): Promise<ConnectionTestResult> => {
    try {
      return await window.electronAPI.sourcesTestConnection(sourceId)
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  }, [])

  // Get libraries for a source
  const getLibraries = useCallback(async (sourceId: string): Promise<MediaLibraryResponse[]> => {
    try {
      return await window.electronAPI.sourcesGetLibraries(sourceId)
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to get libraries')
      throw err
    }
  }, [])

  // Scan a single source library
  const scanSource = useCallback(async (
    sourceId: string,
    libraryId: string
  ): Promise<ScanResultResponse> => {
    setIsScanning(true)

    try {
      const result = await window.electronAPI.sourcesScanLibrary(sourceId, libraryId)
      await loadStats()
      return result
    } finally {
      setIsScanning(false)
      // Clear progress for this source
      setScanProgress(prev => {
        const next = new Map(prev)
        next.delete(sourceId)
        return next
      })
    }
  }, [])

  // Scan all enabled sources
  const scanAllSources = useCallback(async () => {
    setIsScanning(true)

    try {
      await window.electronAPI.sourcesScanAll()
      await loadStats()
    } finally {
      setIsScanning(false)
      setScanProgress(new Map())
    }
  }, [])

  // Stop current scan
  const stopScan = useCallback(async () => {
    try {
      await window.electronAPI.sourcesStopScan()
      setIsScanning(false)
      setScanProgress(new Map())
    } catch (err) {
      console.error('Error stopping scan:', err)
    }
  }, [])

  // Plex-specific: Start auth flow
  const plexStartAuth = useCallback(async () => {
    return await window.electronAPI.plexStartAuth()
  }, [])

  // Plex-specific: Check auth PIN
  const plexCheckAuth = useCallback(async (pinId: number) => {
    return await window.electronAPI.plexCheckAuth(pinId)
  }, [])

  // Plex-specific: Authenticate and discover servers
  // Note: We intentionally don't call refreshSources() here because the source
  // is incomplete until a server is selected. Calling refreshSources() would
  // update sources.length and potentially unmount UI components mid-flow.
  // refreshSources() should be called after plexSelectServer completes.
  const plexAuthenticateAndDiscover = useCallback(async (
    token: string,
    displayName: string
  ) => {
    const result = await window.electronAPI.plexAuthenticateAndDiscover(token, displayName)
    return result
  }, [])

  // Plex-specific: Select server
  // NOTE: Don't call refreshSources() here - the flow continues to library selection.
  // Refresh should happen after the full flow completes (library selection saved).
  const plexSelectServer = useCallback(async (sourceId: string, serverId: string) => {
    const result = await window.electronAPI.plexSelectServerForSource(sourceId, serverId)
    return result
  }, [])

  // Plex-specific: Get servers
  const plexGetServers = useCallback(async (sourceId: string) => {
    return await window.electronAPI.plexGetServersForSource(sourceId)
  }, [])

  const value: SourceContextType = {
    sources,
    activeSources,
    isLoading,
    error,
    scanProgress,
    isScanning,
    stats,
    hasMovies,
    hasTV,
    hasMusic,
    refreshLibraryTypes,
    connectionStatus,
    activeSourceId,
    setActiveSource,
    addSource,
    updateSource,
    removeSource,
    toggleSource,
    refreshSources,
    testConnection,
    getLibraries,
    scanSource,
    scanAllSources,
    stopScan,
    plexStartAuth,
    plexCheckAuth,
    plexAuthenticateAndDiscover,
    plexSelectServer,
    plexGetServers,
    supportedProviders,
    newItemCounts,
    markLibraryAsNew,
    clearNewItems,
  }

  return (
    <SourceContext.Provider value={value}>
      {children}
    </SourceContext.Provider>
  )
}

// Custom hook to use source context
export function useSources(): SourceContextType {
  const context = useContext(SourceContext)

  if (context === undefined) {
    throw new Error('useSources must be used within a SourceProvider')
  }

  return context
}

// Helper hook for getting a specific source
export function useSource(sourceId: string) {
  const { sources } = useSources()
  return sources.find(s => s.source_id === sourceId)
}

export default SourceContext
