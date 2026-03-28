/**
 * MoodSyncPanel
 *
 * Slide-out panel for comparing and syncing mood tags across music sources.
 * Features: source comparison, search filter, selective sync, per-track animation.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Music, RefreshCw, ArrowRight, CheckCircle2, AlertCircle, Loader2, Circle, Search } from 'lucide-react'

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
  const [syncField, setSyncField] = useState<'mood' | 'genre'>('mood')
  const [syncMode, setSyncMode] = useState<'overwrite' | 'append'>('overwrite')
  const [showMismatchOnly, setShowMismatchOnly] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<number>>(new Set())
  const [confirmDialog, setConfirmDialog] = useState<{
    targetSourceId: string
    targetName: string
    trackCount: number
    databasePath?: string
    isRunning?: boolean
  } | null>(null)

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => closeButtonRef.current?.focus(), 100)
      loadSources()
    }
  }, [isOpen, syncField])

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
      const result = await window.electronAPI.moodGetSources(syncField)
      setSources(result)
      if (!sourceOfTruthId) {
        const withMoods = result.find(s => s.tracksWithMoods > 0)
        if (withMoods) setSourceOfTruthId(withMoods.sourceId)
      }
    } catch (error) {
      console.error('Failed to load mood sources:', error)
    }
  }

  const loadComparison = useCallback(async (preserveResult = false) => {
    if (!sourceOfTruthId) return
    setLoading(true)
    if (!preserveResult) setSyncResult(null)
    setSyncedTrackIds(new Set())
    setSelectedTrackIds(new Set())
    try {
      const result = await window.electronAPI.moodGetComparison({ sourceOfTruthId, field: syncField })
      setComparisons(result)
    } catch (err) {
      console.error('Failed to load comparison:', err)
    } finally {
      setLoading(false)
    }
  }, [sourceOfTruthId, syncField])

  useEffect(() => {
    if (sourceOfTruthId && isOpen) {
      loadComparison()
    }
  }, [sourceOfTruthId, loadComparison, isOpen])

  const handleSyncClick = async (targetSourceId: string) => {
    if (!sourceOfTruthId) return

    const target = targetSources.get(targetSourceId)
    if (target?.sourceType === 'mediamonkey' || target?.sourceType === 'kodi-local') {
      const check = await window.electronAPI.moodCheckMediaMonkeyWrite(targetSourceId)
      const trackCount = selectedTrackIds.size > 0 ? selectedTrackIds.size : target.mismatchCount
      setConfirmDialog({
        targetSourceId,
        targetName: target.sourceName,
        trackCount,
        databasePath: check.databasePath,
        isRunning: check.isRunning,
      })
      return
    }

    executeSync(targetSourceId)
  }

  const executeSync = async (targetSourceId: string) => {
    if (!sourceOfTruthId) return
    setConfirmDialog(null)
    setSyncing(true)
    setSyncingTarget(targetSourceId)
    setSyncProgress(null)
    setSyncResult(null)
    setFailedTrackIds(new Set())
    try {
      // Pass selected track IDs if user made a selection
      const trackIds = selectedTrackIds.size > 0 ? Array.from(selectedTrackIds) : undefined
      const result = await window.electronAPI.moodSyncToTarget({
        sourceOfTruthId,
        targetSourceId,
        trackIds,
        mode: syncMode,
        field: syncField,
      })
      setSyncResult(result)
      await loadComparison(true)
    } catch (err) {
      setSyncResult({ synced: 0, failed: 0, errors: [(err as Error).message] })
    } finally {
      setSyncing(false)
      setSyncingTarget(null)
      setSyncProgress(null)
    }
  }

  // Filter and search
  const filteredComparisons = useMemo(() => {
    let result = comparisons
    if (showMismatchOnly) {
      result = result.filter(c => c.targets.some(t => t.hasMismatch))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(c =>
        c.trackTitle.toLowerCase().includes(q) ||
        c.artist.toLowerCase().includes(q) ||
        c.album.toLowerCase().includes(q)
      )
    }
    return result
  }, [comparisons, showMismatchOnly, searchQuery])

  // Build target source summary
  const { targetSources, totalMismatches } = useMemo(() => {
    const targets = new Map<string, { sourceId: string; sourceName: string; sourceType: string; mismatchCount: number; matchedCount: number }>()
    for (const comp of comparisons) {
      for (const target of comp.targets) {
        if (!targets.has(target.sourceId)) {
          targets.set(target.sourceId, { sourceId: target.sourceId, sourceName: target.sourceName, sourceType: target.sourceType, mismatchCount: 0, matchedCount: 0 })
        }
        const ts = targets.get(target.sourceId)!
        ts.matchedCount++
        if (target.hasMismatch) ts.mismatchCount++
      }
    }
    const total = Array.from(targets.values()).reduce((sum, t) => sum + t.mismatchCount, 0)
    return { targetSources: targets, totalMismatches: total }
  }, [comparisons])

  const selectedSource = sources.find(s => s.sourceId === sourceOfTruthId)

  // Selection helpers
  const toggleTrackSelection = (trackId: number) => {
    setSelectedTrackIds(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const selectAll = () => {
    const ids = filteredComparisons
      .filter(c => c.targets.some(t => t.hasMismatch))
      .flatMap(c => c.targets.filter(t => t.hasMismatch).map(t => t.trackId))
    setSelectedTrackIds(new Set(ids))
  }

  const selectNone = () => setSelectedTrackIds(new Set())

  return (
    <div
      ref={panelRef}
      id="mood-sync-panel"
      role="complementary"
      aria-label="Mood Sync"
      className={`fixed top-[88px] bottom-4 right-4 w-96 bg-sidebar-gradient rounded-2xl shadow-xl z-40 flex flex-col overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-[transform,opacity] ${
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
      }`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Tag Sync</h2>
          {totalMismatches > 0 && (
            <span className="text-xs text-muted-foreground">{totalMismatches}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadComparison()}
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

      {/* Field selector + Source selector */}
      <div className="px-3 pt-3 pb-2 border-b border-border/30 space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">Field</span>
          {(['mood', 'genre'] as const).map(f => (
            <label key={f} className="flex items-center gap-1.5 cursor-pointer">
              <button
                role="radio"
                aria-checked={syncField === f}
                onClick={() => { setSyncField(f); setComparisons([]); setSourceOfTruthId('') }}
                className={`w-3.5 h-3.5 rounded-full border-2 transition-colors flex items-center justify-center ${
                  syncField === f
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/40'
                }`}
              >
                {syncField === f && <span className="w-1.5 h-1.5 rounded-full bg-background" />}
              </button>
              <span className={`text-xs ${syncField === f ? 'text-foreground' : 'text-muted-foreground'}`}>
                {f === 'mood' ? 'Mood' : 'Genre'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Source selector */}
      <div className="px-3 pt-3 pb-2 border-b border-border/30">
        <label htmlFor="mood-source-select" className="text-xs font-medium text-muted-foreground mb-1.5 block">Source of Truth</label>
        <select
          id="mood-source-select"
          value={sourceOfTruthId}
          onChange={(e) => setSourceOfTruthId(e.target.value)}
          className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-border/30 text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary"
        >
          <option value="">Select a source...</option>
          {sources.map(s => (
            <option key={s.sourceId} value={s.sourceId}>
              {s.sourceName} — {s.tracksWithMoods} {syncField === 'genre' ? 'genres' : 'moods'}
            </option>
          ))}
        </select>
      </div>

      {/* Summary stats */}
      {selectedSource && comparisons.length > 0 && (
        <div className="px-3 py-2 border-b border-border/30 text-[10px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{selectedSource.tracksWithMoods} source {syncField === 'genre' ? 'genres' : 'moods'}</span>
          <span>{comparisons.length} matched</span>
          <span>{totalMismatches} mismatched</span>
          {selectedTrackIds.size > 0 && <span className="text-primary">{selectedTrackIds.size} selected</span>}
        </div>
      )}

      {/* Sync mode */}
      {targetSources.size > 0 && (
        <div className="px-3 pt-2 pb-2 border-b border-border/30">
          <div className="flex gap-1" role="radiogroup" aria-label="Sync mode">
            <button
              role="radio"
              aria-checked={syncMode === 'overwrite'}
              onClick={() => setSyncMode('overwrite')}
              className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-colors ${
                syncMode === 'overwrite'
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted/20 text-muted-foreground hover:bg-muted/30'
              }`}
            >
              Overwrite
            </button>
            <button
              role="radio"
              aria-checked={syncMode === 'append'}
              onClick={() => setSyncMode('append')}
              className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-colors ${
                syncMode === 'append'
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted/20 text-muted-foreground hover:bg-muted/30'
              }`}
            >
              Append
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {syncMode === 'overwrite'
              ? `Replace target ${syncField === 'genre' ? 'genres' : 'moods'} with source values`
              : `Add source values to existing target ${syncField === 'genre' ? 'genres' : 'moods'}`}
          </p>
        </div>
      )}

      {/* Targets */}
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
                onClick={() => handleSyncClick(target.sourceId)}
                disabled={syncing || target.mismatchCount === 0}
                aria-label={`Sync ${syncField === 'genre' ? 'genres' : 'moods'} to ${target.sourceName}`}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ml-2 focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                {syncingTarget === target.sourceId ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowRight className="w-3 h-3" />
                )}
                {selectedTrackIds.size > 0 ? `Sync ${selectedTrackIds.size}` : 'Sync'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter bar */}
      {comparisons.length > 0 && (
        <div className="px-3 pt-2 pb-2 border-b border-border/30 space-y-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search artist, track, album..."
              className="w-full pl-6 pr-2 py-1.5 rounded-lg bg-background border border-border/30 text-foreground text-[10px] focus:outline-hidden focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/50"
            />
          </div>

          {/* Filter + selection controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Select all
              </button>
              <button
                onClick={selectNone}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
              <span className="text-[10px] text-muted-foreground">
                {filteredComparisons.length} tracks
              </span>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-[10px] text-muted-foreground">Mismatches</span>
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
          <div className="h-1 bg-muted rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round((syncProgress.current / syncProgress.total) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Sync progress">
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
                  : searchQuery ? 'No results' : 'All synced'
                : 'No source selected'}
            </p>
            <p className="text-xs text-muted-foreground max-w-[220px]">
              {sourceOfTruthId
                ? comparisons.length === 0
                  ? `No tracks with ${syncField === 'genre' ? 'genres' : 'moods'} were found in both sources`
                  : searchQuery ? `No tracks match "${searchQuery}"` : 'All mood tags are in sync across your sources'
                : 'Select a source of truth above to compare mood tags'}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1" role="list" aria-label="Track comparison list">
            {filteredComparisons.slice(0, 200).map((comp) => {
              const hasMismatch = comp.targets.some(t => t.hasMismatch)
              const wasSynced = comp.targets.some(t => syncedTrackIds.has(t.trackId))
              const hasFailed = comp.targets.some(t => failedTrackIds.has(t.trackId))
              const isSyncing = comp.targets.some(t => t.trackId === syncingTrackId)
              const isSelected = comp.targets.some(t => selectedTrackIds.has(t.trackId))

              return (
                <div
                  key={comp.sourceOfTruthTrackId}
                  role="listitem"
                  className={`p-2 rounded-lg transition-all duration-300 cursor-pointer ${
                    hasFailed ? 'bg-destructive/10' :
                    wasSynced ? 'bg-green-500/10' :
                    isSyncing ? 'bg-primary/10' :
                    isSelected ? 'bg-primary/5' :
                    'bg-muted/30 hover:bg-muted/50'
                  }`}
                  onClick={() => {
                    if (!syncing && hasMismatch) {
                      comp.targets.forEach(t => {
                        if (t.hasMismatch) toggleTrackSelection(t.trackId)
                      })
                    }
                  }}
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
                      ) : isSelected ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate leading-tight">{comp.trackTitle}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{comp.artist}</p>
                    </div>
                  </div>

                  {/* Source moods */}
                  <div className="mt-1.5 ml-5.5">
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5">Source</p>
                    <p className="text-[10px] text-foreground">
                      {comp.sourceOfTruthMoods.join(' / ')}
                    </p>
                  </div>

                  {/* Target moods (per target) */}
                  {comp.targets.map((target, j) => (
                    <div key={j} className="mt-1 ml-5.5">
                      <p className="text-[10px] text-muted-foreground/60 mb-0.5">
                        {target.sourceName}
                        {target.trackId === syncingTrackId && <Loader2 className="w-2 h-2 text-primary animate-spin inline ml-1" />}
                      </p>
                      <p className={`text-[10px] ${target.hasMismatch && !wasSynced ? 'text-muted-foreground/50 italic' : 'text-foreground'}`}>
                        {target.moods.length > 0 ? target.moods.join(' / ') : `No ${syncField === 'genre' ? 'genres' : 'moods'}`}
                      </p>
                    </div>
                  ))}
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

      {/* Confirmation dialog */}
      {confirmDialog && (
        <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center p-4 z-10" role="alertdialog" aria-modal="true" aria-labelledby="mood-confirm-title">
          <div className="bg-card rounded-xl p-4 w-full max-w-[300px] space-y-3 shadow-lg border border-border/30">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              <h3 id="mood-confirm-title" className="text-sm font-semibold">Write to {confirmDialog.targetName}</h3>
            </div>

            {confirmDialog.isRunning ? (
              <div className="space-y-2">
                <p className="text-xs text-destructive">
                  {confirmDialog.targetName} is currently running. Close it before syncing to prevent database corruption.
                </p>
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p>This will modify the {confirmDialog.targetName} database directly:</p>
                  <ul className="space-y-1 ml-3">
                    <li>Update mood tags on {confirmDialog.trackCount} tracks</li>
                    <li>A backup will be created before writing</li>
                    <li>{syncMode === 'overwrite' ? `Existing ${syncField === 'genre' ? 'genres' : 'moods'} will be replaced` : `New values will be added to existing ${syncField === 'genre' ? 'genres' : 'moods'}`}</li>
                  </ul>
                  {confirmDialog.databasePath && (
                    <p className="text-[10px] text-muted-foreground/70 truncate mt-2">
                      {confirmDialog.databasePath}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDialog(null)}
                    className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => executeSync(confirmDialog.targetSourceId)}
                    className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Write {confirmDialog.trackCount} tracks
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
