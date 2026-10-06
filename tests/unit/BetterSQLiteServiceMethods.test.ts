/**
 * BetterSQLiteService Class-Method Tests
 *
 * Tests the actual BetterSQLiteService class methods (not raw SQL) by mocking
 * better-sqlite3 with a sql.js-backed adapter. This verifies business logic:
 * transactions, JSON manipulation, cascading deletes, credential handling.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../helpers/testDatabase'

// Unmock sql.js — we need the real implementation
vi.unmock('sql.js')

// Shared test database — recreated per test
let testDb: TestDatabase

// Mock better-sqlite3 to return our sql.js adapter
vi.mock('better-sqlite3', () => {
  return {
    default: function() {
      return testDb
    },
  }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test') },
}))

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => true) },
  existsSync: vi.fn(() => true),
}))

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('path')
  return { ...actual }
})

vi.mock('../../src/main/services/CredentialEncryptionService', () => ({
  getCredentialEncryptionService: vi.fn(() => ({
    encryptSetting: vi.fn((_key: string, value: string) => value),
    decryptSetting: vi.fn((_key: string, value: string) => value),
    encryptConnectionConfig: vi.fn((config: any) => config),
    decryptConnectionConfig: vi.fn((config: any) => config),
  })),
}))

vi.mock('../../src/main/services/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: any) => e?.message || String(e)),
}))

import { BetterSQLiteService } from '@main/database/BetterSQLiteService'

// Helper to create and initialize a fresh service
async function createService(): Promise<BetterSQLiteService> {
  testDb = await createTestDatabase()
  const service = new BetterSQLiteService()
  service.initialize()
  return service
}

// Helper to insert a media source
function insertSource(service: BetterSQLiteService, sourceId = 'src-1', sourceType = 'plex') {
  ;(service as any).db.prepare(`
    INSERT INTO media_sources (source_id, source_type, display_name, connection_config, is_enabled)
    VALUES (?, ?, ?, '{}', 1)
  `).run(sourceId, sourceType, `Test ${sourceType}`)
}

// Helper to create a minimal media item
function makeMediaItem(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    plex_id: 'plex-1',
    title: 'Test Movie',
    type: 'movie',
    file_path: '/movies/test.mkv',
    file_size: 1000000,
    duration: 7200,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'HEVC',
    video_bitrate: 5000,
    audio_codec: 'AAC',
    audio_channels: 2,
    audio_bitrate: 128,
    ...overrides,
  }
}

// Helper to create a minimal music artist
function makeMusicArtist(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    provider_id: 'artist-1',
    name: 'Test Artist',
    album_count: 1,
    track_count: 5,
    ...overrides,
  }
}

// Helper to create a minimal music album
function makeMusicAlbum(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    provider_id: 'album-1',
    title: 'Test Album',
    artist_name: 'Test Artist',
    track_count: 5,
    ...overrides,
  }
}

// Helper to create a minimal music track
function makeMusicTrack(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    provider_id: 'track-1',
    title: 'Test Track',
    artist_name: 'Test Artist',
    audio_codec: 'FLAC',
    ...overrides,
  }
}

// ============================================================================
// SETTINGS
// ============================================================================
describe('BetterSQLiteService — Settings', () => {
  let service: BetterSQLiteService

  beforeAll(async () => {
    service = await createService()
    insertSource(service)
  })

  it('setSetting and getSetting round-trip', () => {
    service.setSetting('test_key', 'test_value')
    expect(service.getSetting('test_key')).toBe('test_value')
  })

  it('setSetting overwrites existing', () => {
    service.setSetting('key1', 'value1')
    service.setSetting('key1', 'value2')
    expect(service.getSetting('key1')).toBe('value2')
  })

  it('getSetting returns null for missing key', () => {
    expect(service.getSetting('nonexistent')).toBeNull()
  })

  it('deleteSetting removes entry', () => {
    service.setSetting('to_delete', 'val')
    service.deleteSetting('to_delete')
    expect(service.getSetting('to_delete')).toBeNull()
  })

  it('getAllSettings returns all entries', () => {
    service.setSetting('s1', 'v1')
    service.setSetting('s2', 'v2')
    const all = service.getAllSettings()
    expect(all['s1']).toBe('v1')
    expect(all['s2']).toBe('v2')
  })
})

// ============================================================================
// MEDIA ITEMS
// ============================================================================
describe('BetterSQLiteService — Media Items', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('upsertMediaItem inserts and returns ID', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    expect(id).toBeGreaterThan(0)
  })

  it('upsertMediaItem updates existing (same source_id + plex_id)', () => {
    const id1 = service.upsertMediaItem(makeMediaItem({ title: 'Original' }))
    const id2 = service.upsertMediaItem(makeMediaItem({ title: 'Updated' }))
    expect(id2).toBe(id1)

    const item = service.getMediaItem(id1)
    expect(item?.title).toBe('Updated')
  })

  it('getMediaItem returns correct shape', () => {
    const id = service.upsertMediaItem(makeMediaItem({ year: 2020 }))
    const item = service.getMediaItem(id)
    expect(item).toBeDefined()
    expect(item?.title).toBe('Test Movie')
    expect(item?.year).toBe(2020)
    expect(item?.type).toBe('movie')
  })

  it('getMediaItem returns null for non-existent', () => {
    expect(service.getMediaItem(99999)).toBeNull()
  })

  it('getMediaItems filters by type', () => {
    service.upsertMediaItem(makeMediaItem({ plex_id: 'm1', type: 'movie' }))
    service.upsertMediaItem(makeMediaItem({ plex_id: 'e1', type: 'episode', series_title: 'Show' }))
    const movies = service.getMediaItems({ type: 'movie' })
    expect(movies.every((m: any) => m.type === 'movie')).toBe(true)
  })

  it('countMediaItems counts by source', () => {
    service.upsertMediaItem(makeMediaItem({ plex_id: 'a1' }))
    service.upsertMediaItem(makeMediaItem({ plex_id: 'a2' }))
    const count = service.countMediaItems({ sourceId: 'src-1' })
    expect(count).toBe(2)
  })

  it('deleteMediaItem removes item and cascades', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    service.deleteMediaItem(id)
    expect(service.getMediaItem(id)).toBeNull()
  })
})

// ============================================================================
// DELETE MEDIA ITEM — EPISODE PATH (series completeness updates)
// ============================================================================
describe('BetterSQLiteService — deleteMediaItem episode cascade', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('updates series completeness when episode deleted', () => {
    // Insert two episodes of the same series
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'ep1', type: 'episode', series_title: 'Show A',
      season_number: 1, episode_number: 1, title: 'Pilot', library_id: 'lib-1',
    }))
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'ep2', type: 'episode', series_title: 'Show A',
      season_number: 1, episode_number: 2, title: 'Second', library_id: 'lib-1',
    }))

    // Insert series completeness record
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES (?, ?, ?, '', 1, 5, 1, 2, '[]', '[]', 40)
    `).run('Show A', 'src-1', 'lib-1')

    // Delete one episode
    const ep1 = service.getMediaItemByProviderId('ep1', 'src-1')
    service.deleteMediaItem(ep1!.id!)

    // Verify: owned_episodes decremented
    const sc = (service as any).db.prepare(
      'SELECT owned_episodes, missing_episodes FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?'
    ).get('Show A', 'src-1', 'lib-1') as any
    expect(sc).toBeDefined()
    expect(sc.owned_episodes).toBe(1)

    // Verify: deleted episode added to missing_episodes
    const missing = JSON.parse(sc.missing_episodes)
    expect(missing.some((e: any) => e.episode_number === 1)).toBe(true)
  })

  it('removes series completeness when last episode deleted', () => {
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'ep-only', type: 'episode', series_title: 'Solo Show',
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))

    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES (?, ?, ?, '', 1, 3, 1, 1, '[]', '[]', 33)
    `).run('Solo Show', 'src-1', 'lib-1')

    const ep = service.getMediaItemByProviderId('ep-only', 'src-1')
    service.deleteMediaItem(ep!.id!)

    const sc = (service as any).db.prepare(
      'SELECT * FROM series_completeness WHERE series_title = ? AND source_id = ?'
    ).get('Solo Show', 'src-1')
    expect(sc).toBeUndefined()
  })
})

// ============================================================================
// MUSIC UPSERTS & FK CORRECTNESS
// ============================================================================
describe('BetterSQLiteService — Music', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('upsertMusicArtist returns ID via key lookup (not lastInsertRowid)', () => {
    const id1 = service.upsertMusicArtist(makeMusicArtist())
    expect(id1).toBeGreaterThan(0)
    // Update same artist — should return same ID
    const id2 = service.upsertMusicArtist(makeMusicArtist({ name: 'Updated Artist' }))
    expect(id2).toBe(id1)
  })

  it('upsertMusicAlbum links to artist via FK', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    expect(albumId).toBeGreaterThan(0)
  })

  it('upsertMusicTrack links to album and artist', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const trackId = service.upsertMusicTrack(makeMusicTrack({
      artist_id: artistId,
      album_id: albumId,
    }))
    expect(trackId).toBeGreaterThan(0)
  })

  it('getMusicAlbums supports artistId + artistName OR logic', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId, provider_id: 'alb-1' }))
    // Insert album with different artist_id but same artist_name
    service.upsertMusicAlbum(makeMusicAlbum({
      artist_id: null, provider_id: 'alb-2', title: 'Collab Album',
    }))

    const albums = service.getMusicAlbums({ artistId, artistName: 'Test Artist' })
    expect(albums.length).toBeGreaterThanOrEqual(2)
  })

  it('getMusicStats returns correct counts', () => {
    service.upsertMusicArtist(makeMusicArtist())
    service.upsertMusicAlbum(makeMusicAlbum())
    service.upsertMusicTrack(makeMusicTrack())

    const stats = service.getMusicStats()
    expect(stats.totalArtists).toBe(1)
    expect(stats.totalAlbums).toBe(1)
    expect(stats.totalTracks).toBe(1)
  })
})

// ============================================================================
// DELETE MUSIC TRACK — CASCADE LOGIC
// ============================================================================
describe('BetterSQLiteService — deleteMusicTrack cascade', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('decrements album track_count on delete', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const t1 = service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId, provider_id: 't1' }))
    service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId, provider_id: 't2', title: 'Track 2' }))

    service.deleteMusicTrack(t1)

    const album = (service as any).db.prepare('SELECT track_count FROM music_albums WHERE id = ?').get(albumId)
    expect(album.track_count).toBe(1)
  })

  it('removes orphaned album when last track deleted', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const trackId = service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId }))

    service.deleteMusicTrack(trackId)

    const album = (service as any).db.prepare('SELECT * FROM music_albums WHERE id = ?').get(albumId)
    expect(album).toBeUndefined()
  })

  it('removes orphaned artist when last track deleted', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const trackId = service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId }))

    service.deleteMusicTrack(trackId)

    const artist = (service as any).db.prepare('SELECT * FROM music_artists WHERE id = ?').get(artistId)
    expect(artist).toBeUndefined()
  })
})

// ============================================================================
// WISHLIST
// ============================================================================
describe('BetterSQLiteService — Wishlist', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('addWishlistItem returns ID with active status', () => {
    const id = service.addWishlistItem({
      title: 'Wanted Movie',
      media_type: 'movie',
    } as any)
    expect(id).toBeGreaterThan(0)
    const items = service.getWishlistItems({})
    expect(items.some((i: any) => i.title === 'Wanted Movie' && i.status === 'active')).toBe(true)
  })

  it('getWishlistItems filters by status', () => {
    service.addWishlistItem({ title: 'Active', media_type: 'movie' } as any)
    const items = service.getWishlistItems({ status: 'active' })
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items.every((i: any) => i.status === 'active')).toBe(true)
  })
})

// ============================================================================
// NOTIFICATIONS
// ============================================================================
describe('BetterSQLiteService — Notifications', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
  })

  it('createNotification and getNotifications round-trip', () => {
    service.createNotification({
      type: 'info',
      title: 'Test Alert',
      message: 'Something happened',
    })
    const notifications = service.getNotifications({})
    expect(notifications.some((n: any) => n.title === 'Test Alert')).toBe(true)
  })

  it('markNotificationsRead updates is_read', () => {
    service.createNotification({
      type: 'info',
      title: 'Unread',
      message: 'msg',
    })
    const all = service.getNotifications({})
    const ids = all.map((n: any) => n.id)
    service.markNotificationsRead(ids)

    const unread = service.getUnreadNotifications()
    expect(unread.filter((n: any) => n.title === 'Unread')).toHaveLength(0)
  })
})

// ============================================================================
// EXCLUSIONS
// ============================================================================
describe('BetterSQLiteService — Exclusions', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
  })

  it('addExclusion and isExcluded round-trip', () => {
    service.addExclusion('media_upgrade', '123', 'ref-key', 'parent', 'Title')
    const excluded = service.isExcluded('media_upgrade', '123', 'ref-key', 'parent')
    expect(excluded).toBe(true)
  })

  it('removeExclusion makes isExcluded return false', () => {
    service.addExclusion('collection_movie', '456', 'ref', 'parent', 'Movie')
    const exclusions = service.getExclusions('collection_movie', 'parent')
    expect(exclusions.length).toBeGreaterThan(0)

    service.removeExclusion(exclusions[0].id)
    expect(service.isExcluded('collection_movie', '456', 'ref', 'parent')).toBe(false)
  })

  it('getExclusions filters by type and parentKey', () => {
    service.addExclusion('media_upgrade', '1', 'a', 'parent1', 'T1')
    service.addExclusion('media_upgrade', '2', 'b', 'parent2', 'T2')
    service.addExclusion('collection_movie', '3', 'c', 'parent1', 'T3')

    const result = service.getExclusions('media_upgrade', 'parent1')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('T1')
  })
})

// ============================================================================
// BATCH MODE
// ============================================================================
describe('BetterSQLiteService — Batch Mode', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
  })

  it('startBatch/endBatch are reentrant', async () => {
    service.startBatch()
    service.startBatch()
    await service.endBatch()
    // Still in batch (depth = 1)
    await service.endBatch()
    // Now fully ended (depth = 0)
  })

  it('endBatch below zero does not crash', async () => {
    await service.endBatch()
    await service.endBatch()
    // Should not throw
  })
})

// ============================================================================
// RESET LIBRARY DATA
// ============================================================================
describe('BetterSQLiteService — resetLibraryData', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('clears media data but preserves settings, sources, exclusions', () => {
    // Add data across categories
    service.setSetting('keep_me', 'yes')
    service.upsertMediaItem(makeMediaItem())
    service.addExclusion('media_upgrade', '1', 'ref', 'parent', 'Title')

    service.resetLibraryData()

    // Settings preserved
    expect(service.getSetting('keep_me')).toBe('yes')
    // Source preserved
    const sources = service.getMediaSources()
    expect(sources.length).toBe(1)
    // Exclusions preserved
    expect(service.isExcluded('media_upgrade', '1', 'ref', 'parent')).toBe(true)
    // Media items cleared
    expect(service.countMediaItems({})).toBe(0)
  })
})
