import { Star } from 'lucide-react'

export function WishlistEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Star className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-foreground mb-2">Your wishlist is empty</h3>
      <p className="text-sm text-muted-foreground max-w-[200px] mb-4">
        Add missing items from your library to track what you want to buy.
      </p>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>Use</span>
        <span className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className={`w-3 h-3 ${i <= 3 ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
          ))}
        </span>
        <span>to set priority</span>
      </div>
    </div>
  )
}
