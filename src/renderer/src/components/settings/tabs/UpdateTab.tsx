/**
 * UpdateTab - Settings tab for application updates
 *
 * Features:
 * - Current version display
 * - Auto-update toggle
 * - Manual check for updates
 * - Download and install updates
 */

import { useState, useEffect } from 'react'
import { ArrowUpCircle, RefreshCw, Download } from 'lucide-react'

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  downloadProgress?: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }
  error?: string
  lastChecked?: string
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function UpdateTab() {
  const [isLoading, setIsLoading] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })

  // Load initial state
  useEffect(() => {
    async function load() {
      try {
        const [version, state, setting] = await Promise.all([
          window.electronAPI.getAppVersion(),
          window.electronAPI.autoUpdateGetState(),
          window.electronAPI.getSetting('auto_update_enabled'),
        ])
        setAppVersion(version)
        setUpdateState(state)
        setAutoUpdateEnabled(setting !== 'false')
      } catch (error) {
        console.error('Failed to load update settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  // Listen for state changes from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onAutoUpdateStateChanged((state: UpdateState) => {
      setUpdateState(state)
    })
    return cleanup
  }, [])

  const [isChecking, setIsChecking] = useState(false)

  const handleCheckForUpdates = async () => {
    setIsChecking(true)
    await window.electronAPI.autoUpdateCheckForUpdates()
    // Ensure spinner shows for at least 1 second
    setTimeout(() => setIsChecking(false), 1000)
  }

  const handleDownloadUpdate = async () => {
    await window.electronAPI.autoUpdateDownloadUpdate()
  }

  const handleInstallUpdate = async () => {
    await window.electronAPI.autoUpdateInstallUpdate()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const { status, version: newVersion, downloadProgress, lastChecked } = updateState

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Current Version + Update Status */}
      <div className="bg-muted/30 rounded-lg border border-border/40 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <ArrowUpCircle className="w-7 h-7 text-primary shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-foreground">Totality v{appVersion}</h3>
            {(status === 'idle' || status === 'not-available') && lastChecked && (
              <p className="text-xs text-muted-foreground">
                Up to date · Last checked {new Date(lastChecked).toLocaleString()}
              </p>
            )}
            {(status === 'idle' || status === 'not-available') && !lastChecked && (
              <p className="text-xs text-muted-foreground">Up to date</p>
            )}
            {status === 'checking' && (
              <p className="text-xs text-muted-foreground">Checking for updates...</p>
            )}
            {status === 'available' && (
              <p className="text-xs text-primary">Version {newVersion} available</p>
            )}
            {status === 'downloading' && downloadProgress && (
              <p className="text-xs text-muted-foreground">
                Downloading... {Math.round(downloadProgress.percent)}%
              </p>
            )}
            {status === 'downloaded' && (
              <p className="text-xs text-green-500">Version {newVersion} ready to install</p>
            )}
            {status === 'error' && (
              <p className="text-xs text-destructive">Update check failed</p>
            )}
          </div>
          <button
            onClick={status === 'downloaded' ? handleInstallUpdate : status === 'available' ? handleDownloadUpdate : handleCheckForUpdates}
            disabled={isChecking || status === 'checking' || status === 'downloading'}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {(isChecking || status === 'checking') ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> :
             status === 'downloaded' ? <ArrowUpCircle className="w-3.5 h-3.5" /> :
             status === 'available' ? <Download className="w-3.5 h-3.5" /> :
             <RefreshCw className="w-3.5 h-3.5" />}
            {(isChecking || status === 'checking') ? 'Checking...' :
             status === 'downloaded' ? 'Install' :
             status === 'available' ? 'Download' :
             'Check for Updates'}
          </button>
        </div>

        {/* Download progress bar */}
        {status === 'downloading' && downloadProgress && (
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all"
              style={{ width: `${downloadProgress.percent}%` }}
            />
          </div>
        )}
      </div>

      {/* Auto-Update Toggle */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Automatic Updates</h3>
        <div className="bg-muted/30 rounded-lg border border-border/40">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Check for updates automatically</p>
              <p className="text-xs text-muted-foreground">
                Periodically checks GitHub for new releases
              </p>
            </div>
            <Toggle
              checked={autoUpdateEnabled}
              onChange={async (checked) => {
                setAutoUpdateEnabled(checked)
                await window.electronAPI.setSetting('auto_update_enabled', checked ? 'true' : 'false')
              }}
            />
          </div>
        </div>
      </div>

    </div>
  )
}
