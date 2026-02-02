/**
 * SourceList Component
 *
 * Displays all configured media sources with their status.
 */

import { useState } from 'react'
import { useSources } from '../../contexts/SourceContext'
import { SourceCard } from './SourceCard'
import { AddSourceModal } from './AddSourceModal'

interface SourceListProps {
  onSourcesChanged?: () => void
}

export function SourceList({ onSourcesChanged }: SourceListProps) {
  const { sources, isLoading, error, stats, isScanning, scanAllSources, refreshSources } = useSources()
  const [showAddModal, setShowAddModal] = useState(false)
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)

  const handleScanAll = async () => {
    try {
      await scanAllSources()
      onSourcesChanged?.()
    } catch (err) {
      console.error('Failed to scan all sources:', err)
    }
  }

  const handleSourceAdded = () => {
    setShowAddModal(false)
    refreshSources()
    onSourcesChanged?.()
  }

  if (isLoading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Loading sources...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Media Sources</h2>
          {stats && (
            <p className="text-sm text-muted-foreground">
              {stats.totalSources} source{stats.totalSources !== 1 ? 's' : ''} •{' '}
              {stats.totalItems.toLocaleString()} items
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {sources.length > 0 && (
            <button
              onClick={handleScanAll}
              disabled={isScanning}
              className="text-sm px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
            >
              {isScanning ? 'Scanning...' : 'Scan All'}
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            + Add Source
          </button>
        </div>
      </div>

      {/* Source list */}
      {sources.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-border rounded-lg">
          <div className="text-4xl mb-3">📡</div>
          <h3 className="text-lg font-medium mb-1">No sources configured</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add a media server to start analyzing your library quality
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Add Your First Source
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map(source => (
            <SourceCard
              key={source.source_id}
              source={source}
              expanded={expandedSourceId === source.source_id}
              onToggleExpand={() =>
                setExpandedSourceId(
                  expandedSourceId === source.source_id ? null : source.source_id
                )
              }
              onScan={onSourcesChanged}
            />
          ))}
        </div>
      )}

      {/* Add source modal */}
      {showAddModal && (
        <AddSourceModal
          onClose={() => setShowAddModal(false)}
          onSuccess={handleSourceAdded}
        />
      )}
    </div>
  )
}
