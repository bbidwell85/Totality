import { useEffect, useRef, RefObject } from 'react'

// Selector for all focusable elements
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Hook to trap focus within a container element.
 * When active, Tab/Shift+Tab will cycle through focusable elements
 * within the container, preventing focus from escaping.
 *
 * @param isActive - Whether the focus trap is active
 * @param containerRef - Ref to the container element
 * @param autoFocusFirst - Whether to auto-focus the first element when activated
 */
export function useFocusTrap(
  isActive: boolean,
  containerRef: RefObject<HTMLElement>,
  autoFocusFirst: boolean = true
) {
  const previousActiveElement = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const container = containerRef.current

    // Save the currently focused element to restore later
    previousActiveElement.current = document.activeElement as HTMLElement

    // Get all focusable elements within the container
    const getFocusableElements = (): HTMLElement[] => {
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => {
          // Filter out hidden elements
          const style = window.getComputedStyle(el)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
    }

    // Auto-focus first element if requested
    if (autoFocusFirst) {
      const focusableElements = getFocusableElements()
      if (focusableElements.length > 0) {
        // Small delay to ensure the container is fully rendered
        setTimeout(() => {
          focusableElements[0].focus()
        }, 0)
      }
    }

    // Handle Tab key to trap focus
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab - if on first element, go to last
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab - if on last element, go to first
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    // Handle focus leaving the container
    const handleFocusOut = (e: FocusEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        // Focus is leaving the container, bring it back
        const focusableElements = getFocusableElements()
        if (focusableElements.length > 0) {
          e.preventDefault()
          focusableElements[0].focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    container.addEventListener('focusout', handleFocusOut)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('focusout', handleFocusOut)

      // Restore focus to previous element when trap is deactivated
      if (previousActiveElement.current && document.body.contains(previousActiveElement.current)) {
        previousActiveElement.current.focus()
      }
    }
  }, [isActive, containerRef, autoFocusFirst])
}
