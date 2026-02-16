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
import { ArrowUpCircle, RefreshCw, CheckCircle2, AlertCircle, Download } from 'lucide-react'

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
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

  const handleCheckForUpdates = async () => {
    await window.electronAPI.autoUpdateCheckForUpdates()
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

  const { status, version: newVersion, downloadProgress, error, lastChecked } = updateState

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Current Version */}
      <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/40">
        <div className="flex items-center gap-3">
          <ArrowUpCircle className="w-7 h-7 text-primary" />
          <div>
            <h3 className="text-sm font-medium text-foreground">Totality</h3>
            <p className="text-xs text-muted-foreground">Version {appVersion}</p>
          </div>
        </div>
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

      {/* Status Display */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Update Status</h3>
        <div className="bg-muted/30 rounded-lg border border-border/40 p-4 space-y-3">
          {/* Idle / Not Available */}
          {(status === 'idle' || status === 'not-available') && (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-sm text-foreground">You're up to date</p>
                {lastChecked && (
                  <p className="text-xs text-muted-foreground">
                    Last checked: {new Date(lastChecked).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Checking */}
          {status === 'checking' && (
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
              <p className="text-sm text-foreground">Checking for updates...</p>
            </div>
          )}

          {/* Available */}
          {status === 'available' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <ArrowUpCircle className="w-5 h-5 text-primary flex-shrink-0" />
                <div>
                  <p className="text-sm text-foreground">
                    Version {newVersion} is available
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Current version: {appVersion}
                  </p>
                </div>
              </div>
              <button
                onClick={handleDownloadUpdate}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Download Update
              </button>
            </div>
          )}

          {/* Downloading */}
          {status === 'downloading' && downloadProgress && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Download className="w-5 h-5 text-primary flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-foreground">
                    Downloading update... {Math.round(downloadProgress.percent)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
                    {' '}({formatBytes(downloadProgress.bytesPerSecond)}/s)
                  </p>
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${downloadProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Downloaded */}
          {status === 'downloaded' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                <div>
                  <p className="text-sm text-foreground">
                    Version {newVersion} is ready to install
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The app will restart to apply the update
                  </p>
                </div>
              </div>
              <button
                onClick={handleInstallUpdate}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 text-sm font-medium"
              >
                <ArrowUpCircle className="w-4 h-4" />
                Restart and Update
              </button>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
              <div>
                <p className="text-sm text-foreground">Update check failed</p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Check Button */}
      <button
        onClick={handleCheckForUpdates}
        disabled={status === 'checking' || status === 'downloading'}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-border/50 hover:bg-muted/50 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`w-4 h-4 ${status === 'checking' ? 'animate-spin' : ''}`} />
        {status === 'checking' ? 'Checking...' : 'Check for Updates'}
      </button>
    </div>
  )
}
