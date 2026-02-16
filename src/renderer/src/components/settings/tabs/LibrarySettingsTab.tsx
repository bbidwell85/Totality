/**
 * LibrarySettingsTab - Settings tab for library preferences and exclusion management
 *
 * Uses collapsible card layout matching the Services tab pattern.
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

const EXCLUSION_SECTIONS = [
  { type: 'media_upgrade', label: 'Dismissed Upgrades', icon: CircleFadingArrowUp },
  { type: 'collection_movie', label: 'Dismissed Collection Movies', icon: Film },
  { type: 'series_episode', label: 'Dismissed Episodes', icon: Tv },
  { type: 'artist_album', label: 'Dismissed Albums', icon: Music },
] as const

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
        ] = await Promise.all([
          window.electronAPI.getSetting('completeness_include_eps'),
          window.electronAPI.getSetting('completeness_include_singles'),
          window.electronAPI.getExclusions('media_upgrade'),
          window.electronAPI.getExclusions('collection_movie'),
          window.electronAPI.getExclusions('series_episode'),
          window.electronAPI.getExclusions('artist_album'),
        ])

        setIncludeEps((epsVal as string) !== 'false')
        setIncludeSingles((singlesVal as string) !== 'false')
        setExclusions({
          media_upgrade: mediaUpgrade as ExclusionRecord[],
          collection_movie: collectionMovie as ExclusionRecord[],
          series_episode: seriesEpisode as ExclusionRecord[],
          artist_album: artistAlbum as ExclusionRecord[],
        })
      } catch (error) {
        console.error('Failed to load library settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [])

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
          Configure library analysis preferences and exclusions.
        </p>
      </div>

      {/* Library Analysis Card */}
      <SettingsCard
        title="Library Analysis"
        description="Music completeness and dismissed items"
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
            </div>
          </div>

          {/* Managed Exclusions */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Managed Exclusions</p>
            <p className="text-xs text-muted-foreground">
              {totalExclusions === 0
                ? 'Items you dismiss will appear here.'
                : `${totalExclusions} dismissed item${totalExclusions !== 1 ? 's' : ''}. Remove items to see them again.`}
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

    </div>
  )
}
