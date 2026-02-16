import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Plus, Film, Tv, Music, Folder, Trash2, Pencil, Info, Square, Server, HardDrive, Settings, Eye, EyeOff, Clock, PanelLeftClose, PanelLeft } from 'lucide-react'
import { useSources, type ProviderType } from '../../contexts/SourceContext'
import { AddSourceModal } from '../sources/AddSourceModal'
import type { MediaSourceResponse, MediaLibraryResponse } from '../../../../preload/index'

// Task queue types
interface QueuedTask {
  id: string
  type: string
  label: string
  sourceId?: string
  libraryId?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: {
    current: number
    total: number
    percentage: number
    phase: string
    currentItem?: string
  }
}

interface TaskQueueState {
  currentTask: QueuedTask | null
  queue: QueuedTask[]
  isPaused: boolean
}

const PROVIDER_COLORS: Record<ProviderType, string> = {
  plex: 'bg-[#e5a00d]',
  jellyfin: 'bg-purple-500',
  emby: 'bg-green-500',
  kodi: 'bg-blue-500',
  'kodi-local': 'bg-blue-500',
  local: 'bg-slate-600',
}

const LIBRARY_ICONS: Record<string, typeof Film> = {
  movie: Film,
  show: Tv,
  music: Music,
}

function formatRelativeTime(dateStr?: string): string | null {
  if (!dateStr) return null
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

interface SidebarProps {
  onOpenAbout: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function Sidebar({ onOpenAbout, isCollapsed, onToggleCollapse }: SidebarProps) {
  const {
    sources,
    isLoading,
    scanProgress,
    refreshSources,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    scanSource: _scanSource,
    stopScan,
    activeSourceId,
    setActiveSource,
    connectionStatus,
    removeSource,
    newItemCounts,
    clearNewItems,
    refreshLibraryTypes,
  } = useSources()

  const [showAddModal, setShowAddModal] = useState(false)
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [sourceLibraries, setSourceLibraries] = useState<Map<string, MediaLibraryResponse[]>>(new Map())
  const [allSourceLibraries, setAllSourceLibraries] = useState<Map<string, Array<MediaLibraryResponse & { isEnabled: boolean }>>>(new Map())
  const [loadingLibraries, setLoadingLibraries] = useState<Set<string>>(new Set())
  const [managingSourceId, setManagingSourceId] = useState<string | null>(null)
  // These state values are read but setters reserved for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [scanningLibrary, _setScanningLibrary] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [scanningLibraryType, _setScanningLibraryType] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [scanPhase, _setScanPhase] = useState<'scanning' | 'analyzing' | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number; percentage: number; currentItem?: string } | null>(null)
  const [musicScanProgress, setMusicScanProgress] = useState<Map<string, { current: number; total: number; percentage: number; currentItem?: string; phase?: string }>>(new Map())
  const [renamingSourceId, setRenamingSourceId] = useState<string | null>(null)
  const [taskQueueState, setTaskQueueState] = useState<TaskQueueState | null>(null)
  const addSourceButtonRef = useRef<HTMLButtonElement>(null)
  const aboutButtonRef = useRef<HTMLButtonElement>(null)
  // Listen for library updates to refresh sidebar when libraries are toggled
  useEffect(() => {
    const cleanup = window.electronAPI.onLibraryUpdated?.((data: { type: string; sourceId?: string }) => {
      // Only clear the libraries cache when a library is toggled on/off
      // Don't clear during regular scans (type: 'media' or 'music') as that causes libraries to disappear
      if (data.type === 'libraryToggle') {
        // Clear only the affected source's libraries, or all if sourceId not provided
        if (data.sourceId) {
          setSourceLibraries(prev => {
            const next = new Map(prev)
            next.delete(data.sourceId!)
            return next
          })
        } else {
          setSourceLibraries(new Map())
        }
      }
    })
    return () => cleanup?.()
  }, [])

  // Update cached library timestamps when a scan completes
  useEffect(() => {
    const cleanup = window.electronAPI.onScanCompleted?.((data) => {
      if (!data.sourceId) return

      const sourceId = data.sourceId
      setSourceLibraries(prev => {
        if (!prev.has(sourceId)) return prev
        const next = new Map(prev)
        const libs = next.get(sourceId)!.map(lib =>
          lib.id === data.libraryId
            ? { ...lib, scannedAt: new Date().toISOString() }
            : lib
        )
        next.set(sourceId, libs)
        return next
      })
    })
    return () => cleanup?.()
  }, [])

  // Listen for quality analysis progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onQualityAnalysisProgress?.((progress: unknown) => {
      const p = progress as { current: number; total: number }
      const percentage = p.total > 0 ? (p.current / p.total) * 100 : 0
      setAnalysisProgress({
        current: p.current,
        total: p.total,
        percentage,
      })
    })
    return () => unsubscribe?.()
  }, [])

  // Listen for music scan progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onMusicScanProgress?.((progress: unknown) => {
      const p = progress as { sourceId: string; current: number; total: number; percentage: number; currentItem?: string; phase?: string }
      setMusicScanProgress(prev => {
        const next = new Map(prev)
        next.set(p.sourceId, {
          current: p.current,
          total: p.total,
          percentage: p.percentage,
          currentItem: p.currentItem,
          phase: p.phase,
        })
        return next
      })
    })
    return () => unsubscribe?.()
  }, [])

  // Listen for task queue updates to show scanning/queued status
  useEffect(() => {
    // Load initial state
    window.electronAPI.taskQueueGetState?.().then((state: unknown) => {
      setTaskQueueState(state as TaskQueueState)
    }).catch(console.error)

    // Subscribe to updates
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.((state: unknown) => {
      setTaskQueueState(state as TaskQueueState)
    })
    return () => unsubscribe?.()
  }, [])

  const handleExpandSource = async (sourceId: string) => {
    if (expandedSourceId === sourceId) {
      setExpandedSourceId(null)
      setManagingSourceId(null)
      return
    }

    setExpandedSourceId(sourceId)
    setManagingSourceId(null)

    if (!sourceLibraries.has(sourceId)) {
      setLoadingLibraries(prev => new Set(prev).add(sourceId))
      try {
        // Get libraries with enabled status
        const libsWithStatus = await window.electronAPI.sourcesGetLibrariesWithStatus(sourceId)
        // Store all libraries for managing
        setAllSourceLibraries(prev => new Map(prev).set(sourceId, libsWithStatus))
        // Filter to only show enabled ones in the normal view
        const enabledLibs = libsWithStatus.filter((lib) => lib.isEnabled)
        setSourceLibraries(prev => new Map(prev).set(sourceId, enabledLibs))
      } catch (err) {
        console.error('Failed to load libraries:', err)
      } finally {
        setLoadingLibraries(prev => {
          const next = new Set(prev)
          next.delete(sourceId)
          return next
        })
      }
    }
  }

  const handleToggleLibrary = async (sourceId: string, libraryId: string, enabled: boolean) => {
    try {
      await window.electronAPI.sourcesToggleLibrary(sourceId, libraryId, enabled)

      // Update local state
      setAllSourceLibraries(prev => {
        const next = new Map(prev)
        const libs = next.get(sourceId)
        if (libs) {
          const updated = libs.map(lib =>
            lib.id === libraryId ? { ...lib, isEnabled: enabled } : lib
          )
          next.set(sourceId, updated)
        }
        return next
      })

      // Update visible libraries
      setSourceLibraries(prev => {
        const next = new Map(prev)
        const allLibs = allSourceLibraries.get(sourceId)
        if (allLibs) {
          const enabledLibs = allLibs
            .map(lib => lib.id === libraryId ? { ...lib, isEnabled: enabled } : lib)
            .filter(lib => lib.isEnabled)
          next.set(sourceId, enabledLibs)
        }
        return next
      })

      // Refresh library types in context so TopBar/Dashboard update
      await refreshLibraryTypes()
    } catch (err) {
      console.error('Failed to toggle library:', err)
    }
  }

  const handleManageLibraries = (sourceId: string) => {
    setManagingSourceId(managingSourceId === sourceId ? null : sourceId)
  }

  const handleScanAllLibraries = async (sourceId: string) => {
    try {
      const source = sources.find(s => s.source_id === sourceId)
      const libraries = sourceLibraries.get(sourceId) || []
      const sourceName = source?.display_name || sourceId

      // Queue scan tasks for every enabled library in this source
      for (const library of libraries) {
        const taskType = library.type === 'music' ? 'music-scan' : 'library-scan'
        await window.electronAPI.taskQueueAddTask({
          type: taskType,
          label: `Scan ${library.name} (${sourceName})`,
          sourceId,
          libraryId: library.id,
        })
      }

      // Queue analysis tasks for this source based on library types present
      const libraryTypes = new Set(libraries.map(l => l.type))
      if (libraryTypes.has('show')) {
        await window.electronAPI.taskQueueAddTask({
          type: 'series-completeness',
          label: `Analyze TV Series (${sourceName})`,
          sourceId,
        })
      }
      if (libraryTypes.has('movie')) {
        await window.electronAPI.taskQueueAddTask({
          type: 'collection-completeness',
          label: `Analyze Collections (${sourceName})`,
          sourceId,
        })
      }
      if (libraryTypes.has('music')) {
        await window.electronAPI.taskQueueAddTask({
          type: 'music-completeness',
          label: `Analyze Music (${sourceName})`,
          sourceId,
        })
      }
    } catch (err) {
      console.error('Failed to queue full rescan:', err)
    }
  }

  const handleScanLibrary = async (sourceId: string, libraryId: string, libraryType: string) => {
    try {
      // Find the source and library names for the task label
      const source = sources.find(s => s.source_id === sourceId)
      const libraries = sourceLibraries.get(sourceId) || allSourceLibraries.get(sourceId) || []
      const library = libraries.find(l => l.id === libraryId)
      const libraryName = library?.name || libraryId
      const sourceName = source?.display_name || sourceId

      // Add to task queue - this will show in the activity panel
      const taskType = libraryType === 'music' ? 'music-scan' : 'library-scan'
      await window.electronAPI.taskQueueAddTask({
        type: taskType,
        label: `Scan ${libraryName} (${sourceName})`,
        sourceId,
        libraryId,
      })
    } catch (err) {
      console.error('Failed to queue library scan:', err)
    }
  }

  // Stop scan handler that calls the appropriate cancel based on library type
  const handleStopScan = async () => {
    try {
      if (scanningLibrary && scanningLibraryType === 'music') {
        // Extract sourceId from scanningLibrary (format: "sourceId:libraryId")
        const sourceId = scanningLibrary.split(':')[0]
        await window.electronAPI.musicCancelScan(sourceId)
      } else {
        await stopScan()
      }
    } catch (err) {
      console.error('Failed to stop scan:', err)
    }
  }

  const handleSourceAdded = () => {
    setShowAddModal(false)
    refreshSources()
  }

  const handleRenameSource = async (sourceId: string, newName: string) => {
    try {
      await window.electronAPI.sourcesUpdate(sourceId, { displayName: newName })
      await refreshSources()
    } catch (err) {
      console.error('Failed to rename source:', err)
    } finally {
      setRenamingSourceId(null)
    }
  }

  // Extract library ID from scanningLibrary, handling library IDs that contain colons (e.g., "movies:Movies")
  const getScanningLibraryId = (sourceId: string) => {
    if (!scanningLibrary?.startsWith(`${sourceId}:`)) return null
    // Return everything after "sourceId:" to handle library IDs with colons
    return scanningLibrary.slice(sourceId.length + 1)
  }

  // Unified sidebar with conditional collapsed/expanded content
  return (
    <aside
      className={`fixed left-4 top-[88px] bottom-4 ${isCollapsed ? 'w-16' : 'w-64'} bg-sidebar-gradient rounded-2xl shadow-xl z-40 flex flex-col overflow-hidden transition-[width] duration-300 ease-out will-change-[width]`}
      role="navigation"
      aria-label="Media sources"
    >
      {/* Header - adapts to collapsed/expanded state */}
      <div className={`flex items-center transition-[padding,border] duration-300 ease-out ${isCollapsed ? 'p-2 border-b border-border justify-center' : 'p-4 pb-0 justify-between'}`}>
        {!isCollapsed && (
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 whitespace-nowrap">
            Media Sources
          </h2>
        )}
        <button
          onClick={onToggleCollapse}
          className={`rounded-md text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ${isCollapsed ? 'w-12 h-10 rounded-lg flex items-center justify-center hover:bg-white/10' : 'p-2 hover:bg-muted/50'}`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Collapsed view: Source icons only */}
      {isCollapsed && (
        <div className="flex-1 p-2 overflow-y-auto flex flex-col items-center gap-2 transition-opacity duration-300 ease-out">
          {isLoading && sources.length === 0 && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {sources.map((source) => {
            const color = PROVIDER_COLORS[source.source_type as ProviderType] || 'bg-gray-500'
            const isActive = activeSourceId === source.source_id

            return (
              <button
                key={source.source_id}
                onClick={() => setActiveSource(source.source_id)}
                className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all ${
                  isActive
                    ? 'bg-primary ring-2 ring-primary-foreground/30'
                    : 'hover:bg-white/10'
                }`}
                title={source.display_name}
                aria-label={`Select ${source.display_name}`}
              >
                <div className={`w-8 h-8 ${color} rounded-md flex items-center justify-center`}>
                  {source.source_type === 'local' ? (
                    <HardDrive className="w-4 h-4 text-white" />
                  ) : (
                    <Server className="w-4 h-4 text-white" />
                  )}
                </div>
              </button>
            )
          })}

          <button
            onClick={() => setShowAddModal(true)}
            className="w-12 h-12 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
            title="Add Source"
            aria-label="Add media source"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Expanded view: Full source list */}
      {!isCollapsed && (
        <>
      {/* Media Sources Section */}
      <div className="flex-1 p-4 pt-2 overflow-y-auto space-y-2">

        {/* Loading State */}
        {isLoading && sources.length === 0 && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* No Sources */}
        {!isLoading && sources.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground text-left px-2">
              No media sources configured
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
              aria-label="Add media source"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add Source
            </button>
          </div>
        )}

        {sources.map((source) => (
          <SourceItem
            key={source.source_id}
            source={source}
            isExpanded={expandedSourceId === source.source_id}
            isActive={activeSourceId === source.source_id}
            isOnline={connectionStatus.get(source.source_id) ?? false}
            onToggleExpand={() => handleExpandSource(source.source_id)}
            onSelect={() => setActiveSource(source.source_id)}
            libraries={sourceLibraries.get(source.source_id) || []}
            allLibraries={allSourceLibraries.get(source.source_id) || []}
            isLoadingLibraries={loadingLibraries.has(source.source_id)}
            isManaging={managingSourceId === source.source_id}
            progress={scanProgress.get(source.source_id) || musicScanProgress.get(source.source_id)}
            onScanLibrary={(libraryId, libraryType) => handleScanLibrary(source.source_id, libraryId, libraryType)}
            onManageLibraries={() => handleManageLibraries(source.source_id)}
            onToggleLibrary={(libraryId, enabled) => handleToggleLibrary(source.source_id, libraryId, enabled)}
            scanningLibraryId={getScanningLibraryId(source.source_id)}
            scanPhase={scanningLibrary?.startsWith(`${source.source_id}:`) ? scanPhase : null}
            analysisProgress={scanningLibrary?.startsWith(`${source.source_id}:`) ? analysisProgress : null}
            onDelete={async () => {
              await removeSource(source.source_id)
              if (activeSourceId === source.source_id) setActiveSource(null)
              if (expandedSourceId === source.source_id) setExpandedSourceId(null)
              setSourceLibraries(prev => {
                const next = new Map(prev)
                next.delete(source.source_id)
                return next
              })
              setAllSourceLibraries(prev => {
                const next = new Map(prev)
                next.delete(source.source_id)
                return next
              })
              await refreshSources()
            }}
            isRenaming={renamingSourceId === source.source_id}
            onStartRename={() => setRenamingSourceId(source.source_id)}
            onRename={(newName) => handleRenameSource(source.source_id, newName)}
            onCancelRename={() => setRenamingSourceId(null)}
            onStopScan={handleStopScan}
            onScanAll={() => handleScanAllLibraries(source.source_id)}
            taskQueueState={taskQueueState}
            newItemCounts={newItemCounts}
            onClearNewItems={clearNewItems}
          />
        ))}

        {/* Add Source Button */}
        {sources.length > 0 && (
          <button
            ref={addSourceButtonRef}
            onClick={() => setShowAddModal(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
            aria-label="Add media source"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Add Source
          </button>
        )}
      </div>
        </>
      )}

      {/* Footer - always visible */}
      <div className={`border-t border-border ${isCollapsed ? 'p-2' : 'p-4'}`}>
        <button
          ref={aboutButtonRef}
          onClick={onOpenAbout}
          className="w-full flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          aria-label="About Totality"
        >
          <Info className={isCollapsed ? 'w-5 h-5' : 'w-3.5 h-3.5'} aria-hidden="true" />
          {!isCollapsed && 'About Totality'}
        </button>
      </div>

      {/* Add Source Modal */}
      {showAddModal && (
        <AddSourceModal
          onClose={() => setShowAddModal(false)}
          onSuccess={handleSourceAdded}
        />
      )}

    </aside>
  )
}

interface SourceItemProps {
  source: MediaSourceResponse
  isExpanded: boolean
  isActive: boolean
  isOnline: boolean
  isRenaming: boolean
  onToggleExpand: () => void
  onSelect: () => void
  libraries: MediaLibraryResponse[]
  allLibraries: Array<MediaLibraryResponse & { isEnabled: boolean }>
  isLoadingLibraries: boolean
  isManaging: boolean
  progress?: { current: number; total: number; percentage: number; currentItem?: string }
  onScanLibrary: (libraryId: string, libraryType: string) => void
  onManageLibraries: () => void
  onToggleLibrary: (libraryId: string, enabled: boolean) => void
  scanningLibraryId: string | null
  scanPhase: 'scanning' | 'analyzing' | null
  analysisProgress: { current: number; total: number; percentage: number; currentItem?: string } | null
  onDelete: () => Promise<void>
  onStartRename: () => void
  onRename: (newName: string) => Promise<void>
  onCancelRename: () => void
  onStopScan: () => void
  onScanAll: () => void
  taskQueueState: TaskQueueState | null
  newItemCounts: Map<string, number>
  onClearNewItems: (libraryKey: string) => void
}

function LibraryIcon({ type }: { type: string }) {
  const Icon = LIBRARY_ICONS[type] || Folder
  return <Icon className="w-3.5 h-3.5 text-foreground" />
}

function SourceItem({
  source,
  isExpanded,
  isActive,
  isOnline,
  isRenaming,
  onToggleExpand,
  onSelect,
  libraries,
  allLibraries,
  isLoadingLibraries,
  isManaging,
  progress,
  onScanLibrary,
  onManageLibraries,
  onToggleLibrary,
  scanningLibraryId,
  scanPhase,
  analysisProgress,
  onDelete,
  onStartRename,
  onRename,
  onCancelRename,
  onStopScan,
  onScanAll,
  taskQueueState,
  newItemCounts,
  onClearNewItems,
}: SourceItemProps) {
  const color = PROVIDER_COLORS[source.source_type as ProviderType] || 'bg-gray-500'

  // Helper to check if a library is being scanned via task queue
  const getTaskQueueStatus = (libraryId: string): { isScanning: boolean; isQueued: boolean; queuePosition?: number; progress?: QueuedTask['progress'] } => {
    if (!taskQueueState) return { isScanning: false, isQueued: false }

    // Check if currently running task matches this library
    const currentTask = taskQueueState.currentTask
    if (currentTask &&
        currentTask.sourceId === source.source_id &&
        currentTask.libraryId === libraryId &&
        currentTask.status === 'running') {
      return { isScanning: true, isQueued: false, progress: currentTask.progress }
    }

    // Check if in queue
    const queueIndex = taskQueueState.queue.findIndex(
      task => task.sourceId === source.source_id && task.libraryId === libraryId
    )
    if (queueIndex >= 0) {
      return { isScanning: false, isQueued: true, queuePosition: queueIndex + 1 }
    }

    return { isScanning: false, isQueued: false }
  }
  const buttonRef = useRef<HTMLButtonElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const manageButtonRef = useRef<HTMLButtonElement>(null)
  const renameButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const libraryRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [renameValue, setRenameValue] = useState(source.display_name)
  const confirmTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Focus input when renaming starts
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      setRenameValue(source.display_name)
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming, source.display_name])

  const handleRenameSubmit = async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== source.display_name) {
      await onRename(trimmed)
    } else {
      onCancelRename()
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancelRename()
    }
  }

  // Clear confirm timeout on unmount
  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
      }
    }
  }, [])

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (!confirmDelete) {
      // First click - show confirm state
      setConfirmDelete(true)
      // Reset after 3 seconds if not confirmed
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmDelete(false)
      }, 3000)
    } else {
      // Second click - actually delete
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
      }
      setIsDeleting(true)
      await onDelete()
      setIsDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleExpandClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onToggleExpand()
  }

  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight

  return (
    <div className="rounded-md overflow-hidden">
      <button
        ref={buttonRef}
        onClick={onSelect}
        aria-label={`Select ${source.display_name} media source`}
        aria-expanded={isExpanded}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-md font-medium transition-colors focus:outline-none ${
          isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50 text-foreground'
        }`}
      >
        <div className={`w-5 h-5 ${color} rounded flex items-center justify-center text-white flex-shrink-0`} aria-hidden="true">
          {source.source_type === 'local' ? (
            <HardDrive className="w-3 h-3" />
          ) : (
            <Server className="w-3 h-3" />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-sm font-medium bg-muted text-foreground border border-primary rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          ) : (
            <div className="text-sm font-medium truncate">{source.display_name}</div>
          )}
        </div>
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-yellow-500'}`}
          aria-label={isOnline ? 'Online' : 'Offline'}
          role="status"
        />
        <span
          role="button"
          tabIndex={0}
          onClick={handleExpandClick}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleExpandClick(e)}
          className={`p-1 rounded flex-shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${isActive ? 'hover:bg-primary-foreground/20' : 'hover:bg-muted'}`}
          aria-label={isExpanded ? 'Collapse libraries' : 'Expand libraries'}
          aria-expanded={isExpanded}
        >
          <ChevronIcon className={`w-4 h-4 ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`} aria-hidden="true" />
        </span>
      </button>

      {isExpanded && (
        <div className="px-2 pb-2 space-y-2">
          {isLoadingLibraries && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Manage Libraries Mode */}
          {!isLoadingLibraries && isManaging && allLibraries.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground px-2 mb-2">
                Toggle libraries to show/hide them
              </div>
              {allLibraries.map((library) => (
                <div
                  key={library.id}
                  className="px-2 py-1.5 bg-muted/30 rounded flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <LibraryIcon type={library.type} />
                    <span className="text-xs truncate">{library.name}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleLibrary(library.id, !library.isEnabled)
                    }}
                    className={`p-1 rounded transition-colors ${
                      library.isEnabled
                        ? 'text-green-500 hover:text-green-400'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title={library.isEnabled ? 'Hide library' : 'Show library'}
                    aria-label={library.isEnabled ? `Hide ${library.name}` : `Show ${library.name}`}
                  >
                    {library.isEnabled ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Normal Libraries View */}
          {!isLoadingLibraries && !isManaging && libraries.length > 0 && (
            <div className="space-y-1">
              {libraries.map((library) => {
                // Use library-specific scan time instead of source-level
                const lastScan = formatRelativeTime(library.scannedAt)
                const isScanning = scanningLibraryId === library.id

                // Check task queue status for this library
                const queueStatus = getTaskQueueStatus(library.id)
                const isQueueScanning = queueStatus.isScanning
                const isQueued = queueStatus.isQueued
                const queueProgress = queueStatus.progress

                // Combined scanning state: either from manual scan or task queue
                const showScanningUI = isScanning || isQueueScanning

                const libraryKey = `${source.source_id}:${library.id}`
                const newItemCount = newItemCounts.get(libraryKey)
                return (
                  <div
                    key={library.id}
                    ref={(el) => {
                      if (el) libraryRefs.current.set(library.id, el)
                      else libraryRefs.current.delete(library.id)
                    }}
                    tabIndex={0}
                    role="button"
                    onClick={() => {
                      onSelect()
                      if (newItemCount) {
                        onClearNewItems(libraryKey)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect()
                        if (newItemCount) {
                          onClearNewItems(libraryKey)
                        }
                      }
                    }}
                    className="px-2 py-1.5 bg-muted/30 rounded group cursor-pointer hover:bg-muted/50 transition-colors focus:outline-none"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <LibraryIcon type={library.type} />
                        <span className="text-xs truncate">{library.name}</span>
                        {newItemCount && !isQueueScanning && !isQueued && (
                          <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                            +{newItemCount}
                          </span>
                        )}
                        {isQueued && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>#{queueStatus.queuePosition}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!showScanningUI && !isQueued && lastScan && (
                          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                            {lastScan}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onScanLibrary(library.id, library.type)
                          }}
                          disabled={!!scanningLibraryId || isQueueScanning || isQueued}
                          className={`p-1.5 text-muted-foreground hover:text-foreground transition-opacity disabled:opacity-50 rounded focus:outline-none focus:ring-2 focus:ring-primary ${showScanningUI ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                          title={lastScan ? `Last scanned: ${lastScan}` : 'Never scanned'}
                          aria-label={showScanningUI ? `Scanning ${library.name}` : `Scan ${library.name} library`}
                        >
                          <RefreshCw className={`w-3 h-3 ${showScanningUI ? 'animate-spin' : ''}`} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    {/* Show scanning UI for task queue scans */}
                    {isQueueScanning && queueProgress && (
                      <div className="mt-1.5">
                        <div className="flex items-center gap-1">
                          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${queueProgress.percentage || 0}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          <span className="font-medium">Scanning:</span>{' '}
                          {queueProgress.percentage?.toFixed(0) || 0}%
                          {queueProgress.currentItem && (
                            <span> • {queueProgress.currentItem}</span>
                          )}
                        </div>
                      </div>
                    )}
                    {isQueueScanning && !queueProgress && (
                      <div className="mt-1.5">
                        <div className="text-xs text-muted-foreground truncate">
                          <span className="font-medium">Scanning...</span>
                        </div>
                      </div>
                    )}
                    {/* Show scanning UI for manual scans (original code) */}
                    {isScanning && !isQueueScanning && (
                      <div className="mt-1.5">
                        {(scanPhase === 'scanning' && progress) || (scanPhase === 'analyzing' && analysisProgress) ? (
                          <>
                            <div className="flex items-center gap-1">
                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary transition-all"
                                  style={{ width: `${(scanPhase === 'scanning' ? progress?.percentage : analysisProgress?.percentage) || 0}%` }}
                                />
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onStopScan()
                                }}
                                className="p-0.5 text-muted-foreground hover:text-red-500 transition-colors rounded"
                                title="Stop scan"
                                aria-label="Stop scan"
                              >
                                <Square className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              <span className="font-medium">
                                {scanPhase === 'scanning' ? 'Scanning' : 'Analyzing Quality'}:
                              </span>{' '}
                              {(scanPhase === 'scanning' ? progress?.percentage : analysisProgress?.percentage)?.toFixed(0) || 0}%
                              {scanPhase === 'scanning' && progress?.currentItem && (
                                <span> • {progress.currentItem}</span>
                              )}
                              {scanPhase === 'analyzing' && analysisProgress && (
                                <span> • {analysisProgress.current}/{analysisProgress.total}</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-1">
                            <div className="flex-1 text-xs text-muted-foreground truncate">
                              <span className="font-medium">
                                {scanPhase === 'scanning' ? 'Scanning...' : 'Analyzing Quality...'}
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onStopScan()
                              }}
                              className="p-0.5 text-muted-foreground hover:text-red-500 transition-colors rounded"
                              title="Stop scan"
                              aria-label="Stop scan"
                            >
                              <Square className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!isLoadingLibraries && !isManaging && !progress && libraries.length === 0 && (
            <div className="text-xs text-muted-foreground px-2">No libraries enabled</div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-1 mt-2 justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); onScanAll() }}
              disabled={libraries.length === 0}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              title="Scan & Analyze All Libraries"
              aria-label="Scan and analyze all libraries"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              ref={manageButtonRef}
              onClick={(e) => { e.stopPropagation(); onManageLibraries() }}
              className={`p-2 rounded transition-colors focus:outline-none ${
                isManaging
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
              aria-label={isManaging ? 'Done managing libraries' : 'Manage libraries'}
              title={isManaging ? 'Done' : 'Libraries'}
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              ref={renameButtonRef}
              onClick={(e) => { e.stopPropagation(); onStartRename() }}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors focus:outline-none"
              aria-label={`Rename ${source.display_name}`}
              title="Rename"
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              ref={deleteButtonRef}
              onClick={handleDeleteClick}
              disabled={isDeleting}
              className={`p-2 rounded transition-colors focus:outline-none disabled:opacity-50 ${
                confirmDelete
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
              }`}
              aria-label={confirmDelete ? `Confirm remove ${source.display_name}` : `Remove ${source.display_name}`}
              title={confirmDelete ? 'Confirm?' : 'Remove'}
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
