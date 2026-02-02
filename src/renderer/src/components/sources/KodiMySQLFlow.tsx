/**
 * KodiMySQLFlow Component
 *
 * Handles MySQL/MariaDB connection to Kodi shared database.
 * This is the preferred method for multi-device Kodi setups.
 */

import { useState } from 'react'
import { Film, Tv, Music, Folder, Database, Server, AlertCircle, CheckCircle } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'

interface KodiMySQLFlowProps {
  onSuccess: () => void
  onBack: () => void
}

interface MediaLibrary {
  id: string
  name: string
  type: 'movie' | 'show' | 'music' | 'unknown'
  itemCount?: number
}

type Step = 'connect' | 'libraries'

export function KodiMySQLFlow({ onSuccess, onBack }: KodiMySQLFlowProps) {
  const { getLibraries, refreshSources } = useSources()

  // Connection form state
  const [step, setStep] = useState<Step>('connect')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('3306')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('Kodi (MySQL)')
  const [databasePrefix, setDatabasePrefix] = useState('kodi_')
  const [useSSL, setUseSSL] = useState(false)

  // Connection test state
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    serverVersion?: string
    videoDatabaseName?: string
    videoDatabaseVersion?: number
    musicDatabaseName?: string
    musicDatabaseVersion?: number
    latencyMs?: number
    error?: string
  } | null>(null)

  // Connection state
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Library selection state
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [libraries, setLibraries] = useState<MediaLibrary[]>([])
  const [selectedLibraries, setSelectedLibraries] = useState<Set<string>>(new Set())

  // Test connection
  const handleTestConnection = async () => {
    if (!host.trim()) {
      setError('Host is required')
      return
    }
    if (!username.trim()) {
      setError('Username is required')
      return
    }

    setIsTesting(true)
    setError(null)
    setTestResult(null)

    try {
      const result = await window.electronAPI.kodiTestMySQLConnection({
        host: host.trim(),
        port: parseInt(port, 10) || 3306,
        username: username.trim(),
        password: password,
        databasePrefix: databasePrefix.trim() || 'kodi_',
        ssl: useSSL,
        connectionTimeout: 10000,
      })

      setTestResult(result)

      if (!result.success) {
        setError(result.error || 'Connection failed')
      }
    } catch (err: any) {
      setError(err.message || 'Connection test failed')
    } finally {
      setIsTesting(false)
    }
  }

  // Connect and add source
  const handleConnect = async () => {
    if (!testResult?.success || !testResult.videoDatabaseName) {
      setError('Please test the connection first')
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      const result = await window.electronAPI.kodiAuthenticateMySQL({
        host: host.trim(),
        port: parseInt(port, 10) || 3306,
        username: username.trim(),
        password: password,
        displayName: displayName.trim() || 'Kodi (MySQL)',
        videoDatabaseName: testResult.videoDatabaseName,
        musicDatabaseName: testResult.musicDatabaseName || undefined,
        databasePrefix: databasePrefix.trim() || 'kodi_',
        ssl: useSSL,
      })

      if (!result.success || !result.source) {
        throw new Error(result.error || 'Failed to add source')
      }

      // Store source ID and fetch libraries
      setSourceId(result.source.source_id)
      const libs = await getLibraries(result.source.source_id)
      setLibraries(libs)
      setSelectedLibraries(new Set(libs.map(lib => lib.id)))
      setStep('libraries')
    } catch (err: any) {
      setError(err.message || 'Connection failed')
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
    const sourceName = displayName.trim() || 'Kodi (MySQL)'

    // Queue library scans for all selected libraries
    for (const lib of libraries.filter(l => selectedLibraries.has(l.id))) {
      try {
        const taskType = lib.type === 'music' ? 'music-scan' : 'library-scan'
        await window.electronAPI.taskQueueAddTask({
          type: taskType,
          label: `Scan ${lib.name} (${sourceName})`,
          sourceId,
          libraryId: lib.id,
        })
      } catch (err) {
        console.error('Failed to queue library scan:', err)
      }
    }

    // Complete the flow
    onSuccess()
  }

  // Libraries selection step
  if (step === 'libraries') {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-green-500/20 text-green-500 rounded-full mb-3">
            <CheckCircle className="w-6 h-6" />
          </div>
          <p className="font-medium">Connected to Kodi MySQL!</p>
          <p className="text-sm text-muted-foreground mt-1">
            {testResult?.serverVersion}
          </p>
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
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {libraries.map(lib => (
                <label
                  key={lib.id}
                  className="flex items-center gap-3 py-2 cursor-pointer hover:bg-muted/30 rounded transition-colors"
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    selectedLibraries.has(lib.id)
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground'
                  }`}>
                    {selectedLibraries.has(lib.id) && (
                      <svg className="w-3 h-3 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedLibraries.has(lib.id)}
                    onChange={() => handleToggleLibrary(lib.id)}
                    className="sr-only"
                  />
                  <span className="text-muted-foreground">
                    {lib.type === 'movie' ? <Film className="w-5 h-5" /> : lib.type === 'show' ? <Tv className="w-5 h-5" /> : lib.type === 'music' ? <Music className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
                  </span>
                  <span className="text-sm flex-1">{lib.name}</span>
                  {lib.itemCount !== undefined && (
                    <span className="text-xs text-muted-foreground">({lib.itemCount} items)</span>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Only selected libraries will appear in your media browser. You can change this later.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleComplete}
            disabled={selectedLibraries.size === 0}
            className="px-6 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {selectedLibraries.size === 0 ? 'Select at least one library' : 'Done'}
          </button>
        </div>
      </div>
    )
  }

  // Connection form
  return (
    <div className="space-y-4">
      {/* Info box */}
      <div className="p-3 bg-muted/50 rounded-lg text-sm">
        <p className="font-medium mb-1 flex items-center gap-2">
          <Database className="w-4 h-4 text-foreground" />
          MySQL/MariaDB Shared Database
        </p>
        <p className="text-xs text-muted-foreground">
          Connect to a Kodi shared database for multi-device setups.
        </p>
      </div>

      {/* Display name */}
      <label className="block">
        <span className="text-sm font-medium">Display Name</span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Kodi (MySQL)"
          className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
        />
      </label>

      {/* Host and Port */}
      <div className="grid grid-cols-3 gap-2">
        <label className="block col-span-2">
          <span className="text-sm font-medium">Host</span>
          <input
            type="text"
            value={host}
            onChange={(e) => {
              setHost(e.target.value)
              setTestResult(null)
            }}
            placeholder="192.168.1.100 or localhost"
            className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Port</span>
          <input
            type="number"
            value={port}
            onChange={(e) => {
              setPort(e.target.value)
              setTestResult(null)
            }}
            placeholder="3306"
            min="1"
            max="65535"
            className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
          />
        </label>
      </div>

      {/* Username and Password */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm font-medium">Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setTestResult(null)
            }}
            placeholder="kodi"
            className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setTestResult(null)
            }}
            placeholder="Enter password"
            className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
          />
        </label>
      </div>

      {/* Advanced options */}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Advanced options
        </summary>
        <div className="mt-2 space-y-2 pl-2 border-l-2 border-border">
          <label className="block">
            <span className="text-sm font-medium">Database Prefix</span>
            <input
              type="text"
              value={databasePrefix}
              onChange={(e) => {
                setDatabasePrefix(e.target.value)
                setTestResult(null)
              }}
              placeholder="kodi_"
              className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Default: kodi_ (e.g., kodi_video121)
            </p>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useSSL}
              onChange={(e) => {
                setUseSSL(e.target.checked)
                setTestResult(null)
              }}
              className="w-4 h-4 rounded border-muted-foreground text-primary focus:ring-primary"
            />
            <span>Use SSL/TLS connection</span>
          </label>
        </div>
      </details>

      {/* Test connection button */}
      <button
        onClick={handleTestConnection}
        disabled={isTesting || !host.trim() || !username.trim()}
        className="w-full px-4 py-2 rounded-md border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
      >
        {isTesting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
            Testing connection...
          </>
        ) : (
          <>
            <Server className="w-4 h-4 text-foreground" />
            Test Connection
          </>
        )}
      </button>

      {/* Test result */}
      {testResult && (
        <div className={`p-3 rounded-lg text-sm ${
          testResult.success
            ? 'bg-green-500/10 border border-green-500/20'
            : 'bg-destructive/10 border border-destructive/20'
        }`}>
          {testResult.success ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-green-500 font-medium">
                <CheckCircle className="w-4 h-4" />
                Connection successful
              </div>
              <div className="text-muted-foreground space-y-1">
                <p>Server: {testResult.serverVersion}</p>
                {testResult.videoDatabaseName && (
                  <p>Video DB: {testResult.videoDatabaseName}</p>
                )}
                {testResult.musicDatabaseName && (
                  <p>Music DB: {testResult.musicDatabaseName}</p>
                )}
                {testResult.latencyMs !== undefined && (
                  <p>Latency: {testResult.latencyMs}ms</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-4 h-4" />
              {testResult.error || 'Connection failed'}
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && !testResult && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Connect button */}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          disabled={isConnecting}
          className="flex-1 px-4 py-2 rounded-md border border-border hover:bg-muted disabled:opacity-50 text-sm"
        >
          Back
        </button>
        <button
          onClick={handleConnect}
          disabled={isConnecting || !testResult?.success}
          className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {isConnecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
