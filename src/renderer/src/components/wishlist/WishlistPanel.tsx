import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Filter, ArrowUpDown, Film, Tv, Music, Loader2, ListTodo, CircleFadingArrowUp, Download, CheckCircle2, Circle } from 'lucide-react'
import { useWishlist, WishlistMediaType, WishlistPriority, WishlistReason, WishlistStatus } from '../../contexts/WishlistContext'
import { WishlistItemCard } from './WishlistItemCard'
import { WishlistEmptyState } from './WishlistEmptyState'

interface WishlistPanelProps {
  isOpen: boolean
  onClose: () => void
}

type SortOption = 'priority' | 'added_at' | 'title' | 'year' | 'completed_at'
type FilterType = WishlistMediaType | 'all'
type CategoryType = WishlistReason | 'all'
type StatusType = WishlistStatus | 'all'

export function WishlistPanel({ isOpen, onClose }: WishlistPanelProps) {
  const {
    items,
    counts,
    isLoading,
    setFilters,
    removeItem,
    updateItem,
    markCompleted,
    markActive,
    exportToCsv
  } = useWishlist()

  const [activeCategory, setActiveCategory] = useState<CategoryType>('all')
  const [activeStatus, setActiveStatus] = useState<StatusType>('active')
  const [isExporting, setIsExporting] = useState(false)
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortOption>('priority')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)

  // Auto-focus close button when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        closeButtonRef.current?.focus()
      }, 100)
    }
  }, [isOpen])

  // Handle Escape key to close panel
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [onClose])

  // Apply filters when changed
  useEffect(() => {
    setFilters({
      media_type: activeFilter === 'all' ? undefined : activeFilter,
      reason: activeCategory === 'all' ? undefined : activeCategory,
      status: activeStatus === 'all' ? undefined : activeStatus,
      sortBy: activeStatus === 'completed' && sortBy === 'priority' ? 'completed_at' : sortBy,
      sortOrder
    })
  }, [activeCategory, activeStatus, activeFilter, sortBy, sortOrder, setFilters])

  const handleRemove = async (id: number) => {
    try {
      await removeItem(id)
    } catch (err) {
      console.error('Error removing item:', err)
    }
  }

  const handleUpdatePriority = async (id: number, priority: WishlistPriority) => {
    try {
      await updateItem(id, { priority })
    } catch (err) {
      console.error('Error updating priority:', err)
    }
  }

  const handleMarkCompleted = async (id: number) => {
    try {
      await markCompleted(id)
    } catch (err) {
      console.error('Error marking item as completed:', err)
    }
  }

  const handleMarkActive = async (id: number) => {
    try {
      await markActive(id)
    } catch (err) {
      console.error('Error marking item as active:', err)
    }
  }

  const toggleSort = (field: SortOption) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder(field === 'priority' ? 'desc' : 'asc')
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const result = await exportToCsv()
      if (result.success && result.path) {
        console.log(`Exported ${result.count} items to ${result.path}`)
      }
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  // Status tabs
  const statusOptions: { type: StatusType; icon: typeof Circle; label: string; count: number }[] = [
    { type: 'active', icon: Circle, label: 'Active', count: counts.active },
    { type: 'completed', icon: CheckCircle2, label: 'Completed', count: counts.completed }
  ]

  // Category options with counts
  const categoryOptions: { type: CategoryType; icon: typeof ListTodo; label: string; count: number }[] = [
    { type: 'all', icon: Filter, label: 'All', count: counts.total },
    { type: 'missing', icon: ListTodo, label: 'Missing', count: counts.missing },
    { type: 'upgrade', icon: CircleFadingArrowUp, label: 'Upgrade', count: counts.upgrade }
  ]

  // Media type filter options
  const filterOptions: { type: FilterType; icon: typeof Film; label: string }[] = [
    { type: 'all', icon: Filter, label: 'All' },
    { type: 'movie', icon: Film, label: 'Movies' },
    { type: 'episode', icon: Tv, label: 'TV' },
    { type: 'album', icon: Music, label: 'Music' }
  ]

  // Group items by reason for display
  const missingItems = items.filter(item => item.reason === 'missing')
  const upgradeItems = items.filter(item => item.reason === 'upgrade')

  return (
    <aside
      ref={panelRef}
      id="wishlist-panel"
      className={`fixed top-[88px] bottom-4 right-4 w-80 bg-sidebar-gradient rounded-2xl shadow-xl z-40 flex flex-col overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-[transform,opacity] ${
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
      }`}
      onKeyDown={handleKeyDown}
      role="complementary"
      aria-label="Shopping wishlist"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Wishlist
          </h2>
          {counts.total > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">
              {counts.total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {counts.total > 0 && (
            <button
              ref={exportButtonRef}
              onClick={handleExport}
              disabled={isExporting}
              className="p-1.5 rounded-md hover:bg-muted transition-colors focus:outline-none disabled:opacity-50"
              aria-label="Export wishlist to CSV"
              title="Export to CSV"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <Download className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          )}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Close wishlist panel"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Status Tabs (Active / Completed) */}
      {counts.total > 0 && (
        <div className="px-3 pt-3 pb-2 border-b border-border/30">
          <div className="flex gap-1">
            {statusOptions.map(({ type, icon: Icon, label, count }) => (
              <button
                key={type}
                onClick={() => setActiveStatus(type)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs rounded-lg transition-colors ${
                  activeStatus === type
                    ? type === 'completed' ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground'
                    : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
                {count > 0 && (
                  <span className={`text-xs ${activeStatus === type ? 'opacity-80' : 'text-muted-foreground/60'}`}>
                    ({count})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category Tabs (All / Missing / Upgrade) */}
      {counts.total > 0 && activeStatus !== 'completed' && (
        <div className="px-3 pt-2 pb-2 border-b border-border/30">
          <div className="flex gap-1">
            {categoryOptions.map(({ type, icon: Icon, label, count }) => (
              <button
                key={type}
                onClick={() => setActiveCategory(type)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg transition-colors ${
                  activeCategory === type
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted/20 text-muted-foreground hover:bg-muted/30'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
                {count > 0 && (
                  <span className={`text-xs ${activeCategory === type ? 'text-primary/80' : 'text-muted-foreground/60'}`}>
                    ({count})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters & Sort */}
      {counts.total > 0 && (
        <div className="p-3 border-b border-border/30 space-y-2">
          {/* Media type filter pills */}
          <div className="flex gap-1">
            {filterOptions.map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => setActiveFilter(type)}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full transition-colors ${
                  activeFilter === type
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Sort options */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            <div className="flex gap-1">
              {(['priority', 'added_at', 'title'] as SortOption[]).map((field) => (
                <button
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                    sortBy === field
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {field === 'priority' ? 'Priority' : field === 'added_at' ? 'Date' : 'Title'}
                  {sortBy === field && (
                    <ArrowUpDown className={`w-3 h-3 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <WishlistEmptyState />
        ) : activeCategory === 'all' ? (
          // Show grouped by category when viewing all
          <div className="space-y-4">
            {/* Missing Section */}
            {missingItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <ListTodo className="w-3.5 h-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Complete Collection ({missingItems.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {missingItems.map((item) => (
                    <WishlistItemCard
                      key={item.id}
                      item={item}
                      onRemove={handleRemove}
                      onUpdatePriority={handleUpdatePriority}
                      onMarkCompleted={handleMarkCompleted}
                      onMarkActive={handleMarkActive}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Upgrade Section */}
            {upgradeItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <CircleFadingArrowUp className="w-3.5 h-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Upgrade Quality ({upgradeItems.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {upgradeItems.map((item) => (
                    <WishlistItemCard
                      key={item.id}
                      item={item}
                      onRemove={handleRemove}
                      onUpdatePriority={handleUpdatePriority}
                      onMarkCompleted={handleMarkCompleted}
                      onMarkActive={handleMarkActive}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Show flat list when filtered by category
          <div className="space-y-2">
            {items.map((item) => (
              <WishlistItemCard
                key={item.id}
                item={item}
                onRemove={handleRemove}
                onUpdatePriority={handleUpdatePriority}
                onMarkCompleted={handleMarkCompleted}
                onMarkActive={handleMarkActive}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
