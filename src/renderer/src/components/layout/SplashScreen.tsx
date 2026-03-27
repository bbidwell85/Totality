/**
 * SplashScreen Component
 *
 * Shows the animated logo on app launch (after first launch/onboarding).
 * Fades out after the animation completes.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import logoAnimation from '../../assets/totality_anim.webm'
import logoAnimationBlack from '../../assets/totality_anim_black.webm'
import logoImage from '../../assets/logo.png'
import logoBlackImage from '../../assets/logo_black.png'

interface SplashScreenProps {
  onComplete: () => void
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [videoEnded, setVideoEnded] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const { effectiveIsDark } = useTheme()

  useEffect(() => {
    const timer = setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.play().catch(() => {
          setVideoEnded(true)
          setFadeOut(true)
        })
      }
      setVideoReady(true)
    }, 500)
    return () => {
      clearTimeout(timer)
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current)
    }
  }, [])

  const handleVideoEnd = useCallback(() => {
    setVideoEnded(true)
    fadeTimeoutRef.current = setTimeout(() => {
      setFadeOut(true)
    }, 3000)
  }, [])

  // Handle video error - skip to end
  const handleVideoError = () => {
    console.warn('Splash video failed to load, skipping')
    setVideoEnded(true)
    setFadeOut(true)
  }

  // Call onComplete after fade out
  useEffect(() => {
    if (fadeOut) {
      const timer = setTimeout(() => {
        onComplete()
      }, 600) // Match fade out duration
      return () => clearTimeout(timer)
    }
  }, [fadeOut, onComplete])

  return (
    <div
      className="fixed inset-0 z-200 bg-background flex items-center justify-center"
      style={{
        backgroundColor: 'hsl(var(--background))',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 600ms ease-out',
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: '400px', height: '400px', maxWidth: '80vw', maxHeight: '80vh' }}
      >
        <video
          ref={videoRef}
          src={effectiveIsDark ? logoAnimation : logoAnimationBlack}
          muted
          playsInline
          preload="auto"
          onEnded={handleVideoEnd}
          onError={handleVideoError}
          className="absolute inset-0 w-full h-full object-contain"
          style={{
            opacity: videoReady && !videoEnded ? 1 : 0,
          }}
        />
        <img
          src={effectiveIsDark ? logoImage : logoBlackImage}
          alt="Totality application logo"
          className="absolute inset-0 w-full h-full object-contain"
          style={{
            opacity: videoEnded ? 1 : 0,
          }}
        />
      </div>
    </div>
  )
}
