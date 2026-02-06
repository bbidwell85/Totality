/* eslint-disable react-refresh/only-export-components */
/**
 * NavigationContext - Provides app-wide navigation capabilities
 *
 * Allows components like notifications to trigger navigation to specific items
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

// Navigation target types
export interface NavigationTarget {
  type: 'movie' | 'episode' | 'track' | 'album' | 'artist'
  id: number | string
  // Additional context for navigation
  sourceId?: string
  artistName?: string
  albumId?: number
  seriesTitle?: string
}

interface NavigationContextType {
  // Current navigation target (if any)
  pendingNavigation: NavigationTarget | null
  // Navigate to a specific item
  navigateTo: (target: NavigationTarget) => void
  // Clear pending navigation (called by MediaBrowser after handling)
  clearNavigation: () => void
}

const NavigationContext = createContext<NavigationContextType | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [pendingNavigation, setPendingNavigation] = useState<NavigationTarget | null>(null)

  const navigateTo = useCallback((target: NavigationTarget) => {
    console.log('[Navigation] Navigate to:', target)
    setPendingNavigation(target)
  }, [])

  const clearNavigation = useCallback(() => {
    setPendingNavigation(null)
  }, [])

  return (
    <NavigationContext.Provider value={{ pendingNavigation, navigateTo, clearNavigation }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider')
  }
  return context
}
