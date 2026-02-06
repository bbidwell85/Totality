/**
 * AppearanceTab - Settings tab for visual customization
 *
 * Features:
 * - Theme selection with live preview
 * - Dark / Light / System mode toggle
 * - 9 base themes, each with dark and light variants
 */

import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type BaseTheme, type ThemeMode } from '../../../contexts/ThemeContext'

interface ThemeColors {
  background: string
  card: string
  accent: string
  muted: string
  text: string
}

interface ThemeConfig {
  id: BaseTheme
  label: string
  description: string
  lightLabel?: string
  lightDescription?: string
  darkOnly?: boolean
  darkColors: ThemeColors
  lightColors?: ThemeColors
}

const THEMES: ThemeConfig[] = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Classic dark mode',
    darkOnly: true,
    darkColors: {
      background: '#1c1d24',
      card: '#282a33',
      accent: '#60a5fa',
      muted: '#303340',
      text: '#f3f4f6',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Cool blue-gray',
    lightLabel: 'Mist',
    lightDescription: 'Soft blue-gray',
    darkColors: {
      background: '#232d38',
      card: '#2a3441',
      accent: '#5a9bcf',
      muted: '#344050',
      text: '#ecf0f4',
    },
    lightColors: {
      background: '#d8e2ec',
      card: '#eaf0f5',
      accent: '#5a9bcf',
      muted: '#cdd6e0',
      text: '#1e2e3e',
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Warm movie nights',
    lightLabel: 'Dawn',
    lightDescription: 'Warm sunrise',
    darkColors: {
      background: '#1f1a17',
      card: '#2a2420',
      accent: '#e8842a',
      muted: '#352f2a',
      text: '#f5f2ef',
    },
    lightColors: {
      background: '#ede5dc',
      card: '#f5f0ea',
      accent: '#e8842a',
      muted: '#ddd5cc',
      text: '#2e2218',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Cinema purple',
    lightLabel: 'Lavender',
    lightDescription: 'Gentle purple',
    darkColors: {
      background: '#1a1720',
      card: '#252030',
      accent: '#a372e0',
      muted: '#302a40',
      text: '#f3f1f6',
    },
    lightColors: {
      background: '#e2dced',
      card: '#f0ecf5',
      accent: '#a372e0',
      muted: '#d5cee0',
      text: '#261e34',
    },
  },
  {
    id: 'oled',
    label: 'OLED',
    description: 'True black display',
    darkOnly: true,
    darkColors: {
      background: '#000000',
      card: '#121212',
      accent: '#26b3c9',
      muted: '#1a1a1a',
      text: '#f2f2f2',
    },
  },
  {
    id: 'velvet',
    label: 'Velvet',
    description: 'Theater curtain',
    lightLabel: 'Blush',
    lightDescription: 'Soft rose',
    darkColors: {
      background: '#261418',
      card: '#352025',
      accent: '#d94f6a',
      muted: '#3d252a',
      text: '#f5f0f1',
    },
    lightColors: {
      background: '#eddddf',
      card: '#f5edef',
      accent: '#d94f6a',
      muted: '#e0d0d3',
      text: '#34202a',
    },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    description: 'Luxurious green',
    lightLabel: 'Sage',
    lightDescription: 'Fresh green',
    darkColors: {
      background: '#142019',
      card: '#1d2e24',
      accent: '#2eb872',
      muted: '#24352c',
      text: '#eff5f2',
    },
    lightColors: {
      background: '#dbede4',
      card: '#ecf5f0',
      accent: '#2eb872',
      muted: '#cce0d5',
      text: '#1a2e22',
    },
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    description: 'Deep cinematic',
    lightLabel: 'Sky',
    lightDescription: 'Clear blue',
    darkColors: {
      background: '#141a26',
      card: '#1c2535',
      accent: '#3b7fdb',
      muted: '#232d40',
      text: '#eff2f5',
    },
    lightColors: {
      background: '#dce2ee',
      card: '#ecf0f6',
      accent: '#3b7fdb',
      muted: '#ced5e2',
      text: '#1e2838',
    },
  },
  {
    id: 'carbon',
    label: 'Carbon',
    description: 'Neutral pro',
    lightLabel: 'Silver',
    lightDescription: 'Clean neutral',
    darkColors: {
      background: '#1a1a1a',
      card: '#242424',
      accent: '#b3b3b3',
      muted: '#2b2b2b',
      text: '#f0f0f0',
    },
    lightColors: {
      background: '#e6e6e6',
      card: '#f2f2f2',
      accent: '#b3b3b3',
      muted: '#dadada',
      text: '#1e1e1e',
    },
  },
]

const MODE_OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'system', label: 'System', icon: Monitor },
]

// Mini UI mockup component for theme preview
function ThemePreview({ colors }: { colors: ThemeConfig['darkColors'] }) {
  return (
    <div
      className="w-full aspect-video rounded-xl overflow-hidden"
      style={{ backgroundColor: colors.background }}
    >
      {/* Top bar - always black */}
      <div className="h-[12%] bg-black flex items-center px-1.5">
        <div className="flex gap-0.5">
          <div className="w-1 h-1 rounded-full bg-white/40" />
          <div className="w-1 h-1 rounded-full bg-white/40" />
        </div>
      </div>

      <div className="flex h-[88%]">
        {/* Sidebar */}
        <div
          className="w-[22%] p-1"
          style={{ backgroundColor: colors.card }}
        >
          <div className="space-y-0.5">
            <div
              className="h-1 rounded-sm w-3/4"
              style={{ backgroundColor: colors.muted }}
            />
            <div
              className="h-1 rounded-sm w-full"
              style={{ backgroundColor: colors.accent, opacity: 0.8 }}
            />
            <div
              className="h-1 rounded-sm w-5/6"
              style={{ backgroundColor: colors.muted }}
            />
            <div
              className="h-1 rounded-sm w-2/3"
              style={{ backgroundColor: colors.muted }}
            />
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 p-1.5">
          {/* Grid of "posters" */}
          <div className="grid grid-cols-3 gap-1">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] rounded-sm"
                style={{ backgroundColor: colors.card }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceTab() {
  const { theme, mode, setTheme, setMode, effectiveIsDark } = useTheme()

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Mode Toggle */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Mode</h3>
        <div className="bg-muted/30 rounded-lg border border-border/40 p-3">
          <div className="flex gap-2">
            {MODE_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const isActive = mode === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => setMode(opt.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Theme Selection */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Theme</h3>
        <div className="bg-muted/30 rounded-lg border border-border/40 p-4">
          <div className="grid grid-cols-3 gap-4">
            {THEMES.filter(t => effectiveIsDark || !t.darkOnly).map((themeConfig) => {
              const isActive = theme === themeConfig.id
              const showLight = !effectiveIsDark && !themeConfig.darkOnly
              const previewColors = showLight && themeConfig.lightColors ? themeConfig.lightColors : themeConfig.darkColors
              const displayLabel = showLight && themeConfig.lightLabel ? themeConfig.lightLabel : themeConfig.label
              const displayDesc = showLight && themeConfig.lightDescription ? themeConfig.lightDescription : themeConfig.description
              return (
                <div key={themeConfig.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-xs font-medium">{displayLabel}</span>
                    <span className="text-[10px] text-muted-foreground">{displayDesc}</span>
                  </div>
                  <button
                    onClick={() => setTheme(themeConfig.id)}
                    className={`rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.4)] transition-all ${
                      isActive
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        : 'hover:opacity-80'
                    }`}
                  >
                    <ThemePreview colors={previewColors} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
