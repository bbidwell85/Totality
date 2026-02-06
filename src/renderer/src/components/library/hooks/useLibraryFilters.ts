import { useState, useEffect, useCallback } from 'react'
import type { MediaItem } from '../types'

type TierFilter = 'all' | 'SD' | '720p' | '1080p' | '4K'
type QualityFilter = 'all' | 'low' | 'medium' | 'high'

interface UseLibraryFiltersReturn {
  tierFilter: TierFilter
  setTierFilter: (filter: TierFilter) => void
  qualityFilter: QualityFilter
  setQualityFilter: (filter: QualityFilter) => void
  alphabetFilter: string | null
  setAlphabetFilter: (filter: string | null) => void
  debouncedTierFilter: TierFilter
  debouncedQualityFilter: QualityFilter
  filterItem: (item: MediaItem) => boolean
}

/**
 * Hook to manage library filter state with debouncing
 *
 * Provides tier (resolution), quality (within tier), and alphabet filters
 * with debounced versions for performance during rapid changes.
 *
 * @param searchQuery Current search query (used in filter logic)
 * @returns Filter state, setters, and filter function
 */
export function useLibraryFilters(searchQuery: string): UseLibraryFiltersReturn {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [alphabetFilter, setAlphabetFilter] = useState<string | null>(null)

  // Debounced filter values (faster than search since they're button clicks)
  const [debouncedTierFilter, setDebouncedTierFilter] = useState<TierFilter>('all')
  const [debouncedQualityFilter, setDebouncedQualityFilter] = useState<QualityFilter>('all')

  // Debounce filter changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTierFilter(tierFilter)
      setDebouncedQualityFilter(qualityFilter)
    }, 150) // 150ms debounce for filters

    return () => clearTimeout(timer)
  }, [tierFilter, qualityFilter])

  // Filter function for media items
  const filterItem = useCallback(
    (item: MediaItem): boolean => {
      // Alphabet filter
      if (alphabetFilter) {
        const title = item.type === 'episode' && item.series_title ? item.series_title : item.title
        const firstChar = title.charAt(0).toUpperCase()
        if (alphabetFilter === '#') {
          // Numbers and special characters
          if (/[A-Z]/.test(firstChar)) return false
        } else {
          if (firstChar !== alphabetFilter) return false
        }
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const title = item.title.toLowerCase()
        const seriesTitle = (item.series_title || '').toLowerCase()
        if (!title.includes(query) && !seriesTitle.includes(query)) {
          return false
        }
      }

      // Tier filter (use debounced value)
      if (debouncedTierFilter !== 'all' && item.quality_tier !== debouncedTierFilter) return false

      // Quality filter (use debounced value)
      if (debouncedQualityFilter !== 'all') {
        const tierQuality = (item.tier_quality || 'MEDIUM').toLowerCase()
        if (tierQuality !== debouncedQualityFilter) return false
      }

      return true
    },
    [alphabetFilter, searchQuery, debouncedTierFilter, debouncedQualityFilter]
  )

  return {
    tierFilter,
    setTierFilter,
    qualityFilter,
    setQualityFilter,
    alphabetFilter,
    setAlphabetFilter,
    debouncedTierFilter,
    debouncedQualityFilter,
    filterItem,
  }
}
