/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

export type BaseTheme = 'dark' | 'slate' | 'ember' | 'midnight' | 'oled' | 'velvet' | 'emerald' | 'cobalt' | 'carbon'
export type ThemeMode = 'dark' | 'light' | 'system'

const BASE_THEMES: BaseTheme[] = ['dark', 'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon']
export const DARK_ONLY_THEMES: BaseTheme[] = ['dark', 'oled']

const ALL_THEME_CLASSES = [
  'dark', 'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon', 'frost',
  'slate-light', 'ember-light', 'midnight-light',
  'velvet-light', 'emerald-light', 'cobalt-light', 'carbon-light',
]

interface ThemeContextValue {
  theme: BaseTheme
  mode: ThemeMode
  setTheme: (theme: BaseTheme) => void
  setMode: (mode: ThemeMode) => void
  effectiveIsDark: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

function resolveThemeCSSClass(theme: BaseTheme, mode: ThemeMode, systemIsDark: boolean): string {
  if (DARK_ONLY_THEMES.includes(theme)) return theme
  const effectiveMode = mode === 'system' ? (systemIsDark ? 'dark' : 'light') : mode
  return effectiveMode === 'light' ? `${theme}-light` : theme
}

function applyThemeToDOM(cssClass: string) {
  document.documentElement.classList.remove(...ALL_THEME_CLASSES)
  document.documentElement.classList.add(cssClass)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<BaseTheme>('dark')
  const [mode, setModeState] = useState<ThemeMode>('dark')
  const [systemIsDark, setSystemIsDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [isLoaded, setIsLoaded] = useState(false)

  // Listen to OS preference changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Load settings on mount
  useEffect(() => {
    window.electronAPI.getAllSettings().then(settings => {
      let baseTheme = settings.theme || 'dark'
      let themeMode = (settings.theme_mode as ThemeMode) || 'dark'

      // Migrate frost → slate + light (Dark is dark-only, so use Slate for light mode)
      if (baseTheme === 'frost') {
        baseTheme = 'slate'
        themeMode = 'light'
        window.electronAPI.setSetting('theme', 'slate').catch(console.error)
        window.electronAPI.setSetting('theme_mode', 'light').catch(console.error)
      }

      if (!BASE_THEMES.includes(baseTheme as BaseTheme)) {
        baseTheme = 'dark'
      }

      setThemeState(baseTheme as BaseTheme)
      setModeState(themeMode)
      setIsLoaded(true)
    }).catch(() => {
      setIsLoaded(true)
    })
  }, [])

  // Apply theme to DOM whenever theme, mode, or systemIsDark changes
  useEffect(() => {
    if (!isLoaded) return
    const cssClass = resolveThemeCSSClass(theme, mode, systemIsDark)
    applyThemeToDOM(cssClass)
  }, [theme, mode, systemIsDark, isLoaded])

  const setTheme = useCallback((newTheme: BaseTheme) => {
    setThemeState(newTheme)
    window.electronAPI.setSetting('theme', newTheme).catch(console.error)
  }, [])

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    window.electronAPI.setSetting('theme_mode', newMode).catch(console.error)
    // Auto-switch away from dark-only themes when explicitly choosing light mode
    if (newMode === 'light') {
      setThemeState(current => {
        if (DARK_ONLY_THEMES.includes(current)) {
          const fallback: BaseTheme = 'slate'
          window.electronAPI.setSetting('theme', fallback).catch(console.error)
          return fallback
        }
        return current
      })
    }
  }, [])

  const effectiveIsDark = mode === 'system' ? systemIsDark : mode === 'dark'

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, setMode, effectiveIsDark }}>
      {children}
    </ThemeContext.Provider>
  )
}
