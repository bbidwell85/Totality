/**
 * MoodSyncPanel
 *
 * Slide-out panel for comparing and syncing mood tags across music sources.
 * Follows the same panel pattern as WishlistPanel.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Music, RefreshCw, ArrowRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

interface MoodSource {
  sourceId: string
  sourceName: string
  sourceType: string
  tracksWithMoods: number
  totalTracks: number
}

interface MoodTarget {
  sourceId: string
  sourceName: string
  sourceType: string
  moods: string[]
  trackId: number
  trackProviderId: string
  hasMismatch: boolean
}

interface MoodComparison {
  trackTitle: string
  artist: string
  album: string
  sourceOfTruthMoods: string[]
  sourceOfTruthTrackId: number
  targets: MoodTarget[]
}

export interface MoodSyncPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function MoodSyncPanel({ isOpen, onClose }: MoodSyncPanelProps) {
  const [sources, setSources] = useState<MoodSource[]>([])
  const [sourceOfTruthId, setSourceOfTruthId] = useState<string>('')
  const [comparisons, setComparisons] = useState<MoodComparison[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; currentTrack: string } | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number; errors: string[] } | null>(null)
  const [showMismatchOnly, setShowMismatchOnly] = useState(true)

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Auto-focus close button when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => closeButtonRef.current?.focus(), 100)
      loadSources()
    }
  }, [isOpen])

  // Listen for sync progress
  useEffect(() => {
    const cleanup = window.electronAPI.onMoodSyncProgress((progress) => {
      setSyncProgress(progress)
    })
    return cleanup
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [onClose])

  const loadSources = async () => {
    try {
      const result = await window.electronAPI.moodGetSources()
      setSources(result)
      if (!sourceOfTruthId) {
        const withMoods = result.find(s => s.tracksWithMoods > 0)
        if (withMoods) setSourceOfTruthId(withMoods.sourceId)
      }
    } catch (error) {
      console.error('Failed to load mood sources:', error)
    }
  }

  const loadComparison = useCallback(async () => {
    if (!sourceOfTruthId) return
    setLoading(true)
    setSyncResult(null)
    try {
      const result = await window.electronAPI.moodGetComparison(sourceOfTruthId)
      setComparisons(result)
    } catch (err) {
      console.error('Failed to load comparison:', err)
    } finally {
      setLoading(false)
    }
  }, [sourceOfTruthId])

  useEffect(() => {
    if (sourceOfTruthId && isOpen) {
      loadComparison()
    }
  }, [sourceOfTruthId, loadComparison, isOpen])

  const handleSync = async (targetSourceId: string) => {
    if (!sourceOfTruthId) return
    setSyncing(true)
    setSyncProgress(null)
    setSyncResult(null)
    try {
      const result = await window.electronAPI.moodSyncToTarget({
        sourceOfTruthId,
        targetSourceId,
      })
      setSyncResult(result)
      await loadComparison()
    } catch (err) {
      setSyncResult({ synced: 0, failed: 0, errors: [(err as Error).message] })
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  const filteredComparisons = showMismatchOnly
    ? comparisons.filter(c => c.targets.some(t => t.hasMismatch))
    : comparisons

  const targetSources = new Map<string, { sourceId: string; sourceName: string; mismatchCount: number }>()
  for (const comp of comparisons) {
    for (const target of comp.targets) {
      if (!targetSources.has(target.sourceId)) {
        targetSources.set(target.sourceId, { sourceId: target.sourceId, sourceName: target.sourceName, mismatchCount: 0 })
      }
      if (target.hasMismatch) {
        targetSources.get(target.sourceId)!.mismatchCount++
      }
    }
  }

  const mismatchTotal = Array.from(targetSources.values()).reduce((sum, t) => sum + t.mismatchCount, 0)

  return (
    <div
      ref={panelRef}
      id="mood-sync-panel"
      className={`fixed top-[88px] bottom-4 right-4 w-96 bg-sidebar-gradient rounded-2xl shadow-xl z-40 flex flex-col overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-[transform,opacity] ${
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
      }`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Mood Sync</h2>
          {mismatchTotal > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-medium">
              {mismatchTotal}
            </span>
          )}
        </div>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
          aria-label="Close mood sync panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Source of Truth */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Source of Truth</label>
          <div className="flex items-center gap-2">
            <select
              value={sourceOfTruthId}
              onChange={(e) => setSourceOfTruthId(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-background border border-border/30 text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a source...</option>
              {sources.map(s => (
                <option key={s.sourceId} value={s.sourceId}>
                  {s.sourceName} ({s.tracksWithMoods}/{s.totalTracks} moods)
                </option>
              ))}
            </select>
            <button
              onClick={loadComparison}
              disabled={loading || !sourceOfTruthId}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-50 text-muted-foreground"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Sync Targets */}
        {targetSources.size > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Targets</label>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              {Array.from(targetSources.values()).map(target => (
                <div key={target.sourceId} className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <span className="text-xs font-medium">{target.sourceName}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">
                      {target.mismatchCount > 0 ? `${target.mismatchCount} mismatches` : 'In sync'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleSync(target.sourceId)}
                    disabled={syncing || target.mismatchCount === 0}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                    Sync
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sync Progress */}
        {syncProgress && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span className="truncate pr-2">{syncProgress.currentTrack}</span>
              <span className="shrink-0">{syncProgress.current}/{syncProgress.total}</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Sync Result */}
        {syncResult && (
          <div className={`p-2.5 rounded-lg text-xs ${
            syncResult.failed === 0
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
          }`}>
            <div className="flex items-center gap-1.5">
              {syncResult.failed === 0 ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              <span>Synced {syncResult.synced} tracks{syncResult.failed > 0 ? `, ${syncResult.failed} failed` : ''}</span>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {filteredComparisons.length} of {comparisons.length} matched tracks
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-[10px] text-muted-foreground">Mismatches only</span>
            <button
              role="switch"
              aria-checked={showMismatchOnly}
              onClick={() => setShowMismatchOnly(!showMismatchOnly)}
              className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background ${
                showMismatchOnly ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3 w-3 rounded-full bg-background shadow-sm ring-1 ring-border/50 transition-transform ${
                showMismatchOnly ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </label>
        </div>

        {/* Comparison List */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredComparisons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Music className="w-6 h-6 mb-2 opacity-50" />
            <p className="text-xs">
              {sourceOfTruthId
                ? comparisons.length === 0
                  ? 'No matched tracks found'
                  : 'All moods are in sync!'
                : 'Select a source of truth'}
            </p>
          </div>
        ) : (
          <div className="bg-background/50 rounded-lg divide-y divide-border/30">
            {filteredComparisons.slice(0, 100).map((comp, i) => (
              <div key={i} className="px-3 py-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{comp.trackTitle}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{comp.artist}</p>
                  </div>
                  {comp.targets.some(t => t.hasMismatch) ? (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] shrink-0 ml-2">Mismatch</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px] shrink-0 ml-2">Synced</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {comp.sourceOfTruthMoods.map((mood, j) => (
                    <span key={j} className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px]">
                      {mood}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {filteredComparisons.length > 100 && (
              <div className="px-3 py-2 text-[10px] text-muted-foreground text-center">
                Showing 100 of {filteredComparisons.length}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
