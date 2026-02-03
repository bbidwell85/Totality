/**
 * TroubleshootTab - Live log viewer and export functionality
 *
 * Features:
 * - Real-time log display with virtualization for performance
 * - Filter by log level
 * - Auto-scroll (disables on manual scroll up, "Jump to latest" to re-enable)
 * - Export logs to file
 * - Clear logs
 * - Details panel for selected log
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { FixedSizeList as VirtualList } from 'react-window'
import {
  Loader2,
  Download,
  Trash2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  ChevronsDown,
  Bug,
  MessageSquareText,
} from 'lucide-react'

interface LogEntry {
  id: string
  timestamp: string
  level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  details?: string
}

type LogFilter = 'all' | 'verbose' | 'debug' | 'info' | 'warn' | 'error'

const LOG_ROW_HEIGHT = 28

export function TroubleshootTab() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [listHeight, setListHeight] = useState(300)
  const [verboseEnabled, setVerboseEnabled] = useState(false)
  const listRef = useRef<VirtualList>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastScrollOffset = useRef(0)
  const isAutoScrolling = useRef(false)

  // Compute filtered logs early so effects can use it
  const filteredLogs = useMemo(() => {
    let result = filter === 'all' ? logs : logs.filter((log) => log.level === filter)

    if (searchText.trim()) {
      const query = searchText.toLowerCase()
      result = result.filter(
        (log) =>
          log.message.toLowerCase().includes(query) ||
          log.source.toLowerCase().includes(query) ||
          log.details?.toLowerCase().includes(query)
      )
    }

    return result
  }, [logs, filter, searchText])

  // Load initial logs
  useEffect(() => {
    loadLogs()
  }, [])

  // Subscribe to new logs
  useEffect(() => {
    const cleanup = window.electronAPI.onNewLog?.((entry: LogEntry) => {
      setLogs((prev) => [...prev.slice(-1999), entry])
    })
    return () => cleanup?.()
  }, [])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && listRef.current && filteredLogs.length > 0) {
      isAutoScrolling.current = true
      listRef.current.scrollToItem(filteredLogs.length - 1, 'end')
      // Reset flag after scroll completes
      setTimeout(() => {
        isAutoScrolling.current = false
      }, 50)
    }
  }, [filteredLogs.length, autoScroll])

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(
    ({ scrollOffset }: { scrollOffset: number }) => {
      // If this is a programmatic scroll, ignore it
      if (isAutoScrolling.current) {
        lastScrollOffset.current = scrollOffset
        return
      }

      // If user scrolled up, disable auto-scroll
      if (scrollOffset < lastScrollOffset.current) {
        setAutoScroll(false)
      }

      lastScrollOffset.current = scrollOffset
    },
    []
  )

  // Jump to latest and re-enable auto-scroll
  const jumpToLatest = useCallback(() => {
    setAutoScroll(true)
    if (listRef.current && filteredLogs.length > 0) {
      listRef.current.scrollToItem(filteredLogs.length - 1, 'end')
    }
  }, [filteredLogs.length])

  // Measure container height with ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateHeight = () => {
      const height = container.clientHeight
      if (height > 0) {
        setListHeight(height)
      }
    }

    // Initial measurement
    updateHeight()

    // Watch for resize
    const observer = new ResizeObserver(updateHeight)
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  const loadLogs = async () => {
    try {
      const [entries, isVerbose] = await Promise.all([
        window.electronAPI.getLogs(2000),
        window.electronAPI.isVerboseLogging(),
      ])
      setLogs(entries)
      setVerboseEnabled(isVerbose)
    } catch (error) {
      console.error('Failed to load logs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClear = async () => {
    await window.electronAPI.clearLogs()
    setLogs([])
    setSelectedLogId(null)
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await window.electronAPI.exportLogs()
    } catch (error) {
      console.error('Failed to export logs:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const handleVerboseToggle = async () => {
    const newValue = !verboseEnabled
    setVerboseEnabled(newValue)
    await window.electronAPI.setVerboseLogging(newValue)
  }

  // Get selected log entry
  const selectedLog = useMemo(() => {
    if (!selectedLogId) return null
    return filteredLogs.find((l) => l.id === selectedLogId) || null
  }, [selectedLogId, filteredLogs])

  const getLevelIcon = useCallback((level: string) => {
    switch (level) {
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
      case 'warn':
        return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
      case 'info':
        return <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
      case 'debug':
        return <Bug className="w-3.5 h-3.5 text-purple-400 shrink-0" />
      case 'verbose':
        return <MessageSquareText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      default:
        return <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
    }
  }, [])

  const formatTime = useCallback((timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }, [])

  // Row renderer for virtualized list
  const LogRow = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const entry = filteredLogs[index]
      if (!entry) return null

      const isSelected = entry.id === selectedLogId

      return (
        <div style={style} className="px-2 py-0.5">
          <div
            className={`rounded h-full flex items-center gap-2 px-2 ${
              entry.details ? 'cursor-pointer hover:bg-white/5' : ''
            } ${isSelected ? 'ring-1 ring-primary' : ''}`}
            onClick={() => entry.details && setSelectedLogId(isSelected ? null : entry.id)}
          >
            {getLevelIcon(entry.level)}
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatTime(entry.timestamp)}
            </span>
            <span className="text-primary/70 shrink-0 text-xs max-w-[100px] truncate">
              {entry.source}
            </span>
            <span className="text-foreground flex-1 truncate text-xs">{entry.message}</span>
            {entry.details && (
              <span className="text-muted-foreground text-[10px] shrink-0">
                {isSelected ? '▼' : '▶'}
              </span>
            )}
          </div>
        </div>
      )
    },
    [filteredLogs, selectedLogId, getLevelIcon, formatTime]
  )

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="text-sm font-semibold">Application Logs</h3>

        <div className="flex items-center gap-2">
          {/* Search input */}
          <input
            type="text"
            placeholder="Search logs..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="bg-muted text-foreground text-sm rounded-md px-3 py-1.5 w-44 border border-border focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
          />

          {/* Filter dropdown */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as LogFilter)}
            className="bg-muted text-foreground text-sm rounded-md px-3 py-1.5 border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">All Levels</option>
            <option value="verbose">Verbose</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
          </select>

          {/* Verbose mode toggle */}
          <label className="flex items-center gap-2 cursor-pointer" title="Enable verbose logging for detailed operational logs">
            <input
              type="checkbox"
              checked={verboseEnabled}
              onChange={handleVerboseToggle}
              className="w-4 h-4 rounded border-border bg-muted text-primary focus:ring-primary focus:ring-offset-0"
            />
            <span className="text-sm text-muted-foreground">Verbose</span>
          </label>

          {/* Clear button */}
          <button
            onClick={handleClear}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Clear logs"
          >
            <Trash2 className="w-4 h-4" strokeWidth={2.5} />
          </button>

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={isExporting || logs.length === 0}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Export logs"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />
            ) : (
              <Download className="w-4 h-4" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      {/* Log viewer with virtualization - min-h-0 is critical for flex shrinking */}
      <div className="flex-1 min-h-0 bg-black/50 rounded-lg border border-border/30 font-mono overflow-hidden relative">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No logs to display
          </div>
        ) : (
          <>
            {/* Virtualized log list - absolute positioning to fill parent */}
            <div ref={containerRef} className="absolute inset-0 overflow-hidden">
              <VirtualList
                ref={listRef}
                height={listHeight}
                width="100%"
                itemCount={filteredLogs.length}
                itemSize={LOG_ROW_HEIGHT}
                className="scrollbar-visible"
                style={{ width: '100%' }}
                onScroll={handleScroll}
              >
                {LogRow}
              </VirtualList>
            </div>

            {/* Jump to latest button - overlay */}
            {!autoScroll && filteredLogs.length > 0 && (
              <button
                onClick={jumpToLatest}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all"
              >
                <ChevronsDown className="w-3.5 h-3.5" />
                Jump to latest
              </button>
            )}

            {/* Details panel - overlay at bottom */}
            {selectedLog?.details && (
              <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border/30 bg-black/95 h-[120px] overflow-y-auto">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20 sticky top-0 bg-black/95">
                  <span className="text-xs text-muted-foreground font-medium">Details</span>
                  <button
                    onClick={() => setSelectedLogId(null)}
                    className="p-0.5 rounded hover:bg-white/10"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <pre className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-all">
                  {selectedLog.details}
                </pre>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-border/30 shrink-0">
        <p className="text-xs text-muted-foreground">
          Logs are stored in memory and will be cleared when the app restarts. Export logs before
          closing the app to share with support.
        </p>
      </div>
    </div>
  )
}
