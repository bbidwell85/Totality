import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Bug } from 'lucide-react'

interface LogEntry {
  id: number
  level: 'log' | 'warn' | 'error'
  message: string
  time: string
}

const MAX_ENTRIES = 50
let entryId = 0

export function MobileDevLog() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const unreadRef = useRef(0)

  const addEntry = useCallback((level: LogEntry['level'], args: unknown[]) => {
    const message = args.map(a =>
      typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a)?.substring(0, 200) : String(a)
    ).join(' ')
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setEntries(prev => [...prev.slice(-(MAX_ENTRIES - 1)), { id: ++entryId, level, message, time }])
    unreadRef.current++
  }, [])

  useEffect(() => {
    const origLog = console.log
    const origWarn = console.warn
    const origError = console.error

    console.log = (...args: unknown[]) => { origLog.apply(console, args); addEntry('log', args) }
    console.warn = (...args: unknown[]) => { origWarn.apply(console, args); addEntry('warn', args) }
    console.error = (...args: unknown[]) => { origError.apply(console, args); addEntry('error', args) }

    return () => {
      console.log = origLog
      console.warn = origWarn
      console.error = origError
    }
  }, [addEntry])

  // Auto-scroll when expanded
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, expanded])

  if (dismissed) return null

  const levelColor = (level: LogEntry['level']) =>
    level === 'error' ? 'text-red-400' : level === 'warn' ? 'text-amber-400' : 'text-white/70'

  return (
    <div className="fixed z-[200]" style={{ bottom: '80px', right: '8px' }}>
      {expanded ? (
        <div className="w-[320px] max-h-[40vh] flex flex-col rounded-2xl bg-black/85 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <button onClick={() => setExpanded(false)} className="text-caption font-medium text-white/60">
              Dev logs ({entries.length})
            </button>
            <div className="flex gap-2">
              <button onClick={() => setEntries([])} className="text-micro text-white/40 min-h-[32px] px-2">
                Clear
              </button>
              <button onClick={() => setDismissed(true)} className="text-white/40 min-h-[32px] min-w-[32px] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* Log entries */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 overscroll-contain" style={{ maxHeight: '35vh' }}>
            {entries.length === 0 ? (
              <p className="text-micro text-white/30 text-center py-4">No logs yet</p>
            ) : entries.map(e => (
              <div key={e.id} className="flex gap-1.5 text-micro leading-relaxed">
                <span className="text-white/30 shrink-0">{e.time}</span>
                <span className={`break-all ${levelColor(e.level)}`}>{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setExpanded(true); unreadRef.current = 0 }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/70 backdrop-blur-xl border border-white/10 shadow-lg text-micro text-white/50 min-h-[36px]"
        >
          <Bug className="w-3.5 h-3.5" />
          Dev {entries.length > 0 ? `(${entries.length})` : ''}
        </button>
      )}
    </div>
  )
}
