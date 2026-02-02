import { useEffect, useRef, useCallback, RefObject } from 'react'

interface UseMenuCloseOptions {
  isOpen: boolean
  onClose: () => void
}

/**
 * Hook for handling menu close behavior.
 * Closes the menu when clicking outside or pressing Escape.
 *
 * Usage:
 * ```tsx
 * const [showMenu, setShowMenu] = useState(false)
 * const menuRef = useMenuClose({
 *   isOpen: showMenu,
 *   onClose: () => setShowMenu(false)
 * })
 *
 * return (
 *   <div ref={menuRef} className="relative">
 *     <button onClick={() => setShowMenu(!showMenu)}>Menu</button>
 *     {showMenu && <div>Menu content</div>}
 *   </div>
 * )
 * ```
 */
export function useMenuClose({ isOpen, onClose }: UseMenuCloseOptions): RefObject<HTMLDivElement> {
  const menuRef = useRef<HTMLDivElement>(null)

  // Memoize onClose to prevent unnecessary effect re-runs
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Click-outside handler
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, handleClose])

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, handleClose])

  return menuRef
}
