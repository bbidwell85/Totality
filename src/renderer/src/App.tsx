import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { SETTING_KEYS } from '../../shared/settingKeys'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { MediaBrowser } from './components/library/MediaBrowser'
import { Dashboard } from './components/dashboard'
import { WishlistPanel } from './components/wishlist/WishlistPanel'
import { CompletenessPanel } from './components/library/CompletenessPanel'
import { ChatPanel } from './components/chat/ChatPanel'
import { MoodSyncPanel } from './components/mood/MoodSyncPanel'
import { TaskQueuePanel } from './components/ui/TaskQueuePanel'
import type { ViewContext } from './hooks/useChat'
import { SourceProvider, useSources } from './contexts/SourceContext'
import { WishlistProvider } from './contexts/WishlistContext'
import { NavigationProvider, useNavigation } from './contexts/NavigationContext'
import { ToastProvider } from './contexts/ToastContext'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { AddSourceModal } from './components/sources/AddSourceModal'
import { AboutModal } from './components/ui/AboutModal'
import { SettingsPanel } from './components/settings'
import { SplashScreen } from './components/layout/SplashScreen'
import { ToastContainer } from './components/ui/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SectionErrorBoundary } from './components/ui/SectionErrorBoundary'
import type { MediaViewType, SeriesStats, CollectionStats, MusicCompletenessStats, AnalysisProgress } from './components/library/types'
import { isWebMode, isAuthenticated, authenticate } from './services/webTransport'
import { stateToHash, parseHash, pushHash, replaceHash } from './services/hashRouting'
import { useMobileLayout } from './hooks/useMobileLayout'
import { MobileTabBar, type MobileTab } from './components/mobile/MobileTabBar'
import { MobileSearchOverlay } from './components/mobile/MobileSearchOverlay'
import logoImage from './assets/logo.png'
import { WebLoginScreen } from './components/auth/WebLoginScreen'

type AppView = 'dashboard' | 'library'

function AppContent({ isMobile = false, isTablet = false }: { isMobile?: boolean; isTablet?: boolean }) {
  const { isLoading, sources, activeSourceId, hasMovies, hasTV, hasMusic } = useSources()
  const { effectiveIsDark } = useTheme()
  const [showAddSourceModal, setShowAddSourceModal] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)
  const [splashComplete, setSplashComplete] = useState(() => sessionStorage.getItem('splashShown') === 'true')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [currentView, setCurrentView] = useState<AppView>('dashboard')
  const [libraryTab, setLibraryTab] = useState<MediaViewType>('movies')

  // Navigation history
  const { pushNavState, goBack, goForward, canGoBack, canGoForward, navigateTo } = useNavigation()
  const isRestoringRef = useRef(false)

  // Panel states - managed at app level for TopBar to control
  const [showCompletenessPanel, setShowCompletenessPanel] = useState(false)
  const [showWishlistPanel, setShowWishlistPanel] = useState(false)
  const [showChatPanel, setShowChatPanel] = useState(false)
  const [showMoodSyncPanel, setShowMoodSyncPanel] = useState(false)
  const [showTaskQueuePanel, setShowTaskQueuePanel] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [wsConnected, setWsConnected] = useState(true)
  // Desktop backdrop state (passed up from MediaBrowser)
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null)
  const [backdropVisible, setBackdropVisible] = useState<string | null>(null) // persists URL during fade-out
  useEffect(() => {
    if (backdropUrl) setBackdropVisible(backdropUrl)
  }, [backdropUrl])

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

  // Track WebSocket connection status (web mode only)
  useEffect(() => {
    if (!isWebMode()) return
    const handler = (e: Event) => {
      setWsConnected((e as CustomEvent).detail?.connected ?? true)
    }
    window.addEventListener('ws-status', handler)
    return () => window.removeEventListener('ws-status', handler)
  }, [])
  // Task queue state — lifted here so it survives MediaBrowser unmount (wishlist view swap)
  const [taskQueueState, setTaskQueueState] = useState<unknown>(null)
  useEffect(() => {
    if (!isMobile) return
    const unsub = window.electronAPI.onTaskQueueUpdated?.((s: unknown) => setTaskQueueState(s))
    window.electronAPI.taskQueueGetState?.().then((s) => setTaskQueueState(s))
    return () => { unsub?.() }
  }, [isMobile])
  const isScanActive = !!(taskQueueState && ((taskQueueState as { currentTask: unknown }).currentTask || ((taskQueueState as { queue: unknown[] }).queue?.length > 0)))

  const hasSignaledReady = useRef(false)

  const markSplashShown = () => {
    sessionStorage.setItem('splashShown', 'true')
    setSplashComplete(true)
  }

  // Signal to main process that we're ready to show content
  useEffect(() => {
    if (!hasSignaledReady.current && !isLoading) {
      hasSignaledReady.current = true
      // Small delay to ensure content is painted
      setTimeout(() => {
        window.electronAPI.appReady()
      }, 50)
    }
  }, [isLoading])

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

  // Load music completeness stats — server-side aggregation (~0.5KB vs 680KB full dataset)
  const loadMusicCompletenessData = useCallback(async () => {
    try {
      const [epsVal, singlesVal] = await Promise.all([
        window.electronAPI.getSetting(SETTING_KEYS.completeness_include_eps),
        window.electronAPI.getSetting(SETTING_KEYS.completeness_include_singles),
      ])
      const epsEnabled = (epsVal as string) !== 'false'
      const singlesEnabled = (singlesVal as string) !== 'false'
      const stats = await window.electronAPI.musicGetCompletenessStats(epsEnabled, singlesEnabled) as {
        totalArtists: number; analyzedArtists: number; completeArtists: number
        incompleteArtists: number; totalMissingAlbums: number; averageCompleteness: number
      }
      setMusicCompletenessStats(stats)
    } catch (err) {
      console.warn('Failed to load music completeness stats:', err)
    }
  }, [])

  // Load completeness data on mount — skip on mobile (no dashboard view, saves ~1.7MB)
  useEffect(() => {
    if (!isMobile) {
      loadCompletenessData()
      loadMusicCompletenessData()
    }
  }, [loadCompletenessData, loadMusicCompletenessData, isMobile])

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

    // Listen for EP/Singles settings changes to refresh music stats
    const cleanupSettingsChanged = window.electronAPI.onSettingsChanged?.((data) => {
      if (data.key === 'completeness_include_eps' || data.key === 'completeness_include_singles') {
        loadMusicCompletenessData()
      }
    })

    return () => {
      cleanupSeriesProgress()
      cleanupCollectionsProgress()
      cleanupMusicProgress()
      cleanupTaskQueue()
      cleanupSettingsChanged?.()
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

  const handleAddSourceSuccess = () => {
    setShowAddSourceModal(false)
  }

  const handleNavigateToLibrary = (tab?: MediaViewType) => {
    const newTab = tab || libraryTab
    if (!isRestoringRef.current) {
      pushNavState({ view: 'library', tab: newTab })
      pushHash(stateToHash({ view: 'library', tab: newTab }))
    }
    if (tab) setLibraryTab(tab)
    setCurrentView('library')
    setShowWishlistPanel(false)
    setShowMobileSearch(false)
  }

  const handleNavigateToDashboard = () => {
    if (!isRestoringRef.current) {
      pushNavState({ view: 'dashboard' })
      pushHash(stateToHash({ view: 'dashboard' }))
    }
    setCurrentView('dashboard')
    setBackdropUrl(null)
  }

  const handleBack = useCallback(() => {
    const restored = goBack()
    if (!restored) return
    isRestoringRef.current = true
    setCurrentView(restored.view)
    if (restored.view === 'library' && restored.tab) {
      setLibraryTab(restored.tab)
    }
    window.dispatchEvent(new CustomEvent('navigate-restore', { detail: restored }))
    isRestoringRef.current = false
  }, [goBack])

  const handleForward = useCallback(() => {
    const restored = goForward()
    if (!restored) return
    isRestoringRef.current = true
    setCurrentView(restored.view)
    if (restored.view === 'library' && restored.tab) {
      setLibraryTab(restored.tab)
    }
    window.dispatchEvent(new CustomEvent('navigate-restore', { detail: restored }))
    isRestoringRef.current = false
  }, [goForward])

  // Keyboard shortcuts for back/forward
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        handleBack()
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        handleForward()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleBack, handleForward])

  // Mouse back/forward button navigation
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); handleBack() }
      else if (e.button === 4) { e.preventDefault(); handleForward() }
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [handleBack, handleForward])

  // --- Hash routing (web mode only) ---
  const isRestoringHashRef = useRef(false)

  // Sync hash on top-level navigation changes
  useEffect(() => {
    if (!isWebMode() || isRestoringHashRef.current) return
    const hash = stateToHash({
      view: currentView,
      tab: libraryTab,
      wishlist: showWishlistPanel,
    })
    if (hash) replaceHash(hash)
  }, [currentView, libraryTab, showWishlistPanel])

  // Restore from hash on initial mount
  useEffect(() => {
    if (!isWebMode()) return
    const hash = window.location.hash
    if (!hash || hash === '#/' || hash === '#') return
    const state = parseHash(hash)
    isRestoringHashRef.current = true
    isRestoringRef.current = true
    if (state.wishlist) {
      setShowWishlistPanel(true)
      setCurrentView('library')
    } else {
      setCurrentView(state.view)
      if (state.tab) setLibraryTab(state.tab)
      // Drill-down targets are handled by MediaBrowser via navigateTo
      if (state.mediaId) {
        navigateTo({ type: 'movie', id: state.mediaId })
      } else if (state.showTitle) {
        navigateTo({ type: 'tv', id: state.showTitle, ...(state.seasonNumber !== undefined ? { seasonNumber: state.seasonNumber } : {}) })
      } else if (state.artistId) {
        navigateTo({ type: 'artist', id: state.artistId })
      } else if (state.albumId) {
        navigateTo({ type: 'album', id: state.albumId })
      }
    }
    isRestoringRef.current = false
    isRestoringHashRef.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Browser back/forward via popstate
  useEffect(() => {
    if (!isWebMode()) return
    const onPopState = () => {
      const state = parseHash(window.location.hash)
      isRestoringHashRef.current = true
      isRestoringRef.current = true
      if (state.wishlist) {
        setShowWishlistPanel(true)
        setCurrentView('library')
      } else {
        setShowWishlistPanel(false)
        setCurrentView(state.view)
        if (state.tab) setLibraryTab(state.tab)
        // Drill-down via navigateTo for detail views
        if (state.mediaId) {
          navigateTo({ type: 'movie', id: state.mediaId })
        } else if (state.showTitle) {
          navigateTo({ type: 'tv', id: state.showTitle, ...(state.seasonNumber !== undefined ? { seasonNumber: state.seasonNumber } : {}) })
        } else if (state.artistId) {
          navigateTo({ type: 'artist', id: state.artistId })
        } else if (state.albumId) {
          navigateTo({ type: 'album', id: state.albumId })
        } else {
          // No drill-down — clear any current detail view
          window.dispatchEvent(new CustomEvent('navigate-restore', { detail: { view: state.view, tab: state.tab } }))
        }
      }
      isRestoringRef.current = false
      isRestoringHashRef.current = false
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpenSettings = (initialTab?: string) => {
    setSettingsInitialTab(initialTab)
    setShowSettingsModal(true)
  }

  const closeAllPanels = () => { setShowCompletenessPanel(false); setShowWishlistPanel(false); setShowChatPanel(false); setShowMoodSyncPanel(false); setShowTaskQueuePanel(false) }

  const handleToggleCompleteness = () => {
    setShowCompletenessPanel(prev => { const v = !prev; if (v) closeAllPanels(); setShowCompletenessPanel(v); return v })
  }

  const handleToggleWishlist = () => {
    setShowWishlistPanel(prev => { const v = !prev; if (v) closeAllPanels(); setShowWishlistPanel(v); return v })
  }

  const handleToggleChat = () => {
    setShowChatPanel(prev => { const v = !prev; if (v) closeAllPanels(); setShowChatPanel(v); return v })
  }

  const handleToggleMoodSync = () => {
    setShowMoodSyncPanel(prev => { const v = !prev; if (v) closeAllPanels(); setShowMoodSyncPanel(v); return v })
  }

  const handleToggleTaskQueue = () => {
    setShowTaskQueuePanel(prev => { const v = !prev; if (v) closeAllPanels(); setShowTaskQueuePanel(v); return v })
  }

  const chatViewContext = useMemo((): ViewContext => ({
    currentView: currentView as 'dashboard' | 'library',
    libraryTab: currentView === 'library' ? libraryTab as 'movies' | 'tv' | 'music' : undefined,
    activeSourceId: activeSourceId || undefined,
  }), [currentView, libraryTab, activeSourceId])

  if (isLoading) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  const showSplash = !splashComplete && !isWebMode()

  return (
    <>
      {/* Render main app - it loads behind the splash screen */}
      <div className="relative h-full overflow-hidden bg-main-gradient text-foreground">
        {/* Plex-style blurred backdrop — behind everything, shows through translucent sidebar/topbar */}
        {!isMobile && (
          <div
            className="fixed inset-0 pointer-events-none"
            style={{
              transition: 'opacity 2s cubic-bezier(0.25, 0, 0.15, 1)',
              opacity: backdropUrl ? (effectiveIsDark ? 1 : 0.35) : 0,
              backgroundImage: backdropVisible ? `url(${backdropVisible})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: effectiveIsDark ? 'blur(80px) brightness(0.3)' : 'blur(80px) saturate(0.6)',
            }}
          />
        )}
        {!isMobile && (
          <Sidebar
            onOpenAbout={() => setShowAboutModal(true)}
            isCollapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        )}

        {/* Global Top Bar — hidden on mobile (bottom tab bar provides navigation) */}
        {!isMobile && <TopBar
          currentView={currentView}
          libraryTab={libraryTab}
          onNavigateHome={handleNavigateToDashboard}
          onNavigateToLibrary={handleNavigateToLibrary}
          onOpenSettings={() => handleOpenSettings()}
          onToggleCompleteness={handleToggleCompleteness}
          onToggleWishlist={handleToggleWishlist}
          onToggleChat={handleToggleChat}
          onToggleMoodSync={handleToggleMoodSync}
          onToggleTaskQueue={handleToggleTaskQueue}
          showCompletenessPanel={showCompletenessPanel}
          showWishlistPanel={showWishlistPanel}
          showChatPanel={showChatPanel}
          showMoodSyncPanel={showMoodSyncPanel}
          showTaskQueuePanel={showTaskQueuePanel}
          isAutoRefreshing={isAutoRefreshing}
          hasMovies={hasMovies}
          hasTV={hasTV}
          hasMusic={hasMusic}
          onBack={handleBack}
          canGoBack={canGoBack}
          onForward={handleForward}
          canGoForward={canGoForward}
          isMobile={isMobile}
        />}

        {currentView === 'dashboard' && !isMobile ? (
          <SectionErrorBoundary section="Dashboard">
            <Dashboard
              onNavigateToLibrary={handleNavigateToLibrary}
              onAddSource={() => setShowAddSourceModal(true)}
              sidebarCollapsed={sidebarCollapsed}
              hasMovies={hasMovies}
              hasTV={hasTV}
              hasMusic={hasMusic}
              isMobile={isMobile}
            />
          </SectionErrorBoundary>
        ) : isMobile && showWishlistPanel ? (
          <main
            className="fixed inset-0 bg-background"
            style={{
              paddingTop: 'max(env(safe-area-inset-top, 0px), 8px)',
            }}
          >
            <div className="absolute inset-0 flex flex-col overflow-hidden">
              <WishlistPanel
                isOpen={true}
                onClose={() => setShowWishlistPanel(false)}
                isMobile={isMobile}
                inline={true}
              />
            </div>
          </main>
        ) : (
          <main
            className={`fixed bottom-0 transition-[left,right,top] duration-300 ease-out ${isMobile ? 'bg-background' : ''}`}
            style={{
              top: isMobile ? '0px' : '76px',
              left: isMobile ? '0px' : (sidebarCollapsed ? '96px' : '288px'),
              right: isMobile ? '0px' : '16px',
              bottom: '0px',
              paddingTop: isMobile ? '0px' : undefined,
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
                showChatPanel={showChatPanel}
                onToggleCompleteness={handleToggleCompleteness}
                onToggleWishlist={handleToggleWishlist}
                onToggleChat={handleToggleChat}
                libraryTab={libraryTab}
                onLibraryTabChange={setLibraryTab}
                onAutoRefreshChange={setIsAutoRefreshing}
                onBackdropChange={setBackdropUrl}
                isMobile={isMobile}
                isTablet={isTablet}
                taskQueueState={taskQueueState}
                isScanActive={isScanActive}
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
            {!isMobile && (
              <SectionErrorBoundary section="Wishlist Panel" compact>
                <WishlistPanel
                  isOpen={showWishlistPanel}
                  onClose={() => setShowWishlistPanel(false)}
                />
              </SectionErrorBoundary>
            )}
          </>
        )}
        {/* Mood Sync Panel - rendered at App level, available in all views */}
        <MoodSyncPanel
          isOpen={showMoodSyncPanel}
          onClose={() => setShowMoodSyncPanel(false)}
        />
        {/* Task Queue Panel */}
        <TaskQueuePanel
          isOpen={showTaskQueuePanel}
          onClose={() => setShowTaskQueuePanel(false)}
        />
        {/* Chat Panel - rendered at App level, available in all views */}
        <ChatPanel
          isOpen={showChatPanel}
          onClose={() => setShowChatPanel(false)}
          onOpenSettings={() => handleOpenSettings('services')}
          viewContext={chatViewContext}
        />
        {/* Mobile search overlay */}
        {isMobile && showMobileSearch && (
          <MobileSearchOverlay
            onClose={() => setShowMobileSearch(false)}
            onSelectMovie={(id) => {
              handleNavigateToLibrary('movies')
              // Navigate to the movie detail via the NavigationContext
              navigateTo({ type: 'movie', id })
            }}
            onSelectShow={(title) => {
              handleNavigateToLibrary('tv')
              navigateTo({ type: 'tv', id: title })
            }}
            onSelectEpisode={(id) => {
              handleNavigateToLibrary('tv')
              navigateTo({ type: 'episode', id })
            }}
            onSelectArtist={(id, name) => {
              handleNavigateToLibrary('music')
              navigateTo({ type: 'artist', id, artistName: name })
            }}
            onSelectAlbum={(id) => {
              handleNavigateToLibrary('music')
              navigateTo({ type: 'album', id })
            }}
          />
        )}

        {/* Mobile offline banner */}
        {isMobile && isWebMode() && !wsConnected && (
          <div className="fixed bottom-[68px] left-0 right-0 z-50 bg-destructive text-destructive-foreground text-center text-caption py-1.5" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            Offline — reconnecting...
          </div>
        )}
        {/* Mobile bottom tab bar */}
        {isMobile && (
          <MobileTabBar
            activeTab={
              showWishlistPanel ? 'wishlist' :
              currentView === 'dashboard' ? 'movies' :
              libraryTab === 'movies' ? 'movies' :
              libraryTab === 'tv' ? 'tv' :
              libraryTab === 'music' ? 'music' : 'movies'
            }
            onTabChange={(tab: MobileTab) => {
              if (tab === 'wishlist') {
                setShowWishlistPanel(true)
                pushHash(stateToHash({ view: 'library', wishlist: true }))
              } else {
                setShowWishlistPanel(false)
                handleNavigateToLibrary(tab === 'tv' ? 'tv' : tab)
              }
            }}
            onSearchOpen={() => setShowMobileSearch(true)}
          />
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
  const [webAuthed, setWebAuthed] = useState(() => !isWebMode() || isAuthenticated())
  const { isMobile, isTablet } = useMobileLayout()

  // In web mode without auth, show login screen
  if (isWebMode() && !webAuthed) {
    return (
      <ErrorBoundary>
        <ThemeProvider>
          <WebLoginScreen
            onAuthenticated={() => setWebAuthed(true)}
            authenticate={authenticate}
            logoSrc={logoImage}
          />
        </ThemeProvider>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <ThemeProvider>
          <SourceProvider>
            <WishlistProvider>
              <NavigationProvider>
                <AppContent isMobile={isMobile} isTablet={isTablet} />
              </NavigationProvider>
            </WishlistProvider>
          </SourceProvider>
        </ThemeProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
