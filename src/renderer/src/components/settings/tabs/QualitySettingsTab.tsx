import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { RotateCcw, Save, Loader2 } from 'lucide-react'

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
      <div className="p-6 flex flex-col items-center justify-center py-12 text-center">
        {isReanalyzing ? (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-accent mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold mb-2">Re-analyzing Library</h3>
            {reanalyzeProgress && reanalyzeProgress.total > 0 ? (
              <>
                <p className="text-muted-foreground mb-3">
                  {reanalyzeProgress.current} of {reanalyzeProgress.total} items
                </p>
                <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${(reanalyzeProgress.current / reanalyzeProgress.total) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">Starting analysis...</p>
            )}
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mb-4">
              <Save className="w-6 h-6 text-accent" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Settings Saved</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">
              Would you like to re-analyze your library with the new quality thresholds?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSkipReanalyze}
                className="px-4 py-2 text-sm rounded-md hover:bg-muted transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleReanalyze}
                className="px-4 py-2 text-sm bg-accent text-accent-foreground rounded-md hover:bg-accent/90 transition-colors"
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
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Video Quality Thresholds */}
      <SettingsSection
        title="Video Quality Thresholds"
        description="Set bitrate thresholds that determine LOW, MEDIUM, and HIGH quality ratings"
      >
        {/* Resolution Tabs */}
        <div className="flex gap-1 mb-4 bg-black/50 p-1 rounded-lg" role="tablist">
          {RESOLUTION_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTier(tab.id)}
              role="tab"
              aria-selected={selectedTier === tab.id}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                selectedTier === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          {RESOLUTION_TABS.find(t => t.id === selectedTier)?.description}
        </p>

        <div className="grid grid-cols-2 gap-4">
          <QualityThreshold
            label="Video"
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
            label="Audio"
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
      </SettingsSection>

      {/* Music Quality */}
      <SettingsSection
        title="Music Quality Thresholds"
        description="Set bitrate thresholds for lossy music quality tiers"
      >
        <div className="space-y-4">
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
      </SettingsSection>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <button
          onClick={handleReset}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          Reset to Defaults
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// Section wrapper component
function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  const headingId = useId()

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="bg-muted/30 rounded-lg p-4">{children}</div>
    </section>
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
    <div className="bg-background/50 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
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

      <div className="flex text-xs font-medium">
        <div className="text-accent/40" style={{ width: `${mediumPercent}%` }}>{lowLabel}</div>
        <div className="text-accent/60 text-center" style={{ width: `${highPercent - mediumPercent}%` }}>{mediumLabel}</div>
        <div className="text-accent text-right flex-1">{highLabel}</div>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
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
      {hint && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
