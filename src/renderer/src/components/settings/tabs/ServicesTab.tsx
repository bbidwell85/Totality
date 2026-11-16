import { useState, useEffect, useId, useRef } from 'react'
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
import { Toggle } from '../../ui/Toggle'
import { Button, Input } from '../../ui'

interface ServiceCardProps {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  enableToggle?: {
    enabled: boolean
    onToggle: () => void
    id: string
  }
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
  enableToggle,
}: ServiceCardProps) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <div className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          {/* Status indicator */}
          <div className="shrink-0">
            {status === 'configured' ? (
              <CheckCircle className="w-5 h-5 text-foreground" />
            ) : status === 'partial' ? (
              <CheckCircle className="w-5 h-5 text-muted-foreground" />
            ) : (
              <Circle className="w-5 h-5 text-muted-foreground/50" />
            )}
          </div>

          {/* Icon */}
          <div className="shrink-0 text-muted-foreground">{icon}</div>

          {/* Title and status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-label">{title}</span>
              <span className="text-caption text-muted-foreground">{statusText}</span>
            </div>
            <p className="text-caption text-muted-foreground truncate">{description}</p>
          </div>

        </button>

        {/* Enable toggle */}
        {enableToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle checked={enableToggle.enabled} onChange={() => enableToggle.onToggle()} />
          </div>
        )}

        {/* Expand indicator */}
        <button onClick={onToggle} className="p-1 shrink-0">
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
}

export function ServicesTab() {
  // Expanded state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

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
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const confirmUninstallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    if (!confirmUninstall) {
      setConfirmUninstall(true)
      confirmUninstallTimerRef.current = setTimeout(() => setConfirmUninstall(false), 3000)
      return
    }
    if (confirmUninstallTimerRef.current) clearTimeout(confirmUninstallTimerRef.current)
    setConfirmUninstall(false)
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
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Header */}
      <div className="mb-4">
        <p className="text-caption text-muted-foreground">
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
        <div className="space-y-3">
          <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id={tmdbId}
                  type={showTmdbKey ? 'text' : 'password'}
                  value={tmdbApiKey}
                  onChange={(e) => {
                    setTmdbApiKey(e.target.value)
                    setTmdbStatus('idle')
                  }}
                  placeholder="Enter your TMDB API key"
                  className="pr-10"
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
                disabled={!tmdbApiKey.trim() || tmdbStatus === 'testing' || tmdbStatus === 'valid'}
                className={`px-3 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 ${
                  tmdbStatus === 'valid' ? 'text-foreground' :
                  tmdbStatus === 'invalid' ? 'text-destructive bg-destructive/10' :
                  'text-label bg-muted hover:bg-muted/80'
                }`}
                title={tmdbStatus === 'valid' ? 'API key is valid' : tmdbStatus === 'invalid' ? 'Invalid API key' : 'Test API key'}
              >
                {tmdbStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 tmdbStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
                 tmdbStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-caption">Invalid</span></> :
                 <span className="text-label">Test</span>}
              </button>
              {tmdbApiKey.trim() && (
                <button
                  onClick={() => {
                    setTmdbApiKey('')
                    setTmdbStatus('idle')
                  }}
                  className="px-3 py-2 text-label text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                  aria-label="Clear TMDB API key"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          <p className="text-caption text-muted-foreground">
            Free API key from{' '}
            <button type="button" onClick={() => window.electronAPI.openExternal('https://www.themoviedb.org/settings/api')} className="text-muted-foreground hover:text-foreground hover:underline">themoviedb.org</button>
          </p>
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
        enableToggle={ffprobeAvailable ? { enabled: ffprobeEnabled, onToggle: handleToggleFFprobe, id: toggleId } : undefined}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-label font-medium">
                {ffprobeAvailable ? `FFprobe v${ffprobeVersion || '?'}` : 'FFprobe not installed'}
              </p>
              {ffprobeAvailable && !updateAvailable && latestVersion && (
                <p className="text-caption text-muted-foreground">Up to date</p>
              )}
              {ffprobeAvailable && !updateAvailable && !latestVersion && (
                <p className="text-caption text-muted-foreground">{ffprobeBundled ? 'Bundled' : 'System installed'}</p>
              )}
              {updateAvailable && latestVersion && (
                <p className="text-caption text-primary">Version {latestVersion} available</p>
              )}
              {!ffprobeAvailable && (
                <p className="text-caption text-muted-foreground">Required for local file analysis</p>
              )}
            </div>
            {ffprobeAvailable ? (
              <Button
                variant="primary"
                size="sm"
                icon={(checkingUpdate) ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> :
                 updateAvailable ? <Download className="w-3.5 h-3.5" /> :
                 <RefreshCw className="w-3.5 h-3.5" />}
                onClick={updateAvailable ? handleInstallFFprobe : handleCheckForUpdate}
                disabled={checkingUpdate || isInstalling}
              >
                {checkingUpdate ? 'Checking...' :
                 updateAvailable ? 'Update' :
                 'Check for updates'}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                icon={isInstalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                onClick={handleInstallFFprobe}
                disabled={isInstalling}
              >
                Install (~80MB)
              </Button>
            )}
          </div>

          {/* Install/Update Progress */}
          {isInstalling && installProgress && (
            <div className="w-full bg-muted rounded-full h-1.5">
              <div className="bg-primary h-1.5 rounded-full transition-[width]" style={{ width: `${installProgress.percent}%` }} />
            </div>
          )}

          {/* Error */}
          {ffprobeError && (
            <p className="text-caption text-destructive">{ffprobeError}</p>
          )}

          {/* Uninstall */}
          {ffprobeAvailable && ffprobeBundled && (
            <button
              onClick={handleUninstallFFprobe}
              disabled={isUninstalling || isInstalling}
              className={`text-caption transition-colors disabled:opacity-50 ${
                confirmUninstall
                  ? 'text-destructive'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {isUninstalling ? 'Uninstalling…' : confirmUninstall ? 'Click again to confirm' : 'Uninstall'}
            </button>
          )}

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
          <p className="text-caption text-muted-foreground">
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
                    <div className="flex items-center gap-2 p-2.5">
                      <code className="flex-1 text-caption truncate text-muted-foreground" title={nfsPath}>
                        nfs://{nfsPath}
                      </code>
                      <span className="text-muted-foreground/50">→</span>
                      <code className="flex-1 text-caption truncate" title={localPath}>
                        {localPath}
                      </code>
                      <button
                        onClick={() => handleTestNfsMapping(nfsPath, localPath)}
                        disabled={isTesting}
                        className="flex items-center gap-1 px-2 py-1 text-caption bg-muted hover:bg-muted/80 rounded transition-colors disabled:opacity-50"
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
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-caption rounded-lg ${
                          testResult.success
                            ? 'bg-muted/50 text-foreground'
                            : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        {testResult.success ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{testResult.message}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
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
          <div className="space-y-2 pt-3 border-t border-border/30">
            <p className="text-caption font-medium text-muted-foreground">Add new mapping</p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-caption text-muted-foreground">NFS Path (without nfs://)</label>
                <Input
                  type="text"
                  value={newNfsPath}
                  onChange={(e) => setNewNfsPath(e.target.value)}
                  placeholder="nas.local/media"
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-caption text-muted-foreground">Local Path</label>
                <Input
                  type="text"
                  value={newLocalPath}
                  onChange={(e) => setNewLocalPath(e.target.value)}
                  placeholder="Z:\"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={handleAddNfsMapping}
                disabled={!newNfsPath.trim() || !newLocalPath.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          {Object.keys(nfsMappings).length === 0 && (
            <p className="text-caption text-muted-foreground text-center py-2">
              No NFS mappings configured. Only needed if you use NFS shares with Kodi.
            </p>
          )}
        </div>
      </ServiceCard>

      {/* Mood Sync — moved to Library tab */}

      {/* Save button */}
      {hasChanges && (
        <div className="flex justify-end pt-3">
          <Button
            variant="primary"
            icon={isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  )
}
