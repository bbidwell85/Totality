import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { MediaBrowser } from './components/library/MediaBrowser'
import { SourceProvider, useSources } from './contexts/SourceContext'
import { KeyboardNavigationProvider } from './contexts/KeyboardNavigationContext'
import { WishlistProvider } from './contexts/WishlistContext'
import { NavigationProvider } from './contexts/NavigationContext'
import { ToastProvider } from './contexts/ToastContext'
import { AddSourceModal } from './components/sources/AddSourceModal'
import { AboutModal } from './components/ui/AboutModal'
import { SettingsPanel } from './components/settings'
import { OnboardingWizard } from './components/onboarding'
import { SplashScreen } from './components/layout/SplashScreen'
import { ToastContainer } from './components/ui/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'

function AppContent() {
  const { isLoading } = useSources()
  const [showAddSourceModal, setShowAddSourceModal] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null)
  const [splashComplete, setSplashComplete] = useState(() => sessionStorage.getItem('splashShown') === 'true')
  const hasSignaledReady = useRef(false)

  const markSplashShown = () => {
    sessionStorage.setItem('splashShown', 'true')
    setSplashComplete(true)
  }

  useEffect(() => {
    window.electronAPI.getSetting('onboarding_completed')
      .then(value => setOnboardingComplete(value === 'true'))
      .catch(err => {
        console.error('Failed to load onboarding state:', err)
        setOnboardingComplete(false)
      })
  }, [])

  // Load and apply theme on startup
  useEffect(() => {
    window.electronAPI.getSetting('theme')
      .then(savedTheme => {
        const theme = savedTheme || 'dark'
        document.documentElement.classList.remove('dark', 'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon')
        document.documentElement.classList.add(theme)
      })
      .catch(err => {
        console.error('Failed to load theme:', err)
        document.documentElement.classList.add('dark')
      })
  }, [])

  // Signal to main process that we're ready to show content
  useEffect(() => {
    if (!hasSignaledReady.current && !isLoading && onboardingComplete !== null) {
      hasSignaledReady.current = true
      // Small delay to ensure content is painted
      setTimeout(() => {
        window.electronAPI.appReady()
      }, 50)
    }
  }, [isLoading, onboardingComplete])

  const handleOnboardingComplete = async () => {
    try {
      await window.electronAPI.setSetting('onboarding_completed', 'true')
      markSplashShown()
      setOnboardingComplete(true)
    } catch (error) {
      console.error('Failed to save onboarding state:', error)
    }
  }

  const handleAddSourceSuccess = async () => {
    setShowAddSourceModal(false)
    if (!onboardingComplete) await handleOnboardingComplete()
  }

  if (isLoading || onboardingComplete === null) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Onboarding disabled for now - to re-enable, uncomment the line below
  // const showOnboarding = sources.length === 0 && !onboardingComplete
  const showOnboarding = false
  const showSplash = onboardingComplete && !splashComplete

  if (showOnboarding) {
    return (
      <>
        <OnboardingWizard
          onComplete={handleOnboardingComplete}
          onAddSource={() => setShowAddSourceModal(true)}
        />
        {showAddSourceModal && (
          <AddSourceModal
            onClose={() => setShowAddSourceModal(false)}
            onSuccess={handleAddSourceSuccess}
          />
        )}
      </>
    )
  }

  return (
    <>
      {/* Render main app - it loads behind the splash screen */}
      <div className="relative h-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          onOpenAbout={() => setShowAboutModal(true)}
        />
        <main className="ml-72 h-screen">
          <MediaBrowser onAddSource={() => setShowAddSourceModal(true)} onOpenSettings={(initialTab?: string) => {
            setSettingsInitialTab(initialTab)
            setShowSettingsModal(true)
          }} />
        </main>
        {showAddSourceModal && (
          <AddSourceModal
            onClose={() => setShowAddSourceModal(false)}
            onSuccess={handleAddSourceSuccess}
          />
        )}
        <AboutModal isOpen={showAboutModal} onClose={() => setShowAboutModal(false)} />
        <SettingsPanel
          isOpen={showSettingsModal}
          onClose={() => {
            setShowSettingsModal(false)
            setSettingsInitialTab(undefined)
          }}
          initialTab={settingsInitialTab as any}
        />
      </div>
      {/* Splash screen overlays the app and fades out to reveal it */}
      {showSplash && <SplashScreen onComplete={markSplashShown} />}
      {/* Toast notifications */}
      <ToastContainer />
    </>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SourceProvider>
          <KeyboardNavigationProvider>
            <WishlistProvider>
              <NavigationProvider>
                <AppContent />
              </NavigationProvider>
            </WishlistProvider>
          </KeyboardNavigationProvider>
        </SourceProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
