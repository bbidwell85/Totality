/**
 * EclipseIndicator Component
 *
 * Visual representation of completeness using a solar eclipse metaphor.
 * - 0% complete: Sun fully visible, moon just starting to overlap
 * - 100% complete: Total eclipse with glowing corona
 */

import { memo } from 'react'

interface EclipseIndicatorProps {
  /** Completeness percentage (0-100) */
  percentage: number
  /** Size of the component in pixels */
  size?: number
  /** Whether to show the percentage text */
  showPercentage?: boolean
  /** Optional className for the container */
  className?: string
}

export const EclipseIndicator = memo(function EclipseIndicator({
  percentage,
  size = 48,
  showPercentage = false,
  className = ''
}: EclipseIndicatorProps) {
  // Clamp percentage between 0 and 100
  const clampedPercentage = Math.max(0, Math.min(100, percentage))

  // Calculate moon position
  // At 0%: moon is offset to the right (barely overlapping)
  // At 100%: moon is centered (total eclipse)
  const sunRadius = 40
  const moonRadius = 42 // Slightly larger to fully cover sun at totality

  // Moon X offset: starts at +35 (barely overlapping) and moves to 0 (centered)
  const maxOffset = 35
  const moonOffset = maxOffset * (1 - clampedPercentage / 100)

  // Corona opacity: only visible when approaching totality (>80%)
  const coronaOpacity = clampedPercentage > 80
    ? (clampedPercentage - 80) / 20
    : 0

  // Corona glow intensity increases with completeness
  const coronaGlowRadius = 8 + (clampedPercentage / 100) * 12

  // Sun visibility (for the crescent effect)
  const isComplete = clampedPercentage >= 100

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="overflow-visible"
      >
        <defs>
          {/* Sun gradient - golden orange */}
          <radialGradient id={`sunGradient-${size}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fcd34d" />
            <stop offset="70%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </radialGradient>

          {/* Corona glow gradient */}
          <radialGradient id={`coronaGradient-${size}`} cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="transparent" />
            <stop offset="75%" stopColor="rgba(251, 191, 36, 0.6)" />
            <stop offset="85%" stopColor="rgba(251, 191, 36, 0.3)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>

          {/* Outer corona streamers */}
          <radialGradient id={`outerCorona-${size}`} cx="50%" cy="50%" r="50%">
            <stop offset="50%" stopColor="transparent" />
            <stop offset="70%" stopColor="rgba(254, 243, 199, 0.4)" />
            <stop offset="85%" stopColor="rgba(254, 243, 199, 0.15)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>

          {/* Moon gradient - dark with slight blue tint */}
          <radialGradient id={`moonGradient-${size}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#1f2937" />
            <stop offset="100%" stopColor="#111827" />
          </radialGradient>

          {/* Clip path for the eclipse effect */}
          <clipPath id={`eclipseClip-${size}`}>
            <circle cx={50} cy={50} r={sunRadius} />
          </clipPath>

          {/* Glow filter for corona */}
          <filter id={`coronaGlow-${size}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={coronaGlowRadius} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer corona (only visible at high completeness) */}
        {coronaOpacity > 0 && (
          <circle
            cx={50}
            cy={50}
            r={55}
            fill={`url(#outerCorona-${size})`}
            opacity={coronaOpacity}
            style={{ transition: 'opacity 0.3s ease' }}
          />
        )}

        {/* Corona glow ring (only visible at high completeness) */}
        {coronaOpacity > 0 && (
          <circle
            cx={50}
            cy={50}
            r={sunRadius + 2}
            fill="none"
            stroke="rgba(251, 191, 36, 0.8)"
            strokeWidth={3}
            opacity={coronaOpacity}
            filter={`url(#coronaGlow-${size})`}
            style={{ transition: 'opacity 0.3s ease' }}
          />
        )}

        {/* Sun */}
        <circle
          cx={50}
          cy={50}
          r={sunRadius}
          fill={`url(#sunGradient-${size})`}
        />

        {/* Moon (overlapping the sun) */}
        <circle
          cx={50 + moonOffset}
          cy={50}
          r={moonRadius}
          fill={`url(#moonGradient-${size})`}
          clipPath={isComplete ? undefined : `url(#eclipseClip-${size})`}
          style={{ transition: 'cx 0.3s ease' }}
        />

        {/* At total eclipse, show a thin bright ring (diamond ring effect) */}
        {isComplete && (
          <>
            {/* Inner edge glow */}
            <circle
              cx={50}
              cy={50}
              r={moonRadius - 1}
              fill="none"
              stroke="rgba(254, 243, 199, 0.9)"
              strokeWidth={1.5}
              filter={`url(#coronaGlow-${size})`}
            />
          </>
        )}
      </svg>

      {showPercentage && (
        <span className="text-xs font-medium text-muted-foreground">
          {Math.round(clampedPercentage)}%
        </span>
      )}
    </div>
  )
})
