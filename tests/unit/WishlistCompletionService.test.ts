import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WishlistItem } from '../../src/main/types/database'

const db = vi.hoisted(() => ({
  getMediaItemsByTmdbIds: vi.fn(),
  getMediaItems: vi.fn(),
  getEpisodeCountForSeason: vi.fn(),
  getEpisodeCountForSeries: vi.fn(),
  getSeriesCompletenessByTmdbId: vi.fn(),
  getMusicAlbumsByMusicbrainzIds: vi.fn(),
  getMusicTracksByMusicbrainzIds: vi.fn(),
  getMusicAlbums: vi.fn(),
  getMusicTracks: vi.fn(),
}))

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: () => db,
}))
vi.mock('../../src/main/ipc/utils/safeSend', () => ({ safeSend: vi.fn() }))

import { WishlistCompletionService } from '../../src/main/services/WishlistCompletionService'

const item = (overrides: Partial<WishlistItem>): WishlistItem =>
  ({ id: 1, title: 'Example', status: 'active', ...overrides }) as WishlistItem

function check(items: WishlistItem[]): Array<{ id: number; title: string }> {
  const service = new WishlistCompletionService()
  const method = Reflect.get(service, 'checkMissingItems') as
    (items: WishlistItem[]) => Array<{ id: number; title: string }>
  return method.call(service, items)
}

describe('WishlistCompletionService identity safety', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.getMediaItemsByTmdbIds.mockReturnValue(new Map())
    db.getMediaItems.mockReturnValue([])
    db.getMusicAlbumsByMusicbrainzIds.mockReturnValue(new Map())
    db.getMusicTracksByMusicbrainzIds.mockReturnValue(new Map())
    db.getMusicAlbums.mockReturnValue([])
    db.getMusicTracks.mockReturnValue([])
    db.getEpisodeCountForSeason.mockReturnValue(0)
    db.getEpisodeCountForSeries.mockReturnValue(0)
    db.getSeriesCompletenessByTmdbId.mockReturnValue(null)
  })

  it('does not substitute a same-title movie when its TMDB identity disagrees', () => {
    db.getMediaItems.mockReturnValue([{ title: 'Example', year: 2024, type: 'movie' }])
    expect(check([item({ media_type: 'movie', tmdb_id: '123', year: 2024 })])).toEqual([])
    expect(db.getMediaItems).not.toHaveBeenCalled()
  })

  it('does not confuse TV episode TMDB identity with movie identity', () => {
    db.getMediaItemsByTmdbIds.mockReturnValue(new Map([['123', { tmdb_id: '123', type: 'episode' }]]))
    expect(check([item({ media_type: 'movie', tmdb_id: '123' })])).toEqual([])
  })

  it('still completes a title-and-year movie without an external identity', () => {
    db.getMediaItems.mockReturnValue([{ title: 'Example', year: 2024, type: 'movie' }])
    expect(check([item({ media_type: 'movie', year: 2024 })])).toHaveLength(1)
  })

  it('does not mark a specific season owned from series-level aggregate evidence', () => {
    db.getSeriesCompletenessByTmdbId.mockReturnValue({ owned_episodes: 8 })
    expect(check([item({ media_type: 'season', series_title: 'Example', season_number: 5, tmdb_id: '10' })])).toEqual([])
    expect(db.getSeriesCompletenessByTmdbId).not.toHaveBeenCalled()
  })

  it('does not substitute an album title when its MusicBrainz ID disagrees', () => {
    db.getMusicAlbums.mockReturnValue([{ title: 'Example', artist_name: 'Artist' }])
    expect(check([item({ media_type: 'album', musicbrainz_id: 'album-42', artist_name: 'Artist' })])).toEqual([])
    expect(db.getMusicAlbums).not.toHaveBeenCalled()
  })

  it('requires the artist to match when an album has no external ID', () => {
    db.getMusicAlbums.mockReturnValue([{ title: 'Example', artist_name: 'Different Artist' }])
    expect(check([item({ media_type: 'album', artist_name: 'Artist' })])).toEqual([])
    db.getMusicAlbums.mockReturnValue([{ title: 'Example', artist_name: 'Artist' }])
    expect(check([item({ media_type: 'album', artist_name: 'Artist' })])).toHaveLength(1)
  })
})
