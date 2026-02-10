import { useState, useEffect, useId } from 'react'
import {
  Eye,
  EyeOff,
  Save,
  Loader2,
  CheckCircle,
  XCircle,
  Trash2,
  Download,
  RefreshCw,
  Plus,
  ChevronDown,
  Film,
  Wrench,
  Network,
  Circle,
} from 'lucide-react'

interface ServiceCardProps {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function ServiceCard({
  title,
  description,
  icon,
  status,
  statusText,
  expanded,
  onToggle,
  children,
}: ServiceCardProps) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
      >
        {/* Status indicator */}
        <div className="flex-shrink-0">
          {status === 'configured' ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : status === 'partial' ? (
            <CheckCircle className="w-5 h-5 text-amber-500" />
          ) : (
            <Circle className="w-5 h-5 text-muted-foreground/50" />
          )}
        </div>

        {/* Icon */}
        <div className="flex-shrink-0 text-muted-foreground">{icon}</div>

        {/* Title and status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-muted-foreground">{statusText}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>

        {/* Expand indicator */}
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
}

export function ServicesTab() {
  // Expanded state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set(['tmdb']))

  // TMDB state
  const [tmdbApiKey, setTmdbApiKey] = useState('')
  const [showTmdbKey, setShowTmdbKey] = useState(false)
  const [tmdbStatus, setTmdbStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [originalTmdb, setOriginalTmdb] = useState('')

  // FFprobe state
  const [ffprobeAvailable, setFfprobeAvailable] = useState<boolean | null>(null)
  const [ffprobeBundled, setFfprobeBundled] = useState(false)
  const [ffprobeVersion, setFfprobeVersion] = useState<string | null>(null)
  const [ffprobeEnabled, setFfprobeEnabled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<{ stage: string; percent: number } | null>(
    null
  )
  const [ffprobeError, setFfprobeError] = useState<string | null>(null)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  // NFS Mappings state
  const [nfsMappings, setNfsMappings] = useState<Record<string, string>>({})
  const [originalNfsMappings, setOriginalNfsMappings] = useState<Record<string, string>>({})
  const [newNfsPath, setNewNfsPath] = useState('')
  const [newLocalPath, setNewLocalPath] = useState('')
  const [testingMappings, setTestingMappings] = useState<Set<string>>(new Set())
  const [testResults, setTestResults] = useState<
    Record<
      string,
      {
        success: boolean
        error?: string
        folderCount?: number
        fileCount?: number
        message?: string
      }
    >
  >({})

  // General state
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const tmdbId = useId()
  const toggleId = useId()

  const toggleCard = (card: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(card)) {
        next.delete(card)
      } else {
        next.add(card)
      }
      return next
    })
  }

  useEffect(() => {
    loadSettings()
  }, [])

  useEffect(() => {
    const tmdbChanged = tmdbApiKey !== originalTmdb
    const nfsChanged = JSON.stringify(nfsMappings) !== JSON.stringify(originalNfsMappings)
    setHasChanges(tmdbChanged || nfsChanged)
  }, [tmdbApiKey, originalTmdb, nfsMappings, originalNfsMappings])

  useEffect(() => {
    const cleanup = window.electronAPI.onFFprobeInstallProgress?.((progress: unknown) => {
      setInstallProgress(progress as { stage: string; percent: number })
    })
    return () => cleanup?.()
  }, [])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const [allSettings, ffAvailable, ffBundled, ffVersion, nfsMaps] = await Promise.all([
        window.electronAPI.getAllSettings(),
        window.electronAPI.ffprobeIsAvailable(),
        window.electronAPI.ffprobeIsBundled(),
        window.electronAPI.ffprobeGetVersion().catch(() => null),
        window.electronAPI.getNfsMappings(),
      ])

      const tmdb = allSettings.tmdb_api_key || ''
      setTmdbApiKey(tmdb)
      setOriginalTmdb(tmdb)
      if (tmdb) {
        setTmdbStatus('valid')
      }

      setFfprobeAvailable(ffAvailable)
      setFfprobeBundled(ffBundled)
      setFfprobeVersion(ffVersion)
      setFfprobeEnabled(allSettings.ffprobe_enabled === 'true')

      setNfsMappings(nfsMaps || {})
      setOriginalNfsMappings(nfsMaps || {})
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleTestTmdb = async () => {
    if (!tmdbApiKey.trim()) return
    setTmdbStatus('testing')
    try {
      const response = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${tmdbApiKey}`
      )
      setTmdbStatus(response.ok ? 'valid' : 'invalid')
    } catch {
      setTmdbStatus('invalid')
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await Promise.all([
        window.electronAPI.setSetting('tmdb_api_key', tmdbApiKey),
        window.electronAPI.setNfsMappings(nfsMappings),
      ])
      setOriginalTmdb(tmdbApiKey)
      setOriginalNfsMappings({ ...nfsMappings })
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddNfsMapping = () => {
    if (!newNfsPath.trim() || !newLocalPath.trim()) return
    setNfsMappings((prev) => ({
      ...prev,
      [newNfsPath.trim()]: newLocalPath.trim(),
    }))
    setNewNfsPath('')
    setNewLocalPath('')
  }

  const handleRemoveNfsMapping = (nfsPath: string) => {
    setNfsMappings((prev) => {
      const updated = { ...prev }
      delete updated[nfsPath]
      return updated
    })
    setTestResults((prev) => {
      const updated = { ...prev }
      delete updated[nfsPath]
      return updated
    })
  }

  const handleTestNfsMapping = async (nfsPath: string, localPath: string) => {
    setTestingMappings((prev) => new Set(prev).add(nfsPath))
    setTestResults((prev) => {
      const updated = { ...prev }
      delete updated[nfsPath]
      return updated
    })
    try {
      const result = await window.electronAPI.testNfsMapping(nfsPath, localPath)
      setTestResults((prev) => ({ ...prev, [nfsPath]: result }))
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [nfsPath]: { success: false, error: (err as Error).message || 'Test failed' },
      }))
    } finally {
      setTestingMappings((prev) => {
        const updated = new Set(prev)
        updated.delete(nfsPath)
        return updated
      })
    }
  }

  const handleToggleFFprobe = async () => {
    const newValue = !ffprobeEnabled
    setFfprobeEnabled(newValue)
    try {
      await window.electronAPI.setSetting('ffprobe_enabled', newValue ? 'true' : 'false')
    } catch (error) {
      console.error('Failed to save FFprobe setting:', error)
      setFfprobeEnabled(!newValue)
    }
  }

  const handleInstallFFprobe = async () => {
    setIsInstalling(true)
    setFfprobeError(null)
    setInstallProgress({ stage: 'Starting...', percent: 0 })
    try {
      await window.electronAPI.ffprobeInstall()
      setUpdateAvailable(false)
      setLatestVersion(null)
      await loadSettings()
    } catch (err: unknown) {
      setFfprobeError((err as Error).message || 'Failed to install FFprobe')
    } finally {
      setIsInstalling(false)
      setInstallProgress(null)
    }
  }

  const handleUninstallFFprobe = async () => {
    if (!confirm('Are you sure you want to uninstall FFprobe?')) return
    setIsUninstalling(true)
    setFfprobeError(null)
    try {
      await window.electronAPI.ffprobeUninstall()
      setUpdateAvailable(false)
      setLatestVersion(null)
      await loadSettings()
    } catch (err: unknown) {
      setFfprobeError((err as Error).message || 'Failed to uninstall FFprobe')
    } finally {
      setIsUninstalling(false)
    }
  }

  const handleCheckForUpdate = async () => {
    setCheckingUpdate(true)
    setFfprobeError(null)
    try {
      const result = await window.electronAPI.ffprobeCheckForUpdate()
      if (result.error) {
        setFfprobeError(result.error)
      } else {
        setLatestVersion(result.latestVersion)
        setUpdateAvailable(result.updateAvailable)
        if (result.currentVersion) {
          setFfprobeVersion(result.currentVersion)
        }
      }
    } catch (err: unknown) {
      setFfprobeError((err as Error).message || 'Failed to check for updates')
    } finally {
      setCheckingUpdate(false)
    }
  }

  // Status calculations
  const tmdbConfigured = !!tmdbApiKey.trim()
  const ffprobeStatus: 'configured' | 'partial' | 'not-configured' = ffprobeAvailable
    ? ffprobeEnabled
      ? 'configured'
      : 'partial'
    : 'not-configured'
  const nfsConfigured = Object.keys(nfsMappings).length > 0

  const getFFprobeStatusText = () => {
    if (!ffprobeAvailable) return 'Not installed'
    if (!ffprobeEnabled) return 'Installed but disabled'
    return ffprobeVersion ? `v${ffprobeVersion}` : 'Enabled'
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-3 overflow-y-auto">
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs text-muted-foreground">
          Configure external services and tools used for metadata and media analysis.
        </p>
      </div>

      {/* TMDB Card */}
      <ServiceCard
        title="TMDB API"
        description="Movie and TV metadata for completeness analysis"
        icon={<Film className="w-5 h-5" />}
        status={tmdbConfigured ? 'configured' : 'not-configured'}
        statusText={tmdbConfigured ? 'Configured' : 'Not configured'}
        expanded={expandedCards.has('tmdb')}
        onToggle={() => toggleCard('tmdb')}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Required for TV series and movie collection completeness analysis. Get a free API key
            at{' '}
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              themoviedb.org
            </a>
          </p>

          <div className="space-y-2">
            <label htmlFor={tmdbId} className="block text-xs font-medium text-muted-foreground">
              API Key
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id={tmdbId}
                  type={showTmdbKey ? 'text' : 'password'}
                  value={tmdbApiKey}
                  onChange={(e) => {
                    setTmdbApiKey(e.target.value)
                    setTmdbStatus('idle')
                  }}
                  placeholder="Enter your TMDB API key"
                  className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowTmdbKey(!showTmdbKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showTmdbKey ? 'Hide API key' : 'Show API key'}
                >
                  {showTmdbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={handleTestTmdb}
                disabled={!tmdbApiKey.trim() || tmdbStatus === 'testing'}
                className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {tmdbStatus === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
                Test
              </button>
              {tmdbApiKey.trim() && (
                <button
                  onClick={() => {
                    setTmdbApiKey('')
                    setTmdbStatus('idle')
                  }}
                  className="px-3 py-2 text-sm bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-md transition-colors"
                  aria-label="Clear TMDB API key"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {tmdbStatus === 'valid' && (
              <div className="flex items-center gap-2 text-xs text-green-500">
                <CheckCircle className="w-4 h-4" />
                API key is valid
              </div>
            )}
            {tmdbStatus === 'invalid' && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <XCircle className="w-4 h-4" />
                Invalid API key
              </div>
            )}
          </div>
        </div>
      </ServiceCard>

      {/* FFprobe Card */}
      <ServiceCard
        title="FFprobe"
        description="Extract codec, bitrate, and audio details from files"
        icon={<Wrench className="w-5 h-5" />}
        status={ffprobeStatus}
        statusText={getFFprobeStatusText()}
        expanded={expandedCards.has('ffprobe')}
        onToggle={() => toggleCard('ffprobe')}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Required for Local Folder sources. Enhances Kodi sources with additional metadata. Used
            as fallback for Jellyfin/Emby when audio bitrate data is missing.
          </p>

          {/* Installation controls */}
          <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
            <div className="flex items-center gap-3">
              {ffprobeAvailable ? (
                <div className="flex items-center gap-2 text-green-500">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">Installed</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Circle className="w-4 h-4" />
                  <span className="text-sm font-medium">Not Installed</span>
                </div>
              )}
              {ffprobeVersion && (
                <span className="text-xs text-muted-foreground">(v{ffprobeVersion})</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {ffprobeAvailable && (
                <button
                  onClick={handleCheckForUpdate}
                  disabled={checkingUpdate || isInstalling}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-colors disabled:opacity-50 ${
                    latestVersion && !updateAvailable
                      ? 'text-green-500'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  title="Check for updates"
                >
                  {checkingUpdate ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : latestVersion && !updateAvailable ? (
                    <CheckCircle className="w-3.5 h-3.5" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {checkingUpdate
                    ? 'Checking...'
                    : latestVersion && !updateAvailable
                      ? 'Up to date'
                      : 'Check for updates'}
                </button>
              )}
              {ffprobeAvailable && ffprobeBundled ? (
                <button
                  onClick={handleUninstallFFprobe}
                  disabled={isUninstalling || isInstalling}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                >
                  {isUninstalling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Uninstall
                </button>
              ) : ffprobeAvailable && !ffprobeBundled ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground">
                  System installed
                </span>
              ) : (
                <button
                  onClick={handleInstallFFprobe}
                  disabled={isInstalling}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isInstalling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Install (~80MB)
                </button>
              )}
            </div>
          </div>

          {/* Update Available */}
          {updateAvailable && latestVersion && (
            <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 text-amber-400">
                <RefreshCw className="w-4 h-4" />
                <span className="text-sm">Update available: v{latestVersion}</span>
              </div>
              <button
                onClick={handleInstallFFprobe}
                disabled={isInstalling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500 text-black font-medium rounded hover:bg-amber-400 transition-colors disabled:opacity-50"
              >
                {isInstalling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Update
              </button>
            </div>
          )}

          {/* Install Progress */}
          {isInstalling && installProgress && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{installProgress.stage}</span>
                <span>{installProgress.percent}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${installProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Enable Toggle */}
          {ffprobeAvailable && (
            <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
              <div>
                <label htmlFor={toggleId} className="text-sm font-medium">
                  Enable FFprobe analysis
                </label>
                <p className="text-xs text-muted-foreground">
                  Use FFprobe to analyze media files during scans
                </p>
              </div>
              <button
                id={toggleId}
                role="switch"
                aria-checked={ffprobeEnabled}
                onClick={handleToggleFFprobe}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
                  ffprobeEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition duration-200 ease-in-out ${
                    ffprobeEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}

          {/* Error */}
          {ffprobeError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {ffprobeError}
            </div>
          )}

          {/* Usage info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Usage by source type:</p>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li>
                <strong className="text-foreground">Local Folders:</strong> Required
              </li>
              <li>
                <strong className="text-foreground">Kodi:</strong> Enhances metadata
              </li>
              <li>
                <strong className="text-foreground">Jellyfin/Emby:</strong> Fallback for audio
                bitrates
              </li>
              <li>
                <strong className="text-foreground">Plex:</strong> Not used
              </li>
            </ul>
          </div>
        </div>
      </ServiceCard>

      {/* NFS Mappings Card */}
      <ServiceCard
        title="NFS Mount Mappings"
        description="Map Kodi NFS paths to local mount points"
        icon={<Network className="w-5 h-5" />}
        status={nfsConfigured ? 'configured' : 'not-configured'}
        statusText={
          nfsConfigured ? `${Object.keys(nfsMappings).length} mapping(s)` : 'No mappings'
        }
        expanded={expandedCards.has('nfs')}
        onToggle={() => toggleCard('nfs')}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Required for FFprobe to analyze files on NFS shares used by Kodi. Maps NFS URLs to local
            Windows paths.
          </p>

          {/* Existing Mappings */}
          {Object.keys(nfsMappings).length > 0 && (
            <div className="space-y-2">
              {Object.entries(nfsMappings).map(([nfsPath, localPath]) => {
                const isTesting = testingMappings.has(nfsPath)
                const testResult = testResults[nfsPath]
                return (
                  <div key={nfsPath} className="space-y-1">
                    <div className="flex items-center gap-2 p-2.5 bg-background/50 rounded-lg">
                      <code className="flex-1 text-xs truncate text-muted-foreground" title={nfsPath}>
                        nfs://{nfsPath}
                      </code>
                      <span className="text-muted-foreground/50">→</span>
                      <code className="flex-1 text-xs truncate" title={localPath}>
                        {localPath}
                      </code>
                      <button
                        onClick={() => handleTestNfsMapping(nfsPath, localPath)}
                        disabled={isTesting}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded transition-colors disabled:opacity-50"
                        title="Test mapping"
                      >
                        {isTesting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Test
                      </button>
                      <button
                        onClick={() => handleRemoveNfsMapping(nfsPath)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove mapping"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {testResult && (
                      <div
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg ${
                          testResult.success
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {testResult.success ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{testResult.message}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{testResult.error}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add New Mapping */}
          <div className="space-y-2 p-3 bg-background/50 rounded-lg">
            <p className="text-xs font-medium text-muted-foreground">Add new mapping</p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">NFS Path (without nfs://)</label>
                <input
                  type="text"
                  value={newNfsPath}
                  onChange={(e) => setNewNfsPath(e.target.value)}
                  placeholder="nas.local/media"
                  className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Local Path</label>
                <input
                  type="text"
                  value={newLocalPath}
                  onChange={(e) => setNewLocalPath(e.target.value)}
                  placeholder="Z:\"
                  className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button
                onClick={handleAddNfsMapping}
                disabled={!newNfsPath.trim() || !newLocalPath.trim()}
                className="flex items-center gap-1 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>

          {Object.keys(nfsMappings).length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No NFS mappings configured. Only needed if you use NFS shares with Kodi.
            </p>
          )}
        </div>
      </ServiceCard>

      {/* Save button */}
      {hasChanges && (
        <div className="flex justify-end pt-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
