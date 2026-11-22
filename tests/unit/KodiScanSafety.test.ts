import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetMediaItems = vi.hoisted(() => vi.fn(() => [{ id: 1, plex_id: 'stored-1' }]))
const mockDeleteMediaItem = vi.hoisted(() => vi.fn())
const mockUpdateScanTime = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: () => ({
    getSetting: vi.fn(() => 'false'),
    getMediaItems: mockGetMediaItems,
    deleteMediaItem: mockDeleteMediaItem,
    updateSourceScanTime: mockUpdateScanTime,
    startBatch: vi.fn(),
    endBatch: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: () => ({
    loadThresholdsFromDatabase: vi.fn(),
    analyzeVersion: vi.fn(),
    analyzeMediaItem: vi.fn(),
  }),
}))

import { KodiProvider } from '@main/providers/kodi/KodiProvider'
import { KodiLocalProvider } from '@main/providers/kodi/KodiLocalProvider'
import { KodiMySQLProvider } from '@main/providers/kodi/KodiMySQLProvider'

const providers = [
  ['Kodi JSON-RPC', () => new KodiProvider({ sourceId: 'kodi-test', connectionConfig: {} })],
  ['Kodi SQLite', () => new KodiLocalProvider({ sourceId: 'kodi-local-test', connectionConfig: {} })],
  ['Kodi MySQL', () => new KodiMySQLProvider({ sourceId: 'kodi-mysql-test', connectionConfig: {} })],
] as const

describe('Kodi inventory safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMediaItems.mockReturnValue([{ id: 1, plex_id: 'stored-1' }])
  })

  it('Kodi Local: reports missing targeted items as a failed scan', async () => {
    const provider = new KodiLocalProvider({ sourceId: 'kodi-local-targeted', connectionConfig: {} })
    vi.spyOn(provider as any, 'openDatabase').mockResolvedValue(undefined)
    vi.spyOn(provider as any, 'closeDatabase').mockImplementation(() => {})
    vi.spyOn(provider as any, 'getAudioStreamsByFileId').mockReturnValue(new Map())
    vi.spyOn(provider as any, 'findMovieByFilePath').mockResolvedValue(null)
    const result = await provider.scanLibrary('movies', { targetFiles: ['/missing/movie.mkv'] })

    expect(result.success).toBe(false)
    expect(result.errors.join(' ')).toContain('File not found in Kodi database')
    expect(mockDeleteMediaItem).not.toHaveBeenCalled()
  })

  for (const [name, create] of providers) {
    it(`${name}: rejects an empty server inventory when stored media exists`, async () => {
      const provider = create()
      vi.spyOn(provider, 'getMovies').mockResolvedValue([])
      const result = await provider.scanLibrary('movies')

      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Incomplete')
      expect(result.itemsRemoved).toBe(0)
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
      expect(mockUpdateScanTime).not.toHaveBeenCalled()
    })

    it(`${name}: never deletes media after conversion failure`, async () => {
      const provider = create()
      vi.spyOn(provider, 'getMovies').mockResolvedValue([{ itemId: 'new-1', title: 'Bad Movie' }] as never)
      vi.spyOn(provider as never, 'convertMetadataToVersion' as never).mockImplementation(() => {
        throw new Error('Conversion failed')
      })
      const result = await provider.scanLibrary('movies')

      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Conversion failed')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
      expect(mockUpdateScanTime).not.toHaveBeenCalled()
    })
  }
})
