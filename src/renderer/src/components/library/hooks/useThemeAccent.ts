import { useState, useEffect } from 'react'

/**
 * Hook to track the current theme accent color
 *
 * Watches for theme changes via MutationObserver on the document root
 * and extracts the --accent CSS variable value.
 *
 * @returns The current theme accent color as an HSL string, or empty string if not set
 */
export function useThemeAccent(): string {
  const [themeAccentColor, setThemeAccentColor] = useState('')

  useEffect(() => {
    const updateAccentColor = () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      setThemeAccentColor(accent ? `hsl(${accent})` : '')
    }

    updateAccentColor()

    // Watch for class changes on documentElement (theme switches)
    const observer = new MutationObserver(updateAccentColor)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  return themeAccentColor
}
