import { Star } from 'lucide-react'
import { useState, useCallback } from 'react'

interface StarRatingProps {
  rating: 1 | 2 | 3 | 4 | 5
  onChange?: (rating: 1 | 2 | 3 | 4 | 5) => void
  size?: 'sm' | 'md' | 'lg'
  readonly?: boolean
}

const sizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5'
}

export function StarRating({ rating, onChange, size = 'md', readonly = false }: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null)

  const handleClick = useCallback((value: 1 | 2 | 3 | 4 | 5) => {
    if (!readonly && onChange) {
      onChange(value)
    }
  }, [readonly, onChange])

  const handleMouseEnter = useCallback((value: number) => {
    if (!readonly) {
      setHoverRating(value)
    }
  }, [readonly])

  const handleMouseLeave = useCallback(() => {
    setHoverRating(null)
  }, [])

  const displayRating = hoverRating ?? rating

  return (
    <div
      className={`flex gap-0.5 ${readonly ? '' : 'cursor-pointer'}`}
      onMouseLeave={handleMouseLeave}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          disabled={readonly}
          onClick={() => handleClick(value as 1 | 2 | 3 | 4 | 5)}
          onMouseEnter={() => handleMouseEnter(value)}
          className={`${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform disabled:opacity-100 p-0 border-0 bg-transparent`}
          aria-label={`Set priority to ${value} star${value > 1 ? 's' : ''}`}
        >
          <Star
            className={`${sizeClasses[size]} transition-colors ${
              value <= displayRating
                ? 'fill-amber-400 text-amber-400'
                : 'fill-transparent text-muted-foreground/40'
            }`}
          />
        </button>
      ))}
    </div>
  )
}
