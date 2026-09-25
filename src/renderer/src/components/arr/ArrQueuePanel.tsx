/**
 * ArrQueuePanel — shows the combined download queue from Radarr, Sonarr, and Lidarr.
 * Opened as a slide-in panel from the Dashboard or Library.
 */

import { useState, useEffect, useCallback } from 'react'
import { X, RefreshCw, Loader2, Trash2, AlertCircle, Download, Film, Tv, Music } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'

type ArrType = 'radarr' | 'sonarr' | 'lidarr'

interface ArrQueueItem {
  id: number
  title: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  artistName?: string
  albumTitle?: string
  status: string
  sizeleft: number
  size: number
  timeleft?: string
  estimatedCompletionTime?: string
  quality?: { quality: { name: string } }
  indexer?: string
  downloadClient?: string
  statusMessages?: Array<{ title: string; messages: string[] }>
  arrType: ArrType
}

interface ArrQueuePanelProps {
  isOpen: boolean
  onClose: () => void
}

const ARR_LABEL: Record<ArrType, string> = {
  radarr: 'Radarr',
  sonarr: 'Sonarr',
  lidarr: 'Lidarr',
}

const ARR_COLOR: Record<ArrType, string> = {
  radarr: 'text-yellow-400',
  sonarr: 'text-sky-400',
  lidarr: 'text-green-400',
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatTimeLeft(timeleft?: string): string | null {
  if (!timeleft || timeleft === '00:00:00') return null
  // timeleft format: "HH:MM:SS" or "D.HH:MM:SS"
  const parts = timeleft.split(':')
  if (parts.length < 3) return timeleft
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'downloading': return 'text-blue-400'
    case 'completed': return 'text-green-400'
    case 'failed': case 'importfailed': return 'text-red-400'
    case 'warning': return 'text-yellow-400'
    case 'paused': return 'text-muted-foreground'
    default: return 'text-muted-foreground'
  }
}

function QueueItemRow({
  item,
  onRemove,
}: {
  item: ArrQueueItem
  onRemove: (item: ArrQueueItem) => void
}) {
  const progress = item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0
  const timeLeft = formatTimeLeft(item.timeleft)
  const hasError = item.status.toLowerCase() === 'failed' ||
    item.status.toLowerCase() === 'importfailed' ||
    (item.statusMessages && item.statusMessages.some(m => m.messages.length > 0))

  const subtitle = item.arrType === 'sonarr' && item.seriesTitle
    ? `${item.seriesTitle}${item.seasonNumber != null ? ` · S${item.seasonNumber}E${item.episodeNumber}` : ''}`
    : item.arrType === 'lidarr' && item.artistName
      ? `${item.artistName}${item.albumTitle ? ` · ${item.albumTitle}` : ''}`
      : null

  const MediaIcon = item.arrType === 'sonarr' ? Tv : item.arrType === 'lidarr' ? Music : Film

  return (
    <div className="px-3 py-2.5 border-b border-border/30 last:border-0 group">
      <div className="flex items-start gap-2">
        <MediaIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${ARR_COLOR[item.arrType]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate leading-tight">{item.title}</p>
              {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
            </div>
            <button
              onClick={() => onRemove(item)}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all shrink-0"
              title="Remove from queue"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Progress bar */}
          {item.status.toLowerCase() === 'downloading' && item.size > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{progress}%</span>
            </div>
          )}

          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-medium capitalize ${statusColor(item.status)}`}>
              {item.status}
            </span>
            {item.quality?.quality?.name && (
              <span className="text-[10px] text-muted-foreground">{item.quality.quality.name}</span>
            )}
            {timeLeft && (
              <span className="text-[10px] text-muted-foreground">{timeLeft}</span>
            )}
            {item.sizeleft > 0 && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                {formatBytes(item.sizeleft)} left
              </span>
            )}
          </div>

          {/* Error messages */}
          {hasError && item.statusMessages?.map((msg, i) =>
            msg.messages.map((m, j) => (
              <p key={`${i}-${j}`} className="text-[10px] text-red-400 mt-0.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {m}
              </p>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export function ArrQueuePanel({ isOpen, onClose }: ArrQueuePanelProps) {
  const { addToast } = useToast()
  const [queue, setQueue] = useState<ArrQueueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const items = await window.electronAPI.arrGetQueue()
      setQueue(items as ArrQueueItem[])
      setLastRefreshed(new Date())
    } catch (err) {
      console.error('Failed to load arr queue:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) loadQueue()
  }, [isOpen, loadQueue])

  const handleRemove = async (item: ArrQueueItem) => {
    try {
      const result = await window.electronAPI.arrRemoveFromQueue({
        type: item.arrType,
        queueId: item.id,
      })
      if (result.success) {
        setQueue(prev => prev.filter(q => q.id !== item.id || q.arrType !== item.arrType))
        addToast({ type: 'success', message: `Removed "${item.title}" from queue` })
      } else {
        addToast({ type: 'error', message: result.error || 'Failed to remove from queue' })
      }
    } catch {
      addToast({ type: 'error', message: 'Failed to remove from queue' })
    }
  }

  // Group by arr type
  const radarrItems = queue.filter(q => q.arrType === 'radarr')
  const sonarrItems = queue.filter(q => q.arrType === 'sonarr')
  const lidarrItems = queue.filter(q => q.arrType === 'lidarr')

  const groups: [ArrType, ArrQueueItem[]][] = [
    ['radarr', radarrItems],
    ['sonarr', sonarrItems],
    ['lidarr', lidarrItems],
  ].filter(([, items]) => (items as ArrQueueItem[]).length > 0) as [ArrType, ArrQueueItem[]][]

  return (
    <div className={`fixed inset-y-0 right-0 w-80 bg-background border-l border-border shadow-2xl z-50 flex flex-col transition-[transform,opacity] duration-300 ease-out will-change-[transform,opacity] ${
      isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Downloads</h2>
          {queue.length > 0 && (
            <span className="text-xs text-muted-foreground">({queue.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadQueue}
            disabled={loading}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh queue"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && queue.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground px-4 text-center">
            <Download className="w-8 h-8 opacity-30" />
            <p className="text-sm">Queue is empty</p>
            <p className="text-xs">Items downloading in Radarr, Sonarr, or Lidarr will appear here.</p>
          </div>
        ) : (
          <div>
            {groups.map(([type, items]) => (
              <div key={type}>
                <div className="sticky top-0 bg-background/95 backdrop-blur-sm px-3 py-1.5 border-b border-border/30">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${ARR_COLOR[type]}`}>
                    {ARR_LABEL[type]} · {items.length}
                  </span>
                </div>
                {items.map(item => (
                  <QueueItemRow
                    key={`${item.arrType}-${item.id}`}
                    item={item}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {lastRefreshed && (
        <div className="px-3 py-2 border-t border-border/30 text-[10px] text-muted-foreground">
          Updated {lastRefreshed.toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
