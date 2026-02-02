import { useState, useRef, useEffect } from 'react'
import { ShoppingCart, ExternalLink, ChevronDown } from 'lucide-react'
import type { StoreLink } from '../../contexts/WishlistContext'

interface StoreLinksMenuProps {
  storeLinks: StoreLink[]
  onOpenLink: (url: string) => void
  isLoading?: boolean
}

// Store icons mapping
const storeIcons: Record<string, string> = {
  justwatch: 'JW',
  amazon: 'Az',
  apple: '',
  vudu: 'Vu',
  google: 'GP',
  ebay: 'eB',
  discogs: 'Dc',
  bandcamp: 'Bc',
  hdtracks: 'HD'
}

export function StoreLinksMenu({ storeLinks, onOpenLink, isLoading }: StoreLinksMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close on escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  // Group stores by category
  const aggregators = storeLinks.filter(s => s.category === 'aggregator')
  const digital = storeLinks.filter(s => s.category === 'digital')
  const physical = storeLinks.filter(s => s.category === 'physical')

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
      >
        <ShoppingCart className="w-3.5 h-3.5" />
        <span>Shop</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-xl z-50 py-1 max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Loading stores...</div>
          ) : storeLinks.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No stores available</div>
          ) : (
            <>
              {/* Aggregators */}
              {aggregators.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Where to Watch
                  </div>
                  {aggregators.map((store) => (
                    <StoreMenuItem
                      key={store.url}
                      store={store}
                      onOpenLink={onOpenLink}
                      onClose={() => setIsOpen(false)}
                    />
                  ))}
                </>
              )}

              {/* Physical Media */}
              {physical.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-1">
                    Physical Media
                  </div>
                  {physical.map((store) => (
                    <StoreMenuItem
                      key={store.url}
                      store={store}
                      onOpenLink={onOpenLink}
                      onClose={() => setIsOpen(false)}
                    />
                  ))}
                </>
              )}

              {/* Digital Stores */}
              {digital.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-1">
                    Digital
                  </div>
                  {digital.map((store) => (
                    <StoreMenuItem
                      key={store.url}
                      store={store}
                      onOpenLink={onOpenLink}
                      onClose={() => setIsOpen(false)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface StoreMenuItemProps {
  store: StoreLink
  onOpenLink: (url: string) => void
  onClose: () => void
}

function StoreMenuItem({ store, onOpenLink, onClose }: StoreMenuItemProps) {
  const handleClick = () => {
    onOpenLink(store.url)
    onClose()
  }

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
    >
      <span className="w-6 h-6 rounded bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
        {storeIcons[store.icon] || store.icon.substring(0, 2).toUpperCase()}
      </span>
      <span className="flex-1 truncate">{store.name}</span>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
    </button>
  )
}
