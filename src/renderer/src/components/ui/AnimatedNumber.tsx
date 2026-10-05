import { useEffect, useRef, useState, memo } from 'react'

interface AnimatedNumberProps {
  /** Target value to animate to */
  value: number
  /** Animation duration in ms (default: 400) */
  duration?: number
  /** Format with toLocaleString (default: false) */
  locale?: boolean
  /** Decimal places (default: 0) */
  decimals?: number
  /** Suffix appended after number (e.g., "%", " kbps") */
  suffix?: string
  /** Prefix before number (e.g., "$") */
  prefix?: string
  /** CSS class applied to the span */
  className?: string
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Renders a number that smoothly animates between values (odometer style).
 *
 * Usage:
 *   <AnimatedNumber value={1234} locale />
 *   <AnimatedNumber value={67} suffix="%" />
 *   <AnimatedNumber value={1.5} decimals={1} suffix=" TB" />
 */
export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  duration = 400,
  locale = false,
  decimals = 0,
  suffix = '',
  prefix = '',
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)
  const animRef = useRef<number | null>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    // Skip animation on first render — just show the value
    if (isFirstRender.current) {
      isFirstRender.current = false
      prevRef.current = value
      setDisplay(value)
      return
    }

    const from = prevRef.current
    const to = value
    prevRef.current = to

    // No animation needed if value unchanged
    if (from === to) return

    // Cancel any in-progress animation
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current)
    }

    const start = performance.now()

    const animate = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOut(progress)
      const current = from + (to - from) * eased

      setDisplay(decimals > 0 ? parseFloat(current.toFixed(decimals)) : Math.round(current))

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate)
      } else {
        animRef.current = null
      }
    }

    animRef.current = requestAnimationFrame(animate)

    return () => {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
      }
    }
  }, [value, duration, decimals])

  // Handle edge cases
  if (value == null || isNaN(value)) {
    return <span className={className}>--</span>
  }

  const formatted = locale ? display.toLocaleString() : decimals > 0 ? display.toFixed(decimals) : String(display)

  return <span className={className}>{prefix}{formatted}{suffix}</span>
})
