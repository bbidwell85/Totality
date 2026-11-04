/**
 * Hash-based URL routing for web mode.
 *
 * Syncs navigation state to window.location.hash so browser back/forward,
 * bookmarks, and page refresh work on the mobile web version.
 *
 * Only active when isWebMode() is true — Electron desktop is unaffected.
 */

import { isWebMode } from './webTransport'

export interface HashState {
  view: 'dashboard' | 'library'
  tab?: 'movies' | 'tv' | 'music'
  // Drill-down targets (only one set at a time)
  showTitle?: string
  seasonNumber?: number
  artistId?: number
  albumId?: number
  mediaId?: number
  wishlist?: boolean
}

/** Build a hash string from current navigation state */
export function stateToHash(state: HashState): string {
  if (!isWebMode()) return ''

  if (state.wishlist) return '#/wishlist'
  if (state.view === 'dashboard') return '#/'

  const tab = state.tab || 'movies'

  if (tab === 'movies') {
    if (state.mediaId) return `#/movies/${state.mediaId}`
    return '#/movies'
  }

  if (tab === 'tv') {
    if (state.showTitle && state.seasonNumber !== undefined) {
      return `#/tv/${encodeURIComponent(state.showTitle)}/${state.seasonNumber}`
    }
    if (state.showTitle) return `#/tv/${encodeURIComponent(state.showTitle)}`
    return '#/tv'
  }

  if (tab === 'music') {
    if (state.artistId) return `#/music/artist/${state.artistId}`
    if (state.albumId) return `#/music/album/${state.albumId}`
    return '#/music'
  }

  return '#/'
}

/** Parse a hash string into navigation state */
export function parseHash(hash: string): HashState {
  const path = (hash || '').replace(/^#\/?/, '')
  const segments = path.split('/').map(s => decodeURIComponent(s)).filter(Boolean)

  if (segments.length === 0) return { view: 'dashboard' }

  const first = segments[0]

  if (first === 'wishlist') {
    return { view: 'library', wishlist: true }
  }

  if (first === 'movies') {
    const id = segments[1] ? parseInt(segments[1], 10) : undefined
    return { view: 'library', tab: 'movies', mediaId: id && !isNaN(id) ? id : undefined }
  }

  if (first === 'tv') {
    const showTitle = segments[1] || undefined
    const seasonNum = segments[2] ? parseInt(segments[2], 10) : undefined
    return {
      view: 'library',
      tab: 'tv',
      showTitle,
      seasonNumber: seasonNum && !isNaN(seasonNum) ? seasonNum : undefined,
    }
  }

  if (first === 'music') {
    if (segments[1] === 'artist' && segments[2]) {
      const id = parseInt(segments[2], 10)
      return { view: 'library', tab: 'music', artistId: !isNaN(id) ? id : undefined }
    }
    if (segments[1] === 'album' && segments[2]) {
      const id = parseInt(segments[2], 10)
      return { view: 'library', tab: 'music', albumId: !isNaN(id) ? id : undefined }
    }
    return { view: 'library', tab: 'music' }
  }

  return { view: 'dashboard' }
}

/** Update the URL hash without adding a browser history entry */
export function replaceHash(hash: string): void {
  if (!isWebMode()) return
  if (window.location.hash === hash) return
  history.replaceState(null, '', hash || '#/')
}

/** Update the URL hash and add a browser history entry (for user-initiated navigation) */
export function pushHash(hash: string): void {
  if (!isWebMode()) return
  if (window.location.hash === hash) return
  history.pushState(null, '', hash || '#/')
}
