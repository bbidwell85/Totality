import { useState, useCallback, useId, useRef, useEffect } from 'react'
import { X, Sliders, Wrench, Palette, Database, Activity, Bug, ArrowUpCircle } from 'lucide-react'
import { useKeyboardNavigation } from '../../contexts/KeyboardNavigationContext'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { QualitySettingsTab } from './tabs/QualitySettingsTab'
import { ServicesTab } from './tabs/ServicesTab'
import { AppearanceTab } from './tabs/AppearanceTab'
import { DataManagementTab } from './tabs/DataManagementTab'
import { MonitoringTab } from './tabs/MonitoringTab'
import { TroubleshootTab } from './tabs/TroubleshootTab'
import { UpdateTab } from './tabs/UpdateTab'

type TabId = 'quality' | 'services' | 'appearance' | 'monitoring' | 'data' | 'update' | 'troubleshoot'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: TabId
}

interface Tab {
  id: TabId
  label: string
  icon: typeof Sliders
}

const TABS: Tab[] = [
  { id: 'quality', label: 'Quality', icon: Sliders },
  { id: 'services', label: 'Services', icon: Wrench },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'monitoring', label: 'Monitoring', icon: Activity },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'update', label: 'Update', icon: ArrowUpCircle },
  { id: 'troubleshoot', label: 'Troubleshoot', icon: Bug },
]

export function SettingsPanel({ isOpen, onClose, initialTab }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab || 'quality')
  const { openModal, closeModal } = useKeyboardNavigation()
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Focus trap
  useFocusTrap(isOpen, modalRef, false)

  // Modal registration
  useEffect(() => {
    if (isOpen) {
      openModal('settings-panel')
      return () => closeModal()
    }
  }, [isOpen, openModal, closeModal])

  // Focus close button when modal opens, and set initial tab
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'quality')
      setTimeout(() => {
        closeButtonRef.current?.focus()
      }, 100)
    }
  }, [isOpen, initialTab])

  // Handle Escape key to close modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [onClose])

  // Handle keyboard navigation in tab list
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let newIndex = index

    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      newIndex = index > 0 ? index - 1 : TABS.length - 1
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      newIndex = index < TABS.length - 1 ? index + 1 : 0
    } else if (e.key === 'Home') {
      e.preventDefault()
      newIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      newIndex = TABS.length - 1
    }

    if (newIndex !== index) {
      setActiveTab(TABS[newIndex].id)
      // Focus the new tab button
      const tabButtons = tabListRef.current?.querySelectorAll('[role="tab"]')
      if (tabButtons && tabButtons[newIndex]) {
        (tabButtons[newIndex] as HTMLElement).focus()
      }
    }
  }, [])

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  // Ensure activeTab is always valid
  const validTabIds = TABS.map(t => t.id)
  const currentTab = validTabIds.includes(activeTab) ? activeTab : 'quality'

  const renderTabContent = () => {
    switch (currentTab) {
      case 'quality':
        return <QualitySettingsTab />
      case 'services':
        return <ServicesTab />
      case 'appearance':
        return <AppearanceTab />
      case 'monitoring':
        return <MonitoringTab />
      case 'data':
        return <DataManagementTab />
      case 'update':
        return <UpdateTab />
      case 'troubleshoot':
        return <TroubleshootTab />
      default:
        return <QualitySettingsTab />
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[150]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="bg-card border border-border/30 rounded-2xl w-full max-w-4xl h-[680px] flex flex-col shadow-xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Content area with tabs */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Tab navigation (left side) */}
          <div
            ref={tabListRef}
            className="w-44 border-r border-border/30 p-2 flex flex-col gap-1 bg-sidebar-gradient rounded-tl-2xl"
            role="tablist"
            aria-label="Settings categories"
            aria-orientation="vertical"
          >
            {/* Sidebar header with title and close button */}
            <div className="flex items-center justify-between px-3 py-2.5 mb-1">
              <h2 id={titleId} className="text-lg font-semibold">Settings</h2>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label="Close settings"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {TABS.map((tab, index) => {
              const Icon = tab.icon
              const isActive = currentTab === tab.id
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left focus:outline-none focus:ring-2 focus:ring-primary ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab content (right side) */}
          <div
            role="tabpanel"
            id={`tabpanel-${currentTab}`}
            aria-labelledby={`tab-${currentTab}`}
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
          >
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  )
}
