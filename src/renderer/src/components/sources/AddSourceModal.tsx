/**
 * AddSourceModal Component
 *
 * Modal for adding a new media source with provider-specific auth flows.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Server, HardDrive } from 'lucide-react'
import { useSources, type ProviderType } from '../../contexts/SourceContext'
import { PlexAuthFlow } from './PlexAuthFlow'
import { JellyfinAuthFlow } from './JellyfinAuthFlow'
import { KodiConnectionFlow } from './KodiConnectionFlow'
import { LocalFolderFlow } from './LocalFolderFlow'

interface AddSourceModalProps {
  onClose: () => void
  onSuccess: () => void
}

// Provider info for selection
const providers: Array<{
  type: ProviderType
  name: string
  description: string
  color: string
}> = [
  {
    type: 'plex',
    name: 'Plex',
    description: 'Connect to your Plex Media Server',
    color: 'bg-[#e5a00d]',
  },
  {
    type: 'jellyfin',
    name: 'Jellyfin',
    description: 'Connect to a Jellyfin server',
    color: 'bg-purple-500',
  },
  {
    type: 'emby',
    name: 'Emby',
    description: 'Connect to an Emby server',
    color: 'bg-green-500',
  },
  {
    type: 'kodi',
    name: 'Kodi',
    description: 'Connect to Kodi via JSON-RPC',
    color: 'bg-blue-500',
  },
  {
    type: 'local',
    name: 'Local Folder',
    description: 'Scan a local folder for media files',
    color: 'bg-slate-600',
  },
]

export function AddSourceModal({ onClose, onSuccess }: AddSourceModalProps) {
  const { supportedProviders } = useSources()
  const [selectedProvider, setSelectedProvider] = useState<ProviderType | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Filter to only show supported providers
  const availableProviders = providers.filter(p => supportedProviders.includes(p.type))

  // Auto-focus first button when modal opens
  useEffect(() => {
    if (!selectedProvider && buttonRefs.current[0]) {
      buttonRefs.current[0]?.focus()
    }
  }, [selectedProvider])

  // Handle keyboard navigation in provider list
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (selectedProvider) return // Let sub-flow handle its own navigation

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex(prev => {
          const next = Math.min(prev + 1, availableProviders.length - 1)
          buttonRefs.current[next]?.focus()
          return next
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex(prev => {
          const next = Math.max(prev - 1, 0)
          buttonRefs.current[next]?.focus()
          return next
        })
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [selectedProvider, availableProviders.length, onClose])

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  // Handle successful connection
  const handleSuccess = () => {
    onSuccess()
  }

  // Render provider-specific auth flow
  const renderAuthFlow = () => {
    switch (selectedProvider) {
      case 'plex':
        return <PlexAuthFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      case 'jellyfin':
        return <JellyfinAuthFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      case 'emby':
        return <JellyfinAuthFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} isEmby />
      case 'kodi':
        return <KodiConnectionFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      case 'local':
        return <LocalFolderFlow onSuccess={handleSuccess} onBack={() => setSelectedProvider(null)} />
      default:
        return null
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[150]"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-card rounded-lg shadow-xl w-full max-w-xs mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-black/30 rounded-t-lg">
          <h2 className="text-sm font-semibold">
            {selectedProvider
              ? `Add ${providers.find(p => p.type === selectedProvider)?.name}`
              : 'Add Source'}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className={selectedProvider ? 'p-4' : 'p-2'}>
          {selectedProvider ? (
            renderAuthFlow()
          ) : (
            <div className="space-y-1">
              {availableProviders.map((provider, index) => (
                <button
                  key={provider.type}
                  ref={el => buttonRefs.current[index] = el}
                  onClick={() => setSelectedProvider(provider.type)}
                  onFocus={() => setFocusedIndex(index)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors text-left outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${focusedIndex === index ? 'bg-muted' : ''}`}
                >
                  <div className={`w-6 h-6 ${provider.color} rounded flex items-center justify-center text-white`}>
                    {provider.type === 'local' ? (
                      <HardDrive className="w-3.5 h-3.5" />
                    ) : (
                      <Server className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span className="text-sm">{provider.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
