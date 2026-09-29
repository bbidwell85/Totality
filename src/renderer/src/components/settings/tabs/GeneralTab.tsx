/**
 * GeneralTab - Settings tab for general application behavior
 *
 * Features:
 * - Minimize to tray on close
 * - Start minimized to tray
 * - Auto-update settings
 */

import { useState, useEffect } from 'react'
import { Loader2, Monitor, ArrowUpCircle, RefreshCw, Download } from 'lucide-react'
import { Toggle } from '../../ui/Toggle'

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

export function GeneralTab() {
  const [isLoading, setIsLoading] = useState(true)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)

  // Auto-update state
  const [appVersion, setAppVersion] = useState('')
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [trayVal, startVal, version, uState, uSetting] = await Promise.all([
          window.electronAPI.getSetting('minimize_to_tray'),
          window.electronAPI.getSetting('start_minimized_to_tray'),
          window.electronAPI.getAppVersion(),
          window.electronAPI.autoUpdateGetState(),
          window.electronAPI.getSetting('auto_update_enabled'),
        ])
        setMinimizeToTray(trayVal === 'true')
        setStartMinimized(startVal === 'true')
        setAppVersion(version)
        setUpdateState(uState)
        setAutoUpdateEnabled(uSetting !== 'false')
      } catch (error) {
        console.error('Failed to load general settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  // Listen for update state changes
  useEffect(() => {
    const cleanup = window.electronAPI.onAutoUpdateStateChanged((state: UpdateState) => {
      setUpdateState(state)
    })
    return cleanup
  }, [])

  const handleCheckForUpdates = async () => {
    setIsChecking(true)
    await window.electronAPI.autoUpdateCheckForUpdates()
    setTimeout(() => setIsChecking(false), 1000)
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const { status, version: newVersion, releaseNotes, downloadProgress, lastChecked } = updateState

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Window Behavior */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Monitor className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Window Behavior</h3>
        </div>
        <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm text-foreground">Minimize to tray on close</p>
              <p className="text-xs text-muted-foreground">Hide to system tray instead of quitting</p>
            </div>
            <Toggle
              checked={minimizeToTray}
              onChange={async (checked) => {
                setMinimizeToTray(checked)
                await window.electronAPI.setSetting('minimize_to_tray', String(checked))
                if (!checked) {
                  setStartMinimized(false)
                  await window.electronAPI.setSetting('start_minimized_to_tray', 'false')
                }
              }}
            />
          </div>
          {minimizeToTray && (
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm text-foreground">Start minimized to tray</p>
                <p className="text-xs text-muted-foreground">Launch the app hidden in the system tray</p>
              </div>
              <Toggle
                checked={startMinimized}
                onChange={async (checked) => {
                  setStartMinimized(checked)
                  await window.electronAPI.setSetting('start_minimized_to_tray', String(checked))
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Updates */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <ArrowUpCircle className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Updates</h3>
        </div>
        <div className="bg-muted/30 rounded-lg border border-border/40 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium">Totality v{appVersion}</p>
              {(status === 'idle' || status === 'not-available') && lastChecked && (
                <p className="text-xs text-muted-foreground">Up to date · Last checked {new Date(lastChecked).toLocaleString()}</p>
              )}
              {(status === 'idle' || status === 'not-available') && !lastChecked && (
                <p className="text-xs text-muted-foreground">Up to date</p>
              )}
              {status === 'checking' && <p className="text-xs text-muted-foreground">Checking for updates...</p>}
              {status === 'available' && <p className="text-xs text-primary">Version {newVersion} available</p>}
              {status === 'downloading' && downloadProgress && (
                <p className="text-xs text-muted-foreground">Downloading... {Math.round(downloadProgress.percent)}%</p>
              )}
              {status === 'downloaded' && <p className="text-xs text-green-500">Version {newVersion} ready to install</p>}
              {status === 'error' && <p className="text-xs text-destructive">Update check failed</p>}
            </div>
            <button
              onClick={status === 'downloaded' ? () => window.electronAPI.autoUpdateInstallUpdate() : status === 'available' ? () => window.electronAPI.autoUpdateDownloadUpdate() : handleCheckForUpdates}
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
          {status === 'downloading' && downloadProgress && (
            <div className="w-full bg-muted rounded-full h-1.5">
              <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${downloadProgress.percent}%` }} />
            </div>
          )}
          {/* Release notes */}
          {releaseNotes && (status === 'available' || status === 'downloaded' || status === 'downloading') && (
            <div className="border-t border-border/30 pt-3 mt-1">
              <p className="text-xs font-medium text-foreground mb-2">What's new in v{newVersion}</p>
              <div className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto pr-1">
                {releaseNotes.split('\n').filter(line => line.trim()).map((line, i) => {
                  const trimmed = line.replace(/^#+\s*/, '').replace(/^\*\s*/, '').replace(/^-\s*/, '').trim()
                  if (!trimmed) return null
                  // Section headers (lines that were ## or ### in markdown)
                  if (line.trim().startsWith('#')) {
                    return <p key={i} className="font-medium text-foreground mt-2 first:mt-0">{trimmed}</p>
                  }
                  // Bullet items
                  if (line.trim().startsWith('*') || line.trim().startsWith('-')) {
                    return <p key={i} className="pl-3 relative before:content-['·'] before:absolute before:left-0 before:text-muted-foreground/50">{trimmed}</p>
                  }
                  // Plain text
                  return <p key={i}>{trimmed}</p>
                })}
              </div>
            </div>
          )}
        </div>
        <div className="bg-muted/30 rounded-lg border border-border/40">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm text-foreground">Check for updates automatically</p>
              <p className="text-xs text-muted-foreground">Periodically checks GitHub for new releases</p>
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
