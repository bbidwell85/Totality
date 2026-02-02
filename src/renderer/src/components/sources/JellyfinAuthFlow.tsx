/**
 * JellyfinAuthFlow Component
 *
 * Handles authentication for Jellyfin and Emby servers.
 */

import { useState, useEffect } from 'react'
import { Film, Tv, Music, Folder, Server, ChevronRight } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'

interface JellyfinAuthFlowProps {
  onSuccess: () => void
  onBack: () => void
  isEmby?: boolean
}

interface DiscoveredServer {
  id: string
  name: string
  address: string
}

type Step = 'discover' | 'server-select' | 'auth-method' | 'libraries'

interface MediaLibrary {
  id: string
  name: string
  type: 'movie' | 'show' | 'music' | 'unknown'
  itemCount?: number
}

export function JellyfinAuthFlow({ onSuccess, onBack, isEmby = false }: JellyfinAuthFlowProps) {
  const { getLibraries, refreshSources } = useSources()

  const [step, setStep] = useState<Step>('discover')
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([])
  const [manualUrl, setManualUrl] = useState('')
  const [isTestingUrl, setIsTestingUrl] = useState(false)
  const [selectedServer, setSelectedServer] = useState<{ url: string; name: string } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [libraries, setLibraries] = useState<MediaLibrary[]>([])
  const [selectedLibraries, setSelectedLibraries] = useState<Set<string>>(new Set())

  const providerName = isEmby ? 'Emby' : 'Jellyfin'
  // Emby uses green branding, Jellyfin uses purple
  const serverIconColor = isEmby ? 'bg-green-500' : 'bg-purple-500'

  useEffect(() => {
    // Auto-discover on mount for both Jellyfin and Emby
    handleDiscover()
  }, [isEmby])

  const handleDiscover = async () => {
    setIsDiscovering(true)
    setError(null)
    try {
      // Use the appropriate discovery service based on provider type
      const servers = isEmby
        ? await window.electronAPI.embyDiscoverServers()
        : await window.electronAPI.jellyfinDiscoverServers()
      setDiscoveredServers(servers)
      if (servers.length === 1) {
        handleSelectServer(servers[0].address, servers[0].name)
      } else if (servers.length > 0) {
        setStep('server-select')
      }
    } catch (err: any) {
      console.error('Discovery failed:', err)
    } finally {
      setIsDiscovering(false)
    }
  }

  const handleTestManualUrl = async () => {
    if (!manualUrl.trim()) {
      setError('Please enter a server URL')
      return
    }
    setIsTestingUrl(true)
    setError(null)
    try {
      const url = manualUrl.trim().replace(/\/$/, '')
      // Use the appropriate test endpoint based on provider type
      const result = isEmby
        ? await window.electronAPI.embyTestServerUrl(url)
        : await window.electronAPI.jellyfinTestServerUrl(url)
      if (result.success) {
        handleSelectServer(url, result.serverName || providerName)
      } else {
        setError(result.error || 'Could not connect to server')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect')
    } finally {
      setIsTestingUrl(false)
    }
  }

  const handleSelectServer = async (url: string, name: string) => {
    setSelectedServer({ url, name })
    setDisplayName(name)
    // Both Jellyfin and Emby now use API key authentication
    setStep('auth-method')
  }

  const handleApiKeyAuth = async () => {
    if (!selectedServer) return
    if (!apiKey.trim()) {
      setError('API key is required')
      return
    }
    setError(null)
    setIsConnecting(true)
    try {
      // Use the appropriate API key auth endpoint based on provider type
      const result = isEmby
        ? await window.electronAPI.embyAuthenticateApiKey(
            selectedServer.url,
            apiKey.trim(),
            displayName.trim() || selectedServer.name
          )
        : await window.electronAPI.jellyfinAuthenticateApiKey(
            selectedServer.url,
            apiKey.trim(),
            displayName.trim() || selectedServer.name
          )
      if (!result.success || !result.source) {
        throw new Error(result.error || 'Authentication failed')
      }

      // Store source ID and fetch libraries
      setSourceId(result.source.source_id)
      const libs = await getLibraries(result.source.source_id)
      setLibraries(libs)
      setSelectedLibraries(new Set(libs.map(lib => lib.id)))
      setStep('libraries')
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

    // Get the server name for task labels
    const serverName = selectedServer?.name || providerName

    // Queue library scans for all selected libraries
    for (const lib of libraries.filter(l => selectedLibraries.has(l.id))) {
      try {
        const taskType = lib.type === 'music' ? 'music-scan' : 'library-scan'
        await window.electronAPI.taskQueueAddTask({
          type: taskType,
          label: `Scan ${lib.name} (${serverName})`,
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

  // Libraries selection
  if (step === 'libraries') {
    return (
      <div className="space-y-4">
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

  // Auth method - API key authentication
  if (step === 'auth-method') {
    return (
      <div className="space-y-4">
        {selectedServer && (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className={`w-10 h-10 ${serverIconColor} rounded-lg flex items-center justify-center text-white flex-shrink-0`}>
              <Server className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{selectedServer.name}</div>
              <div className="text-xs text-muted-foreground truncate">{selectedServer.url}</div>
            </div>
            <button onClick={() => setStep('discover')} className="text-xs text-primary hover:underline">Change</button>
          </div>
        )}

        <label className="block">
          <span className="text-sm font-medium">Display Name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={selectedServer?.name || `My ${providerName}`}
            className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
          />
        </label>

        {/* Both Jellyfin and Emby use API key authentication */}
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {isEmby
              ? 'Find your API key in Emby Dashboard → Advanced → API Keys'
              : 'Find your API key in Jellyfin Dashboard → Advanced → API Keys'}
          </p>
        </div>

        {error && <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

        <div className="flex gap-2">
          <button onClick={onBack} disabled={isConnecting} className="flex-1 px-4 py-2 rounded-md border border-border hover:bg-muted disabled:opacity-50">
            Back
          </button>
          <button
            onClick={handleApiKeyAuth}
            disabled={isConnecting}
            className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    )
  }

  // Discovery
  return (
    <div className="space-y-4">
      {discoveredServers.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Found on your network</span>
            <button onClick={handleDiscover} disabled={isDiscovering} className="text-xs text-primary hover:underline disabled:opacity-50">
              {isDiscovering ? 'Scanning...' : 'Rescan'}
            </button>
          </div>
          <div className="space-y-2">
            {discoveredServers.map((server) => (
              <button
                key={server.id}
                onClick={() => handleSelectServer(server.address, server.name)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/50 transition-colors text-left"
              >
                <div className={`w-10 h-10 ${serverIconColor} rounded-lg flex items-center justify-center text-white flex-shrink-0`}>
                  <Server className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{server.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{server.address}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </button>
            ))}
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-background px-2 text-muted-foreground">or</span></div>
          </div>
        </>
      )}

      {discoveredServers.length === 0 && !isDiscovering && (
        <div className="bg-muted/50 rounded-lg p-4 text-sm">
          <p className="text-muted-foreground">
            No {providerName} servers found on your network. Enter address below.
          </p>
        </div>
      )}

      {isDiscovering && discoveredServers.length === 0 && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent mb-4" />
          <p className="text-sm text-muted-foreground">Searching for {providerName} servers...</p>
        </div>
      )}

      <label className="block">
        <span className="text-sm font-medium">Server URL</span>
        <div className="mt-1 flex gap-2">
          <input
            type="url"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="http://192.168.1.100:8096"
            className="flex-1 px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleTestManualUrl()}
          />
          <button
            onClick={handleTestManualUrl}
            disabled={isTestingUrl || !manualUrl.trim()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isTestingUrl ? '...' : 'Connect'}
          </button>
        </div>
      </label>

      {error && <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

      <button onClick={onBack} className="w-full px-4 py-2 rounded-md border border-border hover:bg-muted">
        Back
      </button>
    </div>
  )
}
