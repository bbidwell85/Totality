import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

type ThemeOption = 'dark' | 'slate' | 'ember' | 'midnight' | 'oled' | 'velvet' | 'emerald' | 'cobalt' | 'carbon'

interface ThemeConfig {
  id: ThemeOption
  label: string
  description: string
  colors: {
    background: string
    card: string
    accent: string
    muted: string
    text: string
  }
}

const THEMES: ThemeConfig[] = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Classic dark mode',
    colors: {
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
    colors: {
      background: '#232d38',
      card: '#2a3441',
      accent: '#5a9bcf',
      muted: '#344050',
      text: '#ecf0f4',
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Warm movie nights',
    colors: {
      background: '#1f1a17',
      card: '#2a2420',
      accent: '#e8842a',
      muted: '#352f2a',
      text: '#f5f2ef',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Cinema purple',
    colors: {
      background: '#1a1720',
      card: '#252030',
      accent: '#a372e0',
      muted: '#302a40',
      text: '#f3f1f6',
    },
  },
  {
    id: 'oled',
    label: 'OLED',
    description: 'True black display',
    colors: {
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
    colors: {
      background: '#261418',
      card: '#352025',
      accent: '#d94f6a',
      muted: '#3d252a',
      text: '#f5f0f1',
    },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    description: 'Luxurious green',
    colors: {
      background: '#142019',
      card: '#1d2e24',
      accent: '#2eb872',
      muted: '#24352c',
      text: '#eff5f2',
    },
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    description: 'Deep cinematic',
    colors: {
      background: '#141a26',
      card: '#1c2535',
      accent: '#3b7fdb',
      muted: '#232d40',
      text: '#eff2f5',
    },
  },
  {
    id: 'carbon',
    label: 'Carbon',
    description: 'Neutral pro',
    colors: {
      background: '#1a1a1a',
      card: '#242424',
      accent: '#b3b3b3',
      muted: '#2b2b2b',
      text: '#f0f0f0',
    },
  },
]

// Mini UI mockup component for theme preview
function ThemePreview({ colors }: { colors: ThemeConfig['colors'] }) {
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
  const [theme, setTheme] = useState<ThemeOption>('dark')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const allSettings = await window.electronAPI.getAllSettings()
      const savedTheme = allSettings.theme as ThemeOption
      if (['dark', 'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon'].includes(savedTheme)) {
        setTheme(savedTheme)
      }
    } catch (error) {
      console.error('Failed to load theme:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleThemeChange = (newTheme: ThemeOption) => {
    setTheme(newTheme)

    // Apply theme immediately (optimistic UI)
    document.documentElement.classList.remove('dark', 'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon')
    document.documentElement.classList.add(newTheme)

    // Persist to database asynchronously (don't block UI)
    window.electronAPI.setSetting('theme', newTheme).catch(error => {
      console.error('Failed to save theme:', error)
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Theme</h3>
          <p className="text-xs text-muted-foreground">
            Choose your preferred color scheme
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="grid grid-cols-3 gap-4">
            {THEMES.map((themeConfig) => {
              const isActive = theme === themeConfig.id
              return (
                <div key={themeConfig.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-xs font-medium">{themeConfig.label}</span>
                    <span className="text-[10px] text-muted-foreground">{themeConfig.description}</span>
                  </div>
                  <button
                    onClick={() => handleThemeChange(themeConfig.id)}
                    className={`rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.4)] transition-all ${
                      isActive
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        : 'hover:opacity-80'
                    }`}
                  >
                    <ThemePreview colors={themeConfig.colors} />
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
