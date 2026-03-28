/**
 * MoodSyncPanel
 *
 * Slide-out panel for comparing and syncing mood tags across music sources.
 * Follows WishlistPanel design patterns exactly.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Music, RefreshCw, ArrowRight, CheckCircle2, AlertCircle, Loader2, Circle } from 'lucide-react'

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
  const [syncingTarget, setSyncingTarget] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; currentTrack: string } | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number; errors: string[] } | null>(null)
  const [syncedTrackIds, setSyncedTrackIds] = useState<Set<number>>(new Set())
  const [syncingTrackId, setSyncingTrackId] = useState<number | null>(null)
  const [failedTrackIds, setFailedTrackIds] = useState<Set<number>>(new Set())
  const [showMismatchOnly, setShowMismatchOnly] = useState(true)

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => closeButtonRef.current?.focus(), 100)
      loadSources()
    }
  }, [isOpen])

  useEffect(() => {
    const cleanup = window.electronAPI.onMoodSyncProgress((progress) => {
      setSyncProgress(progress)
      if (progress.trackId) {
        if (progress.status === 'syncing') {
          setSyncingTrackId(progress.trackId)
        } else if (progress.status === 'done') {
          setSyncingTrackId(null)
          setSyncedTrackIds(prev => new Set([...prev, progress.trackId!]))
        } else if (progress.status === 'failed') {
          setSyncingTrackId(null)
          setFailedTrackIds(prev => new Set([...prev, progress.trackId!]))
        }
      }
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
    setSyncedTrackIds(new Set())
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
    setSyncingTarget(targetSourceId)
    setSyncProgress(null)
    setSyncResult(null)
    setFailedTrackIds(new Set())
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
      setSyncingTarget(null)
      setSyncProgress(null)
    }
  }

  const filteredComparisons = showMismatchOnly
    ? comparisons.filter(c => c.targets.some(t => t.hasMismatch))
    : comparisons

  // Build target source summary
  const targetSources = new Map<string, { sourceId: string; sourceName: string; mismatchCount: number; matchedCount: number }>()
  for (const comp of comparisons) {
    for (const target of comp.targets) {
      if (!targetSources.has(target.sourceId)) {
        targetSources.set(target.sourceId, { sourceId: target.sourceId, sourceName: target.sourceName, mismatchCount: 0, matchedCount: 0 })
      }
      const ts = targetSources.get(target.sourceId)!
      ts.matchedCount++
      if (target.hasMismatch) ts.mismatchCount++
    }
  }

  const totalMismatches = Array.from(targetSources.values()).reduce((sum, t) => sum + t.mismatchCount, 0)

  return (
    <div
      ref={panelRef}
      id="mood-sync-panel"
      role="complementary"
      aria-label="Mood Sync"
      className={`fixed top-[88px] bottom-4 right-4 w-80 bg-sidebar-gradient rounded-2xl shadow-xl z-40 flex flex-col overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-[transform,opacity] ${
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
      }`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Mood Sync</h2>
          {totalMismatches > 0 && (
            <span className="text-xs text-muted-foreground">{totalMismatches}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadComparison}
            disabled={loading || !sourceOfTruthId}
            className="p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50 text-muted-foreground hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
            aria-label="Close mood sync panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Source selector */}
      <div className="px-3 pt-3 pb-2 border-b border-border/30">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Source of Truth</label>
        <select
          value={sourceOfTruthId}
          onChange={(e) => setSourceOfTruthId(e.target.value)}
          className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-border/30 text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary"
        >
          <option value="">Select a source...</option>
          {sources.map(s => (
            <option key={s.sourceId} value={s.sourceId}>
              {s.sourceName} — {s.tracksWithMoods} moods
            </option>
          ))}
        </select>
      </div>

      {/* Targets & filter bar */}
      {targetSources.size > 0 && (
        <div className="px-3 pt-2 pb-2 border-b border-border/30 space-y-2">
          {Array.from(targetSources.values()).map(target => (
            <div key={target.sourceId} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                {target.mismatchCount === 0 ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                )}
                <span className="text-xs truncate">{target.sourceName}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {target.mismatchCount === 0 ? 'synced' : `${target.mismatchCount} pending`}
                </span>
              </div>
              <button
                onClick={() => handleSync(target.sourceId)}
                disabled={syncing || target.mismatchCount === 0}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ml-2 focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                {syncingTarget === target.sourceId ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowRight className="w-3 h-3" />
                )}
                Sync
              </button>
            </div>
          ))}

          {/* Filter toggle */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-muted-foreground">
              {filteredComparisons.length} of {comparisons.length} tracks
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-[10px] text-muted-foreground">Mismatches only</span>
              <button
                role="switch"
                aria-checked={showMismatchOnly}
                onClick={() => setShowMismatchOnly(!showMismatchOnly)}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background ${
                  showMismatchOnly ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`inline-block h-3 w-3 rounded-full bg-background shadow-sm ring-1 ring-border/50 transition-transform ${
                  showMismatchOnly ? 'translate-x-3.5' : 'translate-x-0.5'
                }`} />
              </button>
            </label>
          </div>
        </div>
      )}

      {/* Sync progress */}
      {syncProgress && (
        <div className="px-3 py-2 border-b border-border/30 space-y-1">
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

      {/* Sync result */}
      {syncResult && (
        <div className="px-3 py-2 border-b border-border/30">
          <div className="flex items-center gap-1.5 text-xs">
            {syncResult.failed === 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            )}
            <span className="text-muted-foreground">
              {syncResult.synced} synced{syncResult.failed > 0 ? `, ${syncResult.failed} failed` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Track list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredComparisons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <Music className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">
              {sourceOfTruthId
                ? comparisons.length === 0
                  ? 'No matched tracks'
                  : 'All synced'
                : 'No source selected'}
            </p>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              {sourceOfTruthId
                ? comparisons.length === 0
                  ? 'No tracks with moods were found in both sources'
                  : 'All mood tags are in sync across your sources'
                : 'Select a source of truth above to compare mood tags'}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredComparisons.slice(0, 200).map((comp, i) => {
              const hasMismatch = comp.targets.some(t => t.hasMismatch)
              const wasSynced = comp.targets.some(t => syncedTrackIds.has(t.trackId))
              const hasFailed = comp.targets.some(t => failedTrackIds.has(t.trackId))
              const isSyncing = comp.targets.some(t => t.trackId === syncingTrackId)

              return (
                <div
                  key={i}
                  className={`p-2 rounded-lg transition-all duration-300 ${
                    hasFailed ? 'bg-destructive/10' :
                    wasSynced ? 'bg-green-500/10' :
                    isSyncing ? 'bg-primary/10' :
                    'bg-muted/30 hover:bg-muted/50'
                  }`}
                >
                  {/* Track info row */}
                  <div className="flex items-start gap-2">
                    <div className="shrink-0 mt-0.5">
                      {isSyncing ? (
                        <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                      ) : hasFailed ? (
                        <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                      ) : !hasMismatch || wasSynced ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate leading-tight">{comp.trackTitle}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{comp.artist}</p>
                    </div>
                  </div>

                  {/* Moods */}
                  <div className="mt-1.5 ml-5.5 flex flex-wrap gap-1">
                    {comp.sourceOfTruthMoods.map((mood, j) => (
                      <span key={j} className="text-[10px] text-muted-foreground">
                        {j > 0 && <span className="mr-1">/</span>}{mood}
                      </span>
                    ))}
                  </div>

                  {/* Per-target status (only when multiple targets) */}
                  {comp.targets.length > 1 && (
                    <div className="mt-1 ml-5.5 space-y-0.5">
                      {comp.targets.map((target, j) => (
                        <div key={j} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          {target.trackId === syncingTrackId ? (
                            <Loader2 className="w-2.5 h-2.5 text-primary animate-spin shrink-0" />
                          ) : failedTrackIds.has(target.trackId) ? (
                            <AlertCircle className="w-2.5 h-2.5 text-destructive shrink-0" />
                          ) : !target.hasMismatch || syncedTrackIds.has(target.trackId) ? (
                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500 shrink-0" />
                          ) : (
                            <Circle className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
                          )}
                          <span className="truncate">{target.sourceName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {filteredComparisons.length > 200 && (
              <p className="text-[10px] text-muted-foreground text-center py-2">
                Showing 200 of {filteredComparisons.length}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
