/**
 * LocalFolderFlow Component
 *
 * UI flow for adding a local folder as a media source.
 * Auto-detects subfolders and their media types.
 */

import { useState, useEffect } from 'react'
import { useSources } from '../../contexts/SourceContext'
import { Film, Tv, Music, HelpCircle } from 'lucide-react'

interface LocalFolderFlowProps {
  onSuccess: () => void
  onBack: () => void
}

interface DetectedLibrary {
  name: string
  path: string
  suggestedType: 'movies' | 'tvshows' | 'music' | 'unknown'
  selectedType: 'movies' | 'tvshows' | 'music'
  enabled: boolean
}

// Known folder name patterns
const MOVIE_PATTERNS = ['movies', 'films', 'movie', 'film']
const TV_PATTERNS = ['tv shows', 'tv', 'shows', 'series', 'television', 'tvshows']
const MUSIC_PATTERNS = ['music', 'audio', 'songs', 'albums', 'artists']

function detectMediaType(folderName: string): 'movies' | 'tvshows' | 'music' | 'unknown' {
  const lower = folderName.toLowerCase()
  if (MOVIE_PATTERNS.includes(lower)) return 'movies'
  if (TV_PATTERNS.includes(lower)) return 'tvshows'
  if (MUSIC_PATTERNS.includes(lower)) return 'music'
  return 'unknown'
}

export function LocalFolderFlow({ onSuccess, onBack }: LocalFolderFlowProps) {
  const { refreshSources } = useSources()

  // Folder selection state
  const [folderPath, setFolderPath] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ffprobeAvailable, setFfprobeAvailable] = useState<boolean | null>(null)

  // Library detection state
  const [libraries, setLibraries] = useState<DetectedLibrary[]>([])
  const [isDetecting, setIsDetecting] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [isSingleLibrary, setIsSingleLibrary] = useState(false)

  // Check FFprobe availability on mount
  useEffect(() => {
    checkFFprobe()
  }, [])

  const checkFFprobe = async () => {
    try {
      const available = await window.electronAPI.ffprobeIsAvailable()
      setFfprobeAvailable(available)
    } catch {
      setFfprobeAvailable(false)
    }
  }

  const handleSelectFolder = async () => {
    try {
      const result = await window.electronAPI.localSelectFolder()
      if (!result.cancelled && result.folderPath) {
        setFolderPath(result.folderPath)
        setError(null)
        setLibraries([])
        setIsSingleLibrary(false)

        // Auto-set display name from folder name
        const folderName = result.folderPath.split(/[/\\]/).pop() || 'Local Folder'
        setDisplayName(folderName)

        // Check if the folder itself is a known media type
        const folderMediaType = detectMediaType(folderName)

        if (folderMediaType !== 'unknown') {
          // The folder itself is a media library (e.g., "Movies" or "TV Shows")
          setIsSingleLibrary(true)
          setLibraries([{
            name: folderName,
            path: result.folderPath,
            suggestedType: folderMediaType,
            selectedType: folderMediaType,
            enabled: true,
          }])
        } else {
          // Detect subfolders
          await detectSubfolders(result.folderPath)
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to select folder')
    }
  }

  const detectSubfolders = async (path: string) => {
    setIsDetecting(true)
    setError(null)

    try {
      const result = await window.electronAPI.localDetectSubfolders(path)

      if (result.error) {
        setError(result.error)
        return
      }

      if (result.subfolders.length === 0) {
        setError('No subfolders found. Select a folder containing media libraries (e.g., Movies, TV Shows, Music folders).')
        return
      }

      // Convert to DetectedLibrary with user-editable fields
      const detected: DetectedLibrary[] = result.subfolders.map(sf => ({
        name: sf.name,
        path: sf.path,
        suggestedType: sf.suggestedType,
        selectedType: sf.suggestedType === 'unknown' ? 'movies' : sf.suggestedType,
        // Auto-enable folders with known types
        enabled: sf.suggestedType !== 'unknown',
      }))

      setLibraries(detected)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to detect subfolders')
    } finally {
      setIsDetecting(false)
    }
  }

  const handleAdd = async () => {
    if (!displayName.trim()) {
      setError('Please enter a display name')
      return
    }

    const enabledLibraries = libraries.filter(lib => lib.enabled)

    if (enabledLibraries.length === 0) {
      setError('Please select at least one library')
      return
    }

    setIsAdding(true)
    setError(null)

    try {
      // If single library (folder itself is media type), use simple add
      if (isSingleLibrary && enabledLibraries.length === 1) {
        const lib = enabledLibraries[0]
        const result = await window.electronAPI.localAddSource({
          folderPath: lib.path,
          displayName: displayName.trim(),
          mediaType: lib.selectedType,
        })

        await refreshSources()

        // Queue library scan
        const sourceId = result.source_id
        const sourceLibraries = await window.electronAPI.sourcesGetLibraries(sourceId)
        for (const srcLib of sourceLibraries) {
          try {
            const taskType = srcLib.type === 'music' ? 'music-scan' : 'library-scan'
            await window.electronAPI.taskQueueAddTask({
              type: taskType,
              label: `Scan ${srcLib.name} (${displayName.trim()})`,
              sourceId,
              libraryId: srcLib.id,
            })
          } catch (err) {
            console.error('Failed to queue library scan:', err)
          }
        }
      } else {
        // Multiple libraries - use custom library config
        const result = await window.electronAPI.localAddSourceWithLibraries({
          folderPath,
          displayName: displayName.trim(),
          libraries: enabledLibraries.map(lib => ({
            name: lib.name,
            path: lib.path,
            mediaType: lib.selectedType,
            enabled: true,
          })),
        })

        await refreshSources()

        // Queue library scans for selected libraries
        const sourceId = result.source_id
        const sourceLibraries = await window.electronAPI.sourcesGetLibraries(sourceId)

        for (const srcLib of sourceLibraries) {
          try {
            const taskType = srcLib.type === 'music' ? 'music-scan' : 'library-scan'
            await window.electronAPI.taskQueueAddTask({
              type: taskType,
              label: `Scan ${srcLib.name} (${displayName.trim()})`,
              sourceId,
              libraryId: srcLib.id,
            })
          } catch (err) {
            console.error('Failed to queue library scan:', err)
          }
        }
      }

      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add source')
    } finally {
      setIsAdding(false)
    }
  }

  const toggleLibrary = (index: number) => {
    setLibraries(prev => prev.map((lib, i) =>
      i === index ? { ...lib, enabled: !lib.enabled } : lib
    ))
  }

  const setLibraryType = (index: number, type: 'movies' | 'tvshows' | 'music') => {
    setLibraries(prev => prev.map((lib, i) =>
      i === index ? { ...lib, selectedType: type } : lib
    ))
  }

  const handleSelectAll = () => {
    setLibraries(prev => prev.map(lib => ({ ...lib, enabled: true })))
  }

  const handleDeselectAll = () => {
    setLibraries(prev => prev.map(lib => ({ ...lib, enabled: false })))
  }

  const getTypeIcon = (type: 'movies' | 'tvshows' | 'music' | 'unknown') => {
    switch (type) {
      case 'movies': return <Film className="w-4 h-4" />
      case 'tvshows': return <Tv className="w-4 h-4" />
      case 'music': return <Music className="w-4 h-4" />
      default: return <HelpCircle className="w-4 h-4" />
    }
  }

  const enabledCount = libraries.filter(lib => lib.enabled).length
  const hasLibraries = libraries.length > 0

  return (
    <div className="space-y-3">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* FFprobe warning */}
      {ffprobeAvailable === false && (
        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs text-amber-500">
            FFprobe is not installed. Quality data will be limited without file analysis.
          </p>
        </div>
      )}

      {/* Folder selection */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Folder</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={folderPath}
            readOnly
            placeholder="Select a folder..."
            className="flex-1 px-2 py-1.5 text-sm bg-muted border border-border rounded outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleSelectFolder}
            disabled={isDetecting}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isDetecting ? 'Detecting...' : 'Browse'}
          </button>
        </div>
      </div>

      {/* Display name */}
      {hasLibraries && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My Media Library"
            className="w-full px-2 py-1.5 text-sm bg-muted border border-border rounded outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}

      {/* Library selection */}
      {hasLibraries && !isSingleLibrary && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Select Libraries</h3>
              <p className="text-xs text-muted-foreground">
                Found {libraries.length} subfolders
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              <button onClick={handleSelectAll} className="text-primary hover:underline">
                Select All
              </button>
              <span className="text-muted-foreground">|</span>
              <button onClick={handleDeselectAll} className="text-primary hover:underline">
                Deselect All
              </button>
            </div>
          </div>

          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {libraries.map((lib, index) => (
              <div
                key={lib.path}
                className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                  lib.enabled
                    ? 'bg-primary/5 border-primary/30'
                    : 'bg-muted/30 border-border hover:border-border/80'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleLibrary(index)}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                    lib.enabled
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {lib.enabled && (
                    <svg className="w-3 h-3 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                {/* Icon */}
                <span className={`flex-shrink-0 ${lib.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {getTypeIcon(lib.selectedType)}
                </span>

                {/* Name */}
                <span className={`flex-1 text-sm truncate ${lib.enabled ? '' : 'text-muted-foreground'}`}>
                  {lib.name}
                </span>

                {/* Type selector */}
                <select
                  value={lib.selectedType}
                  onChange={(e) => setLibraryType(index, e.target.value as 'movies' | 'tvshows' | 'music')}
                  className="text-xs bg-muted border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="movies">Movies</option>
                  <option value="tvshows">TV Shows</option>
                  <option value="music">Music</option>
                </select>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Assign each folder a media type. Only selected folders will be scanned.
          </p>
        </>
      )}

      {/* Single library message */}
      {hasLibraries && isSingleLibrary && (
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/30">
          <div className="flex items-center gap-3">
            <span className="text-foreground">
              {getTypeIcon(libraries[0].selectedType)}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium">{libraries[0].name}</p>
              <p className="text-xs text-muted-foreground">
                Detected as {libraries[0].selectedType === 'movies' ? 'Movies' : libraries[0].selectedType === 'tvshows' ? 'TV Shows' : 'Music'} library
              </p>
            </div>
            <select
              value={libraries[0].selectedType}
              onChange={(e) => setLibraryType(0, e.target.value as 'movies' | 'tvshows' | 'music')}
              className="text-xs bg-muted border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="movies">Movies</option>
              <option value="tvshows">TV Shows</option>
              <option value="music">Music</option>
            </select>
          </div>
        </div>
      )}

      {/* Info box - only show when no folder selected */}
      {!hasLibraries && !error && (
        <div className="p-2 rounded bg-muted/50 border border-border/50">
          <p className="text-xs text-muted-foreground">
            Select a folder containing your media libraries. Totality will auto-detect subfolders named Movies, TV Shows, Music, etc. and let you choose which to include.
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-2 rounded bg-destructive/10 border border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Add button */}
      {hasLibraries && (
        <button
          onClick={handleAdd}
          disabled={isAdding || enabledCount === 0}
          className="w-full py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isAdding
            ? 'Adding...'
            : enabledCount === 0
              ? 'Select at least one library'
              : isSingleLibrary
                ? 'Add Library'
                : `Add ${enabledCount} ${enabledCount === 1 ? 'Library' : 'Libraries'}`
          }
        </button>
      )}
    </div>
  )
}
