/**
 * Custom DOM events for cross-view dismiss synchronization.
 * Dashboard and Library are sibling components with no shared state,
 * so we use CustomEvents on window to broadcast dismiss actions.
 */

// Event type constants
const DISMISS_UPGRADE = 'totality:dismiss-upgrade'
const DISMISS_COLLECTION_MOVIE = 'totality:dismiss-collection-movie'

// Payload types
interface DismissUpgradePayload {
  mediaId: number
}

interface DismissCollectionMoviePayload {
  collectionId: string
  tmdbId: string
}

// Emitters
export function emitDismissUpgrade(payload: DismissUpgradePayload): void {
  window.dispatchEvent(new CustomEvent(DISMISS_UPGRADE, { detail: payload }))
}

export function emitDismissCollectionMovie(payload: DismissCollectionMoviePayload): void {
  window.dispatchEvent(new CustomEvent(DISMISS_COLLECTION_MOVIE, { detail: payload }))
}

// Listeners (return cleanup functions for useEffect)
export function onDismissUpgrade(handler: (payload: DismissUpgradePayload) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<DismissUpgradePayload>).detail)
  window.addEventListener(DISMISS_UPGRADE, listener)
  return () => window.removeEventListener(DISMISS_UPGRADE, listener)
}

export function onDismissCollectionMovie(handler: (payload: DismissCollectionMoviePayload) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<DismissCollectionMoviePayload>).detail)
  window.addEventListener(DISMISS_COLLECTION_MOVIE, listener)
  return () => window.removeEventListener(DISMISS_COLLECTION_MOVIE, listener)
}
