/**
 * QualitySettingsTab - Settings tab for quality threshold configuration
 *
 * Features:
 * - Video quality thresholds per resolution tier (SD, 720p, 1080p, 4K)
 * - Audio bitrate thresholds
 * - Music quality thresholds (lossy and hi-res)
 * - Re-analyze library after changes
 */

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { RotateCcw, Save, Loader2, RefreshCw, ChevronDown, Film, Music, Clapperboard, Copy, Check, Gauge } from 'lucide-react'

// Default values for all quality settings
const DEFAULT_SETTINGS = {
  quality_video_sd_medium: 1500,
  quality_video_sd_high: 3500,
  quality_video_720p_medium: 3000,
  quality_video_720p_high: 8000,
  quality_video_1080p_medium: 6000,
  quality_video_1080p_high: 15000,
  quality_video_4k_medium: 15000,
  quality_video_4k_high: 40000,
  quality_audio_sd_medium: 128,
  quality_audio_sd_high: 192,
  quality_audio_720p_medium: 192,
  quality_audio_720p_high: 320,
  quality_audio_1080p_medium: 256,
  quality_audio_1080p_high: 640,
  quality_audio_4k_medium: 320,
  quality_audio_4k_high: 1000,
  quality_music_low_bitrate: 192,
  quality_music_high_bitrate: 256,
  quality_music_hires_samplerate: 44100,
  quality_music_hires_bitdepth: 16,
  quality_codec_h264: 1.0,
  quality_codec_h265: 2.0,
  quality_codec_av1: 2.5,
  quality_codec_vp9: 1.8,
}

type SettingsState = typeof DEFAULT_SETTINGS
type ResolutionTier = 'sd' | '720p' | '1080p' | '4k'

const RESOLUTION_TABS: { id: ResolutionTier; label: string; description: string }[] = [
  { id: 'sd', label: 'SD', description: 'Standard definition (<720p)' },
  { id: '720p', label: '720p', description: '720p HD content' },
  { id: '1080p', label: '1080p', description: '1080p Full HD content' },
  { id: '4k', label: '4K', description: '4K Ultra HD (≥2160p)' },
]

const VIDEO_THRESHOLDS: Record<ResolutionTier, { min: number; max: number; step: number }> = {
  sd: { min: 500, max: 10000, step: 100 },
  '720p': { min: 1000, max: 15000, step: 100 },
  '1080p': { min: 2000, max: 30000, step: 100 },
  '4k': { min: 5000, max: 80000, step: 500 },
}

const AUDIO_THRESHOLDS: Record<ResolutionTier, { min: number; max: number; step: number }> = {
  sd: { min: 64, max: 640, step: 8 },
  '720p': { min: 64, max: 1000, step: 8 },
  '1080p': { min: 64, max: 1500, step: 8 },
  '4k': { min: 64, max: 2000, step: 8 },
}

// Expandable card component (matching ServicesTab)
interface SettingsCardProps {
  title: string
  description: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function SettingsCard({
  title,
  description,
  icon,
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
        {/* Icon */}
        <div className="flex-shrink-0 text-muted-foreground">{icon}</div>

        {/* Title and description */}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{title}</span>
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

function formatEffectiveThreshold(thresholdKbps: number, multiplier: number): string {
  const neededKbps = thresholdKbps / multiplier
  if (neededKbps >= 1000) {
    return `${(neededKbps / 1000).toFixed(1)} Mbps`
  }
  return `${Math.round(neededKbps)} kbps`
}

export function QualitySettingsTab() {
  const [settings, setSettings] = useState<SettingsState>({ ...DEFAULT_SETTINGS })
  const [originalSettings, setOriginalSettings] = useState<SettingsState>({ ...DEFAULT_SETTINGS })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedTier, setSelectedTier] = useState<ResolutionTier>('1080p')
  const [showReanalyzePrompt, setShowReanalyzePrompt] = useState(false)
  const [isReanalyzing, setIsReanalyzing] = useState(false)
  const [reanalyzeProgress, setReanalyzeProgress] = useState<{ current: number; total: number } | null>(null)

  // Expanded state for cards
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set(['video']))

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
    const cleanup = window.electronAPI.onQualityAnalysisProgress?.((progress: unknown) => {
      setReanalyzeProgress(progress as { current: number; total: number })
    })
    return () => cleanup?.()
  }, [])

  useEffect(() => {
    const changed = JSON.stringify(settings) !== JSON.stringify(originalSettings)
    setHasChanges(changed)
  }, [settings, originalSettings])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const allSettings = await window.electronAPI.getAllSettings()
      const loaded: SettingsState = { ...DEFAULT_SETTINGS }

      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[]) {
        if (allSettings[key] !== undefined && allSettings[key] !== '') {
          const value = parseFloat(allSettings[key])
          if (!isNaN(value)) {
            loaded[key] = value
          }
        }
      }

      setSettings(loaded)
      setOriginalSettings(loaded)
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      for (const [key, value] of Object.entries(settings)) {
        await window.electronAPI.setSetting(key, String(value))
      }
      setOriginalSettings({ ...settings })
      setShowReanalyzePrompt(true)
    } catch (error) {
      console.error('Failed to save settings:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReanalyze = async () => {
    setIsReanalyzing(true)
    setReanalyzeProgress({ current: 0, total: 0 })
    try {
      await window.electronAPI.qualityAnalyzeAll()
    } catch (error) {
      console.error('Failed to re-analyze:', error)
    } finally {
      setIsReanalyzing(false)
      setReanalyzeProgress(null)
      setShowReanalyzePrompt(false)
    }
  }

  const handleSkipReanalyze = () => {
    setShowReanalyzePrompt(false)
  }

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS })
  }

  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (showReanalyzePrompt) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-64 text-center">
        {isReanalyzing ? (
          <>
            <RefreshCw className="w-8 h-8 animate-spin text-primary mb-4" aria-hidden="true" />
            <h3 className="text-base font-medium mb-2">Re-analyzing Library</h3>
            {reanalyzeProgress && reanalyzeProgress.total > 0 ? (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  {reanalyzeProgress.current} of {reanalyzeProgress.total} items
                </p>
                <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(reanalyzeProgress.current / reanalyzeProgress.total) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Starting analysis...</p>
            )}
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mb-4">
              <Save className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-base font-medium mb-2">Settings Saved</h3>
            <p className="text-xs text-muted-foreground mb-6 max-w-sm">
              Would you like to re-analyze your library with the new quality thresholds?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSkipReanalyze}
                className="px-3 py-1.5 text-xs rounded-md hover:bg-muted transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleReanalyze}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Re-analyze Library
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-3 overflow-y-auto">
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs text-muted-foreground">
          Configure bitrate thresholds for quality scoring. Newer codecs like HEVC and AV1 look just as good at lower bitrates, so scores are adjusted automatically — see Codec Efficiency below. Audio thresholds target stereo codecs (AAC, MP3) and scale for surround formats (AC3, EAC3, DTS).
        </p>
      </div>

      {/* Video Quality Card */}
      <SettingsCard
        title="Video Quality"
        description="Bitrate thresholds for movies and TV shows"
        icon={<Film className="w-7 h-7" />}
        expanded={expandedCards.has('video')}
        onToggle={() => toggleCard('video')}
      >
        <div className="space-y-4">
          {/* Resolution Tabs */}
          <div className="flex gap-1 bg-muted p-1 rounded-lg" role="tablist">
            {RESOLUTION_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTier(tab.id)}
                role="tab"
                aria-selected={selectedTier === tab.id}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  selectedTier === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {RESOLUTION_TABS.find(t => t.id === selectedTier)?.description}
          </p>

          <div className="grid grid-cols-2 gap-4">
            <QualityThreshold
              label="Video Bitrate"
              mediumValue={settings[`quality_video_${selectedTier}_medium` as keyof SettingsState] as number}
              highValue={settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number}
              min={VIDEO_THRESHOLDS[selectedTier].min}
              max={VIDEO_THRESHOLDS[selectedTier].max}
              step={VIDEO_THRESHOLDS[selectedTier].step}
              unit="Mbps"
              displayDivisor={1000}
              onChange={(medium, high) => {
                updateSetting(`quality_video_${selectedTier}_medium` as keyof SettingsState, medium)
                updateSetting(`quality_video_${selectedTier}_high` as keyof SettingsState, high)
              }}
            />
            <QualityThreshold
              label="Audio Bitrate Target"
              mediumValue={settings[`quality_audio_${selectedTier}_medium` as keyof SettingsState] as number}
              highValue={settings[`quality_audio_${selectedTier}_high` as keyof SettingsState] as number}
              min={AUDIO_THRESHOLDS[selectedTier].min}
              max={AUDIO_THRESHOLDS[selectedTier].max}
              step={AUDIO_THRESHOLDS[selectedTier].step}
              unit="kbps"
              onChange={(medium, high) => {
                updateSetting(`quality_audio_${selectedTier}_medium` as keyof SettingsState, medium)
                updateSetting(`quality_audio_${selectedTier}_high` as keyof SettingsState, high)
              }}
            />
          </div>
        </div>
      </SettingsCard>

      {/* Codec Efficiency Card */}
      <SettingsCard
        title="Codec Efficiency"
        description="How much credit each codec gets for using lower bitrates"
        icon={<Gauge className="w-7 h-7" />}
        expanded={expandedCards.has('codec')}
        onToggle={() => toggleCard('codec')}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Newer codecs like HEVC and AV1 deliver the same picture quality at much lower bitrates
            than H.264. To score them fairly, Totality gives newer codecs credit for their
            efficiency — an HEVC file doesn't need as high a bitrate to earn the same score.
          </p>
          <p className="text-xs text-muted-foreground">
            A value of 2.0x means the codec is twice as efficient as H.264, so it only needs half
            the bitrate to score the same. Higher values = more credit for efficiency.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <NumberInput
              label="H.264 (baseline)"
              value={settings.quality_codec_h264}
              min={0.5}
              max={5.0}
              step={0.1}
              onChange={(v) => updateSetting('quality_codec_h264', v)}
              hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_h264)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
            />
            <NumberInput
              label="HEVC / H.265"
              value={settings.quality_codec_h265}
              min={0.5}
              max={5.0}
              step={0.1}
              onChange={(v) => updateSetting('quality_codec_h265', v)}
              hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_h265)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
            />
            <NumberInput
              label="AV1"
              value={settings.quality_codec_av1}
              min={0.5}
              max={5.0}
              step={0.1}
              onChange={(v) => updateSetting('quality_codec_av1', v)}
              hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_av1)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
            />
            <NumberInput
              label="VP9"
              value={settings.quality_codec_vp9}
              min={0.5}
              max={5.0}
              step={0.1}
              onChange={(v) => updateSetting('quality_codec_vp9', v)}
              hint={`Needs ${formatEffectiveThreshold(settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number, settings.quality_codec_vp9)} for ${RESOLUTION_TABS.find(t => t.id === selectedTier)?.label} HIGH`}
            />
          </div>

          <p className="text-[10px] text-muted-foreground italic">
            Most users won't need to change these. Adjust if your HEVC or AV1 files are scoring
            higher or lower than they look — lower the value if scores seem too generous, raise it
            if scores seem too harsh.
          </p>
        </div>
      </SettingsCard>

      {/* Music Quality Card */}
      <SettingsCard
        title="Music Quality"
        description="Bitrate thresholds for music files"
        icon={<Music className="w-7 h-7" />}
        expanded={expandedCards.has('music')}
        onToggle={() => toggleCard('music')}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Set bitrate thresholds for lossy music quality tiers and hi-res detection.
          </p>

          <QualityThreshold
            label="Lossy Audio"
            mediumValue={settings.quality_music_low_bitrate}
            highValue={settings.quality_music_high_bitrate}
            min={64}
            max={320}
            step={8}
            unit="kbps"
            lowLabel="LOSSY_LOW"
            mediumLabel="LOSSY_MID"
            highLabel="LOSSY_HIGH"
            onChange={(medium, high) => {
              updateSetting('quality_music_low_bitrate', medium)
              updateSetting('quality_music_high_bitrate', high)
            }}
          />

          <div className="grid grid-cols-2 gap-4">
            <NumberInput
              label="Hi-Res Sample Rate Threshold (Hz)"
              value={settings.quality_music_hires_samplerate}
              min={44100}
              max={192000}
              step={100}
              onChange={(v) => updateSetting('quality_music_hires_samplerate', v)}
              hint="Above this = Hi-Res"
            />
            <NumberInput
              label="Hi-Res Bit Depth Threshold"
              value={settings.quality_music_hires_bitdepth}
              min={16}
              max={32}
              onChange={(v) => updateSetting('quality_music_hires_bitdepth', v)}
              hint="Above this = Hi-Res"
            />
          </div>
        </div>
      </SettingsCard>

      {/* Handbrake Encoding Guide Card */}
      <SettingsCard
        title="Handbrake Encoding Guide"
        description="Recommended settings to meet quality thresholds"
        icon={<Clapperboard className="w-7 h-7" />}
        expanded={expandedCards.has('handbrake')}
        onToggle={() => toggleCard('handbrake')}
      >
        <HandbrakeGuide selectedTier={selectedTier} setSelectedTier={setSelectedTier} settings={settings} />
      </SettingsCard>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3">
        <button
          onClick={handleReset}
          disabled={isSaving}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to Defaults
        </button>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>
    </div>
  )
}

// Quality threshold component with visual LOW/MEDIUM/HIGH zones
function QualityThreshold({
  label,
  mediumValue,
  highValue,
  min,
  max,
  step,
  unit,
  displayDivisor = 1,
  lowLabel = 'LOW',
  mediumLabel = 'MEDIUM',
  highLabel = 'HIGH',
  onChange,
}: {
  label: string
  mediumValue: number
  highValue: number
  min: number
  max: number
  step: number
  unit: string
  displayDivisor?: number
  lowLabel?: string
  mediumLabel?: string
  highLabel?: string
  onChange: (medium: number, high: number) => void
}) {
  const formatValue = (value: number) => {
    const displayed = value / displayDivisor
    return displayDivisor > 1 ? displayed.toFixed(1) : displayed.toLocaleString()
  }
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'medium' | 'high' | null>(null)

  const getPercent = (value: number) => ((value - min) / (max - min)) * 100

  const getValueFromPosition = useCallback((clientX: number) => {
    if (!trackRef.current) return min
    const rect = trackRef.current.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const rawValue = min + percent * (max - min)
    return Math.round(rawValue / step) * step
  }, [min, max, step])

  const handleMouseDown = (handle: 'medium' | 'high') => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(handle)
  }

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newValue = getValueFromPosition(e.clientX)
      if (dragging === 'medium') {
        onChange(Math.min(newValue, highValue - step), highValue)
      } else {
        onChange(mediumValue, Math.max(newValue, mediumValue + step))
      }
    }

    const handleMouseUp = () => setDragging(null)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, mediumValue, highValue, step, onChange, getValueFromPosition])

  const mediumPercent = getPercent(mediumValue)
  const highPercent = getPercent(highValue)

  return (
    <div className="bg-background/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
      </div>

      <div className="relative h-6">
        <div
          ref={trackRef}
          className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-3 rounded-full cursor-pointer overflow-hidden"
          onClick={(e) => {
            const value = getValueFromPosition(e.clientX)
            const distToMedium = Math.abs(value - mediumValue)
            const distToHigh = Math.abs(value - highValue)
            if (distToMedium < distToHigh) {
              onChange(Math.min(value, highValue - step), highValue)
            } else {
              onChange(mediumValue, Math.max(value, mediumValue + step))
            }
          }}
        >
          <div className="absolute h-full bg-accent/20" style={{ left: 0, width: `${mediumPercent}%` }} />
          <div className="absolute h-full bg-accent/40" style={{ left: `${mediumPercent}%`, width: `${highPercent - mediumPercent}%` }} />
          <div className="absolute h-full bg-accent/70" style={{ left: `${highPercent}%`, width: `${100 - highPercent}%` }} />
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label} ${mediumLabel} threshold`}
          aria-valuemin={min}
          aria-valuemax={highValue - step}
          aria-valuenow={mediumValue}
          className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full cursor-grab shadow-md border-2 border-background z-10 ${dragging === 'medium' ? 'cursor-grabbing scale-110' : 'hover:scale-110'} transition-transform`}
          style={{ left: `${mediumPercent}%`, marginLeft: '-8px' }}
          onMouseDown={handleMouseDown('medium')}
        />

        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label} ${highLabel} threshold`}
          aria-valuemin={mediumValue + step}
          aria-valuemax={max}
          aria-valuenow={highValue}
          className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full cursor-grab shadow-md border-2 border-background z-10 ${dragging === 'high' ? 'cursor-grabbing scale-110' : 'hover:scale-110'} transition-transform`}
          style={{ left: `${highPercent}%`, marginLeft: '-8px' }}
          onMouseDown={handleMouseDown('high')}
        />
      </div>

      <div className="flex text-[10px] font-medium">
        <div className="text-accent/40" style={{ width: `${mediumPercent}%` }}>{lowLabel}</div>
        <div className="text-accent/60 text-center" style={{ width: `${highPercent - mediumPercent}%` }}>{mediumLabel}</div>
        <div className="text-accent text-right flex-1">{highLabel}</div>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{formatValue(min)} {unit}</span>
        <span className="text-accent/60">{formatValue(mediumValue)}</span>
        <span className="text-accent">{formatValue(highValue)}</span>
        <span>{formatValue(max)} {unit}</span>
      </div>
    </div>
  )
}

// Number input component
function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  hint?: string
}) {
  const inputId = useId()
  const hintId = useId()

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-xs text-muted-foreground">{label}</label>
      <input
        id={inputId}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v) && v >= min && v <= max) {
            onChange(v)
          }
        }}
        aria-describedby={hint ? hintId : undefined}
        className="w-full px-3 py-1.5 bg-background border border-border/30 rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {hint && <p id={hintId} className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

// Detailed Handbrake presets for power users - focused on HIGH quality with minimal visual loss
const HANDBRAKE_DETAILED_PRESETS: Record<ResolutionTier, {
  description: string
  x264: {
    rf: string
    preset: string
    tune: string
    profile: string
    level: string
    extraOptions: string
  }
  x265: {
    rf: string
    preset: string
    tune: string
    profile: string
    level: string
    extraOptions: string
  }
  audio: {
    primary: string
    fallback: string
    bitrate: string
  }
  notes: string[]
}> = {
  sd: {
    description: 'DVD-quality content, prioritize detail preservation',
    x264: {
      rf: '18-19',
      preset: 'slow',
      tune: 'film',
      profile: 'high',
      level: '4.0',
      extraOptions: 'ref=5:bframes=8:b-adapt=2:direct=auto:me=umh:subme=9:trellis=2:psy-rd=1.0,0.15:deblock=-1,-1:rc-lookahead=60',
    },
    x265: {
      rf: '20-21',
      preset: 'slow',
      tune: 'none',
      profile: 'main',
      level: '4.0',
      extraOptions: 'ref=5:bframes=8:rd=4:psy-rd=2.0:psy-rdoq=1.0:aq-mode=3:rc-lookahead=60:deblock=-1,-1',
    },
    audio: {
      primary: 'Passthrough (AC3/DTS)',
      fallback: 'AAC 192 kbps stereo',
      bitrate: '192+',
    },
    notes: [
      'Use "film" tune for live action, "animation" for cartoons/anime',
      'Grain preservation: add grain=1 to extra options if source is grainy',
    ],
  },
  '720p': {
    description: 'HD content, balance between quality and file size',
    x264: {
      rf: '17-18',
      preset: 'slow',
      tune: 'film',
      profile: 'high',
      level: '4.1',
      extraOptions: 'ref=5:bframes=8:b-adapt=2:direct=auto:me=umh:subme=10:trellis=2:psy-rd=1.0,0.15:deblock=-1,-1:rc-lookahead=60:aq-mode=2',
    },
    x265: {
      rf: '19-20',
      preset: 'slow',
      tune: 'none',
      profile: 'main10',
      level: '4.1',
      extraOptions: 'ref=5:bframes=8:rd=4:psy-rd=2.0:psy-rdoq=1.0:aq-mode=3:rc-lookahead=60:deblock=-1,-1:sao=0',
    },
    audio: {
      primary: 'Passthrough (AC3/DTS/E-AC3)',
      fallback: 'AAC 256 kbps or AC3 448 kbps',
      bitrate: '320+',
    },
    notes: [
      'main10 profile for x265 reduces banding in gradients',
      'sao=0 disables sample adaptive offset for sharper output',
    ],
  },
  '1080p': {
    description: 'Full HD, maximum quality preservation for archival',
    x264: {
      rf: '16-17',
      preset: 'slower',
      tune: 'film',
      profile: 'high',
      level: '4.1',
      extraOptions: 'ref=6:bframes=8:b-adapt=2:direct=auto:me=umh:subme=10:trellis=2:psy-rd=1.0,0.15:deblock=-1,-1:rc-lookahead=60:aq-mode=3:aq-strength=0.8',
    },
    x265: {
      rf: '18-19',
      preset: 'slower',
      tune: 'none',
      profile: 'main10',
      level: '5.0',
      extraOptions: 'ref=5:bframes=8:rd=5:psy-rd=2.0:psy-rdoq=1.5:aq-mode=3:aq-strength=0.8:rc-lookahead=60:deblock=-1,-1:sao=0:selective-sao=0',
    },
    audio: {
      primary: 'Passthrough (TrueHD/DTS-HD MA/Atmos)',
      fallback: 'E-AC3 640 kbps or AAC 320 kbps',
      bitrate: '640+',
    },
    notes: [
      'Use "slower" preset for best quality-to-size ratio',
      'For grain preservation: add grain tune or set aq-strength=1.0',
      'For animation: use tune=animation with aq-mode=1',
    ],
  },
  '4k': {
    description: 'Ultra HD, preserve HDR and maximum detail',
    x264: {
      rf: '15-16',
      preset: 'slower',
      tune: 'film',
      profile: 'high',
      level: '5.1',
      extraOptions: 'ref=4:bframes=8:b-adapt=2:direct=auto:me=umh:subme=10:trellis=2:psy-rd=1.0,0.15:deblock=0,0:rc-lookahead=60:aq-mode=3',
    },
    x265: {
      rf: '17-18',
      preset: 'slow',
      tune: 'none',
      profile: 'main10',
      level: '5.1',
      extraOptions: 'ref=4:bframes=8:rd=4:psy-rd=2.0:psy-rdoq=1.0:aq-mode=3:rc-lookahead=40:deblock=0,0:sao=0:hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc',
    },
    audio: {
      primary: 'Passthrough (TrueHD Atmos/DTS:X)',
      fallback: 'E-AC3 Atmos 768 kbps or TrueHD',
      bitrate: '1000+',
    },
    notes: [
      'Always use 10-bit (main10) for HDR content',
      'hdr-opt=1 preserves HDR metadata',
      'Keep ref frames ≤4 for 4K to avoid memory issues',
      'For SDR 4K: remove HDR color options',
    ],
  },
}

// Handbrake encoding guide component
function HandbrakeGuide({
  selectedTier,
  setSelectedTier,
  settings,
}: {
  selectedTier: ResolutionTier
  setSelectedTier: (tier: ResolutionTier) => void
  settings: SettingsState
}) {
  const [selectedCodec, setSelectedCodec] = useState<'x264' | 'x265'>('x265')

  // Get current thresholds for the selected tier
  const videoHigh = settings[`quality_video_${selectedTier}_high` as keyof SettingsState] as number
  const audioHigh = settings[`quality_audio_${selectedTier}_high` as keyof SettingsState] as number

  // Adjust target bitrate based on codec efficiency multiplier
  const codecMultiplier = selectedCodec === 'x265'
    ? settings.quality_codec_h265
    : settings.quality_codec_h264
  const adjustedVideoHigh = Math.round(videoHigh / codecMultiplier)

  const preset = HANDBRAKE_DETAILED_PRESETS[selectedTier]
  const codecPreset = preset[selectedCodec]

  const formatBitrate = (kbps: number) => {
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(1)} Mbps`
    }
    return `${kbps} kbps`
  }

  return (
    <div className="space-y-4">
      {/* Resolution Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg" role="tablist">
        {RESOLUTION_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSelectedTier(tab.id)}
            role="tab"
            aria-selected={selectedTier === tab.id}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              selectedTier === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{preset.description}</p>

      {/* Codec Selection */}
      <div className="flex gap-2">
        <button
          onClick={() => setSelectedCodec('x265')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
            selectedCodec === 'x265'
              ? 'bg-accent text-accent-foreground'
              : 'bg-background/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          x265/HEVC (Recommended)
        </button>
        <button
          onClick={() => setSelectedCodec('x264')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
            selectedCodec === 'x264'
              ? 'bg-accent text-accent-foreground'
              : 'bg-background/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          x264/H.264 (Compatibility)
        </button>
      </div>

      {/* Target Bitrate */}
      <div className="bg-background/50 border border-border/30 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Target for HIGH Quality</span>
          <span className="text-sm font-mono text-foreground">
            {formatBitrate(adjustedVideoHigh)}+ video / {audioHigh}+ kbps audio
          </span>
        </div>
      </div>

      {/* Video Settings */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground">Video Encoder Settings</h4>
        <div className="bg-background/50 rounded-lg p-3 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Encoder:</span>
              <span className="text-foreground font-mono">{selectedCodec}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quality (RF):</span>
              <span className="text-foreground font-mono font-medium">{codecPreset.rf}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Preset:</span>
              <span className="text-foreground font-mono">{codecPreset.preset}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tune:</span>
              <span className="text-foreground font-mono">{codecPreset.tune || 'none'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Profile:</span>
              <span className="text-foreground font-mono">{codecPreset.profile}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Level:</span>
              <span className="text-foreground font-mono">{codecPreset.level}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Options */}
      <ExtraOptionsCopyable extraOptions={codecPreset.extraOptions} />

      {/* Audio Settings */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground">Audio Settings</h4>
        <div className="bg-background/50 rounded-lg p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Primary:</span>
            <span className="text-foreground">{preset.audio.primary}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fallback:</span>
            <span className="text-foreground">{preset.audio.fallback}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Min Bitrate:</span>
            <span className="text-foreground font-mono">{preset.audio.bitrate} kbps</span>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground">Tips for {RESOLUTION_TABS.find(t => t.id === selectedTier)?.label}</h4>
        <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside">
          {preset.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      </div>

      {/* Common Settings */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground">Other Settings</h4>
        <div className="bg-background/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>Container:</span>
            <span className="text-foreground">MKV (preserves all tracks/chapters)</span>
          </div>
          <div className="flex justify-between">
            <span>Framerate:</span>
            <span className="text-foreground">Same as source (CFR)</span>
          </div>
          <div className="flex justify-between">
            <span>Anamorphic:</span>
            <span className="text-foreground">Automatic</span>
          </div>
          <div className="flex justify-between">
            <span>Filters:</span>
            <span className="text-foreground">None (preserve source)</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        Based on HandBrake 1.10.2. Lower RF = higher quality/larger file. These settings prioritize
        visual transparency over file size.
      </p>
    </div>
  )
}

function ExtraOptionsCopyable({ extraOptions }: { extraOptions: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(extraOptions)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-foreground">Extra Options (Advanced)</h4>
      <div className="bg-background/50 rounded-lg p-3 flex items-start gap-2">
        <code className="text-[10px] text-muted-foreground break-all leading-relaxed block flex-1 select-all">
          {extraOptions}
        </code>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Paste into Handbrake's "Extra Options" field under the Video tab.
      </p>
    </div>
  )
}
