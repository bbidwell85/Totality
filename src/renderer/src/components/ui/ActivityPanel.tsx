/**
 * ActivityPanel - Task queue and monitoring activity panel
 *
 * Features:
 * - Current task progress display
 * - Queue management (reorder, remove, clear)
 * - Pause/resume queue
 * - Tabbed activity history (Tasks/Monitoring)
 */

import { useState, useRef, useEffect, useCallback } from 'react'
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
  Activity,
  X,
  Trash2,
  Pause,
  Play,
  GripVertical,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Scaling,
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

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

interface ActivityLogEntry {
  id: string
  timestamp: string
  type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
  message: string
  taskId?: string
  taskType?: TaskType
}

interface MonitoringEvent {
  id: number
  timestamp: string
  message: string
  type: 'poll' | 'added' | 'removed' | 'error' | 'info'
}

// ============================================================================
// Component
// ============================================================================

// Default and min/max dimensions for resizable panel
const DEFAULT_WIDTH = 450
const DEFAULT_HEIGHT = 500
const MIN_WIDTH = 350
const MIN_HEIGHT = 300
const MAX_WIDTH = 700
const MAX_HEIGHT = 800

// ============================================================================
// Sortable Queue Item Component
// ============================================================================

function SortableQueueItem({
  task,
  onRemove,
}: {
  task: QueuedTask
  onRemove: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-4 py-2.5 ${isDragging ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
      {...attributes}
    >
      <GripVertical
        className={`w-4 h-4 flex-shrink-0 cursor-grab active:cursor-grabbing transition-colors ${
          isDragging ? 'text-primary' : 'text-muted-foreground/50'
        }`}
        {...listeners}
      />
      <span className="text-sm flex-1 truncate">{task.label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove(task.id)
        }}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400 flex-shrink-0"
        title="Remove"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function ActivityPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'tasks' | 'monitoring'>('tasks')
  const [queueState, setQueueState] = useState<QueueState>({
    currentTask: null,
    queue: [],
    isPaused: false,
    completedTasks: [],
  })
  const [taskHistory, setTaskHistory] = useState<ActivityLogEntry[]>([])
  const [monitoringEvents, setMonitoringEvents] = useState<MonitoringEvent[]>([])
  const [isMonitoringActive, setIsMonitoringActive] = useState(false)

  // Configure dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Resize state
  const [panelSize, setPanelSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef({ x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })

  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventIdRef = useRef(0)

  // Calculate total pending tasks (queue + current)
  const pendingCount = queueState.queue.length + (queueState.currentTask ? 1 : 0)

  // Get the active theme from the document root so the dropdown can override
  // the top bar's forced dark scoping and follow the user's chosen theme
  const getActiveTheme = () => {
    const themes = [
      'frost',
      'slate-light', 'ember-light', 'midnight-light',
      'velvet-light', 'emerald-light', 'cobalt-light', 'carbon-light',
      'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon', 'dark',
    ]
    for (const theme of themes) {
      if (document.documentElement.classList.contains(theme)) return theme
    }
    return 'dark'
  }

  // ============================================================================
  // Effects
  // ============================================================================

  // Subscribe to task queue updates
  useEffect(() => {
    const unsubscribeQueue = window.electronAPI.onTaskQueueUpdated?.((state) => {
      // Cast the IPC state to our local type
      setQueueState(state as unknown as QueueState)
    })

    const unsubscribeComplete = window.electronAPI.onTaskQueueTaskComplete?.((_task) => {
      // Task completed - could trigger notification here
    })

    const unsubscribeHistory = window.electronAPI.onTaskQueueHistoryUpdated?.(
      (history) => {
        // Cast the IPC history to our local type
        setTaskHistory(history.taskHistory as unknown as ActivityLogEntry[])
      }
    )

    // Get initial state
    window.electronAPI.taskQueueGetState?.().then(setQueueState)
    window.electronAPI.taskQueueGetTaskHistory?.().then(setTaskHistory)

    return () => {
      unsubscribeQueue?.()
      unsubscribeComplete?.()
      unsubscribeHistory?.()
    }
  }, [])

  // Subscribe to monitoring events (keeping the monitoring feature)
  useEffect(() => {
    const unsubscribeStatus = window.electronAPI.onMonitoringStatus?.((status: { isActive: boolean }) => {
      setIsMonitoringActive(status.isActive)
    })

    const unsubscribeEvent = window.electronAPI.onMonitoringEvent?.(
      (event: { type: string; message: string }) => {
        const newEvent: MonitoringEvent = {
          id: eventIdRef.current++,
          timestamp: new Date().toLocaleTimeString(),
          message: event.message,
          type: event.type as MonitoringEvent['type'],
        }
        setMonitoringEvents((prev) => [newEvent, ...prev].slice(0, 100))
      }
    )

    // Request initial status
    window.electronAPI.getMonitoringStatus?.()

    return () => {
      unsubscribeStatus?.()
      unsubscribeEvent?.()
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  // Resize handlers - using requestAnimationFrame for smooth updates
  useEffect(() => {
    if (!isResizing) return

    let animationFrameId: number

    const handleMouseMove = (e: MouseEvent) => {
      // Cancel any pending animation frame
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }

      // Use requestAnimationFrame for smooth updates
      animationFrameId = requestAnimationFrame(() => {
        const deltaX = resizeStartRef.current.x - e.clientX // Inverted for bottom-left resize
        const deltaY = e.clientY - resizeStartRef.current.y

        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartRef.current.width + deltaX))
        const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartRef.current.height + deltaY))

        setPanelSize({ width: newWidth, height: newHeight })
      })
    }

    const handleMouseUp = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
    }
    setIsResizing(true)
  }, [panelSize])

  // ============================================================================
  // Handlers
  // ============================================================================

  const handlePauseResume = useCallback(() => {
    if (queueState.isPaused) {
      window.electronAPI.taskQueueResume?.()
    } else {
      window.electronAPI.taskQueuePause?.()
    }
  }, [queueState.isPaused])

  const handleCancelCurrent = useCallback(() => {
    window.electronAPI.taskQueueCancelCurrent?.()
  }, [])

  const handleRemoveTask = useCallback((taskId: string) => {
    window.electronAPI.taskQueueRemoveTask?.(taskId)
  }, [])

  const handleClearQueue = useCallback(() => {
    window.electronAPI.taskQueueClearQueue?.()
  }, [])

  const handleClearTaskHistory = useCallback(() => {
    window.electronAPI.taskQueueClearTaskHistory?.()
    setTaskHistory([])
  }, [])

  const handleClearMonitoringEvents = useCallback(() => {
    setMonitoringEvents([])
  }, [])

  // dnd-kit drag handler
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setQueueState((prev) => {
        const oldIndex = prev.queue.findIndex((t) => t.id === active.id)
        const newIndex = prev.queue.findIndex((t) => t.id === over.id)
        const newQueue = arrayMove(prev.queue, oldIndex, newIndex)

        // Commit to service
        window.electronAPI.taskQueueReorderQueue?.(newQueue.map((t) => t.id))

        return { ...prev, queue: newQueue }
      })
    }
  }, [])

  // ============================================================================
  // Helpers
  // ============================================================================

  const getEventColor = (type: MonitoringEvent['type']) => {
    switch (type) {
      case 'added':
        return 'text-green-400'
      case 'removed':
        return 'text-red-400'
      case 'error':
        return 'text-red-500'
      case 'poll':
        return 'text-blue-400'
      default:
        return 'text-muted-foreground'
    }
  }

  const getHistoryIcon = (type: ActivityLogEntry['type']) => {
    switch (type) {
      case 'task-complete':
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
      case 'task-failed':
        return <AlertCircle className="w-3.5 h-3.5 text-red-400" />
      case 'task-cancelled':
        return <XCircle className="w-3.5 h-3.5 text-yellow-400" />
      default:
        return <Activity className="w-3.5 h-3.5 text-blue-400" />
    }
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString()
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="relative">
      {/* Activity Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-md transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-black ${
          isOpen
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-muted-foreground hover:bg-muted'
        }`}
        aria-label="Activity Panel"
        aria-expanded={isOpen}
      >
        {queueState.currentTask ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Activity className="w-5 h-5" />
        )}
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>

      {/* Activity Panel Dropdown */}
      <div
        ref={dropdownRef}
        className={`${getActiveTheme()} absolute right-0 top-full mt-2 bg-card rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden ${
          isResizing ? 'select-none' : 'transition-all duration-300 ease-out'
        } ${
          isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        }`}
        style={{
          width: panelSize.width,
          height: panelSize.height,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 12px 24px -8px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Resize Handle - Bottom Left Corner */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-2.5 left-2.5 cursor-sw-resize z-10 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <Scaling className="w-4 h-4 rotate-180" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Activity</h3>
            {queueState.isPaused && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded-full">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handlePauseResume}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title={queueState.isPaused ? 'Resume queue' : 'Pause queue'}
            >
              {queueState.isPaused ? (
                <Play className="w-4 h-4" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Current Task */}
        {queueState.currentTask && (
          <div className="p-4 border-b border-border/30 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium">{queueState.currentTask.label}</span>
              </div>
              <button
                onClick={handleCancelCurrent}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400"
                title="Cancel"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
            {queueState.currentTask.progress && (
              <>
                <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${queueState.currentTask.progress.percentage}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {queueState.currentTask.progress.currentItem ||
                      queueState.currentTask.progress.phase}
                  </span>
                  <span>{Math.round(queueState.currentTask.progress.percentage)}%</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Queue - grows with panel resize */}
        <div className="flex-1 min-h-0 flex flex-col border-b border-border/30">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/20 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Queue {queueState.queue.length > 0 && `(${queueState.queue.length})`}
              </span>
            </div>
            {queueState.queue.length > 0 && (
              <button
                onClick={handleClearQueue}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {queueState.queue.length === 0 ? (
              <div className="py-6 text-center">
                <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Queue empty</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Tasks will appear here when queued
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={queueState.queue.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="divide-y divide-border/10">
                    {queueState.queue.map((task) => (
                      <SortableQueueItem
                        key={task.id}
                        task={task}
                        onRemove={handleRemoveTask}
                      />
                    ))}
                  </div>
                  <p className="px-4 py-1.5 text-xs text-muted-foreground/60 italic border-t border-border/20">
                    Drag to reorder
                  </p>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* History Section - Fixed height, pl-6 to avoid resize handle */}
        <div className="h-48 flex-shrink-0 flex flex-col pl-6">
          {/* Tabs */}
          <div className="flex border-b border-border/30 flex-shrink-0">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                activeTab === 'tasks'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              History
            </button>
            <button
              onClick={() => setActiveTab('monitoring')}
              className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                activeTab === 'monitoring'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Monitoring
              {isMonitoringActive && (
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              )}
            </button>
          </div>

          {/* Tab Content - pb-6 to avoid overlap with resize handle */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pb-6">
            {activeTab === 'tasks' ? (
              <div className="p-2">
              {taskHistory.length === 0 ? (
                <div className="py-6 text-center">
                  <CheckCircle2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No completed tasks</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Task completions will appear here
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex justify-end mb-2">
                    <button
                      onClick={handleClearTaskHistory}
                      className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      title="Clear history"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {taskHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-muted/30 text-xs"
                      >
                        <span className="flex-shrink-0 mt-0.5">{getHistoryIcon(entry.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground truncate">{entry.message}</p>
                          <p className="text-muted-foreground/60">{formatTime(entry.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="p-2">
              {monitoringEvents.length === 0 ? (
                <div className="py-6 text-center">
                  <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No monitoring events</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Live monitoring activity will appear here
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex justify-end mb-2">
                    <button
                      onClick={handleClearMonitoringEvents}
                      className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      title="Clear log"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-0.5 font-mono">
                    {monitoringEvents.map((event) => (
                      <div
                        key={event.id}
                        className="py-1 px-2 rounded hover:bg-muted/30 flex gap-2 text-xs"
                      >
                        <span className="text-muted-foreground/50 flex-shrink-0">
                          {event.timestamp}
                        </span>
                        <span className={getEventColor(event.type)}>{event.message}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
