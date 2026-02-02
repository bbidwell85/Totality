/**
 * SplashScreen Component
 *
 * Shows the animated logo on app launch (after first launch/onboarding).
 * Fades out after the animation completes.
 */

import { useState, useRef, useEffect } from 'react'
import logoAnimation from '../../assets/totality_anim.webm'
import logoImage from '../../assets/logo.png'

interface SplashScreenProps {
  onComplete: () => void
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [videoEnded, setVideoEnded] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Start video playback after a delay to ensure window is fully visible
  useEffect(() => {
    const timer = setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.play().catch(() => {
          // If play fails, skip to end
          setVideoEnded(true)
          setFadeOut(true)
        })
      }
      setVideoReady(true)
    }, 500) // Wait 500ms for window to be fully ready
    return () => clearTimeout(timer)
  }, [])

  // Handle video end
  const handleVideoEnd = () => {
    setVideoEnded(true)
    // Hold on static logo for 3 seconds before fading out
    setTimeout(() => {
      setFadeOut(true)
    }, 3000)
  }

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
      className="fixed inset-0 z-[200] bg-background flex items-center justify-center"
      style={{
        backgroundColor: '#1c1d24',
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
          src={logoAnimation}
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
          src={logoImage}
          alt="Totality"
          className="absolute inset-0 w-full h-full object-contain"
          style={{
            opacity: videoEnded ? 1 : 0,
          }}
        />
      </div>
    </div>
  )
}
