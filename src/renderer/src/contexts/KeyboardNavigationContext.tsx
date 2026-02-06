/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useCallback, useRef, useState } from 'react'

// All navigable regions in the app
type Region = 'sidebar' | 'toolbar' | 'filters' | 'content' | 'panel' | 'modal'

// Region cycle order (excluding modal which is handled separately)
const REGION_CYCLE: Region[] = ['sidebar', 'toolbar', 'filters', 'content', 'panel']

interface FocusState {
  id: string
  region: Region
}

interface KeyboardNavigationContextType {
  // Register a focusable element in a specific region
  registerFocusable: (id: string, element: HTMLElement, region: Region, index: number) => void
  // Unregister a focusable element
  unregisterFocusable: (id: string) => void
  // Current focused element ID
  focusedId: string | null
  // Current region
  currentRegion: Region
  // Set the current region
  setCurrentRegion: (region: Region) => void
  // Focus a specific element
  focusElement: (id: string) => void
  // Check if keyboard navigation is active
  isNavigationActive: boolean
  // Modal management
  openModal: (modalId: string) => void
  closeModal: () => void
  isModalOpen: boolean
  // Navigate to next/previous region
  navigateToNextRegion: () => void
  navigateToPreviousRegion: () => void
  // Jump to specific region
  jumpToRegion: (region: Region) => void
}

const KeyboardNavigationContext = createContext<KeyboardNavigationContextType | null>(null)

interface FocusableElement {
  id: string
  element: HTMLElement
  region: Region
  index: number
}

export function KeyboardNavigationProvider({ children }: { children: React.ReactNode }) {
  const focusableElements = useRef<Map<string, FocusableElement>>(new Map())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [currentRegion, setCurrentRegion] = useState<Region>('content')
  const [isNavigationActive, setIsNavigationActive] = useState(false)

  // Feature toggle - set to false to disable custom keyboard navigation
  // All code remains in place but the feature is inactive
  const isEnabled = false

  // Modal state
  const [modalStack, setModalStack] = useState<string[]>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_previousFocus, setPreviousFocus] = useState<FocusState | null>(null)
  const focusRestoreStack = useRef<FocusState[]>([])

  const isModalOpen = modalStack.length > 0

  const registerFocusable = useCallback((id: string, element: HTMLElement, region: Region, index: number) => {
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
  const getRegionElements = useCallback((region: Region) => {
    const elements: FocusableElement[] = []
    focusableElements.current.forEach((el) => {
      if (el.region === region) {
        elements.push(el)
      }
    })
    return elements.sort((a, b) => a.index - b.index)
  }, [])

  // Focus first element in a region
  const focusFirstInRegion = useCallback((region: Region): boolean => {
    const elements = getRegionElements(region)
    if (elements.length > 0) {
      elements[0].element.focus()
      elements[0].element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      setFocusedId(elements[0].id)
      setCurrentRegion(region)
      return true
    }
    return false
  }, [getRegionElements])

  // Navigate to next region (F6)
  const navigateToNextRegion = useCallback(() => {
    if (isModalOpen) return // Don't navigate regions when modal is open

    setIsNavigationActive(true)
    const currentIndex = REGION_CYCLE.indexOf(currentRegion)

    // Try each region in order until we find one with elements
    for (let i = 1; i <= REGION_CYCLE.length; i++) {
      const nextIndex = (currentIndex + i) % REGION_CYCLE.length
      const nextRegion = REGION_CYCLE[nextIndex]
      if (focusFirstInRegion(nextRegion)) {
        return
      }
    }
  }, [currentRegion, focusFirstInRegion, isModalOpen])

  // Navigate to previous region (Shift+F6)
  const navigateToPreviousRegion = useCallback(() => {
    if (isModalOpen) return

    setIsNavigationActive(true)
    const currentIndex = REGION_CYCLE.indexOf(currentRegion)

    for (let i = 1; i <= REGION_CYCLE.length; i++) {
      const prevIndex = (currentIndex - i + REGION_CYCLE.length) % REGION_CYCLE.length
      const prevRegion = REGION_CYCLE[prevIndex]
      if (focusFirstInRegion(prevRegion)) {
        return
      }
    }
  }, [currentRegion, focusFirstInRegion, isModalOpen])

  // Jump to specific region
  const jumpToRegion = useCallback((region: Region) => {
    if (isModalOpen && region !== 'modal') return

    setIsNavigationActive(true)
    focusFirstInRegion(region)
  }, [focusFirstInRegion, isModalOpen])

  // Open modal - save current focus and switch to modal region
  const openModal = useCallback((modalId: string) => {
    // Save current focus state to restore later
    if (focusedId && currentRegion !== 'modal') {
      focusRestoreStack.current.push({ id: focusedId, region: currentRegion })
      setPreviousFocus({ id: focusedId, region: currentRegion })
    }

    setModalStack(prev => [...prev, modalId])
    setCurrentRegion('modal')
  }, [focusedId, currentRegion])

  // Close modal - restore previous focus
  const closeModal = useCallback(() => {
    setModalStack(prev => {
      const newStack = prev.slice(0, -1)

      // If no more modals, restore focus
      if (newStack.length === 0) {
        const savedFocus = focusRestoreStack.current.pop()
        if (savedFocus) {
          // Use setTimeout to allow modal to close first
          setTimeout(() => {
            const focusable = focusableElements.current.get(savedFocus.id)
            if (focusable) {
              focusable.element.focus()
              setFocusedId(savedFocus.id)
              setCurrentRegion(savedFocus.region)
            } else {
              // If element no longer exists, focus first in saved region
              focusFirstInRegion(savedFocus.region)
            }
          }, 0)
        }
        setPreviousFocus(null)
      }

      return newStack
    })
  }, [focusFirstInRegion])

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
      // Right arrow moves to toolbar first, then content
      if (direction === 'right') {
        const toolbarElements = getRegionElements('toolbar')
        if (toolbarElements.length > 0) return toolbarElements[0]
        const contentElements = getRegionElements('content')
        return contentElements[0] || null
      }
      return null
    }

    // For toolbar (horizontal list)
    if (current.region === 'toolbar') {
      if (direction === 'left' && currentIndex > 0) {
        return regionElements[currentIndex - 1]
      }
      if (direction === 'right' && currentIndex < regionElements.length - 1) {
        return regionElements[currentIndex + 1]
      }
      // Down goes to filters or content
      if (direction === 'down') {
        const filterElements = getRegionElements('filters')
        if (filterElements.length > 0) return filterElements[0]
        const contentElements = getRegionElements('content')
        return contentElements[0] || null
      }
      // Left at beginning goes to sidebar
      if (direction === 'left' && currentIndex === 0) {
        const sidebarElements = getRegionElements('sidebar')
        return sidebarElements[0] || null
      }
      return null
    }

    // For filters (horizontal list)
    if (current.region === 'filters') {
      if (direction === 'left' && currentIndex > 0) {
        return regionElements[currentIndex - 1]
      }
      if (direction === 'right' && currentIndex < regionElements.length - 1) {
        return regionElements[currentIndex + 1]
      }
      // Left at first element goes to sidebar
      if (direction === 'left' && currentIndex === 0) {
        const sidebarElements = getRegionElements('sidebar')
        return sidebarElements[0] || null
      }
      // Up goes to toolbar
      if (direction === 'up') {
        const toolbarElements = getRegionElements('toolbar')
        return toolbarElements[0] || null
      }
      // Down goes to content
      if (direction === 'down') {
        const contentElements = getRegionElements('content')
        return contentElements[0] || null
      }
      return null
    }

    // For panel (vertical list)
    if (current.region === 'panel') {
      if (direction === 'up' && currentIndex > 0) {
        return regionElements[currentIndex - 1]
      }
      if (direction === 'down' && currentIndex < regionElements.length - 1) {
        return regionElements[currentIndex + 1]
      }
      // Left goes to content
      if (direction === 'left') {
        const contentElements = getRegionElements('content')
        return contentElements[0] || null
      }
      return null
    }

    // For modal (vertical/grid depending on content)
    if (current.region === 'modal') {
      // Simple up/down navigation in modal
      if (direction === 'up' && currentIndex > 0) {
        return regionElements[currentIndex - 1]
      }
      if (direction === 'down' && currentIndex < regionElements.length - 1) {
        return regionElements[currentIndex + 1]
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

      // If right and no match found, go to panel if open
      if (direction === 'right' && !bestMatch) {
        const panelElements = getRegionElements('panel')
        if (panelElements.length > 0) return panelElements[0]
      }

      // If up and no match found, go to filters
      if (direction === 'up' && !bestMatch) {
        const filterElements = getRegionElements('filters')
        if (filterElements.length > 0) return filterElements[0]
        const toolbarElements = getRegionElements('toolbar')
        return toolbarElements[0] || null
      }

      return bestMatch
    }

    return null
  }, [currentRegion, getRegionElements])

  // Global keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Feature disabled - don't handle any custom keyboard navigation
      if (!isEnabled) return

      // F6 - Cycle through regions
      if (e.key === 'F6') {
        e.preventDefault()
        if (e.shiftKey) {
          navigateToPreviousRegion()
        } else {
          navigateToNextRegion()
        }
        return
      }

      // Ignore arrow keys if in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }

      // Arrow key navigation - disabled when modal is open (let modal handle it)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (isModalOpen) return // Modal has its own navigation
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

      // Tab to move within region or to next region
      if (e.key === 'Tab' && !isModalOpen) {
        setIsNavigationActive(true)

        // Get current region elements
        const regionElements = getRegionElements(currentRegion)
        const currentIndex = focusedId
          ? regionElements.findIndex(el => el.id === focusedId)
          : -1

        if (e.shiftKey) {
          // Shift+Tab - go to previous element or previous region
          if (currentIndex > 0) {
            e.preventDefault()
            const prevElement = regionElements[currentIndex - 1]
            prevElement.element.focus()
            setFocusedId(prevElement.id)
          } else {
            // At first element, go to previous region
            e.preventDefault()
            navigateToPreviousRegion()
          }
        } else {
          // Tab - go to next element or next region
          if (currentIndex < regionElements.length - 1 && currentIndex >= 0) {
            e.preventDefault()
            const nextElement = regionElements[currentIndex + 1]
            nextElement.element.focus()
            setFocusedId(nextElement.id)
          } else {
            // At last element, go to next region
            e.preventDefault()
            navigateToNextRegion()
          }
        }
      }

      // Escape to clear focus (but not in modal - let modal handle it)
      if (e.key === 'Escape' && !isModalOpen) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, currentRegion, findElementByDirection, getRegionElements, navigateToNextRegion, navigateToPreviousRegion, jumpToRegion, isModalOpen])

  return (
    <KeyboardNavigationContext.Provider
      value={{
        registerFocusable,
        unregisterFocusable,
        focusedId,
        currentRegion,
        setCurrentRegion,
        focusElement,
        // When disabled, always report as inactive so no focus rings appear
        isNavigationActive: isEnabled && isNavigationActive,
        openModal,
        closeModal,
        isModalOpen,
        navigateToNextRegion,
        navigateToPreviousRegion,
        jumpToRegion,
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
export function useFocusable(id: string, region: Region, index: number) {
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

// Export Region type for use in components
export type { Region }
