import { useState, useEffect, useRef, useCallback } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { MediaBrowser } from './components/library/MediaBrowser'
import { Dashboard } from './components/dashboard'
import { WishlistPanel } from './components/wishlist/WishlistPanel'
import { CompletenessPanel } from './components/library/CompletenessPanel'
import { SourceProvider, useSources } from './contexts/SourceContext'
import { WishlistProvider } from './contexts/WishlistContext'
import { NavigationProvider } from './contexts/NavigationContext'
import { ToastProvider } from './contexts/ToastContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AddSourceModal } from './components/sources/AddSourceModal'
import { AboutModal } from './components/ui/AboutModal'
import { SettingsPanel } from './components/settings'
import { OnboardingWizard } from './components/onboarding'
import { SplashScreen } from './components/layout/SplashScreen'
import { ToastContainer } from './components/ui/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SectionErrorBoundary } from './components/ui/SectionErrorBoundary'
import type { MediaViewType, SeriesStats, CollectionStats, MusicCompletenessStats, AnalysisProgress } from './components/library/types'

type AppView = 'dashboard' | 'library'

function AppContent() {
  const { isLoading, sources, activeSourceId, hasMovies, hasTV, hasMusic } = useSources()
  const [showAddSourceModal, setShowAddSourceModal] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null)
  const [splashComplete, setSplashComplete] = useState(() => sessionStorage.getItem('splashShown') === 'true')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [currentView, setCurrentView] = useState<AppView>('dashboard')
  const [libraryTab, setLibraryTab] = useState<MediaViewType>('movies')

  // Panel states - managed at app level for TopBar to control
  const [showCompletenessPanel, setShowCompletenessPanel] = useState(false)
  const [showWishlistPanel, setShowWishlistPanel] = useState(false)

  // Auto-refresh state (passed up from MediaBrowser)
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)

  // Completeness panel state - managed at app level for both Dashboard and Library views
  const [seriesStats, setSeriesStats] = useState<SeriesStats | null>(null)
  const [collectionStats, setCollectionStats] = useState<CollectionStats | null>(null)
  const [musicCompletenessStats, setMusicCompletenessStats] = useState<MusicCompletenessStats | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analysisType, setAnalysisType] = useState<'series' | 'collections' | 'music' | null>(null)

  // Persist sidebar collapsed state
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])
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

  // Load completeness stats data
  const loadCompletenessData = useCallback(async () => {
    try {
      const [sStats, cStats] = await Promise.all([
        window.electronAPI.seriesGetStats(),
        window.electronAPI.collectionsGetStats()
      ])
      setSeriesStats(sStats as SeriesStats)
      setCollectionStats(cStats as CollectionStats)
    } catch (err) {
      console.warn('Failed to load completeness stats:', err)
    }
  }, [])

  // Load music completeness stats
  const loadMusicCompletenessData = useCallback(async () => {
    try {
      const artistsData = await window.electronAPI.musicGetAllArtistCompleteness()
      const artists = artistsData as Array<{
        completeness_percentage: number
        total_albums: number
        owned_albums: number
      }>

      // Calculate music stats from artist data
      const totalArtists = artists.length
      const completeArtists = artists.filter(a => a.completeness_percentage >= 100).length
      const incompleteArtists = totalArtists - completeArtists
      const avgCompleteness = totalArtists > 0
        ? artists.reduce((sum, a) => sum + a.completeness_percentage, 0) / totalArtists
        : 0
      const totalMissingAlbums = artists.reduce((sum, a) => sum + (a.total_albums - a.owned_albums), 0)

      setMusicCompletenessStats({
        totalArtists,
        analyzedArtists: totalArtists,
        completeArtists,
        incompleteArtists,
        totalMissingAlbums,
        averageCompleteness: avgCompleteness
      })
    } catch (err) {
      console.warn('Failed to load music completeness stats:', err)
    }
  }, [])

  // Load completeness data on mount and when sources change
  useEffect(() => {
    loadCompletenessData()
    loadMusicCompletenessData()
  }, [loadCompletenessData, loadMusicCompletenessData])

  // Listen for completeness analysis progress events
  useEffect(() => {
    const cleanupSeriesProgress = window.electronAPI.onSeriesProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
      setIsAnalyzing(true)
      setAnalysisType('series')
    })
    const cleanupCollectionsProgress = window.electronAPI.onCollectionsProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
      setIsAnalyzing(true)
      setAnalysisType('collections')
    })
    const cleanupMusicProgress = window.electronAPI.onMusicAnalysisProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
      setIsAnalyzing(true)
      setAnalysisType('music')
    })

    // Listen for task queue updates to detect completion
    const cleanupTaskQueue = window.electronAPI.onTaskQueueUpdated((state: unknown) => {
      const queueState = state as { currentTask: { status: string } | null }
      if (!queueState.currentTask || queueState.currentTask.status === 'completed') {
        setIsAnalyzing(false)
        setAnalysisProgress(null)
        setAnalysisType(null)
        // Refresh stats after completion
        loadCompletenessData()
        loadMusicCompletenessData()
      }
    })

    return () => {
      cleanupSeriesProgress()
      cleanupCollectionsProgress()
      cleanupMusicProgress()
      cleanupTaskQueue()
    }
  }, [loadCompletenessData, loadMusicCompletenessData])

  // Analysis handlers
  const handleAnalyzeSeries = async (_libraryId?: string) => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'series-completeness',
        label: `Analyze TV Series (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue series analysis:', err)
    }
  }

  const handleAnalyzeCollections = async (_libraryId?: string) => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'collection-completeness',
        label: `Analyze Collections (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue collections analysis:', err)
    }
  }

  const handleAnalyzeMusic = async () => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'music-completeness',
        label: `Analyze Music (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      console.error('Failed to queue music analysis:', err)
    }
  }

  const handleCancelAnalysis = async () => {
    try {
      await window.electronAPI.taskQueueCancelCurrent()
    } catch (err) {
      console.error('Failed to cancel analysis:', err)
    }
  }

  const handleCompletenessDataRefresh = useCallback(() => {
    loadCompletenessData()
    loadMusicCompletenessData()
  }, [loadCompletenessData, loadMusicCompletenessData])

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

  const handleNavigateToLibrary = (tab?: MediaViewType) => {
    if (tab) setLibraryTab(tab)
    setCurrentView('library')
  }

  const handleNavigateToDashboard = () => {
    setCurrentView('dashboard')
  }

  const handleOpenSettings = (initialTab?: string) => {
    setSettingsInitialTab(initialTab)
    setShowSettingsModal(true)
  }

  const handleToggleCompleteness = () => {
    setShowCompletenessPanel(prev => {
      const newState = !prev
      if (newState) setShowWishlistPanel(false)
      return newState
    })
  }

  const handleToggleWishlist = () => {
    setShowWishlistPanel(prev => {
      const newState = !prev
      if (newState) setShowCompletenessPanel(false)
      return newState
    })
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
  const showSplash = !splashComplete

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
      <div className="relative h-screen overflow-hidden bg-main-gradient text-foreground">
        <Sidebar
          onOpenAbout={() => setShowAboutModal(true)}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Global Top Bar */}
        <TopBar
          currentView={currentView}
          libraryTab={libraryTab}
          onNavigateHome={handleNavigateToDashboard}
          onNavigateToLibrary={handleNavigateToLibrary}
          onOpenSettings={() => handleOpenSettings()}
          onToggleCompleteness={handleToggleCompleteness}
          onToggleWishlist={handleToggleWishlist}
          showCompletenessPanel={showCompletenessPanel}
          showWishlistPanel={showWishlistPanel}
          isAutoRefreshing={isAutoRefreshing}
          hasMovies={hasMovies}
          hasTV={hasTV}
          hasMusic={hasMusic}
        />

        {currentView === 'dashboard' ? (
          <SectionErrorBoundary section="Dashboard">
            <Dashboard
              onNavigateToLibrary={handleNavigateToLibrary}
              onAddSource={() => setShowAddSourceModal(true)}
              sidebarCollapsed={sidebarCollapsed}
              hasMovies={hasMovies}
              hasTV={hasTV}
              hasMusic={hasMusic}
            />
          </SectionErrorBoundary>
        ) : (
          <main
            className="fixed top-[88px] bottom-0 transition-[left,right] duration-300 ease-out"
            style={{
              left: sidebarCollapsed ? '96px' : '288px',
              right: '16px'
            }}
          >
            <SectionErrorBoundary section="Media Library">
              <MediaBrowser
                onAddSource={() => setShowAddSourceModal(true)}
                sidebarCollapsed={sidebarCollapsed}
                onOpenSettings={handleOpenSettings}
                hideHeader={true}
                showCompletenessPanel={showCompletenessPanel}
                showWishlistPanel={showWishlistPanel}
                onToggleCompleteness={handleToggleCompleteness}
                onToggleWishlist={handleToggleWishlist}
                libraryTab={libraryTab}
                onLibraryTabChange={setLibraryTab}
                onAutoRefreshChange={setIsAutoRefreshing}
              />
            </SectionErrorBoundary>
          </main>
        )}
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
          initialTab={settingsInitialTab as 'library' | 'quality' | 'services' | 'appearance' | 'data' | 'update' | 'troubleshoot' | undefined}
        />
        {/* Panels - rendered at App level for Dashboard view */}
        {currentView === 'dashboard' && (
          <>
            <SectionErrorBoundary section="Completeness Panel" compact>
              <CompletenessPanel
                isOpen={showCompletenessPanel}
                onClose={() => setShowCompletenessPanel(false)}
                seriesStats={seriesStats}
                collectionStats={collectionStats}
                musicStats={musicCompletenessStats}
                onAnalyzeSeries={handleAnalyzeSeries}
                onAnalyzeCollections={handleAnalyzeCollections}
                onAnalyzeMusic={handleAnalyzeMusic}
                onCancel={handleCancelAnalysis}
                isAnalyzing={isAnalyzing}
                analysisProgress={analysisProgress}
                analysisType={analysisType}
                onDataRefresh={handleCompletenessDataRefresh}
                hasTV={hasTV}
                hasMovies={hasMovies}
                hasMusic={hasMusic}
                onOpenSettings={handleOpenSettings}
                libraries={[]}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary section="Wishlist Panel" compact>
              <WishlistPanel
                isOpen={showWishlistPanel}
                onClose={() => setShowWishlistPanel(false)}
              />
            </SectionErrorBoundary>
          </>
        )}
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
        <ThemeProvider>
          <SourceProvider>
            <WishlistProvider>
              <NavigationProvider>
                <AppContent />
              </NavigationProvider>
            </WishlistProvider>
          </SourceProvider>
        </ThemeProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
