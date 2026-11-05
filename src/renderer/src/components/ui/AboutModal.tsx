/**
 * AboutModal Component
 *
 * Displays app version, credits, and legal information with tabbed navigation.
 */

import { useState, useEffect, useRef } from 'react'
import { X, Info, Heart, Scale } from 'lucide-react'
import { Button } from './Button'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useTheme } from '../../contexts/ThemeContext'
import tmdbLogo from '../../assets/tmdb-logo.svg'
import musicbrainzLogo from '../../assets/musicbrainz-logo.svg'
import logoImage from '../../assets/logo.png'
import logoBlackImage from '../../assets/logo_black.png'

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
  const modalRef = useRef<HTMLDivElement>(null)

  // Focus trap
  useFocusTrap(isOpen, modalRef)

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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
      <div ref={modalRef} className="bg-card border border-border rounded-2xl w-full max-w-lg mx-4 shadow-xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <h2 id="about-modal-title" className="text-title font-semibold">About Totality</h2>
          <Button variant="tertiary" size="icon-sm" onClick={onClose} icon={<X className="w-4 h-4" />} aria-label="Close" />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/30 px-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-label font-medium border-b-2 transition-colors ${
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
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}

/** About Tab - App info and description */
function AboutTab() {
  const [version, setVersion] = useState<string>('...')
  const { effectiveIsDark } = useTheme()

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion).catch(() => setVersion('unknown'))
  }, [])

  return (
    <div className="space-y-6">
      {/* Logo and Version */}
      <div className="flex flex-col items-center">
        <img src={effectiveIsDark ? logoImage : logoBlackImage} alt="Totality" className="h-24 w-auto object-contain mb-3" />
        <p className="text-label text-muted-foreground">Version {version}</p>
      </div>

      {/* Description */}
      <p className="text-label text-muted-foreground">
        Analyze media library quality, track completeness, and discover upgrades across your Plex, Jellyfin, Emby, Kodi, and local folder collections.
      </p>

      {/* Features */}
      <div>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Features
        </h3>
        <ul className="list-disc list-inside text-label text-muted-foreground space-y-2">
          <li>Multi-source library scanning (Plex, Jellyfin, Emby, Kodi, Local Folders, MediaMonkey)</li>
          <li>Video and audio quality analysis with tier-based scoring and TMDB ratings</li>
          <li>TV series, movie collection, music, and director/actor filmography completeness</li>
          <li>AI-powered assistant with 29 tools for library insights and recommendations</li>
          <li>Wishlist with Plex and Trakt watchlist sync, barcode scanner for quick adds</li>
          <li>Mobile and web access — browse your library from any device on your network</li>
          <li>Storage analytics, codec migration tracking, and duplicate detection</li>
          <li>Watch history tracking with smart upgrade priority</li>
          <li>Tag sync (mood/genre) across Plex, MediaMonkey, and Kodi</li>
          <li>Release alerts for upcoming wishlist items</li>
        </ul>
      </div>

      {/* Links */}
      <div className="flex justify-center gap-4 text-label">
        <ExtLink href="https://github.com/bbidwell85/totality">
          GitHub
        </ExtLink>
        <span className="text-muted-foreground/30">•</span>
        <ExtLink href="https://github.com/bbidwell85/totality/issues">
          Report Issue
        </ExtLink>
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
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Data sources
        </h3>

        {/* TMDB - Required attribution per terms of use */}
        <div className="flex items-start gap-3 mb-4">
          <img src={tmdbLogo} alt="TMDB" className="h-5 mt-0.5 shrink-0" />
          <div className="text-caption text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1">The Movie Database (TMDB)</p>
            <p>
              This product uses the{' '}
              <ExtLink href="https://www.themoviedb.org">
                TMDB API
              </ExtLink>
              {' '}but is not endorsed or certified by TMDB. Movie and TV metadata, images, and collection information provided by TMDB.
            </p>
          </div>
        </div>

        {/* MusicBrainz - Required CC BY-SA attribution */}
        <div className="flex items-start gap-3">
          <img src={musicbrainzLogo} alt="MusicBrainz" className="h-5 mt-0.5 shrink-0" />
          <div className="text-caption text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1">MusicBrainz</p>
            <p>
              Music metadata provided by{' '}
              <ExtLink href="https://musicbrainz.org">
                MusicBrainz
              </ExtLink>
              , licensed under{' '}
              <ExtLink href="https://creativecommons.org/publicdomain/zero/1.0/">
                CC0 1.0
              </ExtLink>
              {' '}(public domain). Cover art from{' '}
              <ExtLink href="https://coverartarchive.org">
                Cover Art Archive
              </ExtLink>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Watchlist Services */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Watchlist services
        </h3>
        <div className="text-caption text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1">Trakt</p>
          <p>
            Watchlist import powered by the{' '}
            <ExtLink href="https://trakt.tv">
              Trakt
            </ExtLink>
            {' '}API. Trakt is a platform for tracking movies and TV shows you watch.
          </p>
        </div>
      </section>

      {/* Barcode Lookup */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Barcode lookup
        </h3>
        <div className="text-caption text-muted-foreground leading-relaxed">
          <p>
            Barcode scanning uses MusicBrainz for CD lookups and{' '}
            <ExtLink href="https://www.upcitemdb.com">
              UPCitemdb
            </ExtLink>
            {' '}for movie and TV disc lookups, with TMDB for title matching.
          </p>
        </div>
      </section>

      {/* AI Assistant */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          AI assistant
        </h3>
        <div className="text-caption text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1">Google Gemini</p>
          <p>
            AI chat and library analysis powered by{' '}
            <ExtLink href="https://ai.google.dev">
              Google Gemini
            </ExtLink>
            {' '}via the{' '}
            <ExtLink href="https://www.npmjs.com/package/@google/genai">
              @google/genai
            </ExtLink>
            {' '}SDK. Features include natural language library queries, quality and upgrade reports, completeness analysis, and personalized recommendations. Requires a personal Gemini API key.
          </p>
        </div>
      </section>

      {/* Media Analysis */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Media analysis
        </h3>
        <div className="text-caption text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1">FFmpeg / FFprobe</p>
          <p>
            Media file analysis powered by{' '}
            <ExtLink href="https://ffmpeg.org">
              FFmpeg
            </ExtLink>
            , a complete, cross-platform solution for recording, converting, and streaming audio and video.
            FFmpeg is free software licensed under the{' '}
            <ExtLink href="https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html">
              LGPL v2.1
            </ExtLink>
            {' '}or later, with some optional components under{' '}
            <ExtLink href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html">
              GPL
            </ExtLink>
            . FFmpeg is a trademark of Fabrice Bellard. Totality does not bundle FFmpeg; it uses separately installed copies.
          </p>
        </div>
      </section>

      {/* Open Source Technologies */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Built with open source
        </h3>
        <div className="grid grid-cols-2 gap-2 text-caption">
          <TechLink name="Electron" url="https://www.electronjs.org" license="MIT" />
          <TechLink name="React" url="https://react.dev" license="MIT" />
          <TechLink name="TypeScript" url="https://www.typescriptlang.org" license="Apache 2.0" />
          <TechLink name="Vite" url="https://vitejs.dev" license="MIT" />
          <TechLink name="Tailwind CSS" url="https://tailwindcss.com" license="MIT" />
          <TechLink name="Lucide Icons" url="https://lucide.dev" license="ISC" />
          <TechLink name="better-sqlite3" url="https://github.com/WiseLibs/better-sqlite3" license="MIT" />
          <TechLink name="SQL.js" url="https://sql.js.org" license="MIT" />
          <TechLink name="electron-updater" url="https://www.electron.build/auto-update" license="MIT" />
          <TechLink name="react-window" url="https://react-window.vercel.app" license="MIT" />
          <TechLink name="dnd-kit" url="https://dndkit.com" license="MIT" />
          <TechLink name="Zod" url="https://zod.dev" license="MIT" />
          <TechLink name="react-markdown" url="https://github.com/remarkjs/react-markdown" license="MIT" />
          <TechLink name="html5-qrcode" url="https://github.com/mebjas/html5-qrcode" license="Apache 2.0" />
          <TechLink name="ws" url="https://github.com/websockets/ws" license="MIT" />
          <TechLink name="selfsigned" url="https://github.com/jfromaniello/selfsigned" license="MIT" />
          <TechLink name="chokidar" url="https://github.com/paulmillr/chokidar" license="MIT" />
          <TechLink name="adm-zip" url="https://github.com/cthackers/adm-zip" license="MIT" />
        </div>
      </section>

      {/* External Services */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          External services
        </h3>
        <div className="text-caption text-muted-foreground leading-relaxed space-y-2">
          <p>
            <span className="text-foreground font-semibold">Watchlist Sync:</span> Import watchlists from Plex and Trakt to track movies and shows you want to acquire.
          </p>
          <p>
            <span className="text-foreground font-semibold">Store Links:</span> The wishlist provides convenience links to search for physical media on Amazon, eBay, Discogs, Bandcamp, and HDtracks.
            Totality is not affiliated with these services and does not receive compensation for referrals.
          </p>
          <p>
            <span className="text-foreground font-semibold">Updates:</span> Automatic updates delivered via GitHub Releases using electron-updater.
          </p>
        </div>
      </section>
    </div>
  )
}

/** Legal Tab - Privacy, trademarks, disclaimer, license */
function LegalTab() {
  return (
    <div className="space-y-6 text-caption text-muted-foreground leading-relaxed">
      {/* Privacy */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Privacy and data
        </h3>
        <div className="space-y-2">
          <p>
            <span className="text-foreground font-semibold">Local Storage:</span> All media library data is stored locally on your device in an SQLite database and is never transmitted to external servers.
          </p>
          <p>
            <span className="text-foreground font-semibold">API Communication:</span> Totality communicates with your configured media servers (Plex, Jellyfin, Emby, Kodi) and metadata APIs (TMDB, MusicBrainz) to retrieve library and metadata information. Watchlist sync connects to Plex and Trakt APIs.
          </p>
          <p>
            <span className="text-foreground font-semibold">Credential Security:</span> Server credentials and API keys are encrypted using your operating system's secure storage (Windows DPAPI, macOS Keychain, or Linux Secret Service).
          </p>
          <p>
            <span className="text-foreground font-semibold">AI Features:</span> When enabled, AI chat and reports send library metadata (titles, quality specs, statistics) to Google&apos;s Gemini API using your personal API key. No data passes through Totality&apos;s servers. Chat history is not saved to disk.
          </p>
          <p>
            <span className="text-foreground font-semibold">Auto-Updates:</span> Totality periodically checks GitHub Releases for new versions. No personal data is transmitted during update checks.
          </p>
          <p>
            <span className="text-foreground font-semibold">No Analytics:</span> Totality does not collect usage analytics, telemetry, or personal information.
          </p>
        </div>
      </section>

      {/* Trademarks */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Trademarks
        </h3>
        <div className="space-y-2">
          <p>
            <span className="text-foreground font-semibold">Media Servers:</span> Plex is a trademark of Plex, Inc. Jellyfin is a trademark of the Jellyfin Contributors. Emby is a trademark of Emby LLC. Kodi is a trademark of the XBMC Foundation. MediaMonkey is a trademark of Ventis Media Inc.
          </p>
          <p>
            <span className="text-foreground font-semibold">Sync:</span> Trakt is a trademark of Trakt, Inc.
          </p>
          <p>
            <span className="text-foreground font-semibold">Retailers:</span> Amazon, eBay, Discogs, Bandcamp, and HDtracks are trademarks of their respective owners.
          </p>
          <p>
            <span className="text-foreground font-semibold">AI Services:</span> Google and Gemini are trademarks of Google LLC.
          </p>
          <p>
            <span className="text-foreground font-semibold">Data Services:</span> TMDB and MusicBrainz are trademarks of their respective owners.
          </p>
          <p className="text-muted-foreground/70 italic">
            This software is not affiliated with, endorsed by, or sponsored by any of the above organizations.
          </p>
        </div>
      </section>

      {/* Disclaimer */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          Disclaimer
        </h3>
        <div className="space-y-2">
          <p>
            This software is provided <span className="text-foreground font-semibold">"as is"</span> without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement.
          </p>
          <p>
            In no event shall the authors or copyright holders be liable for any claim, damages, or other liability arising from the use of this software.
          </p>
          <p>
            Quality analysis is based on technical metadata (resolution, bitrate, codecs) and may not reflect subjective viewing or listening experience. Upgrade recommendations are suggestions only.
          </p>
          <p>
            AI-generated responses and reports may contain inaccuracies. Always verify recommendations before making purchase decisions.
          </p>
        </div>
      </section>

      {/* License */}
      <section>
        <h3 className="text-label font-semibold text-muted-foreground mb-3">
          License
        </h3>
        <div className="space-y-2">
          <p>
            Totality is open source software licensed under the{' '}
            <ExtLink href="https://opensource.org/licenses/MIT">
              MIT License
            </ExtLink>
            .
          </p>
          <p className="text-muted-foreground/70">
            &copy; {new Date().getFullYear()} Brandon Bidwell. All rights reserved.
          </p>
        </div>
      </section>
    </div>
  )
}

/** External link component - opens in default browser */
function ExtLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      onClick={(e) => { e.preventDefault(); window.electronAPI.openExternal(href) }}
      className={className ?? 'text-muted-foreground hover:text-foreground hover:underline transition-colors'}
    >
      {children}
    </a>
  )
}

/** Technology link component */
function TechLink({ name, url, license }: { name: string; url: string; license: string }) {
  return (
    <div className="p-2">
      <ExtLink href={url} className="text-muted-foreground hover:text-foreground hover:underline transition-colors font-medium">
        {name}
      </ExtLink>
      <span className="text-muted-foreground/60 ml-1">({license})</span>
    </div>
  )
}
