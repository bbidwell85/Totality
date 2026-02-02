/**
 * OnboardingWizard Component
 *
 * Full-window first-launch experience with animated logo and feature showcases.
 * Features are grouped into pages with alternating image/text layouts.
 */

import { useState, useEffect, useRef } from 'react'
import { Search, CircleFadingArrowUp, Library, SlidersHorizontal, ChevronRight, ChevronLeft, Server, HardDrive } from 'lucide-react'
import logoAnimation from '../../assets/totality_anim.webm'
import logoImage from '../../assets/logo.png'
import qualityAuditImg from '../../assets/onboarding/quality-audit.png'
import qualityTargetsImg from '../../assets/onboarding/quality-targets.png'
import upgradeRadarImg from '../../assets/onboarding/upgrade-radar.png'
import collectionGapsImg from '../../assets/onboarding/collection-gaps.png'

interface OnboardingWizardProps {
  onComplete: () => void
  onAddSource: () => void
}

interface Feature {
  id: string
  icon: typeof Search
  title: string
  tagline: string
  points: string[]
  accentColor: string
  screenshot?: string
}

// Individual features
const FEATURES: Record<string, Feature> = {
  qualityAudit: {
    id: 'quality-audit',
    icon: Search,
    title: 'Quality Audit',
    tagline: 'See exactly what you have — no more guessing',
    points: [
      'Resolution, bitrate, and codec details at a glance',
      'HDR and audio format detection',
      'Quality tier badges (SD, 720p, 1080p, 4K)',
    ],
    accentColor: 'from-blue-500/20 to-cyan-500/20',
    screenshot: qualityAuditImg,
  },
  qualityTargets: {
    id: 'quality-targets',
    icon: SlidersHorizontal,
    title: 'Custom Quality Targets',
    tagline: 'Your library, your standards',
    points: [
      'Set bitrate thresholds for each resolution tier',
      'Define what "good enough" means for your collection',
      'Different standards for movies, TV, and music',
    ],
    accentColor: 'from-purple-500/20 to-pink-500/20',
    screenshot: qualityTargetsImg,
  },
  upgradeRadar: {
    id: 'upgrade-radar',
    icon: CircleFadingArrowUp,
    title: 'Upgrade Radar',
    tagline: 'Find what deserves a better encode',
    points: [
      'Identifies low-bitrate encodes within each tier',
      'Spots compression artifacts before you notice them',
      'Prioritize your upgrade wishlist',
    ],
    accentColor: 'from-orange-500/20 to-amber-500/20',
    screenshot: upgradeRadarImg,
  },
  collectionGaps: {
    id: 'collection-gaps',
    icon: Library,
    title: 'Collection Gaps',
    tagline: "Never miss what's missing",
    points: [
      'Missing episodes in TV series',
      'Incomplete movie franchises and collections',
      'Album track completeness for music',
    ],
    accentColor: 'from-green-500/20 to-emerald-500/20',
    screenshot: collectionGapsImg,
  },
}

// Feature page groupings
const FEATURE_PAGES = [
  {
    id: 'analysis',
    title: 'Deep Analysis',
    subtitle: 'Know every detail of your collection',
    features: [FEATURES.qualityAudit, FEATURES.qualityTargets],
  },
  {
    id: 'tracking',
    title: 'Smart Tracking',
    subtitle: 'Find gaps and opportunities',
    features: [FEATURES.upgradeRadar, FEATURES.collectionGaps],
  },
]

const PROVIDERS = [
  { name: 'Plex', color: 'bg-[#e5a00d]', isLocal: false },
  { name: 'Jellyfin', color: 'bg-purple-500', isLocal: false },
  { name: 'Emby', color: 'bg-green-500', isLocal: false },
  { name: 'Kodi', color: 'bg-blue-500', isLocal: false },
  { name: 'Local Folder', color: 'bg-slate-600', isLocal: true },
]

const TRANSITION_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const TRANSITION_DURATION = 800

// Screenshot component - shows actual image or placeholder
function FeatureScreenshot({ feature }: { feature: Feature }) {
  if (feature.screenshot) {
    return (
      <div className="w-full rounded-xl overflow-hidden border border-border/50 shadow-xl">
        <img
          src={feature.screenshot}
          alt={`${feature.title} screenshot`}
          className="w-full h-auto"
        />
      </div>
    )
  }

  // Fallback placeholder if no screenshot
  return (
    <div
      className={`w-full aspect-[4/3] rounded-xl bg-gradient-to-br ${feature.accentColor} border border-border/50 flex items-center justify-center relative overflow-hidden`}
    >
      <div className="absolute inset-0 opacity-10">
        <div className="w-full h-full" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '20px 20px'
        }} />
      </div>
      <div className="text-center z-10">
        <feature.icon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" strokeWidth={1} />
        <p className="text-xs text-muted-foreground/50 font-medium">Screenshot Coming Soon</p>
      </div>
    </div>
  )
}

// Feature row component with alternating layout
function FeatureRow({ feature, imageOnLeft }: { feature: Feature; imageOnLeft: boolean }) {
  const content = (
    <>
      {/* Image side */}
      <div className="flex-1 min-w-0">
        <FeatureScreenshot feature={feature} />
      </div>

      {/* Text side */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-3 mb-2">
          <div className={`p-2.5 rounded-lg bg-gradient-to-br ${feature.accentColor}`}>
            <feature.icon className="w-6 h-6 text-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            {feature.title}
          </h3>
        </div>
        <p className="text-base text-muted-foreground mb-4">
          {feature.tagline}
        </p>
        <ul className="space-y-2.5">
          {feature.points.map((point, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${feature.accentColor.replace('/20', '')} mt-1.5 flex-shrink-0`} />
              <span className="text-sm text-muted-foreground leading-relaxed">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )

  return (
    <div className={`flex flex-col md:flex-row gap-8 md:gap-12 items-center ${imageOnLeft ? '' : 'md:flex-row-reverse'}`}>
      {content}
    </div>
  )
}

export function OnboardingWizard({ onComplete, onAddSource }: OnboardingWizardProps) {
  const [isReady, setIsReady] = useState(false)
  const [videoEnded, setVideoEnded] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [targetPage, setTargetPage] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const totalPages = 4 // Welcome + 2 feature pages + Add Source

  // Delay before showing content, then start video playback
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true)
      setTimeout(() => {
        videoRef.current?.play().catch(() => setVideoEnded(true))
      }, 100)
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  const handleVideoEnd = () => setVideoEnded(true)

  const handleVideoError = () => {
    console.warn('Video failed to load, showing static image')
    setVideoEnded(true)
  }

  const navigateToPage = (page: number) => {
    if (page !== currentPage && !isTransitioning && page >= 0 && page < totalPages) {
      setTargetPage(page)
      setIsTransitioning(true)
    }
  }

  const handleTransitionEnd = () => {
    if (isTransitioning) {
      setCurrentPage(targetPage)
      setIsTransitioning(false)
    }
  }

  const handleAddSourceClick = () => {
    onComplete()
    onAddSource()
  }

  const getPageOpacity = (index: number) => {
    if (!isTransitioning) return index === currentPage ? 1 : 0
    if (index === currentPage) return 0
    if (index === targetPage) return 1
    return 0
  }

  const displayPage = isTransitioning ? targetPage : currentPage

  const renderWelcomePage = () => (
    <div className="flex flex-col items-center">
      <div
        className="relative flex items-center justify-center mb-6"
        style={{ width: '500px', height: '500px', maxWidth: '90vw', maxHeight: '40vh' }}
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
          style={{ opacity: videoEnded ? 0 : 1 }}
        />
        <img
          src={logoImage}
          alt="Totality"
          className="absolute inset-0 w-full h-full object-contain"
          style={{ opacity: videoEnded ? 1 : 0 }}
        />
      </div>
      <h1 className="text-4xl font-bold text-foreground mb-4 tracking-tight">
        Welcome to Totality
      </h1>
      <p className="text-lg text-muted-foreground max-w-lg text-center leading-relaxed">
        For those who care about every pixel and every bit.
        <br />
        <span className="text-foreground/80">Let's see what your library is really made of.</span>
      </p>
    </div>
  )

  const renderFeaturePage = (pageData: typeof FEATURE_PAGES[0]) => (
    <div className="flex flex-col w-full max-w-5xl mx-auto px-4">
      {/* Page header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-2">
          {pageData.title}
        </h2>
        <p className="text-lg text-muted-foreground">
          {pageData.subtitle}
        </p>
      </div>

      {/* Feature rows with alternating layout */}
      <div className="space-y-12 md:space-y-16">
        {pageData.features.map((feature, index) => (
          <FeatureRow
            key={feature.id}
            feature={feature}
            imageOnLeft={index % 2 === 0}
          />
        ))}
      </div>
    </div>
  )

  const renderAddSourcePage = () => (
    <div className="flex flex-col items-center">
      <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3 tracking-tight">
        Connect Your Library
      </h2>
      <p className="text-lg text-muted-foreground max-w-md text-center mb-10">
        Point us at your media server or scan a local folder to get started
      </p>
      <button
        onClick={handleAddSourceClick}
        className="px-10 py-4 bg-accent text-accent-foreground rounded-xl font-semibold text-lg hover:bg-accent/90 transition-all hover:scale-105 shadow-lg mb-12"
      >
        Add Media Source
      </button>
      <div className="text-center">
        <p className="text-xs text-muted-foreground mb-5 uppercase tracking-widest font-medium">
          Supported Sources
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {PROVIDERS.map((provider) => (
            <div
              key={provider.name}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-card border border-border hover:border-muted-foreground/30 transition-colors"
            >
              <div className={`w-7 h-7 ${provider.color} rounded-md flex items-center justify-center text-white`}>
                {provider.isLocal ? (
                  <HardDrive className="w-4 h-4" />
                ) : (
                  <Server className="w-4 h-4" />
                )}
              </div>
              <span className="text-sm font-medium text-foreground">{provider.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  const pages = [
    renderWelcomePage,
    () => renderFeaturePage(FEATURE_PAGES[0]),
    () => renderFeaturePage(FEATURE_PAGES[1]),
    renderAddSourcePage,
  ]

  const transitionStyle = isTransitioning
    ? `${TRANSITION_DURATION}ms ${TRANSITION_EASING}`
    : 'none'

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
        style={{ opacity: isReady ? 1 : 0, transition: `opacity ${TRANSITION_DURATION}ms ease-out` }}
      >
        <div className="flex-1 overflow-hidden overflow-y-auto">
          <div className="flex flex-col items-center justify-center min-h-full px-8 py-12">
            <div className="relative w-full max-w-5xl overflow-visible">
              <div
                className="flex"
                style={{
                  transform: `translateX(calc(-${displayPage * 100}% - ${displayPage * 80}px))`,
                  transition: `transform ${transitionStyle}`,
                }}
                onTransitionEnd={handleTransitionEnd}
              >
                {pages.map((renderPage, index) => (
                  <div
                    key={index}
                    className="w-full flex-shrink-0"
                    style={{
                      marginRight: '80px',
                      opacity: getPageOpacity(index),
                      transition: `opacity ${transitionStyle}`,
                    }}
                  >
                    {renderPage()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation footer */}
        <div className="flex-shrink-0 border-t border-border bg-card/50 backdrop-blur-sm">
          <div className="px-8 py-5">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <button
                onClick={() => navigateToPage(currentPage - 1)}
                disabled={displayPage === 0 || isTransitioning}
                className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-0 disabled:cursor-default transition-colors rounded-lg hover:bg-muted/50"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              {/* Page indicators */}
              <div className="flex items-center gap-2">
                {Array.from({ length: totalPages }).map((_, index) => (
                  <button
                    key={index}
                    onClick={() => navigateToPage(index)}
                    disabled={isTransitioning}
                    className="p-1.5 rounded-full transition-all disabled:cursor-default group"
                    aria-label={`Go to page ${index + 1}`}
                  >
                    <div
                      className="rounded-full transition-all duration-300 group-hover:scale-110"
                      style={{
                        width: index === displayPage ? '28px' : '10px',
                        height: '10px',
                        backgroundColor: index === displayPage
                          ? 'hsl(var(--accent))'
                          : 'hsl(var(--muted-foreground) / 0.25)',
                      }}
                    />
                  </button>
                ))}
              </div>

              {displayPage < totalPages - 1 ? (
                <button
                  onClick={() => navigateToPage(currentPage + 1)}
                  disabled={isTransitioning}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-accent hover:text-accent/80 transition-colors rounded-lg hover:bg-accent/10 disabled:opacity-50 disabled:cursor-default"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={onComplete}
                  disabled={isTransitioning}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted/50 disabled:opacity-50 disabled:cursor-default"
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
