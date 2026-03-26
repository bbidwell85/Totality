/* eslint-disable react-refresh/only-export-components */
/**
 * NavigationContext - Provides app-wide navigation capabilities
 *
 * Allows components like notifications to trigger navigation to specific items.
 * Includes a history stack for back/forward navigation.
 */

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'

// Navigation target types (for navigateTo)
export interface NavigationTarget {
  type: 'movie' | 'tv' | 'episode' | 'track' | 'album' | 'artist'
  id: number | string
  // Additional context for navigation
  sourceId?: string
  artistName?: string
  albumId?: number
  seriesTitle?: string
  seasonNumber?: number
}

// Snapshot of the full navigation state (for history stack)
export interface NavigationState {
  view: 'dashboard' | 'library'
  tab?: 'movies' | 'tv' | 'music'
  // TV drill-down
  selectedShow?: string | null
  selectedSeason?: number | null
  // Music drill-down
  selectedArtist?: { id: number; name: string } | null
  selectedAlbum?: { id: number; title: string } | null
}

const MAX_HISTORY = 50

function statesEqual(a: NavigationState, b: NavigationState): boolean {
  return a.view === b.view
    && a.tab === b.tab
    && (a.selectedShow ?? null) === (b.selectedShow ?? null)
    && (a.selectedSeason ?? null) === (b.selectedSeason ?? null)
    && (a.selectedArtist?.id ?? null) === (b.selectedArtist?.id ?? null)
    && (a.selectedAlbum?.id ?? null) === (b.selectedAlbum?.id ?? null)
}

interface NavigationContextType {
  // Current navigation target (if any)
  pendingNavigation: NavigationTarget | null
  // Navigate to a specific item
  navigateTo: (target: NavigationTarget) => void
  // Clear pending navigation (called by MediaBrowser after handling)
  clearNavigation: () => void

  // History stack
  pushNavState: (state: NavigationState) => void
  goBack: () => NavigationState | null
  goForward: () => NavigationState | null
  canGoBack: boolean
  canGoForward: boolean
}

const NavigationContext = createContext<NavigationContextType | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [pendingNavigation, setPendingNavigation] = useState<NavigationTarget | null>(null)

  // History stack state
  const historyRef = useRef<NavigationState[]>([])
  const forwardRef = useRef<NavigationState[]>([])
  const currentRef = useRef<NavigationState>({ view: 'dashboard' })
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const updateFlags = useCallback(() => {
    setCanGoBack(historyRef.current.length > 0)
    setCanGoForward(forwardRef.current.length > 0)
  }, [])

  const navigateTo = useCallback((target: NavigationTarget) => {
    console.log('[Navigation] Navigate to:', target)
    setPendingNavigation(target)
  }, [])

  const clearNavigation = useCallback(() => {
    setPendingNavigation(null)
  }, [])

  const pushNavState = useCallback((state: NavigationState) => {
    // Skip duplicate consecutive entries
    if (statesEqual(currentRef.current, state)) return

    // Push current to history
    historyRef.current.push(currentRef.current)
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift()
    }

    // Set new current and clear forward stack
    currentRef.current = state
    forwardRef.current = []
    updateFlags()
  }, [updateFlags])

  const goBack = useCallback((): NavigationState | null => {
    if (historyRef.current.length === 0) return null

    // Push current to forward stack
    forwardRef.current.push(currentRef.current)

    // Pop from history
    const restored = historyRef.current.pop()!
    currentRef.current = restored
    updateFlags()
    return restored
  }, [updateFlags])

  const goForward = useCallback((): NavigationState | null => {
    if (forwardRef.current.length === 0) return null

    // Push current to history
    historyRef.current.push(currentRef.current)

    // Pop from forward stack
    const restored = forwardRef.current.pop()!
    currentRef.current = restored
    updateFlags()
    return restored
  }, [updateFlags])

  return (
    <NavigationContext.Provider value={{
      pendingNavigation, navigateTo, clearNavigation,
      pushNavState, goBack, goForward, canGoBack, canGoForward,
    }}>
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
