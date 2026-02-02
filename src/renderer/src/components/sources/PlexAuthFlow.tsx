/**
 * PlexAuthFlow Component
 *
 * Handles the Plex OAuth authentication flow and server selection.
 */

import { useState, useEffect, useRef } from 'react'
import { Film, Tv, Music, Folder } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'
import type { ServerInstanceResponse, MediaLibraryResponse } from '../../../../preload/index'

interface PlexAuthFlowProps {
  onSuccess: () => void
  onBack: () => void
}

type Step = 'start' | 'authenticating' | 'servers' | 'libraries' | 'done'

const POLL_INTERVAL_MS = 2000

export function PlexAuthFlow({ onSuccess, onBack }: PlexAuthFlowProps) {
  const {
    plexStartAuth,
    plexCheckAuth,
    plexAuthenticateAndDiscover,
    plexSelectServer,
    refreshSources,
  } = useSources()

  const [step, setStep] = useState<Step>('start')
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [servers, setServers] = useState<ServerInstanceResponse[]>([])
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [libraries, setLibraries] = useState<MediaLibraryResponse[]>([])
  const [selectedLibraries, setSelectedLibraries] = useState<Set<string>>(new Set())
  const [sourceId, setSourceId] = useState<string | null>(null)

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // Start auth flow
  const handleStartAuth = async () => {
    setError(null)
    setStep('authenticating')

    try {
      const { pinId, authUrl: url } = await plexStartAuth()
      setAuthUrl(url)

      // Open auth URL in browser
      window.open(url, '_blank')

      // Start polling for auth completion
      pollIntervalRef.current = setInterval(async () => {
        try {
          const token = await plexCheckAuth(pinId)
          if (token) {
            // Stop polling
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current)
              pollIntervalRef.current = null
            }

            // Authenticate and get servers (display name will be set to actual server name when selected)
            const result = await plexAuthenticateAndDiscover(token, 'Plex Server')
            setServers(result.servers)
            setSourceId(result.source.source_id)
            setStep('servers')
          }
        } catch (err) {
          console.error('Error checking auth:', err)
        }
      }, POLL_INTERVAL_MS)

    } catch (err: any) {
      setError(err.message || 'Failed to start authentication')
      setStep('start')
    }
  }

  // Cancel polling
  const handleCancelAuth = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setStep('start')
  }

  // Select server
  const handleSelectServer = async (serverId: string) => {
    if (!sourceId) return

    setError(null)
    setSelectedServerId(serverId)

    try {
      const result = await plexSelectServer(sourceId, serverId)
      if (result.success) {
        const libs = result.libraries || []
        setLibraries(libs)
        // Select all libraries by default
        setSelectedLibraries(new Set(libs.map(lib => lib.id)))
        setStep('libraries')
      } else {
        setError('Failed to connect to server')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to select server')
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

  // Complete setup
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
    const serverName = servers.find(s => s.id === selectedServerId)?.name || 'Plex'

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

    setStep('done')
    onSuccess()
  }

  return (
    <div className="space-y-4">
      {/* Step: Start */}
      {step === 'start' && (
        <>
          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            <p className="font-medium mb-2">How it works:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Click "Sign in with Plex" below</li>
              <li>A browser window will open to plex.tv</li>
              <li>Sign in with your Plex account</li>
              <li>Return here to select your server</li>
            </ol>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onBack}
              className="flex-1 px-4 py-2 rounded-md border border-border hover:bg-muted"
            >
              Back
            </button>
            <button
              onClick={handleStartAuth}
              className="flex-1 px-4 py-2 rounded-md bg-[#e5a00d] text-white hover:bg-[#cc8f0c]"
            >
              Sign in with Plex
            </button>
          </div>
        </>
      )}

      {/* Step: Authenticating */}
      {step === 'authenticating' && (
        <>
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-[#e5a00d] border-t-transparent mb-4" />
            <p className="font-medium">Waiting for Plex sign in...</p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete the sign-in process in your browser
            </p>
          </div>

          {authUrl && (
            <div className="text-center">
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                Click here if the browser didn't open
              </a>
            </div>
          )}

          <button
            onClick={handleCancelAuth}
            className="w-full px-4 py-2 rounded-md border border-border hover:bg-muted"
          >
            Cancel
          </button>
        </>
      )}

      {/* Step: Server Selection */}
      {step === 'servers' && (
        <>
          <p className="text-sm text-muted-foreground">
            Select a Plex server to connect:
          </p>

          {servers.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No servers found on your Plex account
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map(server => (
                <button
                  key={server.id}
                  onClick={() => handleSelectServer(server.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                    selectedServerId === server.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="w-10 h-10 bg-[#e5a00d] rounded-lg flex items-center justify-center text-white">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      {server.name}
                      {server.isOwned && (
                        <span className="text-xs bg-[#e5a00d]/20 text-[#e5a00d] px-1.5 py-0.5 rounded">
                          Owned
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {server.address}:{server.port}
                      {server.isLocal && ' (Local)'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <button
            onClick={onBack}
            className="w-full px-4 py-2 rounded-md border border-border hover:bg-muted"
          >
            Back
          </button>
        </>
      )}

      {/* Step: Libraries */}
      {step === 'libraries' && (
        <>
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-500/20 text-green-500 rounded-full mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium">Connected!</p>
          </div>

          {libraries.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Select libraries to include:</p>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={handleSelectAll}
                    className="text-primary hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-muted-foreground">|</span>
                  <button
                    onClick={handleDeselectAll}
                    className="text-primary hover:underline"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {libraries.map(lib => (
                  <label
                    key={lib.id}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedLibraries.has(lib.id)
                        ? 'bg-primary/10 border border-primary/30'
                        : 'bg-muted/50 border border-transparent hover:bg-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedLibraries.has(lib.id)}
                      onChange={() => handleToggleLibrary(lib.id)}
                      className="w-4 h-4 rounded border-muted-foreground text-primary focus:ring-primary focus:ring-offset-0"
                    />
                    <span className="text-white">
                      {lib.type === 'movie' ? <Film className="w-5 h-5" /> : lib.type === 'show' ? <Tv className="w-5 h-5" /> : lib.type === 'music' ? <Music className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
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
            className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {selectedLibraries.size === 0 ? 'Select at least one library' : 'Done'}
          </button>
        </>
      )}
    </div>
  )
}
