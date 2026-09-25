/**
 * AddToArrButton — small icon button that sends an item to Radarr, Sonarr, or Lidarr.
 *
 * Shows a spinner while the request is in flight, and a brief ✓ checkmark on success.
 */

import { useState } from 'react'
import { Loader2, Check, ExternalLink } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'

type ArrType = 'radarr' | 'sonarr' | 'lidarr'

interface AddToArrButtonProps {
  type: ArrType
  /** For movies: TMDB ID */
  tmdbId?: string | number
  /** Title used for series/artist lookup (and Radarr fallback) */
  title: string
  year?: number
  /** MusicBrainz ID for Lidarr */
  mbId?: string
  compact?: boolean
}

const TYPE_LABEL: Record<ArrType, string> = {
  radarr: 'Radarr',
  sonarr: 'Sonarr',
  lidarr: 'Lidarr',
}

// Minimal SVG logos for the three apps
function RadarrLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="5" fill="currentColor" opacity="0.4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}

function SonarrLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.5" fill="currentColor" />
    </svg>
  )
}

function LidarrLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18V6l12-2v12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

const LOGOS: Record<ArrType, (size: number) => JSX.Element> = {
  radarr: (s) => <RadarrLogo size={s} />,
  sonarr: (s) => <SonarrLogo size={s} />,
  lidarr: (s) => <LidarrLogo size={s} />,
}

export function AddToArrButton({
  type,
  tmdbId,
  title,
  year,
  mbId,
  compact = false,
}: AddToArrButtonProps) {
  const { addToast } = useToast()
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const size = compact ? 13 : 16

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (status !== 'idle') return
    setStatus('loading')

    try {
      let result: { success: boolean; alreadyExists?: boolean; triggered?: boolean; error?: string }

      if (type === 'radarr') {
        if (!tmdbId) {
          addToast({ type: 'error', message: 'No TMDB ID available for this movie' })
          setStatus('idle')
          return
        }
        result = await window.electronAPI.arrAddMovie({ tmdbId, title, year })
      } else if (type === 'sonarr') {
        result = await window.electronAPI.arrAddSeries({ title, year })
      } else {
        result = await window.electronAPI.arrAddArtist({ name: title, mbId })
      }

      if (result.success) {
        const label = TYPE_LABEL[type]
        if (result.alreadyExists && result.triggered) {
          addToast({ type: 'success', message: `${label}: upgrade search triggered for "${title}"` })
        } else if (result.alreadyExists) {
          addToast({ type: 'info', message: `"${title}" is already in ${label}` })
        } else {
          addToast({ type: 'success', message: `"${title}" added to ${label}` })
        }
        setStatus('done')
        setTimeout(() => setStatus('idle'), 3000)
      } else {
        addToast({ type: 'error', message: result.error || `Failed to send to ${TYPE_LABEL[type]}` })
        setStatus('idle')
      }
    } catch {
      addToast({ type: 'error', message: `Failed to send to ${TYPE_LABEL[type]}` })
      setStatus('idle')
    }
  }

  const label = TYPE_LABEL[type]
  const iconSize = compact ? 12 : 14

  return (
    <button
      onClick={handleClick}
      disabled={status === 'loading'}
      className={`${compact ? 'p-1' : 'p-1.5'} rounded-md transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50`}
      title={status === 'done' ? `Sent to ${label}` : `Send to ${label}`}
    >
      {status === 'loading' ? (
        <Loader2 className="animate-spin" style={{ width: iconSize, height: iconSize }} />
      ) : status === 'done' ? (
        <Check style={{ width: iconSize, height: iconSize }} className="text-green-500" />
      ) : (
        LOGOS[type](size)
      )}
    </button>
  )
}

/**
 * Group of arr buttons — renders only the apps that are configured.
 */
export function ArrButtons({
  arrApps,
  tmdbId,
  title,
  year,
  mbId,
  mediaType,
  compact = false,
}: {
  arrApps: { radarr: boolean; sonarr: boolean; lidarr: boolean }
  tmdbId?: string | number
  title: string
  year?: number
  mbId?: string
  mediaType: 'movie' | 'tv' | 'music'
  compact?: boolean
}) {
  return (
    <>
      {mediaType === 'movie' && arrApps.radarr && (
        <AddToArrButton type="radarr" tmdbId={tmdbId} title={title} year={year} compact={compact} />
      )}
      {mediaType === 'tv' && arrApps.sonarr && (
        <AddToArrButton type="sonarr" title={title} year={year} compact={compact} />
      )}
      {mediaType === 'music' && arrApps.lidarr && (
        <AddToArrButton type="lidarr" title={title} mbId={mbId} compact={compact} />
      )}
    </>
  )
}

/**
 * External link icon that opens the arr web UI.
 */
export function ArrExternalLink({
  type,
  url,
  compact = false,
}: {
  type: ArrType
  url: string
  compact?: boolean
}) {
  const iconSize = compact ? 12 : 14
  return (
    <a
      href={url}
      onClick={(e) => { e.preventDefault(); window.electronAPI.openExternal(url) }}
      className={`${compact ? 'p-1' : 'p-1.5'} rounded-md text-muted-foreground hover:text-foreground transition-colors`}
      title={`Open ${TYPE_LABEL[type]}`}
    >
      <ExternalLink style={{ width: iconSize, height: iconSize }} />
    </a>
  )
}
