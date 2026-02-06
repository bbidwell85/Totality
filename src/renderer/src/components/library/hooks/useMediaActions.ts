import { useState, useCallback } from 'react'

interface MatchFixModalState {
  isOpen: boolean
  type: 'series' | 'movie' | 'artist' | 'album'
  title: string
  year?: number
  filePath?: string
  artistName?: string
  sourceId?: string
  mediaItemId?: number
  artistId?: number
  albumId?: number
}

interface MissingItemPopupState {
  type: 'episode' | 'season' | 'movie'
  title: string
  year?: number
  airDate?: string
  seasonNumber?: number
  episodeNumber?: number
  posterUrl?: string
  tmdbId?: string
  imdbId?: string
  seriesTitle?: string
}

interface UseMediaActionsOptions {
  selectedMediaId: number | null
  loadMedia: () => Promise<void>
  setDetailRefreshKey: (fn: (prev: number) => number) => void
}

interface UseMediaActionsReturn {
  // Match fix modal
  matchFixModal: MatchFixModalState | null
  setMatchFixModal: (modal: MatchFixModalState | null) => void
  // Missing item popup
  selectedMissingItem: MissingItemPopupState | null
  setSelectedMissingItem: (item: MissingItemPopupState | null) => void
  // Rescan action
  handleRescanItem: (
    mediaItemId: number,
    sourceId: string,
    libraryId: string | null,
    filePath: string
  ) => Promise<void>
}

/**
 * Hook to manage media item actions
 *
 * Handles rescanning items, match fix modal state, and missing item popup state.
 *
 * @param options Media action configuration
 * @returns Action handlers and modal states
 */
export function useMediaActions({
  selectedMediaId,
  loadMedia,
  setDetailRefreshKey,
}: UseMediaActionsOptions): UseMediaActionsReturn {
  // Match fix modal state
  const [matchFixModal, setMatchFixModal] = useState<MatchFixModalState | null>(null)

  // Missing item popup state
  const [selectedMissingItem, setSelectedMissingItem] = useState<MissingItemPopupState | null>(null)

  // Rescan a single media item
  const handleRescanItem = useCallback(
    async (
      mediaItemId: number,
      sourceId: string,
      libraryId: string | null,
      filePath: string
    ) => {
      try {
        console.log(`[useMediaActions] Rescanning item: ${filePath}`)
        await window.electronAPI.sourcesScanItem(sourceId, libraryId, filePath)
        // Reload media items to show updated data
        await loadMedia()
        // If the detail view is open for this item, force it to refresh
        if (selectedMediaId === mediaItemId) {
          setDetailRefreshKey((prev) => prev + 1)
        }
      } catch (err) {
        console.error('Rescan failed:', err)
      }
    },
    [selectedMediaId, loadMedia, setDetailRefreshKey]
  )

  return {
    matchFixModal,
    setMatchFixModal,
    selectedMissingItem,
    setSelectedMissingItem,
    handleRescanItem,
  }
}
