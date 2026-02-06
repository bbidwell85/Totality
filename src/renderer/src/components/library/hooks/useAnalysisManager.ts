import { useState, useCallback } from 'react'
import type { AnalysisProgress, MediaSource } from '../types'

type AnalysisType = 'series' | 'collections' | 'music'

interface UseAnalysisManagerOptions {
  sources: MediaSource[]
  activeSourceId: string | null
  loadCompletenessData: () => Promise<void>
}

interface UseAnalysisManagerReturn {
  isAnalyzing: boolean
  setIsAnalyzing: (analyzing: boolean) => void
  analysisProgress: AnalysisProgress | null
  setAnalysisProgress: (progress: AnalysisProgress | null) => void
  analysisType: AnalysisType | null
  setAnalysisType: (type: AnalysisType | null) => void
  tmdbApiKeySet: boolean
  setTmdbApiKeySet: (set: boolean) => void
  handleAnalyzeSeries: () => Promise<void>
  handleAnalyzeCollections: () => Promise<void>
  handleAnalyzeMusic: () => Promise<void>
  handleAnalyzeSingleSeries: (seriesTitle: string) => Promise<void>
  handleCancelAnalysis: () => Promise<void>
  checkTmdbApiKey: () => Promise<void>
}

/**
 * Hook to manage completeness analysis tasks
 *
 * Handles running series, collection, and music completeness analysis
 * via the task queue, with progress tracking and cancellation support.
 *
 * @param options Sources and data reload callbacks
 * @returns Analysis state and action handlers
 */
export function useAnalysisManager({
  sources,
  activeSourceId,
  loadCompletenessData,
}: UseAnalysisManagerOptions): UseAnalysisManagerReturn {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analysisType, setAnalysisType] = useState<AnalysisType | null>(null)
  const [tmdbApiKeySet, setTmdbApiKeySet] = useState(false)

  // Get source name for task labels
  const getSourceName = useCallback(() => {
    if (!activeSourceId) return 'All Sources'
    const source = sources.find((s) => s.source_id === activeSourceId)
    return source?.display_name || 'All Sources'
  }, [sources, activeSourceId])

  // Check if TMDB API key is configured
  const checkTmdbApiKey = useCallback(async () => {
    try {
      const key = await window.electronAPI.getSetting('tmdb_api_key')
      setTmdbApiKeySet(!!key && key.length > 0)
    } catch (err) {
      console.warn('Failed to check TMDB API key:', err)
    }
  }, [])

  // Run series analysis via task queue
  const handleAnalyzeSeries = useCallback(async () => {
    try {
      const sourceName = getSourceName()
      await window.electronAPI.taskQueueAddTask({
        type: 'series-completeness',
        label: `Analyze TV Series (${sourceName})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue series analysis:', err)
    }
  }, [activeSourceId, getSourceName])

  // Run collections analysis via task queue
  const handleAnalyzeCollections = useCallback(async () => {
    try {
      const sourceName = getSourceName()
      await window.electronAPI.taskQueueAddTask({
        type: 'collection-completeness',
        label: `Analyze Collections (${sourceName})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue collections analysis:', err)
    }
  }, [activeSourceId, getSourceName])

  // Run unified music analysis via task queue
  const handleAnalyzeMusic = useCallback(async () => {
    try {
      const sourceName = getSourceName()
      await window.electronAPI.taskQueueAddTask({
        type: 'music-completeness',
        label: `Analyze Music (${sourceName})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue music analysis:', err)
    }
  }, [activeSourceId, getSourceName])

  // Analyze a single series for completeness
  const handleAnalyzeSingleSeries = useCallback(
    async (seriesTitle: string) => {
      try {
        console.log(`[useAnalysisManager] Analyzing series: ${seriesTitle}`)
        await window.electronAPI.seriesAnalyze(seriesTitle)
        // Reload completeness data after analysis
        await loadCompletenessData()
      } catch (err) {
        console.error('Single series analysis failed:', err)
      }
    },
    [loadCompletenessData]
  )

  // Cancel current analysis
  const handleCancelAnalysis = useCallback(async () => {
    try {
      // Cancel the current task in the queue
      await window.electronAPI.taskQueueCancelCurrent()
    } catch (err) {
      console.error('Failed to cancel analysis:', err)
    }
  }, [])

  return {
    isAnalyzing,
    setIsAnalyzing,
    analysisProgress,
    setAnalysisProgress,
    analysisType,
    setAnalysisType,
    tmdbApiKeySet,
    setTmdbApiKeySet,
    handleAnalyzeSeries,
    handleAnalyzeCollections,
    handleAnalyzeMusic,
    handleAnalyzeSingleSeries,
    handleCancelAnalysis,
    checkTmdbApiKey,
  }
}
