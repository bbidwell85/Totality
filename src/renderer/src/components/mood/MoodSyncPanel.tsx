/**
 * MoodSyncPanel
 *
 * Settings tab for comparing and syncing mood tags across music sources.
 * Follows the same design patterns as other Settings tabs (GeneralTab, ServicesTab, etc.)
 */

import { useState, useEffect, useCallback } from 'react'
import { Music, RefreshCw, ArrowRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

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

export function MoodSyncPanel() {
  const [sources, setSources] = useState<MoodSource[]>([])
  const [sourceOfTruthId, setSourceOfTruthId] = useState<string>('')
  const [comparisons, setComparisons] = useState<MoodComparison[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; currentTrack: string } | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number; errors: string[] } | null>(null)
  const [showMismatchOnly, setShowMismatchOnly] = useState(true)

  useEffect(() => {
    loadSources()
  }, [])

  useEffect(() => {
    const cleanup = window.electronAPI.onMoodSyncProgress((progress) => {
      setSyncProgress(progress)
    })
    return cleanup
  }, [])

  const loadSources = async () => {
    try {
      const result = await window.electronAPI.moodGetSources()
      setSources(result)
      const withMoods = result.find(s => s.tracksWithMoods > 0)
      if (withMoods && !sourceOfTruthId) {
        setSourceOfTruthId(withMoods.sourceId)
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
    if (sourceOfTruthId) {
      loadComparison()
    }
  }, [sourceOfTruthId, loadComparison])

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

  const targetSources = new Map<string, { sourceId: string; sourceName: string; sourceType: string; mismatchCount: number }>()
  for (const comp of comparisons) {
    for (const target of comp.targets) {
      if (!targetSources.has(target.sourceId)) {
        targetSources.set(target.sourceId, {
          sourceId: target.sourceId,
          sourceName: target.sourceName,
          sourceType: target.sourceType,
          mismatchCount: 0,
        })
      }
      if (target.hasMismatch) {
        targetSources.get(target.sourceId)!.mismatchCount++
      }
    }
  }

  const selectedSource = sources.find(s => s.sourceId === sourceOfTruthId)

  return (
    <div className="space-y-5">
      {/* Source of Truth Section */}
      <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
        <div className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Music className="w-5 h-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">Source of Truth</p>
              <p className="text-xs text-muted-foreground">Select which source has the authoritative mood tags</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <select
                value={sourceOfTruthId}
                onChange={(e) => setSourceOfTruthId(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg bg-background border border-border/30 text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <option value="">Select a source...</option>
                {sources.map(s => (
                  <option key={s.sourceId} value={s.sourceId}>
                    {s.sourceName} ({s.tracksWithMoods} tracks with moods / {s.totalTracks} total)
                  </option>
                ))}
              </select>
              <button
                onClick={loadComparison}
                disabled={loading || !sourceOfTruthId}
                className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50 text-muted-foreground"
                title="Refresh comparison"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {selectedSource && (
              <p className="text-xs text-muted-foreground">
                {selectedSource.tracksWithMoods} of {selectedSource.totalTracks} tracks have mood tags
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Sync Targets Section */}
      {targetSources.size > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
          <div className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <ArrowRight className="w-5 h-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Sync Targets</p>
                <p className="text-xs text-muted-foreground">Push mood tags from source of truth to these sources</p>
              </div>
            </div>

            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              {Array.from(targetSources.values()).map(target => (
                <div
                  key={target.sourceId}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <span className="text-sm font-medium">{target.sourceName}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {target.mismatchCount > 0
                        ? `${target.mismatchCount} mismatches`
                        : 'In sync'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleSync(target.sourceId)}
                    disabled={syncing || target.mismatchCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus:ring-2 focus:ring-primary"
                  >
                    {syncing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    Sync {target.mismatchCount} tracks
                  </button>
                </div>
              ))}
            </div>

            {/* Sync Progress */}
            {syncProgress && (
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{syncProgress.currentTrack}</span>
                  <span>{syncProgress.current}/{syncProgress.total}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Sync Result */}
            {syncResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${
                syncResult.failed === 0
                  ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                  : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
              }`}>
                <div className="flex items-center gap-2">
                  {syncResult.failed === 0 ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>Synced {syncResult.synced} tracks{syncResult.failed > 0 ? `, ${syncResult.failed} failed` : ''}</span>
                </div>
                {syncResult.errors.length > 0 && (
                  <ul className="mt-2 text-xs space-y-1">
                    {syncResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Comparison Results Section */}
      <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Music className="w-5 h-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Comparison Results</p>
                <p className="text-xs text-muted-foreground">
                  {filteredComparisons.length} of {comparisons.length} matched tracks
                </p>
              </div>
            </div>

            {/* Filter toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-muted-foreground">Mismatches only</span>
              <button
                role="switch"
                aria-checked={showMismatchOnly}
                onClick={() => setShowMismatchOnly(!showMismatchOnly)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
                  showMismatchOnly ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-background shadow-md ring-1 ring-border/50 transition-transform ${
                  showMismatchOnly ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </label>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredComparisons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Music className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">
                {sourceOfTruthId
                  ? comparisons.length === 0
                    ? 'No matched tracks found between sources'
                    : 'All moods are in sync!'
                  : 'Select a source of truth to begin'}
              </p>
            </div>
          ) : (
            <div className="bg-background/50 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Track</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Artist</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Source Moods</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Target Moods</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filteredComparisons.slice(0, 100).map((comp, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 text-foreground">{comp.trackTitle}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{comp.artist}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {comp.sourceOfTruthMoods.map((mood, j) => (
                            <span key={j} className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-xs">
                              {mood}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {comp.targets.map((target, j) => (
                          <div key={j} className="flex flex-wrap gap-1">
                            {target.moods.length > 0 ? target.moods.map((mood, k) => (
                              <span key={k} className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                                {mood}
                              </span>
                            )) : (
                              <span className="text-muted-foreground/50 italic">No moods</span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2.5">
                        {comp.targets.some(t => t.hasMismatch) ? (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs">Mismatch</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs">In sync</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredComparisons.length > 100 && (
                <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/30">
                  Showing first 100 of {filteredComparisons.length} tracks
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
