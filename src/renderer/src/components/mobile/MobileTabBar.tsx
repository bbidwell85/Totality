import { Film, Tv, Music, Star, Search } from 'lucide-react'

export type MobileTab = 'movies' | 'tv' | 'music' | 'wishlist'

interface MobileTabBarProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
  onSearchOpen: () => void
}

const tabs: { id: MobileTab; label: string; icon: typeof Film }[] = [
  { id: 'movies', label: 'Movies', icon: Film },
  { id: 'tv', label: 'TV Shows', icon: Tv },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'wishlist', label: 'Wishlist', icon: Star },
]

export function MobileTabBar({ activeTab, onTabChange, onSearchOpen }: MobileTabBarProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom pointer-events-none">
      {/* Gradient behind tab bar — fades content into theme background */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background via-background/80 to-transparent" />
      <div className="relative px-4 pb-4 mt-auto pointer-events-auto" style={{ paddingTop: '80px' }}>
        <div className="bg-black rounded-3xl shadow-2xl px-2 py-2.5 flex items-center gap-1.5" role="tablist" aria-label="Navigation">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              role="tab"
              aria-selected={active}
              aria-label={label}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-2xl text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-black'
                  : 'text-white hover:bg-white/10'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs">{label}</span>
            </button>
          )
        })}

        {/* Divider */}
        <div className="w-px h-8 bg-white/20 mx-0.5" />

        {/* Search */}
        <button
          onClick={onSearchOpen}
          className="min-h-[52px] min-w-[44px] flex flex-col items-center justify-center gap-0.5 rounded-2xl text-white hover:bg-white/10 transition-colors"
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
        </button>
        </div>
      </div>
    </nav>
  )
}
