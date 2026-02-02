/**
 * SourceCard Component
 *
 * Displays a single media source with its status and actions.
 */

import { useState, useEffect, useCallback } from 'react'
import { Server, HardDrive } from 'lucide-react'
import { useSources, type ProviderType } from '../../contexts/SourceContext'
import type { MediaSourceResponse, MediaLibraryResponse } from '../../../../preload/index'

// Extended library type with enabled status
interface LibraryWithStatus extends MediaLibraryResponse {
  isEnabled: boolean
  lastScanAt: string | null
  itemsScanned: number
}

// Provider colors
const providerColors: Record<ProviderType, string> = {
  plex: 'bg-[#e5a00d]',
  jellyfin: 'bg-purple-500',
  emby: 'bg-green-500',
  kodi: 'bg-blue-500',
  'kodi-local': 'bg-blue-500',
  local: 'bg-slate-600',
}

// Helper to parse connection config and get server URL
function getServerUrl(source: MediaSourceResponse): string | null {
  try {
    const config = JSON.parse(source.connection_config)
    return config.serverUrl || null
  } catch {
    return null
  }
}

// Helper to get user-friendly error message and suggestions
function getErrorDetails(error: string, source: MediaSourceResponse, allSources: MediaSourceResponse[]): {
  message: string
  suggestion?: string
  isDuplicateUrl?: boolean
} {
  const errorLower = error.toLowerCase()
  const serverUrl = getServerUrl(source)

  // Check for duplicate server URLs
  if (serverUrl) {
    const duplicates = allSources.filter(s =>
      s.source_id !== source.source_id &&
      getServerUrl(s) === serverUrl
    )
    if (duplicates.length > 0) {
      const duplicateNames = duplicates.map(d => d.display_name).join(', ')
      return {
        message: 'Authentication failed - possible server conflict',
        suggestion: `This source shares the same server URL (${serverUrl}) with: ${duplicateNames}. Each source needs its own server instance. If you're running both Jellyfin and Emby, they must be on different ports.`,
        isDuplicateUrl: true
      }
    }
  }

  // 401 Unauthorized
  if (errorLower.includes('401') || errorLower.includes('unauthorized') || errorLower.includes('access token is invalid')) {
    return {
      message: 'Authentication failed',
      suggestion: 'Your access token has expired or is invalid. Try removing and re-adding this source to re-authenticate.'
    }
  }

  // Connection refused / ECONNREFUSED
  if (errorLower.includes('econnrefused') || errorLower.includes('connection refused')) {
    return {
      message: 'Connection refused',
      suggestion: 'The server is not running or not accepting connections. Make sure the media server is running and accessible.'
    }
  }

  // Timeout
  if (errorLower.includes('timeout') || errorLower.includes('etimedout')) {
    return {
      message: 'Connection timed out',
      suggestion: 'The server took too long to respond. Check if the server is running and the network connection is stable.'
    }
  }

  // DNS / hostname errors
  if (errorLower.includes('enotfound') || errorLower.includes('getaddrinfo')) {
    return {
      message: 'Server not found',
      suggestion: 'The server hostname could not be resolved. Check if the server URL is correct and your network connection is working.'
    }
  }

  // Generic error
  return {
    message: error,
    suggestion: undefined
  }
}

interface SourceCardProps {
  source: MediaSourceResponse
  onScan?: () => void
  expanded?: boolean
  onToggleExpand?: () => void
}

export function SourceCard({ source, onScan, expanded = false, onToggleExpand }: SourceCardProps) {
  const {
    sources,
    toggleSource,
    removeSource,
    testConnection,
    scanProgress,
    isScanning,
  } = useSources()

  const [libraries, setLibraries] = useState<LibraryWithStatus[]>([])
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(false)
  const [isTogglingLibrary, setIsTogglingLibrary] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'error'>('unknown')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // FFprobe state (for kodi-local sources)
  const [ffprobeAvailable, setFfprobeAvailable] = useState<boolean | null>(null)
  const [ffprobeVersion, setFfprobeVersion] = useState<string | null>(null)
  const [ffprobeEnabled, setFfprobeEnabled] = useState(false)
  const [ffprobeLoading, setFfprobeLoading] = useState(false)
  const [ffprobeError, setFfprobeError] = useState<string | null>(null)
  const [ffprobeCanInstall, setFfprobeCanInstall] = useState(false)
  const [ffprobeInstalling, setFfprobeInstalling] = useState(false)
  const [ffprobeInstallProgress, setFfprobeInstallProgress] = useState<{ stage: string; percent: number } | null>(null)
  const isKodiLocal = source.source_type === 'kodi-local'

  const providerType = source.source_type as ProviderType
  const color = providerColors[providerType] || 'bg-gray-500'
  const progress = scanProgress.get(source.source_id)

  // Load libraries when expanded
  const handleExpand = async () => {
    onToggleExpand?.()

    if (!expanded && libraries.length === 0) {
      setIsLoadingLibraries(true)
      setConnectionError(null)
      try {
        // Use the new API that includes enabled status
        const libs = await window.electronAPI.sourcesGetLibrariesWithStatus(source.source_id)
        setLibraries(libs)

        // Also test connection
        const result = await testConnection(source.source_id)
        setConnectionStatus(result.success ? 'connected' : 'error')
        if (!result.success && result.error) {
          setConnectionError(result.error)
        }
      } catch (err: any) {
        console.error('Failed to load libraries:', err)
        setConnectionStatus('error')
        setConnectionError(err.message || 'Failed to connect to server')
      } finally {
        setIsLoadingLibraries(false)
      }
    }
  }

  // Toggle library enabled status
  const handleToggleLibrary = async (libraryId: string, currentEnabled: boolean) => {
    setIsTogglingLibrary(libraryId)
    try {
      await window.electronAPI.sourcesToggleLibrary(source.source_id, libraryId, !currentEnabled)
      // Update local state
      setLibraries(prev => prev.map(lib =>
        lib.id === libraryId ? { ...lib, isEnabled: !currentEnabled } : lib
      ))
    } catch (err) {
      console.error('Failed to toggle library:', err)
    } finally {
      setIsTogglingLibrary(null)
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to remove "${source.display_name}"? This will also delete all scanned media items from this source.`)) {
      return
    }

    setIsDeleting(true)
    try {
      await removeSource(source.source_id)
    } catch (err) {
      console.error('Failed to remove source:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle toggle enabled
  const handleToggle = async () => {
    try {
      await toggleSource(source.source_id, !source.is_enabled)
    } catch (err) {
      console.error('Failed to toggle source:', err)
    }
  }

  // Scan a library via task queue
  const handleScanLibrary = async (libraryId: string) => {
    try {
      // Find the library to get its name and type
      const library = libraries.find(l => l.id === libraryId)
      const libraryName = library?.name || libraryId
      const libraryType = library?.type || 'unknown'

      // Add to task queue
      const taskType = libraryType === 'music' ? 'music-scan' : 'library-scan'
      await window.electronAPI.taskQueueAddTask({
        type: taskType,
        label: `Scan ${libraryName} (${source.display_name})`,
        sourceId: source.source_id,
        libraryId,
      })
      onScan?.()
    } catch (err) {
      console.error('Failed to queue library scan:', err)
    }
  }

  // Load FFprobe status function
  const loadFFprobeStatus = useCallback(async () => {
    setFfprobeLoading(true)
    setFfprobeError(null)
    try {
      const status = await window.electronAPI.ffprobeIsAvailableForSource(source.source_id)
      setFfprobeAvailable(status.available)
      setFfprobeVersion(status.version || null)
      if (!status.available && status.reason) {
        setFfprobeError(status.reason)
      }

      // Also check if it's currently enabled
      if (status.available) {
        const enabled = await window.electronAPI.ffprobeIsEnabled(source.source_id)
        setFfprobeEnabled(enabled)
      } else {
        // Check if we can auto-install
        const canInstall = await window.electronAPI.ffprobeCanInstall()
        setFfprobeCanInstall(canInstall)
      }
    } catch (err: any) {
      console.error('Failed to load FFprobe status:', err)
      setFfprobeError(err.message || 'Failed to check FFprobe status')
    } finally {
      setFfprobeLoading(false)
    }
  }, [source.source_id])

  // Handle FFprobe installation
  const handleInstallFFprobe = async () => {
    setFfprobeInstalling(true)
    setFfprobeInstallProgress({ stage: 'Starting...', percent: 0 })

    // Listen for progress updates
    const unsubscribe = window.electronAPI.onFFprobeInstallProgress((progress) => {
      setFfprobeInstallProgress(progress)
    })

    try {
      const result = await window.electronAPI.ffprobeInstall()

      if (result.success) {
        // Reload status to reflect the new installation
        setFfprobeAvailable(true)
        setFfprobeInstallProgress({ stage: 'Complete!', percent: 100 })
        // Get the version
        const version = await window.electronAPI.ffprobeGetVersion()
        setFfprobeVersion(version)
        setFfprobeError(null)
      } else {
        setFfprobeError(result.error || 'Installation failed')
        setFfprobeInstallProgress(null)
      }
    } catch (err: any) {
      console.error('Failed to install FFprobe:', err)
      setFfprobeError(err.message || 'Installation failed')
      setFfprobeInstallProgress(null)
    } finally {
      unsubscribe()
      setFfprobeInstalling(false)
    }
  }

  // Load FFprobe status when expanded (for kodi-local sources)
  useEffect(() => {
    if (expanded && isKodiLocal && ffprobeAvailable === null) {
      loadFFprobeStatus()
    }
  }, [expanded, isKodiLocal, ffprobeAvailable, loadFFprobeStatus])

  const handleToggleFFprobe = async () => {
    if (!ffprobeAvailable) return

    try {
      const newValue = !ffprobeEnabled
      await window.electronAPI.ffprobeSetEnabled(source.source_id, newValue)
      setFfprobeEnabled(newValue)
    } catch (err: any) {
      console.error('Failed to toggle FFprobe:', err)
    }
  }

  // Format last scan time
  const formatLastScan = (dateStr?: string) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  return (
    <div className={`rounded-lg border ${source.is_enabled ? 'border-border' : 'border-border/50 opacity-60'} bg-card overflow-hidden`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={handleExpand}
      >
        {/* Provider icon */}
        <div className={`w-8 h-8 ${color} rounded-md flex items-center justify-center text-white`}>
          {source.source_type === 'local' ? (
            <HardDrive className="w-4 h-4" />
          ) : (
            <Server className="w-4 h-4" />
          )}
        </div>

        {/* Source info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{source.display_name}</span>
            {connectionStatus === 'connected' && (
              <span className="w-2 h-2 bg-green-500 rounded-full" title="Connected" />
            )}
            {connectionStatus === 'error' && (
              <span className="w-2 h-2 bg-red-500 rounded-full" title="Connection error" />
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {source.source_type.charAt(0).toUpperCase() + source.source_type.slice(1)} •{' '}
            Last scan: {formatLastScan(source.last_scan_at)}
          </div>
        </div>

        {/* Toggle switch */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleToggle()
          }}
          className={`w-10 h-5 rounded-full transition-colors ${
            source.is_enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <div
            className={`w-4 h-4 bg-white rounded-full transition-transform ${
              source.is_enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>

        {/* Expand indicator */}
        <svg
          className={`w-5 h-5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border p-3 space-y-3">
          {/* Progress bar */}
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Scanning: {progress.currentItem || '...'}</span>
                <span>{Math.round(progress.percentage)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Connection Error */}
          {connectionStatus === 'error' && connectionError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              {(() => {
                const errorDetails = getErrorDetails(connectionError, source, sources)
                return (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-destructive">{errorDetails.message}</p>
                        {errorDetails.suggestion && (
                          <p className="text-xs text-muted-foreground mt-1">{errorDetails.suggestion}</p>
                        )}
                        {errorDetails.isDuplicateUrl && (
                          <div className="mt-2 flex items-center gap-2">
                            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-xs text-amber-500">Duplicate server URL detected</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Libraries */}
          {isLoadingLibraries ? (
            <div className="text-sm text-muted-foreground">Loading libraries...</div>
          ) : connectionStatus === 'error' ? (
            <div className="text-sm text-muted-foreground">Unable to load libraries due to connection error</div>
          ) : libraries.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase">Libraries</div>
              {libraries.map(lib => (
                <div
                  key={lib.id}
                  className={`flex items-center justify-between p-2 rounded ${lib.isEnabled ? 'bg-muted/50' : 'bg-muted/20 opacity-60'}`}
                >
                  <div className="flex items-center gap-2">
                    {/* Toggle switch */}
                    <button
                      onClick={() => handleToggleLibrary(lib.id, lib.isEnabled)}
                      disabled={isTogglingLibrary === lib.id}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                        lib.isEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                      } ${isTogglingLibrary === lib.id ? 'opacity-50' : ''}`}
                      role="switch"
                      aria-checked={lib.isEnabled}
                      title={lib.isEnabled ? 'Disable library' : 'Enable library'}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition duration-200 ease-in-out ${
                          lib.isEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>

                    <span className="text-lg">
                      {lib.type === 'movie' ? '🎬' : lib.type === 'show' ? '📺' : lib.type === 'music' ? '🎵' : '📁'}
                    </span>
                    <span className={`text-sm ${!lib.isEnabled ? 'text-muted-foreground' : ''}`}>{lib.name}</span>
                    {lib.itemCount !== undefined && (
                      <span className="text-xs text-muted-foreground">({lib.itemCount} items)</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleScanLibrary(lib.id)}
                    disabled={isScanning || !lib.isEnabled}
                    className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!lib.isEnabled ? 'Enable library to scan' : 'Scan library'}
                  >
                    Scan
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No libraries found</div>
          )}

          {/* FFprobe Settings (Kodi-local only) */}
          {isKodiLocal && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="text-xs font-medium text-muted-foreground uppercase">File Analysis</div>

              {ffprobeLoading ? (
                <div className="text-sm text-muted-foreground">Checking FFprobe availability...</div>
              ) : ffprobeInstalling ? (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span className="text-sm font-medium">{ffprobeInstallProgress?.stage || 'Installing...'}</span>
                    </div>
                    {ffprobeInstallProgress && (
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${ffprobeInstallProgress.percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : !ffprobeAvailable ? (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-500">FFprobe Not Available</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        FFprobe enables accurate file analysis for bitrate, audio tracks, and HDR data. Without it, quality data is estimated from Kodi's metadata.
                      </p>

                      {ffprobeCanInstall ? (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleInstallFFprobe()
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                              Install FFprobe
                            </button>
                            <span className="text-xs text-muted-foreground">~30-80 MB download</span>
                          </div>
                          {ffprobeError && (
                            <p className="text-xs text-destructive">
                              Installation failed: {ffprobeError}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-2">
                          <span className="font-medium">Manual installation:</span>
                          {' '}
                          <a
                            href="https://ffmpeg.org/download.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ffmpeg.org/download.html
                          </a>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : ffprobeAvailable ? (
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        <span className="text-sm font-medium">FFprobe Available</span>
                        {ffprobeVersion && (
                          <span className="text-xs text-muted-foreground">v{ffprobeVersion}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {ffprobeEnabled
                          ? 'Scans will analyze files for accurate bitrate, audio tracks, and HDR data.'
                          : 'Enable to get accurate quality data from actual files during scans.'}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleFFprobe()
                      }}
                      className={`w-10 h-5 rounded-full transition-colors ${
                        ffprobeEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                      }`}
                      title={ffprobeEnabled ? 'Disable FFprobe analysis' : 'Enable FFprobe analysis'}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full transition-transform ${
                          ffprobeEnabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                  {ffprobeEnabled && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-amber-500">Note:</span> File analysis adds time to scans depending on library size and disk speed.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-xs px-3 py-1.5 rounded border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
