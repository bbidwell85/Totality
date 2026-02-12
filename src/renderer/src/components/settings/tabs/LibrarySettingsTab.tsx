/**
 * LibrarySettingsTab - Settings tab for library preferences, monitoring, and exclusion management
 *
 * Uses collapsible card layout matching the Services tab pattern.
 * Two cards: Library Analysis (completeness + exclusions + recommendations) and Live Monitoring.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Music,
  Film,
  Tv,
  CircleFadingArrowUp,
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  Activity,
  Library,
  CheckCircle,
  Circle,
} from 'lucide-react'

interface ExclusionRecord {
  id: number
  exclusion_type: string
  reference_id: number | null
  reference_key: string | null
  parent_key: string | null
  title: string | null
  created_at: string
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

const EXCLUSION_SECTIONS = [
  { type: 'media_upgrade', label: 'Dismissed Upgrades', icon: CircleFadingArrowUp },
  { type: 'collection_movie', label: 'Dismissed Collection Movies', icon: Film },
  { type: 'series_episode', label: 'Dismissed Episodes', icon: Tv },
  { type: 'artist_album', label: 'Dismissed Albums', icon: Music },
] as const

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

// Collapsible card matching Services tab design
interface SettingsCardProps {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function SettingsCard({
  title,
  description,
  icon,
  status,
  statusText,
  expanded,
  onToggle,
  children,
}: SettingsCardProps) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex-shrink-0">
          {status === 'configured' ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : status === 'partial' ? (
            <CheckCircle className="w-5 h-5 text-amber-500" />
          ) : (
            <Circle className="w-5 h-5 text-muted-foreground/50" />
          )}
        </div>
        <div className="flex-shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-muted-foreground">{statusText}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
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

export function LibrarySettingsTab() {
  const [isLoading, setIsLoading] = useState(true)

  // Card expand state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set(['analysis']))

  // Music completeness toggles
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)

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
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  // Exclusions
  const [exclusions, setExclusions] = useState<Record<string, ExclusionRecord[]>>({
    media_upgrade: [],
    collection_movie: [],
    series_episode: [],
    artist_album: [],
  })
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  const toggleCard = (card: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(card)) next.delete(card)
      else next.add(card)
      return next
    })
  }

  // Load all data on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [
          epsVal,
          singlesVal,
          mediaUpgrade,
          collectionMovie,
          seriesEpisode,
          artistAlbum,
          mConfig,
          sources,
        ] = await Promise.all([
          window.electronAPI.getSetting('completeness_include_eps'),
          window.electronAPI.getSetting('completeness_include_singles'),
          window.electronAPI.getExclusions('media_upgrade'),
          window.electronAPI.getExclusions('collection_movie'),
          window.electronAPI.getExclusions('series_episode'),
          window.electronAPI.getExclusions('artist_album'),
          window.electronAPI.monitoringGetConfig(),
          window.electronAPI.sourcesList(),
        ])

        setIncludeEps((epsVal as string) !== 'false')
        setIncludeSingles((singlesVal as string) !== 'false')
        setExclusions({
          media_upgrade: mediaUpgrade as ExclusionRecord[],
          collection_movie: collectionMovie as ExclusionRecord[],
          series_episode: seriesEpisode as ExclusionRecord[],
          artist_album: artistAlbum as ExclusionRecord[],
        })
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
        console.error('Failed to load library settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
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

  const reloadExclusions = useCallback(async () => {
    try {
      const [mediaUpgrade, collectionMovie, seriesEpisode, artistAlbum] = await Promise.all([
        window.electronAPI.getExclusions('media_upgrade'),
        window.electronAPI.getExclusions('collection_movie'),
        window.electronAPI.getExclusions('series_episode'),
        window.electronAPI.getExclusions('artist_album'),
      ])
      setExclusions({
        media_upgrade: mediaUpgrade as ExclusionRecord[],
        collection_movie: collectionMovie as ExclusionRecord[],
        series_episode: seriesEpisode as ExclusionRecord[],
        artist_album: artistAlbum as ExclusionRecord[],
      })
    } catch (error) {
      console.error('Failed to reload exclusions:', error)
    }
  }, [])

  const toggleSection = useCallback((type: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const handleRemoveExclusion = useCallback(
    async (id: number, type: string) => {
      setExclusions((prev) => ({
        ...prev,
        [type]: prev[type].filter((e) => e.id !== id),
      }))
      try {
        await window.electronAPI.removeExclusion(id)
      } catch (error) {
        console.error('Failed to remove exclusion:', error)
        await reloadExclusions()
      }
    },
    [reloadExclusions]
  )

  const handleClearAll = useCallback(
    async (type: string) => {
      const items = exclusions[type]
      if (items.length === 0) return
      setExclusions((prev) => ({ ...prev, [type]: [] }))
      try {
        await Promise.all(items.map((e) => window.electronAPI.removeExclusion(e.id)))
      } catch (error) {
        console.error('Failed to clear exclusions:', error)
        await reloadExclusions()
      }
    },
    [exclusions, reloadExclusions]
  )

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const totalExclusions = Object.values(exclusions).reduce((sum, list) => sum + list.length, 0)

  return (
    <div className="p-6 space-y-3 overflow-y-auto h-full">
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs text-muted-foreground">
          Configure library analysis preferences, exclusions, and live monitoring.
        </p>
      </div>

      {/* Library Analysis Card */}
      <SettingsCard
        title="Library Analysis"
        description="Music completeness, dismissed items, and recommendations"
        icon={<Library className="w-5 h-5" />}
        status="configured"
        statusText={
          totalExclusions > 0
            ? `${totalExclusions} exclusion${totalExclusions !== 1 ? 's' : ''}`
            : 'Active'
        }
        expanded={expandedCards.has('analysis')}
        onToggle={() => toggleCard('analysis')}
      >
        <div className="space-y-4">
          {/* Completeness Options */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Completeness</p>
            <p className="text-xs text-muted-foreground">
              Configure how completeness analysis works across your libraries.
              Changes take effect on next analysis run.
            </p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Include EPs</span>
                <Toggle
                  checked={includeEps}
                  onChange={async (checked) => {
                    setIncludeEps(checked)
                    await window.electronAPI.setSetting(
                      'completeness_include_eps',
                      String(checked)
                    )
                  }}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Include Singles</span>
                <Toggle
                  checked={includeSingles}
                  onChange={async (checked) => {
                    setIncludeSingles(checked)
                    await window.electronAPI.setSetting(
                      'completeness_include_singles',
                      String(checked)
                    )
                  }}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3 opacity-50">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">Similar Content Recommendations</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">Coming soon</span>
                </div>
                <Toggle checked={false} onChange={() => {}} disabled={true} />
              </div>
            </div>
          </div>

          {/* Managed Exclusions */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Managed Exclusions</p>
            <p className="text-xs text-muted-foreground">
              {totalExclusions === 0
                ? 'Items you dismiss from recommendations will appear here.'
                : `${totalExclusions} item${totalExclusions !== 1 ? 's' : ''} dismissed from recommendations. Remove items to see them again.`}
            </p>
            <div className="bg-background/50 rounded-lg divide-y divide-border/30">
              {EXCLUSION_SECTIONS.map((section) => {
                const items = exclusions[section.type] || []
                const isExpanded = expandedSections.has(section.type)
                const Icon = section.icon

                return (
                  <div key={section.type}>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.type)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm text-foreground">{section.label}</span>
                        {items.length > 0 && (
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                            {items.length}
                          </span>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/30">
                        {items.length === 0 ? (
                          <p className="px-4 py-3 text-xs text-muted-foreground italic">
                            No dismissed items
                          </p>
                        ) : (
                          <>
                            <div className="flex justify-end px-4 pt-2">
                              <button
                                type="button"
                                onClick={() => handleClearAll(section.type)}
                                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                              >
                                Clear All
                              </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto px-4 pb-3">
                              {items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between py-1.5 group"
                                >
                                  <span className="text-xs text-foreground truncate mr-2">
                                    {item.title || item.reference_key || 'Unknown item'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveExclusion(item.id, section.type)}
                                    className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                                    title="Remove exclusion"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>        </div>
      </SettingsCard>

      {/* Live Monitoring Card */}
      <SettingsCard
        title="Live Monitoring"
        description="Automatically detect new content from your sources"
        icon={<Activity className="w-5 h-5" />}
        status={monitoringConfig.enabled ? 'configured' : 'not-configured'}
        statusText={monitoringConfig.enabled ? 'Active' : 'Disabled'}
        expanded={expandedCards.has('monitoring')}
        onToggle={() => toggleCard('monitoring')}
      >
        <div className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
            <div>
              <span className="text-sm font-medium">Enable monitoring</span>
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
