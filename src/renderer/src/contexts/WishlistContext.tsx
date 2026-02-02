/**
 * WishlistContext
 *
 * React Context for managing wishlist state across the application.
 * Provides access to wishlist items, count, and CRUD operations.
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

// Types for wishlist
export type WishlistMediaType = 'movie' | 'episode' | 'season' | 'album' | 'track'
export type WishlistPriority = 1 | 2 | 3 | 4 | 5
export type WishlistReason = 'missing' | 'upgrade'
export type WishlistStatus = 'active' | 'completed'

export interface WishlistItem {
  id: number
  media_type: WishlistMediaType
  title: string
  subtitle?: string
  year?: number
  reason: WishlistReason
  tmdb_id?: string
  imdb_id?: string
  musicbrainz_id?: string
  series_title?: string
  season_number?: number
  episode_number?: number
  collection_name?: string
  artist_name?: string
  album_title?: string
  poster_url?: string
  priority: WishlistPriority
  notes?: string
  // Status tracking
  status: WishlistStatus
  completed_at?: string
  // Upgrade-specific fields
  current_quality_tier?: string
  current_quality_level?: string
  current_resolution?: string
  current_video_codec?: string
  current_audio_codec?: string
  media_item_id?: number
  added_at: string
  updated_at: string
}

export interface WishlistFilters {
  media_type?: WishlistMediaType
  priority?: WishlistPriority
  reason?: WishlistReason
  status?: WishlistStatus
  searchQuery?: string
  sortBy?: 'added_at' | 'priority' | 'title' | 'year' | 'completed_at'
  sortOrder?: 'asc' | 'desc'
}

export interface StoreLink {
  name: string
  url: string
  icon: string
  category: 'aggregator' | 'digital' | 'physical'
}

export type StoreRegion = 'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au'

export interface WishlistCounts {
  missing: number
  upgrade: number
  active: number
  completed: number
  total: number
}

// Context type definition
interface WishlistContextType {
  // State
  items: WishlistItem[]
  count: number
  counts: WishlistCounts
  isLoading: boolean
  error: string | null
  filters: WishlistFilters
  region: StoreRegion

  // CRUD operations
  addItem: (item: Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>) => Promise<number>
  updateItem: (id: number, updates: { priority?: WishlistPriority; notes?: string; status?: WishlistStatus }) => Promise<void>
  removeItem: (id: number) => Promise<void>
  markCompleted: (id: number) => Promise<void>
  markActive: (id: number) => Promise<void>
  checkExists: (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) => Promise<boolean>
  addBulk: (items: Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>[]) => Promise<number>

  // Store search
  getStoreLinks: (item: WishlistItem) => Promise<StoreLink[]>
  openStoreLink: (url: string) => Promise<void>
  setRegion: (region: StoreRegion) => Promise<void>

  // Export
  exportToCsv: () => Promise<{ success: boolean; path?: string; count?: number; cancelled?: boolean }>

  // Filters
  setFilters: (filters: WishlistFilters) => void
  clearFilters: () => void

  // Refresh
  refresh: () => Promise<void>
}

const WishlistContext = createContext<WishlistContextType | null>(null)

interface WishlistProviderProps {
  children: ReactNode
}

export function WishlistProvider({ children }: WishlistProviderProps) {
  const [items, setItems] = useState<WishlistItem[]>([])
  const [count, setCount] = useState(0)
  const [counts, setCounts] = useState<WishlistCounts>({ missing: 0, upgrade: 0, active: 0, completed: 0, total: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFiltersState] = useState<WishlistFilters>({
    sortBy: 'priority',
    sortOrder: 'desc'
  })
  const [region, setRegionState] = useState<StoreRegion>('us')

  // Define loadWishlist before the effect that uses it
  const loadWishlist = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const [itemsResult, countResult, countsResult] = await Promise.all([
        window.electronAPI.wishlistGetAll(filters),
        window.electronAPI.wishlistGetCount(),
        window.electronAPI.wishlistGetCountsByReason()
      ])
      setItems(itemsResult as WishlistItem[])
      setCount(countResult)
      setCounts(countsResult)
    } catch (err) {
      console.error('Error loading wishlist:', err)
      setError('Failed to load wishlist')
    } finally {
      setIsLoading(false)
    }
  }, [filters])

  const loadRegion = useCallback(async () => {
    try {
      const storedRegion = await window.electronAPI.wishlistGetRegion()
      setRegionState(storedRegion)
    } catch (err) {
      console.error('Error loading region:', err)
    }
  }, [])

  // Load initial data and reload when filters change
  useEffect(() => {
    loadWishlist()
  }, [loadWishlist])

  // Load region on mount
  useEffect(() => {
    loadRegion()
  }, [loadRegion])

  const addItem = useCallback(async (item: Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>): Promise<number> => {
    try {
      const id = await window.electronAPI.wishlistAdd(item)
      await loadWishlist()
      return id
    } catch (err) {
      console.error('Error adding wishlist item:', err)
      throw err
    }
  }, [loadWishlist])

  const updateItem = useCallback(async (id: number, updates: { priority?: WishlistPriority; notes?: string; status?: WishlistStatus }) => {
    try {
      await window.electronAPI.wishlistUpdate(id, updates)
      await loadWishlist()
    } catch (err) {
      console.error('Error updating wishlist item:', err)
      throw err
    }
  }, [loadWishlist])

  const markCompleted = useCallback(async (id: number) => {
    try {
      await window.electronAPI.wishlistUpdate(id, { status: 'completed' })
      await loadWishlist()
    } catch (err) {
      console.error('Error marking wishlist item as completed:', err)
      throw err
    }
  }, [loadWishlist])

  const markActive = useCallback(async (id: number) => {
    try {
      await window.electronAPI.wishlistUpdate(id, { status: 'active' })
      await loadWishlist()
    } catch (err) {
      console.error('Error marking wishlist item as active:', err)
      throw err
    }
  }, [loadWishlist])

  const removeItem = useCallback(async (id: number) => {
    try {
      await window.electronAPI.wishlistRemove(id)
      await loadWishlist()
    } catch (err) {
      console.error('Error removing wishlist item:', err)
      throw err
    }
  }, [loadWishlist])

  const checkExists = useCallback(async (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): Promise<boolean> => {
    try {
      return await window.electronAPI.wishlistCheckExists(tmdbId, musicbrainzId, mediaItemId)
    } catch (err) {
      console.error('Error checking wishlist existence:', err)
      return false
    }
  }, [])

  const addBulk = useCallback(async (items: Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>[]): Promise<number> => {
    try {
      const result = await window.electronAPI.wishlistAddBulk(items)
      await loadWishlist()
      return result.added
    } catch (err) {
      console.error('Error bulk adding wishlist items:', err)
      throw err
    }
  }, [loadWishlist])

  const getStoreLinks = useCallback(async (item: WishlistItem): Promise<StoreLink[]> => {
    try {
      return await window.electronAPI.wishlistGetStoreLinks(item) as StoreLink[]
    } catch (err) {
      console.error('Error getting store links:', err)
      return []
    }
  }, [])

  const openStoreLink = useCallback(async (url: string) => {
    try {
      await window.electronAPI.wishlistOpenStoreLink(url)
    } catch (err) {
      console.error('Error opening store link:', err)
    }
  }, [])

  const setRegion = useCallback(async (newRegion: StoreRegion) => {
    try {
      await window.electronAPI.wishlistSetRegion(newRegion)
      setRegionState(newRegion)
    } catch (err) {
      console.error('Error setting region:', err)
    }
  }, [])

  const exportToCsv = useCallback(async () => {
    try {
      return await window.electronAPI.wishlistExportCsv()
    } catch (err) {
      console.error('Error exporting wishlist:', err)
      return { success: false }
    }
  }, [])

  const setFilters = useCallback((newFilters: WishlistFilters) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }))
  }, [])

  const clearFilters = useCallback(() => {
    setFiltersState({
      sortBy: 'priority',
      sortOrder: 'desc'
    })
  }, [])

  const refresh = useCallback(async () => {
    await loadWishlist()
  }, [loadWishlist])

  const value: WishlistContextType = {
    items,
    count,
    counts,
    isLoading,
    error,
    filters,
    region,
    addItem,
    updateItem,
    removeItem,
    markCompleted,
    markActive,
    checkExists,
    addBulk,
    getStoreLinks,
    openStoreLink,
    setRegion,
    exportToCsv,
    setFilters,
    clearFilters,
    refresh
  }

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  )
}

export function useWishlist() {
  const context = useContext(WishlistContext)
  if (!context) {
    throw new Error('useWishlist must be used within a WishlistProvider')
  }
  return context
}
