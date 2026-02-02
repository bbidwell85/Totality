/**
 * KodiConnectionFlow Component
 *
 * Handles connection to Kodi:
 * - Auto-detects local Kodi installation and offers direct database access
 * - Supports MySQL/MariaDB shared database for multi-device setups
 */

import { useState, useEffect } from 'react'
import { Database, HardDrive, Film, Music } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'
import { KodiMySQLFlow } from './KodiMySQLFlow'

interface KodiConnectionFlowProps {
  onSuccess: () => void
  onBack: () => void
}

interface KodiLocalInstallation {
  path: string
  databasePath: string
  databaseVersion: number
  musicDatabasePath: string | null
  musicDatabaseVersion: number | null
  kodiRunning: boolean
}

interface MediaLibrary {
  id: string
  name: string
  type: 'movie' | 'show' | 'music' | 'unknown'
  itemCount?: number
}

type ConnectionMode = 'detecting' | 'select-mode' | 'local' | 'mysql' | 'libraries'

export function KodiConnectionFlow({ onSuccess, onBack }: KodiConnectionFlowProps) {
  const { addSource, testConnection, getLibraries, refreshSources } = useSources()

  // Detection state
  const [mode, setMode] = useState<ConnectionMode>('detecting')
  const [localInstallation, setLocalInstallation] = useState<KodiLocalInstallation | null>(null)

  // Local mode state
  const [localDisplayName, setLocalDisplayName] = useState('Kodi (Local)')
  const [includeVideoDb, setIncludeVideoDb] = useState(true)
  const [includeMusicDb, setIncludeMusicDb] = useState(true)

  // Common state
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  // Library selection state (setters kept for future library selection flow)
  const [sourceId, _setSourceId] = useState<string | null>(null)
  const [libraries, _setLibraries] = useState<MediaLibrary[]>([])
  const [selectedLibraries, setSelectedLibraries] = useState<Set<string>>(new Set())

  // Auto-detect local Kodi on mount
  useEffect(() => {
    detectLocalKodi()
  }, [])

  const detectLocalKodi = async () => {
    try {
      const installation = await window.electronAPI.kodiDetectLocal()
      setLocalInstallation(installation)

      if (installation && !installation.kodiRunning) {
        // Local installation found and Kodi not running - go directly to local mode
        setMode('local')
      } else {
        // No local installation or Kodi is running - show mode selection
        setMode('select-mode')
      }
    } catch (err) {
      console.error('Error detecting local Kodi:', err)
      setMode('select-mode')
    }
  }

  // Handle local connection
  const handleLocalConnect = async () => {
    if (!localInstallation) {
      setError('Local installation not detected')
      return
    }

    // At least one database must be selected
    if (!includeVideoDb && !includeMusicDb) {
      setError('Select at least one database')
      return
    }

    setError(null)
    setIsConnecting(true)

    try {
      // Add the source as kodi-local
      const source = await addSource({
        sourceType: 'kodi-local',
        displayName: localDisplayName.trim() || 'Kodi (Local)',
        connectionConfig: {
          databasePath: includeVideoDb ? localInstallation.databasePath : '',
          databaseVersion: includeVideoDb ? localInstallation.databaseVersion : 0,
          musicDatabasePath: includeMusicDb ? localInstallation.musicDatabasePath : null,
          musicDatabaseVersion: includeMusicDb ? localInstallation.musicDatabaseVersion : null,
          includeVideo: includeVideoDb,
          includeMusic: includeMusicDb,
        },
      })

      // Test connection
      const testResult = await testConnection(source.source_id)
      if (!testResult.success) {
        throw new Error(testResult.error || 'Connection failed')
      }

      // Get libraries and queue scans
      const libs = await getLibraries(source.source_id)
      const displayName = localDisplayName.trim() || 'Kodi (Local)'

      // Queue library scans for all libraries
      for (const lib of libs) {
        try {
          const taskType = lib.type === 'music' ? 'music-scan' : 'library-scan'
          await window.electronAPI.taskQueueAddTask({
            type: taskType,
            label: `Scan ${lib.name} (${displayName})`,
            sourceId: source.source_id,
            libraryId: lib.id,
          })
        } catch (err) {
          console.error('Failed to queue library scan:', err)
        }
      }

      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Failed to connect')
    } finally {
      setIsConnecting(false)
    }
  }

  // Toggle library selection
  const handleToggleLibrary = (libraryId: string) => {
    setSelectedLibraries(prev => {
      const next = new Set(prev)
      if (next.has(libraryId)) {
        next.delete(libraryId)
      } else {
        next.add(libraryId)
      }
      return next
    })
  }

  // Select/deselect all libraries
  const handleSelectAll = () => {
    setSelectedLibraries(new Set(libraries.map(lib => lib.id)))
  }

  const handleDeselectAll = () => {
    setSelectedLibraries(new Set())
  }

  // Complete setup with library selection
  const handleComplete = async () => {
    if (!sourceId) return

    // Save library selection
    try {
      await window.electronAPI.sourcesSetLibrariesEnabled(
        sourceId,
        libraries.map(lib => ({
          id: lib.id,
          name: lib.name,
          type: lib.type,
          enabled: selectedLibraries.has(lib.id)
        }))
      )
    } catch (err) {
      console.error('Failed to save library selection:', err)
    }

    // Refresh sources list now that setup is complete
    await refreshSources()

    // Get the display name for task labels
    const displayName = localDisplayName.trim() || 'Kodi (Local)'

    // Queue library scans for all selected libraries
    const selectedLibs = libraries.filter(l => selectedLibraries.has(l.id))
    for (const lib of selectedLibs) {
      try {
        const taskType = lib.type === 'music' ? 'music-scan' : 'library-scan'
        await window.electronAPI.taskQueueAddTask({
          type: taskType,
          label: `Scan ${lib.name} (${displayName})`,
          sourceId,
          libraryId: lib.id,
        })
      } catch (err) {
        console.error('Failed to queue library scan:', err)
      }
    }

    setIsSuccess(true)
  }

  // MySQL mode - delegate to KodiMySQLFlow
  if (mode === 'mysql') {
    return (
      <KodiMySQLFlow
        onSuccess={onSuccess}
        onBack={() => {
          setMode('select-mode')
        }}
      />
    )
  }

  // Libraries selection step
  if (mode === 'libraries') {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-green-500/20 text-green-500 rounded-full mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-medium">Connected to Kodi!</p>
        </div>

        {libraries.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Select libraries to include:</p>
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
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {libraries.map(lib => (
                <label
                  key={lib.id}
                  className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                    selectedLibraries.has(lib.id)
                      ? 'bg-blue-500/10 border border-blue-500/30'
                      : 'bg-muted/50 border border-transparent hover:bg-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedLibraries.has(lib.id)}
                    onChange={() => handleToggleLibrary(lib.id)}
                    className="w-4 h-4 rounded border-muted-foreground text-primary focus:ring-primary focus:ring-offset-0"
                  />
                  <span className="text-lg">
                    {lib.type === 'movie' ? '🎬' : lib.type === 'show' ? '📺' : lib.type === 'music' ? '🎵' : '📁'}
                  </span>
                  <span className="text-sm">{lib.name}</span>
                  {lib.itemCount !== undefined && (
                    <span className="text-xs text-muted-foreground">({lib.itemCount} items)</span>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Only selected libraries will appear in your media browser. You can change this later by expanding the source card.
            </p>
          </div>
        )}

        <button
          onClick={handleComplete}
          disabled={selectedLibraries.size === 0}
          className="w-full px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {selectedLibraries.size === 0 ? 'Select at least one library' : 'Continue'}
        </button>
      </div>
    )
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-green-500/20 text-green-500 rounded-full mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-medium">Connected to Kodi!</p>
          <p className="text-sm text-muted-foreground mt-1">
            Your Kodi installation has been added.
          </p>
        </div>

        <button
          onClick={onSuccess}
          className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Done
        </button>
      </div>
    )
  }

  // Detecting state
  if (mode === 'detecting') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-3 py-6">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm text-muted-foreground">Detecting local Kodi...</span>
        </div>

        <button
          onClick={onBack}
          className="w-full px-4 py-2 rounded-md border border-border hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    )
  }

  // Mode selection state (when no local installation or Kodi is running)
  if (mode === 'select-mode') {
    return (
      <div className="space-y-4">
        {/* Kodi running warning */}
        {localInstallation?.kodiRunning && (
          <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
            <svg className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-muted-foreground">
              Kodi is running. Close it for local database access.
            </span>
          </div>
        )}

        {/* No local installation notice */}
        {!localInstallation && (
          <div className="flex items-center gap-2 p-3 bg-muted/50 border border-border rounded-lg text-sm">
            <span className="text-muted-foreground">
              No local Kodi installation found. Choose a connection method:
            </span>
          </div>
        )}

        {/* Connection mode options */}
        <div className="space-y-2">
          {/* Local Database option - only show if local installation found */}
          {localInstallation && (
            <button
              onClick={() => setMode('local')}
              disabled={localInstallation.kodiRunning}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent"
            >
              <HardDrive className="w-5 h-5 text-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm flex items-center gap-2">
                  Local Database
                  <span className="text-xs text-green-500 font-normal">Found</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {localInstallation.databaseVersion > 0 && `MyVideos${localInstallation.databaseVersion}.db`}
                  {localInstallation.databaseVersion > 0 && localInstallation.musicDatabaseVersion && ' + '}
                  {localInstallation.musicDatabaseVersion && `MyMusic${localInstallation.musicDatabaseVersion}.db`}
                </div>
              </div>
            </button>
          )}

          <button
            onClick={() => setMode('mysql')}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/50 transition-colors text-left"
          >
            <Database className="w-5 h-5 text-foreground flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-medium text-sm">MySQL/MariaDB (Shared)</div>
              <div className="text-xs text-muted-foreground">Connect to shared database for multi-device setups</div>
            </div>
          </button>
        </div>

        <button
          onClick={onBack}
          className="w-full px-4 py-2 rounded-md border border-border hover:bg-muted"
        >
          Back
        </button>
      </div>
    )
  }

  // Local mode configuration
  if (mode === 'local' && localInstallation) {
    const hasVideoDb = localInstallation.databasePath && localInstallation.databaseVersion > 0
    const hasMusicDb = localInstallation.musicDatabasePath && localInstallation.musicDatabaseVersion

    return (
      <div className="space-y-4">
        {/* Database selection */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Select databases to access:</p>

          {/* Video database option */}
          {hasVideoDb && (
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                includeVideoDb
                  ? 'bg-primary border-primary'
                  : 'border-muted-foreground group-hover:border-foreground'
              }`}>
                {includeVideoDb && (
                  <svg className="w-3 h-3 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                checked={includeVideoDb}
                onChange={(e) => setIncludeVideoDb(e.target.checked)}
                className="sr-only"
              />
              <Film className="w-5 h-5 text-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">Movies & TV Shows</div>
                <div className="text-xs text-muted-foreground">
                  MyVideos{localInstallation.databaseVersion}.db
                </div>
              </div>
            </label>
          )}

          {/* Music database option */}
          {hasMusicDb && (
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                includeMusicDb
                  ? 'bg-primary border-primary'
                  : 'border-muted-foreground group-hover:border-foreground'
              }`}>
                {includeMusicDb && (
                  <svg className="w-3 h-3 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                checked={includeMusicDb}
                onChange={(e) => setIncludeMusicDb(e.target.checked)}
                className="sr-only"
              />
              <Music className="w-5 h-5 text-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">Music</div>
                <div className="text-xs text-muted-foreground">
                  MyMusic{localInstallation.musicDatabaseVersion}.db
                </div>
              </div>
            </label>
          )}

          {/* Show message if only one database found */}
          {!hasVideoDb && hasMusicDb && (
            <p className="text-xs text-muted-foreground">
              Only music database found. Video database (MyVideos*.db) not detected.
            </p>
          )}
          {hasVideoDb && !hasMusicDb && (
            <p className="text-xs text-muted-foreground">
              Only video database found. Music database (MyMusic*.db) not detected.
            </p>
          )}
        </div>

        {/* Display name */}
        <label className="block">
          <span className="text-sm font-medium">Display Name</span>
          <input
            type="text"
            value={localDisplayName}
            onChange={(e) => setLocalDisplayName(e.target.value)}
            placeholder="Kodi (Local)"
            className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </label>

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setMode('select-mode')
              setError(null)
            }}
            disabled={isConnecting}
            className="flex-1 px-4 py-2 rounded-md border border-border hover:bg-muted disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={handleLocalConnect}
            disabled={isConnecting || (!includeVideoDb && !includeMusicDb)}
            className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    )
  }

  // Fallback - shouldn't reach here
  return null
}
