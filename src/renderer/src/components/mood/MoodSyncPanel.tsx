/**
 * MoodSyncPanel
 *
 * UI for comparing and syncing mood tags across music sources.
 * User selects a source of truth, sees mismatches, and can push corrections.
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

  // Load sources on mount
  useEffect(() => {
    loadSources()
  }, [])

  // Listen for sync progress
  useEffect(() => {
    const cleanup = window.electronAPI.onMoodSyncProgress((progress) => {
      setSyncProgress(progress)
    })
    return cleanup
  }, [])

  const loadSources = async () => {
    const result = await window.electronAPI.moodGetSources()
    setSources(result)
    // Auto-select first source with moods
    const withMoods = result.find(s => s.tracksWithMoods > 0)
    if (withMoods && !sourceOfTruthId) {
      setSourceOfTruthId(withMoods.sourceId)
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

  // Load comparison when source changes
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
      // Reload comparison to reflect changes
      await loadComparison()
    } catch (err) {
      setSyncResult({ synced: 0, failed: 0, errors: [(err as Error).message] })
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  // Filter comparisons
  const filteredComparisons = showMismatchOnly
    ? comparisons.filter(c => c.targets.some(t => t.hasMismatch))
    : comparisons

  // Get unique target sources from comparisons
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--color-text)]">Mood Sync</h3>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Compare and sync mood tags between your music sources
        </p>
      </div>

      {/* Source of Truth Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">Source of Truth</label>
        <div className="flex items-center gap-3">
          <select
            value={sourceOfTruthId}
            onChange={(e) => setSourceOfTruthId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
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
            className="p-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] text-[var(--color-text-secondary)] disabled:opacity-50"
            title="Refresh comparison"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {selectedSource && (
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {selectedSource.tracksWithMoods} of {selectedSource.totalTracks} tracks have mood tags
          </p>
        )}
      </div>

      {/* Sync Targets */}
      {targetSources.size > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">Sync Targets</label>
          <div className="space-y-2">
            {Array.from(targetSources.values()).map(target => (
              <div
                key={target.sourceId}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
              >
                <div>
                  <span className="text-sm font-medium text-[var(--color-text)]">{target.sourceName}</span>
                  <span className="text-xs text-[var(--color-text-secondary)] ml-2">
                    {target.mismatchCount} mismatches
                  </span>
                </div>
                <button
                  onClick={() => handleSync(target.sourceId)}
                  disabled={syncing || target.mismatchCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
        </div>
      )}

      {/* Sync Progress */}
      {syncProgress && (
        <div className="space-y-2 p-3 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30">
          <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
            <span>{syncProgress.currentTrack}</span>
            <span>{syncProgress.current}/{syncProgress.total}</span>
          </div>
          <div className="h-1.5 bg-[var(--color-bg-secondary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] transition-all duration-300"
              style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Sync Result */}
      {syncResult && (
        <div className={`p-3 rounded-lg text-sm ${
          syncResult.failed === 0
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
        }`}>
          <div className="flex items-center gap-2">
            {syncResult.failed === 0 ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
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

      {/* Filter */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={showMismatchOnly}
            onChange={(e) => setShowMismatchOnly(e.target.checked)}
            className="rounded"
          />
          Show mismatches only
        </label>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          ({filteredComparisons.length} of {comparisons.length} tracks)
        </span>
      </div>

      {/* Comparison Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent)]" />
          <span className="ml-3 text-[var(--color-text-secondary)]">Loading comparison...</span>
        </div>
      ) : filteredComparisons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-secondary)]">
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
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                <th className="px-3 py-2 text-left font-medium">Track</th>
                <th className="px-3 py-2 text-left font-medium">Artist</th>
                <th className="px-3 py-2 text-left font-medium">Source Moods</th>
                <th className="px-3 py-2 text-left font-medium">Target Moods</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredComparisons.slice(0, 100).map((comp, i) => (
                <tr key={i} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]/50">
                  <td className="px-3 py-2 text-[var(--color-text)]">{comp.trackTitle}</td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">{comp.artist}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {comp.sourceOfTruthMoods.map((mood, j) => (
                        <span key={j} className="px-1.5 py-0.5 text-xs rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
                          {mood}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {comp.targets.map((target, j) => (
                      <div key={j} className="flex flex-wrap gap-1">
                        {target.moods.length > 0 ? target.moods.map((mood, k) => (
                          <span key={k} className="px-1.5 py-0.5 text-xs rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                            {mood}
                          </span>
                        )) : (
                          <span className="text-xs text-[var(--color-text-tertiary)] italic">No moods</span>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    {comp.targets.some(t => t.hasMismatch) ? (
                      <span className="text-xs text-amber-400">Mismatch</span>
                    ) : (
                      <span className="text-xs text-green-400">In sync</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredComparisons.length > 100 && (
            <div className="px-3 py-2 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-bg-secondary)]">
              Showing first 100 of {filteredComparisons.length} tracks
            </div>
          )}
        </div>
      )}
    </div>
  )
}
