/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchJSON = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/services/utils/httpClient', () => ({
  fetchJSON: mockFetchJSON,
  fetchWithTimeout: vi.fn(),
  buildUrl: (base: string, params?: Record<string, unknown>) => {
    if (!params) return base
    const qs = Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `${base}?${qs}` : base
  },
  isHttpError: vi.fn((e: any) => e && typeof e.status === 'number'),
}))

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
    getMediaItems: vi.fn(() => []),
    upsertMediaItem: vi.fn(),
    deleteMediaItem: vi.fn(),
    upsertLibraryScan: vi.fn(),
    getLibraryScan: vi.fn(() => null),
  })),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    loadThresholdsFromDatabase: vi.fn(),
    analyzeMediaItem: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/utils/retryWithBackoff', () => ({
  retryWithBackoff: vi.fn((fn: () => any) => fn()),
}))

import { PlexService } from '@main/services/PlexService'

describe('PlexService', () => {
  let service: PlexService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PlexService()
  })

  // ==========================================================================
  // getAuthUrl
  // ==========================================================================
  describe('getAuthUrl', () => {
    it('generates correct auth URL with code', () => {
      const url = service.getAuthUrl(123, 'abc-def')
      expect(url).toContain('app.plex.tv/auth')
      expect(url).toContain('code=abc-def')
      expect(url).toContain('clientID=')
    })
  })

  // ==========================================================================
  // requestAuthPin
  // ==========================================================================
  describe('requestAuthPin', () => {
    it('returns pin data on success', async () => {
      mockFetchJSON.mockResolvedValueOnce({ id: 123, code: 'abc' })
      const pin = await service.requestAuthPin()
      expect(pin.id).toBe(123)
      expect(pin.code).toBe('abc')
    })

    it('throws on failure', async () => {
      mockFetchJSON.mockRejectedValueOnce(new Error('Network error'))
      await expect(service.requestAuthPin()).rejects.toThrow('Failed to initiate Plex authentication')
    })
  })

  // ==========================================================================
  // checkAuthPin
  // ==========================================================================
  describe('checkAuthPin', () => {
    it('returns token when authorized', async () => {
      mockFetchJSON.mockResolvedValueOnce({ authToken: 'tok-123' })
      const token = await service.checkAuthPin(123)
      expect(token).toBe('tok-123')
    })

    it('returns null when not yet authorized', async () => {
      mockFetchJSON.mockResolvedValueOnce({ authToken: null })
      const token = await service.checkAuthPin(123)
      expect(token).toBeNull()
    })

    it('returns null on error', async () => {
      mockFetchJSON.mockRejectedValueOnce(new Error('fail'))
      const token = await service.checkAuthPin(123)
      expect(token).toBeNull()
    })
  })

  // ==========================================================================
  // detectHDRFormat (private — test via any cast)
  // ==========================================================================
  describe('detectHDRFormat', () => {
    it('returns None for null', () => {
      expect((service as any).detectHDRFormat(null)).toBe('None')
    })

    it('detects Dolby Vision (PQ + BT.2020)', () => {
      expect((service as any).detectHDRFormat('smpte2084', 'bt2020nc')).toBe('Dolby Vision')
    })

    it('detects HDR10 (PQ only)', () => {
      expect((service as any).detectHDRFormat('smpte2084')).toBe('HDR10')
    })

    it('detects HDR10 with st2084', () => {
      expect((service as any).detectHDRFormat('st2084')).toBe('HDR10')
    })

    it('detects HLG', () => {
      expect((service as any).detectHDRFormat('arib-std-b67')).toBe('HLG')
    })

    it('detects HLG by keyword', () => {
      expect((service as any).detectHDRFormat('hlg')).toBe('HLG')
    })

    it('returns None for standard SDR', () => {
      expect((service as any).detectHDRFormat('bt709')).toBe('None')
    })
  })

  // ==========================================================================
  // detectObjectAudio (private)
  // ==========================================================================
  describe('detectObjectAudio', () => {
    it('detects Atmos by codec name', () => {
      expect((service as any).detectObjectAudio('atmos')).toBe(true)
    })

    it('detects Atmos with TrueHD + >6 channels', () => {
      expect((service as any).detectObjectAudio('truehd', undefined, 8)).toBe(true)
    })

    it('does not flag TrueHD with 6 channels', () => {
      expect((service as any).detectObjectAudio('truehd', undefined, 6)).toBe(false)
    })

    it('detects Atmos by layout', () => {
      expect((service as any).detectObjectAudio('eac3', '7.1 (Atmos)')).toBe(true)
    })

    it('detects DTS:X', () => {
      expect((service as any).detectObjectAudio('dts:x')).toBe(true)
      expect((service as any).detectObjectAudio('dtsx')).toBe(true)
    })

    it('returns false for regular codec', () => {
      expect((service as any).detectObjectAudio('ac3', '5.1', 6)).toBe(false)
    })
  })

  // ==========================================================================
  // hasSelectedServer / getServers
  // ==========================================================================
  describe('hasSelectedServer', () => {
    it('returns false initially', () => {
      expect(service.hasSelectedServer()).toBe(false)
    })
  })

  describe('getServers', () => {
    it('throws when not authenticated', async () => {
      await expect(service.getServers()).rejects.toThrow('Not authenticated')
    })
  })
})
