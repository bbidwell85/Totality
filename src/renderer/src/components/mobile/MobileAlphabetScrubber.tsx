import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronsUpDown } from 'lucide-react'

const LETTERS = ['#', ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ')]
const HIDE_DELAY = 2000
const TOP_BOUND = 80
const BOTTOM_BOUND = 100 // space for tab bar + safe area

interface MobileAlphabetScrubberProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export default function MobileAlphabetScrubber({
  scrollContainerRef,
}: MobileAlphabetScrubberProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  const [handleY, setHandleY] = useState<number | null>(null)

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrolledLetterRef = useRef<string | null>(null)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const startHideTimer = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      if (!isDragging) setIsVisible(false)
    }, HIDE_DELAY)
  }, [clearHideTimer, isDragging])

  // Show on scroll, hide after idle
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const onScroll = () => {
      setIsVisible(true)
      startHideTimer()
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [scrollContainerRef, startHideTimer])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const getLetterFromY = useCallback((clientY: number): string => {
    const scrubHeight = window.innerHeight - TOP_BOUND - BOTTOM_BOUND
    const relativeY = Math.max(0, Math.min(scrubHeight, clientY - TOP_BOUND))
    const index = Math.round((relativeY / scrubHeight) * (LETTERS.length - 1))
    return LETTERS[Math.max(0, Math.min(LETTERS.length - 1, index))]
  }, [])

  const scrollToLetter = useCallback((letter: string) => {
    if (letter === lastScrolledLetterRef.current) return
    lastScrolledLetterRef.current = letter

    const container = scrollContainerRef.current
    if (!container) return

    const items = container.querySelectorAll('[data-title]')
    for (const el of items) {
      const title = el.getAttribute('data-title') || ''
      const firstChar = title[0]?.toUpperCase() || ''
      const isMatch = letter === '#'
        ? !/^[A-Z]/.test(firstChar)
        : firstChar === letter

      if (isMatch) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' })
        break
      }
    }
  }, [scrollContainerRef])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    clearHideTimer()

    const clientY = e.touches[0].clientY
    const letter = getLetterFromY(clientY)
    setActiveLetter(letter)
    setHandleY(clientY)
    scrollToLetter(letter)
  }, [clearHideTimer, getLetterFromY, scrollToLetter])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    e.preventDefault()

    const clientY = e.touches[0].clientY
    const clampedY = Math.max(TOP_BOUND, Math.min(window.innerHeight - BOTTOM_BOUND, clientY))
    const letter = getLetterFromY(clampedY)

    setActiveLetter(letter)
    setHandleY(clampedY)
    scrollToLetter(letter)
  }, [isDragging, getLetterFromY, scrollToLetter])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    lastScrolledLetterRef.current = null

    setTimeout(() => {
      setActiveLetter(null)
      setHandleY(null)
    }, 300)
    startHideTimer()
  }, [isDragging, startHideTimer])

  const showHandle = isVisible || isDragging
  const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 400
  const currentY = handleY ?? centerY

  return (
    <>
      {/* Letter bubble — positioned to left of thumb */}
      <div
        className="fixed z-40 pointer-events-none flex items-center justify-center w-12 h-12 rounded-full bg-foreground text-background text-h2 font-semibold"
        style={{
          right: 80,
          top: currentY - 24,
          opacity: isDragging && activeLetter ? 1 : 0,
          transition: 'opacity 150ms ease-out',
        }}
      >
        {activeLetter}
      </div>

      {/* Scrubber handle */}
      <div
        className="fixed z-40 flex items-center justify-center w-10 h-10 rounded-full bg-card/80 backdrop-blur-sm"
        style={{
          right: 8,
          top: currentY - 20,
          transform: `translateX(${showHandle ? '0' : '48px'})`,
          opacity: showHandle ? 1 : 0,
          transition: isDragging
            ? 'opacity 150ms ease-out'
            : 'opacity 300ms ease-out, transform 300ms ease-out',
          touchAction: 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <ChevronsUpDown className="w-5 h-5 text-muted-foreground" />
      </div>
    </>
  )
}
