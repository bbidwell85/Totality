import { useState, useCallback, useRef, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

interface MobileScanButtonProps {
  sources: Array<{ source_id: string; display_name: string; source_type: string }>
  activeSourceId: string | null
  currentLibraries: Array<{ id: string; name: string; type: string }>
  activeLibraryId: string | null
  viewType: 'movies' | 'tv' | 'music'
  isScanning: boolean
}

export function MobileScanButton({ sources, activeSourceId, currentLibraries, activeLibraryId, viewType: _viewType, isScanning }: MobileScanButtonProps) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside tap
  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    setTimeout(() => document.addEventListener('click', handler), 0)
    return () => document.removeEventListener('click', handler)
  }, [showMenu])

  const scanLibrary = useCallback(async (sourceId: string, libraryId: string, libraryName: string, sourceName: string, libraryType: string) => {
    const taskType = libraryType === 'music' ? 'music-scan' : 'library-scan'
    await window.electronAPI.taskQueueAddTask({
      type: taskType,
      label: `Scan ${libraryName} (${sourceName})`,
      sourceId,
      libraryId,
    })
    setShowMenu(false)
  }, [])

  const scanAllLibraries = useCallback(async () => {
    for (const source of sources) {
      try {
        const libs = await window.electronAPI.sourcesGetLibraries(source.source_id) as Array<{ id: string; name: string; type: string; enabled?: boolean }>
        for (const lib of libs.filter(l => l.enabled !== false)) {
          const taskType = lib.type === 'music' ? 'music-scan' : 'library-scan'
          await window.electronAPI.taskQueueAddTask({
            type: taskType,
            label: `Scan ${lib.name} (${source.display_name})`,
            sourceId: source.source_id,
            libraryId: lib.id,
          })
        }
      } catch (err) {
        console.error(`Failed to queue scans for ${source.display_name}:`, err)
      }
    }
    setShowMenu(false)
  }, [sources])

  // Find current source name
  const activeSource = sources.find(s => s.source_id === activeSourceId)
  const sourceName = activeSource?.display_name || 'Source'

  // If a specific library is selected, scan just that one. Otherwise show the current type's libraries.
  const targetLibraries = activeLibraryId
    ? currentLibraries.filter(l => l.id === activeLibraryId)
    : currentLibraries

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors ${isScanning ? 'text-foreground' : 'text-muted-foreground'}`}
        aria-label="Scan library"
      >
        <RefreshCw className={`w-5 h-5 ${isScanning ? 'animate-[spin_2s_linear_infinite]' : ''}`} />
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full mt-2 z-50 min-w-[200px] bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
          {/* Scan specific libraries */}
          {activeSourceId && targetLibraries.length > 0 && targetLibraries.map((lib) => (
            <button
              key={lib.id}
              onClick={() => scanLibrary(activeSourceId, lib.id, lib.name, sourceName, lib.type)}
              className="w-full px-4 py-3 min-h-[44px] text-left text-label transition-colors active:bg-muted/50"
            >
              Scan {lib.name}
            </button>
          ))}

          {/* Divider */}
          {activeSourceId && targetLibraries.length > 0 && (
            <div className="h-px bg-border" />
          )}

          {/* Scan all */}
          <button
            onClick={scanAllLibraries}
            className="w-full px-4 py-3 min-h-[44px] text-left text-label transition-colors active:bg-muted/50"
          >
            Scan all libraries
          </button>
        </div>
      )}
    </div>
  )
}
