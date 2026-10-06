import { useState, useCallback, useRef } from 'react'

interface UsePaginationOptions<T> {
  pageSize: number
  fetchItems: (filters: Record<string, unknown>) => Promise<T[]>
  fetchCount: (filters: Record<string, unknown>) => Promise<number>
  buildFilters: () => Record<string, unknown>
  deps: unknown[]
}

interface UsePaginationReturn<T> {
  items: T[]
  setItems: React.Dispatch<React.SetStateAction<T[]>>
  totalCount: number
  loading: boolean
  load: (reset?: boolean, startOffset?: number) => Promise<void>
  loadMore: () => void
}

/**
 * Generic server-side pagination hook.
 *
 * Handles loading guard, request staleness detection, offset tracking,
 * and reset/append logic. Callers provide fetch functions and filter builders.
 */
export function usePagination<T>({
  pageSize,
  fetchItems,
  fetchCount,
  buildFilters,
  deps,
}: UsePaginationOptions<T>): UsePaginationReturn<T> {
  const [items, setItems] = useState<T[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const offsetRef = useRef(0)
  const requestIdRef = useRef(0)

  const load = useCallback(async (reset = true, startOffset?: number) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const thisRequestId = ++requestIdRef.current
    try {
      const offset = reset ? (startOffset ?? 0) : offsetRef.current
      const filters = { ...buildFilters(), limit: pageSize, offset }

      const [fetchedItems, count] = await Promise.all([
        fetchItems(filters),
        fetchCount(filters),
      ])

      // Discard stale response if a newer request was started
      if (requestIdRef.current !== thisRequestId) {
        // Don't reset loadingRef — the newer request owns it
        return
      }

      if (reset) {
        setItems(fetchedItems)
        offsetRef.current = pageSize
      } else {
        setItems(prev => [...prev, ...fetchedItems])
        offsetRef.current = offset + pageSize
      }
      setTotalCount(count)
    } catch (err) {
      console.warn('Failed to load paginated items:', err)
    } finally {
      if (requestIdRef.current === thisRequestId) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps])

  const loadMore = useCallback(() => {
    if (offsetRef.current < totalCount && !loading) {
      load(false)
    }
  }, [totalCount, loading, load])

  return { items, setItems, totalCount, loading, load, loadMore }
}
