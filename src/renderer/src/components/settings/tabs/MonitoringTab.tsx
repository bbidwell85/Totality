/**
 * MonitoringTab - Settings tab for Live Monitoring configuration
 *
 * Features:
 * - Enable/disable live monitoring
 * - Configure polling intervals per provider
 * - Behavior settings (pause during scan, start on launch)
 */

import { useState, useEffect, useCallback } from 'react'
import { Activity, RefreshCw } from 'lucide-react'

interface MonitoringConfig {
  enabled: boolean
  startOnLaunch: boolean
  pauseDuringManualScan: boolean
  pollingIntervals: Record<string, number>
}

interface MediaSource {
  source_id: string
  source_type: string
  display_name: string
  is_enabled: boolean
}

// Provider display names and their monitoring method
const PROVIDERS: Array<{
  key: string
  name: string
  method: 'polling' | 'file-watching'
}> = [
  { key: 'plex', name: 'Plex', method: 'polling' },
  { key: 'jellyfin', name: 'Jellyfin', method: 'polling' },
  { key: 'emby', name: 'Emby', method: 'polling' },
  { key: 'kodi', name: 'Kodi', method: 'polling' },
  { key: 'local', name: 'Local Folders', method: 'file-watching' },
]

// Interval options in milliseconds
const INTERVAL_OPTIONS = [
  { label: '1 min', value: 60000 },
  { label: '2 min', value: 120000 },
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '15 min', value: 900000 },
  { label: '30 min', value: 1800000 },
]

// Toggle switch component
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

export function MonitoringTab() {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set())

  // Monitoring config
  const [monitoringConfig, setMonitoringConfig] = useState<MonitoringConfig>({
    enabled: false,
    startOnLaunch: true,
    pauseDuringManualScan: true,
    pollingIntervals: {
      plex: 300000,
      jellyfin: 300000,
      emby: 300000,
      kodi: 300000,
    },
  })

  // Load configuration
  useEffect(() => {
    async function loadConfig() {
      try {
        const [mConfig, sources] = await Promise.all([
          window.electronAPI.monitoringGetConfig(),
          window.electronAPI.sourcesList(),
        ])
        setMonitoringConfig(mConfig)

        // Build set of configured provider types
        const providerTypes = new Set<string>()
        ;(sources as MediaSource[]).forEach((source) => {
          if (source.is_enabled) {
            // Normalize provider type (kodi-local -> kodi, local -> local)
            const type = source.source_type.startsWith('kodi') ? 'kodi' : source.source_type
            providerTypes.add(type)
          }
        })
        setConfiguredProviders(providerTypes)
      } catch (error) {
        console.error('Failed to load monitoring config:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadConfig()
  }, [])

  // Save monitoring config
  const saveMonitoringConfig = useCallback(async (config: Partial<MonitoringConfig>) => {
    setIsSaving(true)
    try {
      await window.electronAPI.monitoringSetConfig(config)
      setMonitoringConfig((prev) => ({ ...prev, ...config }))
    } catch (error) {
      console.error('Failed to save monitoring config:', error)
    } finally {
      setIsSaving(false)
    }
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Enable/Disable Section */}
      <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/40">
        <div className="flex items-center gap-3">
          <Activity
            className={`w-7 h-7 ${monitoringConfig.enabled ? 'text-green-500' : 'text-muted-foreground'}`}
          />
          <div>
            <h3 className="text-sm font-medium text-foreground">Live Monitoring</h3>
            <p className="text-xs text-muted-foreground">
              {monitoringConfig.enabled
                ? 'Automatically detecting new content'
                : 'Enable to detect new content automatically'}
            </p>
          </div>
        </div>
        <Toggle
          checked={monitoringConfig.enabled}
          onChange={(enabled) => saveMonitoringConfig({ enabled })}
          disabled={isSaving}
        />
      </div>

      {/* Polling Intervals */}
      <div
        className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Source Detection</h3>
        </div>

        <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
          {PROVIDERS.map((provider) => {
            const isConfigured = configuredProviders.has(provider.key)
            return (
              <div
                key={provider.key}
                className={`flex items-center justify-between px-4 py-2.5 ${
                  !isConfigured ? 'opacity-40' : ''
                }`}
              >
                <span className="text-sm text-foreground">{provider.name}</span>

                {provider.method === 'polling' ? (
                  <select
                    value={monitoringConfig.pollingIntervals[provider.key] || 300000}
                    onChange={(e) => {
                      const newIntervals = {
                        ...monitoringConfig.pollingIntervals,
                        [provider.key]: parseInt(e.target.value, 10),
                      }
                      saveMonitoringConfig({ pollingIntervals: newIntervals })
                    }}
                    disabled={isSaving || !monitoringConfig.enabled || !isConfigured}
                    className="bg-background text-foreground text-xs rounded-md px-2.5 py-1.5 border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary min-w-[90px] disabled:opacity-50"
                  >
                    {INTERVAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="bg-background text-foreground text-xs rounded-md px-2.5 py-1.5 border border-border/50 min-w-[90px] text-center">
                    File Watching
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Behavior */}
      <div
        className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <h3 className="text-sm font-medium text-foreground">Behavior</h3>

        <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <span className="text-sm text-foreground">Start on app launch</span>
              <p className="text-xs text-muted-foreground">Begin monitoring when Totality opens</p>
            </div>
            <Toggle
              checked={monitoringConfig.startOnLaunch}
              onChange={(startOnLaunch) => saveMonitoringConfig({ startOnLaunch })}
              disabled={isSaving || !monitoringConfig.enabled}
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <span className="text-sm text-foreground">Pause during manual scans</span>
              <p className="text-xs text-muted-foreground">
                Prevents conflicts when you trigger a scan manually
              </p>
            </div>
            <Toggle
              checked={monitoringConfig.pauseDuringManualScan}
              onChange={(pauseDuringManualScan) => saveMonitoringConfig({ pauseDuringManualScan })}
              disabled={isSaving || !monitoringConfig.enabled}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
