/**
 * AboutModal Component
 *
 * Displays app version, credits, and legal information with tabbed navigation.
 */

import { useState, useEffect, useRef } from 'react'
import { X, Info, Heart, Scale } from 'lucide-react'
import { useKeyboardNavigation } from '../../contexts/KeyboardNavigationContext'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import tmdbLogo from '../../assets/tmdb-logo.svg'
import musicbrainzLogo from '../../assets/musicbrainz-logo.svg'
import logoImage from '../../assets/logo.png'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

type TabId = 'about' | 'credits' | 'legal'

interface Tab {
  id: TabId
  label: string
  icon: typeof Info
}

const tabs: Tab[] = [
  { id: 'about', label: 'About', icon: Info },
  { id: 'credits', label: 'Credits', icon: Heart },
  { id: 'legal', label: 'Legal', icon: Scale },
]

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('about')
  const { openModal, closeModal } = useKeyboardNavigation()
  const modalRef = useRef<HTMLDivElement>(null)

  // Focus trap
  useFocusTrap(isOpen, modalRef)

  // Modal registration
  useEffect(() => {
    if (isOpen) {
      openModal('about-modal')
      return () => closeModal()
    }
  }, [isOpen, openModal, closeModal])

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[150]">
      <div ref={modalRef} className="bg-card border border-border rounded-lg w-full max-w-lg mx-4 shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-lg">
          <h2 className="text-lg font-semibold">About Totality</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/30 px-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-visible">
          {activeTab === 'about' && <AboutTab />}
          {activeTab === 'credits' && <CreditsTab />}
          {activeTab === 'legal' && <LegalTab />}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/30 flex justify-center">
          <button
            onClick={onClose}
            className="px-6 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** About Tab - App info and description */
function AboutTab() {
  const [version, setVersion] = useState<string>('...')

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion).catch(() => setVersion('unknown'))
  }, [])

  return (
    <div className="space-y-6">
      {/* Logo and Version */}
      <div className="flex flex-col items-center">
        <img src={logoImage} alt="Totality" className="h-24 w-auto object-contain mb-3" />
        <p className="text-sm text-muted-foreground">Version {version}</p>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground text-center">
        Analyze media library quality and recommend upgrades for your Plex, Jellyfin, Emby, and Kodi collections.
      </p>

      {/* Features */}
      <div className="bg-muted/30 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Features
        </h3>
        <ul className="text-sm text-muted-foreground space-y-2">
          <li>• Multi-source library scanning (Plex, Jellyfin, Emby, Kodi, Local Folders)</li>
          <li>• Video and audio quality analysis with tier-based scoring</li>
          <li>• TV series and movie collection completeness tracking</li>
          <li>• Music library analysis with MusicBrainz integration</li>
          <li>• Shopping wishlist for missing and upgrade items</li>
        </ul>
      </div>

      {/* Links */}
      <div className="flex justify-center gap-4 text-sm">
        <a
          href="https://github.com/bbidwell85/totality"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          GitHub
        </a>
        <span className="text-muted-foreground/30">•</span>
        <a
          href="https://github.com/bbidwell85/totality/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Report Issue
        </a>
      </div>
    </div>
  )
}

/** Credits Tab - Data sources and technologies */
function CreditsTab() {
  return (
    <div className="space-y-6">
      {/* Data APIs */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Data Sources
        </h3>

        {/* TMDB - Required attribution per terms of use */}
        <div className="flex items-start gap-3 mb-4 p-3 bg-muted/30 rounded-lg">
          <img src={tmdbLogo} alt="TMDB" className="h-5 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1">The Movie Database (TMDB)</p>
            <p>
              This product uses the{' '}
              <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                TMDB API
              </a>
              {' '}but is not endorsed or certified by TMDB. Movie and TV metadata, images, and collection information provided by TMDB.
            </p>
          </div>
        </div>

        {/* MusicBrainz - Required CC BY-SA attribution */}
        <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
          <img src={musicbrainzLogo} alt="MusicBrainz" className="h-5 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1">MusicBrainz</p>
            <p>
              Music metadata provided by{' '}
              <a href="https://musicbrainz.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                MusicBrainz
              </a>
              , licensed under{' '}
              <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                CC0 1.0
              </a>
              {' '}(public domain). Cover art from{' '}
              <a href="https://coverartarchive.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Cover Art Archive
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Media Analysis */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Media Analysis
        </h3>
        <div className="p-3 bg-muted/30 rounded-lg">
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1">FFmpeg / FFprobe</p>
            <p>
              Media file analysis powered by{' '}
              <a href="https://ffmpeg.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                FFmpeg
              </a>
              , a complete, cross-platform solution for recording, converting, and streaming audio and video.
              FFmpeg is free software licensed under the{' '}
              <a href="https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                LGPL v2.1
              </a>
              {' '}or later, with some optional components under{' '}
              <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                GPL
              </a>
              . FFmpeg is a trademark of Fabrice Bellard. Totality does not bundle FFmpeg; it uses separately installed copies.
            </p>
          </div>
        </div>
      </section>

      {/* Open Source Technologies */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Built With Open Source
        </h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <TechLink name="Electron" url="https://www.electronjs.org" license="MIT" />
          <TechLink name="React" url="https://react.dev" license="MIT" />
          <TechLink name="TypeScript" url="https://www.typescriptlang.org" license="Apache 2.0" />
          <TechLink name="Vite" url="https://vitejs.dev" license="MIT" />
          <TechLink name="Tailwind CSS" url="https://tailwindcss.com" license="MIT" />
          <TechLink name="Lucide Icons" url="https://lucide.dev" license="ISC" />
          <TechLink name="SQL.js" url="https://sql.js.org" license="MIT" />
          <TechLink name="react-window" url="https://react-window.vercel.app" license="MIT" />
          <TechLink name="Axios" url="https://axios-http.com" license="MIT" />
        </div>
      </section>

      {/* External Services */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          External Services
        </h3>
        <div className="text-xs text-muted-foreground leading-relaxed p-3 bg-muted/30 rounded-lg">
          <p>
            The wishlist feature provides convenience links to search for physical media on external retailers including Amazon, eBay, and Discogs, as well as music services like Bandcamp and HDtracks.
            Totality is not affiliated with these services and does not receive compensation for referrals.
          </p>
        </div>
      </section>
    </div>
  )
}

/** Legal Tab - Privacy, trademarks, disclaimer, license */
function LegalTab() {
  return (
    <div className="space-y-6 text-xs text-muted-foreground leading-relaxed">
      {/* Privacy */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Privacy & Data
        </h3>
        <div className="p-3 bg-muted/30 rounded-lg space-y-2">
          <p>
            <strong className="text-foreground">Local Storage:</strong> All media library data is stored locally on your device in an SQLite database and is never transmitted to external servers.
          </p>
          <p>
            <strong className="text-foreground">API Communication:</strong> Totality communicates with your configured media servers (Plex, Jellyfin, Emby, Kodi) and metadata APIs (TMDB, MusicBrainz) to retrieve library and metadata information.
          </p>
          <p>
            <strong className="text-foreground">Credential Security:</strong> Server credentials and API keys are encrypted using your operating system's secure storage (Windows DPAPI, macOS Keychain, or Linux Secret Service).
          </p>
          <p>
            <strong className="text-foreground">No Analytics:</strong> Totality does not collect usage analytics, telemetry, or personal information.
          </p>
        </div>
      </section>

      {/* Trademarks */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Trademarks
        </h3>
        <div className="p-3 bg-muted/30 rounded-lg space-y-2">
          <p>
            <strong className="text-foreground">Media Servers:</strong> Plex is a trademark of Plex, Inc. Jellyfin is a trademark of the Jellyfin Contributors. Emby is a trademark of Emby LLC. Kodi is a trademark of the XBMC Foundation.
          </p>
          <p>
            <strong className="text-foreground">Retailers:</strong> Amazon, eBay, Discogs, Bandcamp, and HDtracks are trademarks of their respective owners.
          </p>
          <p>
            <strong className="text-foreground">Data Services:</strong> TMDB and MusicBrainz are trademarks of their respective owners.
          </p>
          <p className="text-muted-foreground/70 italic">
            This software is not affiliated with, endorsed by, or sponsored by any of the above organizations.
          </p>
        </div>
      </section>

      {/* Disclaimer */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Disclaimer
        </h3>
        <div className="p-3 bg-muted/30 rounded-lg space-y-2">
          <p>
            This software is provided <strong className="text-foreground">"as is"</strong> without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement.
          </p>
          <p>
            In no event shall the authors or copyright holders be liable for any claim, damages, or other liability arising from the use of this software.
          </p>
          <p>
            Quality analysis is based on technical metadata (resolution, bitrate, codecs) and may not reflect subjective viewing or listening experience. Upgrade recommendations are suggestions only.
          </p>
        </div>
      </section>

      {/* License */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          License
        </h3>
        <div className="p-3 bg-muted/30 rounded-lg">
          <p className="text-center">
            Totality is open source software licensed under the{' '}
            <a
              href="https://opensource.org/licenses/MIT"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              MIT License
            </a>
            .
          </p>
          <p className="text-center mt-3 text-muted-foreground/70">
            &copy; {new Date().getFullYear()} Brandon Bidwell. All rights reserved.
          </p>
        </div>
      </section>
    </div>
  )
}

/** Technology link component */
function TechLink({ name, url, license }: { name: string; url: string; license: string }) {
  return (
    <div className="p-2 bg-muted/30 rounded">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline font-medium">
        {name}
      </a>
      <span className="text-muted-foreground/60 ml-1">({license})</span>
    </div>
  )
}
