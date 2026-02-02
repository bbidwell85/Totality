import React, { createContext, useContext, useEffect, useCallback, useRef, useState } from 'react'

interface KeyboardNavigationContextType {
  // Register a focusable element in a specific region
  registerFocusable: (id: string, element: HTMLElement, region: string, index: number) => void
  // Unregister a focusable element
  unregisterFocusable: (id: string) => void
  // Current focused element ID
  focusedId: string | null
  // Current region (sidebar, content, modal)
  currentRegion: string
  // Set the current region
  setCurrentRegion: (region: string) => void
  // Focus a specific element
  focusElement: (id: string) => void
  // Check if keyboard navigation is active
  isNavigationActive: boolean
}

const KeyboardNavigationContext = createContext<KeyboardNavigationContextType | null>(null)

interface FocusableElement {
  id: string
  element: HTMLElement
  region: string
  index: number
}

export function KeyboardNavigationProvider({ children }: { children: React.ReactNode }) {
  const focusableElements = useRef<Map<string, FocusableElement>>(new Map())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [currentRegion, setCurrentRegion] = useState<string>('content')
  const [isNavigationActive, setIsNavigationActive] = useState(false)

  const registerFocusable = useCallback((id: string, element: HTMLElement, region: string, index: number) => {
    focusableElements.current.set(id, { id, element, region, index })
  }, [])

  const unregisterFocusable = useCallback((id: string) => {
    focusableElements.current.delete(id)
  }, [])

  const focusElement = useCallback((id: string) => {
    const focusable = focusableElements.current.get(id)
    if (focusable) {
      focusable.element.focus()
      setFocusedId(id)
      setCurrentRegion(focusable.region)
    }
  }, [])

  // Get elements in current region sorted by index
  const getRegionElements = useCallback((region: string) => {
    const elements: FocusableElement[] = []
    focusableElements.current.forEach((el) => {
      if (el.region === region) {
        elements.push(el)
      }
    })
    return elements.sort((a, b) => a.index - b.index)
  }, [])

  // Find element by grid position (for 2D navigation in content area)
  const findElementByDirection = useCallback((
    currentId: string | null,
    direction: 'up' | 'down' | 'left' | 'right'
  ): FocusableElement | null => {
    if (!currentId) {
      // No current focus, get first element in current region
      const regionElements = getRegionElements(currentRegion)
      return regionElements[0] || null
    }

    const current = focusableElements.current.get(currentId)
    if (!current) return null

    const regionElements = getRegionElements(current.region)
    const currentIndex = regionElements.findIndex((el) => el.id === currentId)

    if (currentIndex === -1) return null

    // For sidebar (vertical list)
    if (current.region === 'sidebar') {
      if (direction === 'up' && currentIndex > 0) {
        return regionElements[currentIndex - 1]
      }
      if (direction === 'down' && currentIndex < regionElements.length - 1) {
        return regionElements[currentIndex + 1]
      }
      // Right arrow moves to content
      if (direction === 'right') {
        const contentElements = getRegionElements('content')
        return contentElements[0] || null
      }
      return null
    }

    // For content grid (2D navigation)
    if (current.region === 'content') {
      // Estimate grid columns based on element positions
      const currentRect = current.element.getBoundingClientRect()

      // Find best match based on direction
      let bestMatch: FocusableElement | null = null
      let bestScore = Infinity

      regionElements.forEach((el) => {
        if (el.id === currentId) return

        const rect = el.element.getBoundingClientRect()
        const dx = rect.left - currentRect.left
        const dy = rect.top - currentRect.top

        let isValid = false
        let score = Infinity

        switch (direction) {
          case 'up':
            if (dy < -10) {
              isValid = true
              score = Math.abs(dx) + Math.abs(dy) * 0.1
            }
            break
          case 'down':
            if (dy > 10) {
              isValid = true
              score = Math.abs(dx) + Math.abs(dy) * 0.1
            }
            break
          case 'left':
            if (dx < -10) {
              isValid = true
              score = Math.abs(dx) * 0.1 + Math.abs(dy)
            }
            break
          case 'right':
            if (dx > 10) {
              isValid = true
              score = Math.abs(dx) * 0.1 + Math.abs(dy)
            }
            break
        }

        if (isValid && score < bestScore) {
          bestScore = score
          bestMatch = el
        }
      })

      // If left and no match found, go to sidebar
      if (direction === 'left' && !bestMatch) {
        const sidebarElements = getRegionElements('sidebar')
        return sidebarElements[0] || null
      }

      return bestMatch
    }

    return null
  }, [currentRegion, getRegionElements])

  // Global keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }

      // Arrow key navigation
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        setIsNavigationActive(true)

        const direction = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right'
        const nextElement = findElementByDirection(focusedId, direction)

        if (nextElement) {
          nextElement.element.focus()
          nextElement.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          setFocusedId(nextElement.id)
          setCurrentRegion(nextElement.region)
        }
      }

      // Enter/Space to activate
      if (e.key === 'Enter' || e.key === ' ') {
        if (focusedId) {
          const focusable = focusableElements.current.get(focusedId)
          if (focusable && focusable.element !== document.activeElement) {
            e.preventDefault()
            focusable.element.click()
          }
        }
      }

      // Tab to switch regions
      if (e.key === 'Tab') {
        setIsNavigationActive(true)
        const regions = ['sidebar', 'content']
        const currentIndex = regions.indexOf(currentRegion)
        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + regions.length) % regions.length
          : (currentIndex + 1) % regions.length
        const nextRegion = regions[nextIndex]

        const nextRegionElements = getRegionElements(nextRegion)
        if (nextRegionElements.length > 0) {
          e.preventDefault()
          const firstElement = nextRegionElements[0]
          firstElement.element.focus()
          setFocusedId(firstElement.id)
          setCurrentRegion(nextRegion)
        }
      }

      // Escape to clear focus
      if (e.key === 'Escape') {
        setFocusedId(null)
        setIsNavigationActive(false)
        const activeElement = document.activeElement as HTMLElement
        activeElement?.blur()
      }
    }

    // Mouse click disables keyboard navigation mode
    const handleMouseDown = () => {
      setIsNavigationActive(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handleMouseDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleMouseDown)
    }
  }, [focusedId, currentRegion, findElementByDirection, getRegionElements])

  return (
    <KeyboardNavigationContext.Provider
      value={{
        registerFocusable,
        unregisterFocusable,
        focusedId,
        currentRegion,
        setCurrentRegion,
        focusElement,
        isNavigationActive,
      }}
    >
      {children}
    </KeyboardNavigationContext.Provider>
  )
}

export function useKeyboardNavigation() {
  const context = useContext(KeyboardNavigationContext)
  if (!context) {
    throw new Error('useKeyboardNavigation must be used within KeyboardNavigationProvider')
  }
  return context
}

// Hook to register a focusable element
export function useFocusable(id: string, region: string, index: number) {
  const { registerFocusable, unregisterFocusable, focusedId, isNavigationActive } = useKeyboardNavigation()
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (ref.current) {
      registerFocusable(id, ref.current, region, index)
    }
    return () => {
      unregisterFocusable(id)
    }
  }, [id, region, index, registerFocusable, unregisterFocusable])

  const isFocused = focusedId === id && isNavigationActive

  return { ref, isFocused }
}
