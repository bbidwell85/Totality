/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'

const mockEndBatch = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: () => ({
    startBatch: vi.fn(),
    endBatch: mockEndBatch,
  }),
}))

import { MediaMonkeyProvider } from '@main/providers/mediamonkey/MediaMonkeyProvider'

function prepareProvider(): MediaMonkeyProvider {
  const provider = new MediaMonkeyProvider({ sourceId: 'media-monkey-test', connectionConfig: {} })
  vi.spyOn(provider as any, 'openDatabase').mockResolvedValue(undefined)
  vi.spyOn(provider as any, 'closeDatabase').mockImplementation(() => {})
  vi.spyOn(provider as any, 'loadAllMoods').mockReturnValue(new Map())
  vi.spyOn(provider as any, 'loadAlbumCovers').mockReturnValue(new Map())
  vi.spyOn(provider as any, 'query')
    .mockReturnValueOnce([{ count: 0 }])
    .mockReturnValueOnce([])
  return provider
}

describe('MediaMonkey scan result safety', () => {
  it('returns unsuccessful status after cancellation and releases the batch', async () => {
    const provider = prepareProvider()
    const scan = Reflect.get(provider, 'scanMusicLibrary') as
      (onProgress?: () => void) => Promise<{ success: boolean; cancelled?: boolean }>
    const result = await scan.call(provider, () => provider.cancelScan())
    expect(result.success).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(mockEndBatch).toHaveBeenCalled()
  })

  it('reports artwork failures instead of silently marking the scan successful', async () => {
    const provider = prepareProvider()
    vi.spyOn(provider as any, 'resolveAlbumArtwork')
      .mockRejectedValue(new Error('Artwork unavailable'))
    const scan = Reflect.get(provider, 'scanMusicLibrary') as
      () => Promise<{ success: boolean; errors: string[] }>
    const result = await scan.call(provider)
    expect(result.success).toBe(false)
    expect(result.errors.join(' ')).toContain('Artwork unavailable')
  })
})
