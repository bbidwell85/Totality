import { useEffect, useRef, useCallback } from 'react'
import type { AnalysisProgress } from '../types'

interface UseLibraryEventListenersOptions {
  activeSourceId: string | null
  scanProgressSize: number
  loadMedia: () => Promise<void>
  loadStats: (sourceId?: string) => Promise<void>
  loadCompletenessData: () => Promise<void>
  loadMusicData: () => Promise<void>
  loadMusicCompletenessData: () => Promise<void>
  loadActiveSourceLibraries: () => Promise<void>
  setIsAnalyzing: (analyzing: boolean) => void
  setAnalysisType: (type: 'series' | 'collections' | 'music' | null) => void
  setAnalysisProgress: (progress: AnalysisProgress | null) => void
  setTmdbApiKeySet: (set: boolean) => void
  setIsAutoRefreshing: (refreshing: boolean) => void
  setActiveSource: (sourceId: string) => void
  markLibraryAsNew: (key: string, count: number) => void
  addToast: (toast: {
    type: 'success' | 'error' | 'info'
    title: string
    message: string
    action?: { label: string; onClick: () => void }
  }) => void
}

/**
 * Hook to manage library IPC event listeners
 *
 * Sets up all the event listeners for library updates, analysis progress,
 * auto-refresh, task queue updates, and scan completion notifications.
 *
 * @param options Event listener callbacks
 */
export function useLibraryEventListeners({
  activeSourceId,
  scanProgressSize,
  loadMedia,
  loadStats,
  loadCompletenessData,
  loadMusicData,
  loadMusicCompletenessData,
  loadActiveSourceLibraries,
  setIsAnalyzing,
  setAnalysisType,
  setAnalysisProgress,
  setTmdbApiKeySet,
  setIsAutoRefreshing,
  setActiveSource,
  markLibraryAsNew,
  addToast,
}: UseLibraryEventListenersOptions): void {
  // Debounced library update handler for live refresh during scans/analysis
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null)

  const handleLibraryUpdate = useCallback(
    (data: { type: 'media' | 'music' | 'libraryToggle'; sourceId?: string }) => {
      // Skip expensive DB queries during active scans - will reload when scan completes via flush()
      const hasActiveScan = scanProgressSize > 0
      if (hasActiveScan && data.type !== 'libraryToggle') {
        return
      }

      // Debounce updates to avoid excessive refreshes
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current)
      }
      pendingUpdateRef.current = setTimeout(() => {
        if (data.type === 'libraryToggle') {
          // Refresh enabled libraries when a library is toggled
          // Only refresh if it's the active source or no sourceId specified
          if (!data.sourceId || data.sourceId === activeSourceId) {
            loadActiveSourceLibraries()
          }
        } else if (data.type === 'media') {
          loadMedia()
          loadStats(activeSourceId || undefined)
          loadCompletenessData()
        } else if (data.type === 'music') {
          loadMusicData()
          loadMusicCompletenessData()
        }
        pendingUpdateRef.current = null
      }, 500) // 500ms debounce for live updates
    },
    [
      activeSourceId,
      loadActiveSourceLibraries,
      scanProgressSize,
      loadMedia,
      loadStats,
      loadCompletenessData,
      loadMusicData,
      loadMusicCompletenessData,
    ]
  )

  useEffect(() => {
    // Listen for completeness analysis progress
    const cleanupSeriesProgress = window.electronAPI.onSeriesProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
    })
    const cleanupCollectionsProgress = window.electronAPI.onCollectionsProgress(
      (prog: unknown) => {
        setAnalysisProgress(prog as AnalysisProgress)
      }
    )
    const cleanupMusicAnalysisProgress = window.electronAPI.onMusicAnalysisProgress(
      (prog: unknown) => {
        setAnalysisProgress(prog as AnalysisProgress)
      }
    )

    // Listen for library updates (live refresh during scans/analysis)
    const cleanupLibraryUpdated = window.electronAPI.onLibraryUpdated(handleLibraryUpdate)

    // Listen for auto-refresh events (incremental scan on app start)
    const cleanupAutoRefreshStarted = window.electronAPI.onAutoRefreshStarted(() => {
      setIsAutoRefreshing(true)
    })
    const cleanupAutoRefreshComplete = window.electronAPI.onAutoRefreshComplete(() => {
      setIsAutoRefreshing(false)
    })

    // Listen for task queue task completion (refreshes data after queued scans complete)
    const cleanupTaskComplete = window.electronAPI.onTaskQueueTaskComplete?.((task: unknown) => {
      const t = task as { type: string; status: string }
      // Refresh data when a scan task completes successfully
      if (t.status === 'completed') {
        if (t.type === 'library-scan' || t.type === 'music-scan') {
          handleLibraryUpdate({ type: t.type === 'music-scan' ? 'music' : 'media' })
        }
        // Refresh completeness data after completeness tasks
        if (t.type === 'series-completeness' || t.type === 'collection-completeness') {
          loadCompletenessData()
        }
        if (t.type === 'music-completeness') {
          loadMusicCompletenessData()
        }
      }
    })

    // Listen for task queue state updates to sync analyzing state
    const cleanupTaskQueueUpdated = window.electronAPI.onTaskQueueUpdated?.((state: unknown) => {
      const s = state as { currentTask: { type: string; progress?: AnalysisProgress } | null }
      if (s.currentTask) {
        const taskType = s.currentTask.type
        if (taskType === 'series-completeness') {
          setIsAnalyzing(true)
          setAnalysisType('series')
          if (s.currentTask.progress) {
            setAnalysisProgress(s.currentTask.progress)
          }
        } else if (taskType === 'collection-completeness') {
          setIsAnalyzing(true)
          setAnalysisType('collections')
          if (s.currentTask.progress) {
            setAnalysisProgress(s.currentTask.progress)
          }
        } else if (taskType === 'music-completeness') {
          setIsAnalyzing(true)
          setAnalysisType('music')
          if (s.currentTask.progress) {
            setAnalysisProgress(s.currentTask.progress)
          }
        } else {
          // Non-completeness task running, reset completeness analyzing state
          setIsAnalyzing(false)
          setAnalysisType(null)
        }
      } else {
        // No task running
        setIsAnalyzing(false)
        setAnalysisType(null)
        setAnalysisProgress(null)
      }
    })

    // Listen for settings changes (e.g., API key added/removed in Settings)
    const cleanupSettingsChanged = window.electronAPI.onSettingsChanged?.((data) => {
      if (data.key === 'tmdb_api_key') {
        setTmdbApiKeySet(data.hasValue)
      }
    })

    // Listen for wishlist auto-completion
    const cleanupWishlistAutoCompleted = window.electronAPI.onWishlistAutoCompleted?.((items) => {
      if (items.length === 1) {
        addToast({
          type: 'success',
          title: 'Wishlist item completed',
          message: `"${items[0].title}" has been fulfilled`,
        })
      } else if (items.length > 1) {
        addToast({
          type: 'success',
          title: `${items.length} wishlist items completed`,
          message: items.map((i) => i.title).join(', '),
        })
      }
    })

    // Listen for scan completion to show toast notification
    const cleanupScanCompleted = window.electronAPI.onScanCompleted?.((data) => {
      // Show toast notification
      const itemsChanged = data.itemsAdded + data.itemsUpdated
      const message =
        itemsChanged > 0
          ? `Added ${data.itemsAdded}, updated ${data.itemsUpdated}`
          : `${data.itemsScanned} items scanned, no changes`

      addToast({
        type: 'success',
        title: `${data.libraryName} complete`,
        message,
        action: data.sourceId
          ? {
              label: 'View Library',
              onClick: () => {
                if (data.sourceId) {
                  setActiveSource(data.sourceId)
                }
              },
            }
          : undefined,
      })

      // Mark library as having new items (for sidebar badge)
      if (data.sourceId && data.libraryId && data.itemsAdded > 0) {
        markLibraryAsNew(`${data.sourceId}:${data.libraryId}`, data.itemsAdded)
      }

      // Auto-navigate on first scan to help new users
      if (data.isFirstScan && data.sourceId) {
        setActiveSource(data.sourceId)
      }
    })

    // Cleanup all listeners on unmount
    return () => {
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current)
      }
      cleanupSeriesProgress?.()
      cleanupCollectionsProgress?.()
      cleanupMusicAnalysisProgress?.()
      cleanupLibraryUpdated?.()
      cleanupAutoRefreshStarted?.()
      cleanupAutoRefreshComplete?.()
      cleanupTaskComplete?.()
      cleanupTaskQueueUpdated?.()
      cleanupSettingsChanged?.()
      cleanupWishlistAutoCompleted?.()
      cleanupScanCompleted?.()
    }
  }, [
    handleLibraryUpdate,
    addToast,
    setActiveSource,
    markLibraryAsNew,
    setIsAnalyzing,
    setAnalysisType,
    setAnalysisProgress,
    setTmdbApiKeySet,
    setIsAutoRefreshing,
    loadCompletenessData,
    loadMusicCompletenessData,
  ])
}
