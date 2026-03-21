/**
 * GeneralTab - Settings tab for general application behavior
 *
 * Features:
 * - Minimize to tray on close
 * - Start minimized to tray
 * - Live monitoring configuration (enable, polling intervals, behavior)
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Monitor, Radio, ChevronDown, CheckCircle, Circle } from 'lucide-react'

// Collapsible settings card matching Library/Services tab pattern
function SettingsCard({ title, description, icon, status, statusText, expanded, onToggle, children }: {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="shrink-0">
          {status === 'configured' ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : status === 'partial' ? (
            <CheckCircle className="w-5 h-5 text-amber-500" />
          ) : (
            <Circle className="w-5 h-5 text-muted-foreground/50" />
          )}
        </div>
        <div className="shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-muted-foreground">{statusText}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
}

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

export function GeneralTab() {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const toggleCard = (id: string) => setExpandedCards(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const [isLoading, setIsLoading] = useState(true)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)
  // Monitoring state
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
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [trayVal, startVal, mConfig, sources] = await Promise.all([
          window.electronAPI.getSetting('minimize_to_tray'),
          window.electronAPI.getSetting('start_minimized_to_tray'),
          window.electronAPI.monitoringGetConfig(),
          window.electronAPI.sourcesList(),
        ])
        setMinimizeToTray(trayVal === 'true')
        setStartMinimized(startVal === 'true')
        setMonitoringConfig(mConfig)

        const providerTypes = new Set<string>()
        ;(sources as MediaSource[]).forEach((source) => {
          if (source.is_enabled) {
            const type = source.source_type.startsWith('kodi') ? 'kodi' : source.source_type
            providerTypes.add(type)
          }
        })
        setConfiguredProviders(providerTypes)
      } catch (error) {
        console.error('Failed to load general settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const saveMonitoringConfig = useCallback(
    async (config: Partial<MonitoringConfig>) => {
      setIsSaving(true)
      try {
        await window.electronAPI.monitoringSetConfig(config)
        setMonitoringConfig((prev) => ({ ...prev, ...config }))
      } catch (error) {
        console.error('Failed to save monitoring config:', error)
      } finally {
        setIsSaving(false)
      }
    },
    []
  )

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Window Behavior */}
      <SettingsCard
        title="Window Behavior"
        description="System tray and startup options"
        icon={<Monitor className="w-5 h-5" />}
        status="configured"
        statusText={minimizeToTray ? 'Tray enabled' : 'Default'}
        expanded={expandedCards.has('window')}
        onToggle={() => toggleCard('window')}
      >
        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-foreground">Minimize to tray on close</p>
              <p className="text-xs text-muted-foreground">Closing the window hides the app to the system tray instead of quitting</p>
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
          </label>

          {minimizeToTray && (
            <label className="flex items-center justify-between cursor-pointer pl-4 border-l-2 border-border/40">
              <div>
                <p className="text-sm font-medium text-foreground">Start minimized to tray</p>
                <p className="text-xs text-muted-foreground">Launch the app hidden in the system tray</p>
              </div>
              <Toggle
                checked={startMinimized}
                onChange={async (checked) => {
                  setStartMinimized(checked)
                  await window.electronAPI.setSetting('start_minimized_to_tray', String(checked))
                }}
              />
            </label>
          )}
        </div>
      </SettingsCard>

      {/* Live Monitoring */}
      <SettingsCard
        title="Live Monitoring"
        description="Automatic change detection for media sources"
        icon={<Radio className="w-5 h-5" />}
        status={monitoringConfig.enabled ? 'configured' : 'not-configured'}
        statusText={monitoringConfig.enabled ? 'Active' : 'Disabled'}
        expanded={expandedCards.has('monitoring')}
        onToggle={() => toggleCard('monitoring')}
      >
        <div className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Enable monitoring</p>
              <p className="text-xs text-muted-foreground">
                {monitoringConfig.enabled
                  ? 'Automatically detecting new content'
                  : 'Enable to detect new content automatically'}
              </p>
            </div>
            <Toggle
              checked={monitoringConfig.enabled}
              onChange={(enabled) => saveMonitoringConfig({ enabled })}
              disabled={isSaving}
            />
          </div>

          {/* Source Detection */}
          <div
            className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <p className="text-xs font-medium text-foreground">Source Detection</p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
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
                        className="bg-background text-foreground text-sm rounded-md px-3 py-2 border border-border/30 focus:outline-hidden focus:ring-2 focus:ring-primary min-w-[90px] disabled:opacity-50"
                      >
                        {INTERVAL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
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
          <div
            className={`space-y-2 transition-opacity ${!monitoringConfig.enabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <p className="text-xs font-medium text-foreground">Behavior</p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Start on app launch</span>
                <Toggle
                  checked={monitoringConfig.startOnLaunch}
                  onChange={(startOnLaunch) => saveMonitoringConfig({ startOnLaunch })}
                  disabled={isSaving || !monitoringConfig.enabled}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Pause during manual scans</span>
                <Toggle
                  checked={monitoringConfig.pauseDuringManualScan}
                  onChange={(pauseDuringManualScan) =>
                    saveMonitoringConfig({ pauseDuringManualScan })
                  }
                  disabled={isSaving || !monitoringConfig.enabled}
                />
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
