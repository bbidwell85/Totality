import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, Pause, Play, XCircle, Loader2, Clock } from 'lucide-react'
import { Button } from '../ui/Button'

interface TaskProgress {
  current: number
  total: number
  percentage: number
  phase: string
  currentItem?: string
}

interface QueuedTask {
  id: string
  type: string
  label: string
  status: string
  progress?: TaskProgress
}

export interface QueueState {
  currentTask: QueuedTask | null
  queue: QueuedTask[]
  isPaused: boolean
  completedTasks: QueuedTask[]
}

export function MobileScanBanner({ queueState }: { queueState: QueueState | null }) {
  const state = queueState
  const [expanded, setExpanded] = useState(false)

  const handlePause = useCallback(() => {
    if (state?.isPaused) {
      window.electronAPI.taskQueueResume?.()
    } else {
      window.electronAPI.taskQueuePause?.()
    }
  }, [state?.isPaused])

  const handleCancel = useCallback(() => {
    window.electronAPI.taskQueueCancelCurrent?.()
  }, [])

  if (!state?.currentTask && (!state?.queue || state.queue.length === 0)) return null

  const task = state.currentTask
  const progress = task?.progress
  const pct = Math.round(progress?.percentage ?? 0)
  const queueCount = state.queue.length

  return (
    <div className="mb-4 rounded-2xl bg-card border border-border overflow-hidden">
      {/* Collapsed — tap to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px]"
      >
        {task ? (
          <Loader2 className="w-4 h-4 text-foreground animate-spin shrink-0" />
        ) : (
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-label font-medium truncate flex-1 text-left">
          {task ? task.label : `${queueCount} task${queueCount !== 1 ? 's' : ''} queued`}
        </span>
        {task && (
          <span className="text-caption text-muted-foreground shrink-0">
            {state.isPaused ? 'Paused' : `${pct}%`}
          </span>
        )}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Progress bar */}
      {task && (
        <div className="h-0.5 bg-muted mx-4 rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-2">
          {task && progress?.currentItem && (
            <p className="text-caption text-muted-foreground truncate mb-4">
              {progress.currentItem}
            </p>
          )}

          {task && (
            <div className="flex gap-2 mb-4">
              <Button variant="tertiary" size="md" onClick={handlePause} className="flex-1 gap-2">
                {state.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                {state.isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="tertiary" size="md" onClick={handleCancel} className="flex-1 gap-2">
                <XCircle className="w-4 h-4" />
                Cancel
              </Button>
            </div>
          )}

          {queueCount > 0 && (
            <div className="space-y-2">
              <p className="text-label text-muted-foreground">Queued</p>
              {state.queue.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-caption text-muted-foreground">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
