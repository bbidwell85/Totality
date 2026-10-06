/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchJSON = vi.hoisted(() => vi.fn())
const mockFetchWithTimeout = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/services/utils/httpClient', () => ({
  fetchJSON: mockFetchJSON,
  fetchWithTimeout: mockFetchWithTimeout,
  buildUrl: (base: string, params?: Record<string, unknown>) => {
    if (!params) return base
    const qs = Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `${base}?${qs}` : base
  },
}))

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    upsertArtistCompleteness: vi.fn(),
    upsertAlbumCompleteness: vi.fn(),
    getArtistCompleteness: vi.fn(() => []),
    getMusicArtists: vi.fn(() => []),
    getMusicAlbums: vi.fn(() => []),
    getMusicAlbumsByArtistName: vi.fn(() => []),
    getMusicTracks: vi.fn(() => []),
  })),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/utils/RateLimiter', () => ({
  RateLimiters: {
    createMusicBrainzLimiter: vi.fn(() => ({
      waitForSlot: vi.fn(),
      wait: vi.fn(),
      release: vi.fn(),
    })),
  },
  SimpleDelayRateLimiter: vi.fn().mockImplementation(() => ({
    waitForSlot: vi.fn(),
    wait: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/utils/retryWithBackoff', () => ({
  retryWithBackoff: vi.fn((fn: () => any) => fn()),
}))

vi.mock('../../src/main/services/utils/ProgressTracker', () => ({
  CancellableOperation: class {
    cancelled = false
    cancel() { this.cancelled = true }
    isCancelled() { return this.cancelled }
    checkCancellation() { if (this.cancelled) throw new Error('Cancelled') }
  },
  wasRecentlyAnalyzed: vi.fn(() => false),
}))

import { MusicBrainzService } from '@main/services/MusicBrainzService'

describe('MusicBrainzService', () => {
  let service: MusicBrainzService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MusicBrainzService()
  })

  // ==========================================================================
  // buildCoverArtUrl
  // ==========================================================================
  describe('buildCoverArtUrl', () => {
    it('builds front URL by default', () => {
      const url = service.buildCoverArtUrl('rg-123')
      expect(url).toBe('https://coverartarchive.org/release-group/rg-123/front')
    })

    it('builds sized URL for 250', () => {
      const url = service.buildCoverArtUrl('rg-123', '250')
      expect(url).toBe('https://coverartarchive.org/release-group/rg-123/front-250')
    })

    it('builds sized URL for 500', () => {
      const url = service.buildCoverArtUrl('rg-123', '500')
      expect(url).toBe('https://coverartarchive.org/release-group/rg-123/front-500')
    })

    it('builds sized URL for 1200', () => {
      const url = service.buildCoverArtUrl('rg-123', '1200')
      expect(url).toBe('https://coverartarchive.org/release-group/rg-123/front-1200')
    })
  })

  // ==========================================================================
  // getCoverArtUrl
  // ==========================================================================
  describe('getCoverArtUrl', () => {
    it('returns URL on successful HEAD request', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({ ok: true, status: 200 })
      const url = await service.getCoverArtUrl('rg-123')
      expect(url).toContain('coverartarchive.org')
    })

    it('returns null on 404', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 404 })
      const url = await service.getCoverArtUrl('rg-123')
      expect(url).toBeNull()
    })

    it('returns null on network error', async () => {
      mockFetchWithTimeout.mockRejectedValueOnce(new Error('timeout'))
      const url = await service.getCoverArtUrl('rg-123')
      expect(url).toBeNull()
    })
  })

  // ==========================================================================
  // searchArtist
  // ==========================================================================
  describe('searchArtist', () => {
    it('returns artist results', async () => {
      mockFetchJSON.mockResolvedValueOnce({
        artists: [{ id: 'a1', name: 'Test Artist', 'sort-name': 'Artist, Test' }],
      })
      const results = await service.searchArtist('Test Artist')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Test Artist')
    })

    it('returns empty array when no results', async () => {
      mockFetchJSON.mockResolvedValueOnce({ artists: [] })
      const results = await service.searchArtist('Unknown')
      expect(results).toEqual([])
    })

    it('handles missing artists field', async () => {
      mockFetchJSON.mockResolvedValueOnce({})
      const results = await service.searchArtist('Test')
      expect(results).toEqual([])
    })
  })

  // ==========================================================================
  // getReleaseTracklist
  // ==========================================================================
  describe('getReleaseTracklist', () => {
    it('returns null when no releases found', async () => {
      mockFetchJSON.mockResolvedValueOnce({ releases: [] })
      // Second call (without status filter) also returns empty
      mockFetchJSON.mockResolvedValueOnce({ releases: [] })
      const result = await service.getReleaseTracklist('rg-123')
      expect(result).toBeNull()
    })

    it('extracts tracks from release media', async () => {
      mockFetchJSON.mockResolvedValueOnce({
        releases: [{
          id: 'r1',
          title: 'Album',
          media: [{
            position: 1,
            tracks: [
              { id: 't1', title: 'Track 1', position: 1, length: 200000 },
              { id: 't2', title: 'Track 2', position: 2, length: 180000 },
            ],
          }],
        }],
      })

      const result = await service.getReleaseTracklist('rg-123')
      expect(result).not.toBeNull()
      expect(result!.releaseId).toBe('r1')
      expect(result!.tracks).toHaveLength(2)
    })
  })
})
