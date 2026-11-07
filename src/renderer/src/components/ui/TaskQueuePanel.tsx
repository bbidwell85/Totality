/**
 * TaskQueuePanel - Slide-out panel for task queue management.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  X,
  Pause,
  Play,
  GripVertical,
  XCircle,
  Clock,
  Loader2,
  Activity,
  CheckCircle2,
} from 'lucide-react'
import { Button } from './Button'

type TaskType =
  | 'library-scan'
  | 'source-scan'
  | 'series-completeness'
  | 'collection-completeness'
  | 'music-completeness'
  | 'music-scan'

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

interface TaskProgress {
  current: number
  total: number
  percentage: number
  phase: string
  currentItem?: string
}

interface QueuedTask {
  id: string
  type: TaskType
  label: string
  sourceId?: string
  libraryId?: string
  status: TaskStatus
  progress?: TaskProgress
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  result?: {
    itemsScanned?: number
    itemsAdded?: number
    itemsUpdated?: number
    itemsRemoved?: number
  }
}

interface QueueState {
  currentTask: QueuedTask | null
  queue: QueuedTask[]
  isPaused: boolean
  completedTasks: QueuedTask[]
}

interface TaskQueuePanelProps {
  isOpen: boolean
  onClose: () => void
}

function SortableQueueItem({ task, onRemove }: { task: QueuedTask; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-2 px-4 py-2.5 ${isDragging ? 'bg-muted/30' : 'hover:bg-muted/30'}`}
      {...attributes}>
      <GripVertical className={`w-4 h-4 shrink-0 cursor-grab active:cursor-grabbing transition-colors ${isDragging ? 'text-foreground' : 'text-muted-foreground/50'}`} {...listeners} />
      <span className="text-label flex-1 truncate">{task.label}</span>
      <button onClick={(e) => { e.stopPropagation(); onRemove(task.id) }}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0" title="Remove">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function TaskQueuePanel({ isOpen, onClose }: TaskQueuePanelProps) {
  const [queueState, setQueueState] = useState<QueueState>({
    currentTask: null, queue: [], isPaused: false, completedTasks: [],
  })
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const pendingCount = queueState.queue.length + (queueState.currentTask ? 1 : 0)

  // Auto-focus close button when panel opens
  useEffect(() => {
    if (isOpen) setTimeout(() => closeButtonRef.current?.focus(), 100)
  }, [isOpen])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.((state) => {
      setQueueState(state as unknown as QueueState)
    })
    window.electronAPI.taskQueueGetState?.().then(setQueueState)
    return () => unsubscribe?.()
  }, [])

  const handlePauseResume = useCallback(() => {
    if (queueState.isPaused) window.electronAPI.taskQueueResume?.()
    else window.electronAPI.taskQueuePause?.()
  }, [queueState.isPaused])

  const handleCancelCurrent = useCallback(() => { window.electronAPI.taskQueueCancelCurrent?.() }, [])
  const handleRemoveTask = useCallback((taskId: string) => { window.electronAPI.taskQueueRemoveTask?.(taskId) }, [])
  const handleClearQueue = useCallback(() => { window.electronAPI.taskQueueClearQueue?.() }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setQueueState((prev) => {
        const oldIndex = prev.queue.findIndex((t) => t.id === active.id)
        const newIndex = prev.queue.findIndex((t) => t.id === over.id)
        const newQueue = arrayMove(prev.queue, oldIndex, newIndex)
        window.electronAPI.taskQueueReorderQueue?.(newQueue.map((t) => t.id))
        return { ...prev, queue: newQueue }
      })
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }, [onClose])

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[45] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-[76px] bottom-4 right-4 w-80 bg-card rounded-2xl shadow-xl border border-border z-[46] slide-panel flex flex-col overflow-hidden transition-opacity duration-200 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onKeyDown={handleKeyDown}
        role="complementary"
        aria-label="Task Queue"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-label font-semibold">Task Queue</h2>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 text-caption font-medium bg-muted text-foreground rounded-full">
                {pendingCount}
              </span>
            )}
            {queueState.isPaused && (
              <span className="text-caption font-medium text-amber-500">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="tertiary" size="icon-sm" onClick={handlePauseResume}
              icon={queueState.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              title={queueState.isPaused ? 'Resume queue' : 'Pause queue — current task will finish'}
            />
            <Button ref={closeButtonRef} variant="tertiary" size="icon-sm" onClick={onClose}
              icon={<X className="w-4 h-4" />}
              aria-label="Close task queue panel" title="Close"
            />
          </div>
        </div>

        {/* Current Task */}
        {queueState.currentTask && (
          <div className="p-4 border-b border-border/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-label font-medium">{queueState.currentTask.label}</span>
              </div>
              <Button variant="tertiary" size="icon-sm" onClick={handleCancelCurrent} title="Cancel"
                icon={<XCircle className="w-4 h-4" />}
              />
            </div>
            {queueState.currentTask.progress && (
              <>
                <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5">
                  <div className="h-full bg-primary transition-[width] duration-300"
                    style={{ width: `${queueState.currentTask.progress.percentage}%` }} />
                </div>
                <div className="flex items-center justify-between text-caption text-muted-foreground">
                  <span>{queueState.currentTask.progress.currentItem || queueState.currentTask.progress.phase}</span>
                  <span>{Math.round(queueState.currentTask.progress.percentage)}%</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Queue */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 shrink-0">
            <span className="text-caption font-medium text-muted-foreground">
              Queued{queueState.queue.length > 0 ? ` (${queueState.queue.length})` : ''}
            </span>
            {queueState.queue.length > 0 && (
              <Button variant="tertiary" size="sm" onClick={handleClearQueue}>Clear</Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {queueState.queue.length === 0 ? (
              <div className="py-8 text-center">
                <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-label text-muted-foreground">Queue empty</p>
                <p className="text-caption text-muted-foreground/50 mt-1">Tasks will appear here when queued</p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
                <SortableContext items={queueState.queue.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="divide-y divide-border/10">
                    {queueState.queue.map((task) => (
                      <SortableQueueItem key={task.id} task={task} onRemove={handleRemoveTask} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* Recent completed tasks */}
        {queueState.completedTasks.length > 0 && (
          <div className="border-t border-border/30 max-h-40 overflow-y-auto">
            <div className="px-4 py-2">
              <span className="text-caption font-medium text-muted-foreground">Recent</span>
            </div>
            <div className="divide-y divide-border/10">
              {queueState.completedTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center gap-2 px-4 py-2 text-muted-foreground/60">
                  <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${task.status === 'failed' ? 'text-destructive' : 'text-foreground'}`} />
                  <span className="text-caption flex-1 truncate">{task.label}</span>
                  {task.status === 'failed' && <span className="text-caption text-destructive">Failed</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
