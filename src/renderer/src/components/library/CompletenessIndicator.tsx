interface CompletenessIndicatorProps {
  type: 'series' | 'collection'
  percentage: number
  owned: number
  total: number
  className?: string
}

export function CompletenessIndicator({
  type,
  percentage,
  owned,
  total,
  className = ''
}: CompletenessIndicatorProps) {
  // Don't show badge for complete items
  if (percentage === 100) return null

  // Display format differs by type
  const displayText = type === 'series'
    ? `${Math.round(percentage)}%`
    : `${owned}/${total}`

  return (
    <div className={`absolute top-2 right-2 ${className}`}>
      <div
        className="bg-foreground text-background text-xs font-bold px-2 py-1 rounded shadow-md border border-border"
        title={type === 'series'
          ? `${owned} of ${total} episodes owned`
          : `${owned} of ${total} movies in collection`
        }
      >
        {displayText}
      </div>
    </div>
  )
}
