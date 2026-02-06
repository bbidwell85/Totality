import { useState } from 'react'

interface UsePanelStateOptions {
  externalShowCompletenessPanel?: boolean
  externalShowWishlistPanel?: boolean
  onToggleCompleteness?: () => void
  onToggleWishlist?: () => void
}

interface UsePanelStateReturn {
  showCompletenessPanel: boolean
  showWishlistPanel: boolean
  setShowCompletenessPanel: (value: boolean | ((prev: boolean) => boolean)) => void
  setShowWishlistPanel: (value: boolean | ((prev: boolean) => boolean)) => void
}

/**
 * Hook to manage completeness and wishlist panel visibility state
 *
 * Supports both internal state management and external control via props.
 * When external state is provided, it takes precedence over internal state.
 *
 * @param options External state and toggle handlers (optional)
 * @returns Panel visibility state and setters
 */
export function usePanelState({
  externalShowCompletenessPanel,
  externalShowWishlistPanel,
  onToggleCompleteness,
  onToggleWishlist,
}: UsePanelStateOptions = {}): UsePanelStateReturn {
  // Internal panel state (used when external state not provided)
  const [internalShowCompletenessPanel, setInternalShowCompletenessPanel] = useState(false)
  const [internalShowWishlistPanel, setInternalShowWishlistPanel] = useState(false)

  // Use external state if provided, otherwise use internal
  const showCompletenessPanel = externalShowCompletenessPanel ?? internalShowCompletenessPanel
  const showWishlistPanel = externalShowWishlistPanel ?? internalShowWishlistPanel

  // Wrap setters to support both internal and external state management
  const setShowCompletenessPanel = onToggleCompleteness
    ? (_value: boolean | ((prev: boolean) => boolean)) => {
        // When external toggle is provided, call it (ignores the value)
        onToggleCompleteness()
      }
    : setInternalShowCompletenessPanel

  const setShowWishlistPanel = onToggleWishlist
    ? (_value: boolean | ((prev: boolean) => boolean)) => {
        // When external toggle is provided, call it (ignores the value)
        onToggleWishlist()
      }
    : setInternalShowWishlistPanel

  return {
    showCompletenessPanel,
    showWishlistPanel,
    setShowCompletenessPanel,
    setShowWishlistPanel,
  }
}
