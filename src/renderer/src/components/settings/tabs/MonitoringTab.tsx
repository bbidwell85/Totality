/**
 * MonitoringTab - Live monitoring configuration
 *
 * Features:
 * - Enable/disable monitoring
 * - Per-provider polling intervals
 * - Behavior settings (start on launch, pause during scans)
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Radio } from 'lucide-react'
import { Toggle } from '../../ui/Toggle'

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

const PROVIDERS: Array<{
  key: string
  name: string
  method: 'polling' | 'file-watching'
}> = [
  { key: 'plex', name: 'Plex', method: 'polling' },
  { key: 'jellyfin', name: 'Jellyfin', method: 'polling' },
  { key: 'emby', name: 'Emby', method: 'polling' },
  { key: 'kodi', name: 'Kodi', method: 'polling' },
  { key: 'kodi-local', name: 'Kodi (Local DB)', method: 'file-watching' },
  { key: 'kodi-mysql', name: 'Kodi (MySQL)', method: 'polling' },
  { key: 'mediamonkey', name: 'MediaMonkey', method: 'polling' },
  { key: 'local', name: 'Local Folders', method: 'file-watching' },
]

const INTERVAL_OPTIONS = [
  { label: '1 min', value: 60000 },
  { label: '2 min', value: 120000 },
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '15 min', value: 900000 },
  { label: '30 min', value: 1800000 },
]

export function MonitoringTab() {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [monitoringConfig, setMonitoringConfig] = useState<MonitoringConfig>({
    enabled: false,
    startOnLaunch: true,
    pauseDuringManualScan: true,
    pollingIntervals: {
      plex: 300000,
      jellyfin: 300000,
      emby: 300000,
      kodi: 300000,
      'kodi-mysql': 300000,
      mediamonkey: 60000,
    },
  })
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = async () => {
      try {
        const [mConfig, sources] = await Promise.all([
          window.electronAPI.monitoringGetConfig(),
          window.electronAPI.sourcesList(),
        ])
        setMonitoringConfig(mConfig)
        const providerTypes = new Set<string>()
        ;(sources as MediaSource[]).forEach((source) => {
          if (source.is_enabled) providerTypes.add(source.source_type)
        })
        setConfiguredProviders(providerTypes)
      } catch (error) {
        console.error('Failed to load monitoring settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

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
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Status */}
      <div className="flex items-center gap-3 bg-muted/30 rounded-lg border border-border/40 p-4">
        <Radio className="w-5 h-5 text-muted-foreground shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-medium">Live Monitoring</h3>
          <p className="text-xs text-muted-foreground">Automatically detect new content across your media sources</p>
        </div>
        <Toggle
          checked={monitoringConfig.enabled}
          onChange={(enabled) => saveMonitoringConfig({ enabled })}
          disabled={isSaving}
        />
      </div>

      {/* Source Detection */}
      <div className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <h3 className="text-sm font-medium text-foreground">Source Detection</h3>
        <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
          {PROVIDERS.map((provider) => {
            const isConfigured = configuredProviders.has(provider.key)
            return (
              <div key={provider.key} className={`flex items-center justify-between px-4 py-2.5 ${!isConfigured ? 'opacity-40' : ''}`}>
                <span className="text-sm text-foreground">{provider.name}</span>
                {provider.method === 'polling' ? (
                  <select
                    value={monitoringConfig.pollingIntervals[provider.key] || 300000}
                    onChange={(e) => {
                      const newIntervals = { ...monitoringConfig.pollingIntervals, [provider.key]: parseInt(e.target.value, 10) }
                      saveMonitoringConfig({ pollingIntervals: newIntervals })
                    }}
                    disabled={isSaving || !monitoringConfig.enabled || !isConfigured}
                    className="bg-background text-foreground text-sm rounded-md px-3 py-2 border border-border/30 focus:outline-hidden focus:ring-2 focus:ring-primary min-w-[90px] disabled:opacity-50"
                  >
                    {INTERVAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="bg-background text-foreground text-sm rounded-md px-3 py-2 border border-border/30 min-w-[90px] text-center">
                    File Watching
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Behavior */}
      <div className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <h3 className="text-sm font-medium text-foreground">Behavior</h3>
        <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground">Start on app launch</span>
            <Toggle checked={monitoringConfig.startOnLaunch} onChange={(startOnLaunch) => saveMonitoringConfig({ startOnLaunch })} disabled={isSaving || !monitoringConfig.enabled} />
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground">Pause during manual scans</span>
            <Toggle checked={monitoringConfig.pauseDuringManualScan} onChange={(pauseDuringManualScan) => saveMonitoringConfig({ pauseDuringManualScan })} disabled={isSaving || !monitoringConfig.enabled} />
          </div>
        </div>
      </div>
    </div>
  )
}
