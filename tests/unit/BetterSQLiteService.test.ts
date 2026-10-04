/**
 * BetterSQLiteService SQL Tests
 *
 * Tests database operations using sql.js (WASM) as a stand-in for better-sqlite3.
 * Verifies SQL correctness, constraint enforcement, and data integrity.
 *
 * These tests run the SAME SQL queries that BetterSQLiteService uses,
 * against a real in-memory SQLite database with the full schema.
 */

import { createTestDatabase, type TestDatabase } from '../helpers/testDatabase'

// Unmock sql.js — we need the real implementation for test databases
vi.unmock('sql.js')

let db: TestDatabase

beforeEach(async () => {
  db = await createTestDatabase()
})

afterEach(() => {
  db.close()
})

// =============================================================================
// SETTINGS
// =============================================================================

describe('Settings', () => {
  it('setSetting and getSetting round-trip', () => {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    ).run('test_key', 'test_value')

    const result = db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).get('test_key') as { value: string } | undefined

    expect(result?.value).toBe('test_value')
  })

  it('setSetting overwrites existing value', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('key1', 'value1')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('key1', 'value2')

    const result = db.prepare('SELECT value FROM settings WHERE key = ?').get('key1') as { value: string }
    expect(result.value).toBe('value2')
  })

  it('deleteSetting removes the row', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('to_delete', 'val')
    db.prepare('DELETE FROM settings WHERE key = ?').run('to_delete')

    const result = db.prepare('SELECT value FROM settings WHERE key = ?').get('to_delete')
    expect(result).toBeUndefined()
  })

  it('getAllSettings returns all entries', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('k1', 'v1')
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('k2', 'v2')

    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    // Schema inserts default settings, so just check ours are present
    expect(rows.some(r => r.key === 'k1' && r.value === 'v1')).toBe(true)
    expect(rows.some(r => r.key === 'k2' && r.value === 'v2')).toBe(true)
  })

  it('settings value NOT NULL constraint prevents null', () => {
    expect(() => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('bad', null)
    }).toThrow()
  })
})

// =============================================================================
// MEDIA ITEMS
// =============================================================================

describe('Media Items', () => {
  const insertSource = () => {
    db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
      VALUES (?, ?, ?, ?)
    `).run('src1', 'plex', 'Test Plex', '{}')
  }

  const insertMediaItem = (plex_id: string, title: string, type: string, overrides: Record<string, unknown> = {}) => {
    const defaults = {
      source_id: 'src1', source_type: 'plex', library_id: 'lib1',
      file_path: `/media/${title}.mkv`, file_size: 1000000, duration: 7200000,
      resolution: '1080p', width: 1920, height: 1080,
      video_codec: 'HEVC', video_bitrate: 5000,
      audio_codec: 'AAC', audio_channels: 2, audio_bitrate: 320,
      ...overrides,
    }
    return db.prepare(`
      INSERT INTO media_items (
        source_id, source_type, library_id, plex_id, title, type,
        file_path, file_size, duration, resolution, width, height,
        video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      defaults.source_id, defaults.source_type, defaults.library_id,
      plex_id, title, type,
      defaults.file_path, defaults.file_size, defaults.duration,
      defaults.resolution, defaults.width, defaults.height,
      defaults.video_codec, defaults.video_bitrate,
      defaults.audio_codec, defaults.audio_channels, defaults.audio_bitrate
    )
  }

  beforeEach(() => {
    insertSource()
  })

  it('inserts a new media item', () => {
    insertMediaItem('p1', 'Test Movie', 'movie')
    const item = db.prepare('SELECT * FROM media_items WHERE plex_id = ?').get('p1') as Record<string, unknown>
    expect(item).toBeDefined()
    expect(item.title).toBe('Test Movie')
    expect(item.type).toBe('movie')
    expect(item.source_id).toBe('src1')
  })

  it('unique constraint on (source_id, plex_id)', () => {
    insertMediaItem('p1', 'Movie A', 'movie')
    // Same source_id + plex_id should conflict
    expect(() => {
      insertMediaItem('p1', 'Movie B', 'movie')
    }).toThrow()
  })

  it('different sources can have same plex_id', () => {
    db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
      VALUES (?, ?, ?, ?)
    `).run('src2', 'plex', 'Other Plex', '{}')

    insertMediaItem('p1', 'Movie A', 'movie', { source_id: 'src1' })
    insertMediaItem('p1', 'Movie B', 'movie', { source_id: 'src2' })

    const items = db.prepare('SELECT * FROM media_items WHERE plex_id = ?').all('p1')
    expect(items.length).toBe(2)
  })

  it('deleteMediaItem removes item and cascades to quality_scores', () => {
    const result = insertMediaItem('p1', 'Movie', 'movie')
    const itemId = result.lastInsertRowid

    // Add quality score
    db.prepare(`
      INSERT INTO quality_scores (media_item_id, quality_tier, tier_quality, tier_score, overall_score, needs_upgrade,
        bitrate_tier_score, audio_tier_score, resolution_score, bitrate_score, audio_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, '1080p', 'HIGH', 85, 85, 0, 85, 80, 100, 85, 80)

    // Delete media item
    db.prepare('DELETE FROM media_items WHERE id = ?').run(itemId)

    // Quality score should be cascaded
    const qs = db.prepare('SELECT * FROM quality_scores WHERE media_item_id = ?').get(itemId)
    expect(qs).toBeUndefined()
  })

  it('getMediaItems filters by type', () => {
    insertMediaItem('p1', 'Movie 1', 'movie')
    insertMediaItem('p2', 'Episode 1', 'episode')

    const movies = db.prepare("SELECT * FROM media_items WHERE type = ?").all('movie')
    expect(movies.length).toBe(1)
    expect((movies[0] as Record<string, unknown>).title).toBe('Movie 1')
  })

  it('getMediaItems filters by sourceId', () => {
    db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
      VALUES (?, ?, ?, ?)
    `).run('src2', 'jellyfin', 'Jellyfin', '{}')

    insertMediaItem('p1', 'Plex Movie', 'movie', { source_id: 'src1' })
    insertMediaItem('p2', 'Jellyfin Movie', 'movie', { source_id: 'src2' })

    const items = db.prepare("SELECT * FROM media_items WHERE source_id = ?").all('src1')
    expect(items.length).toBe(1)
  })

  it('sort by title with id tie-breaker is deterministic', () => {
    insertMediaItem('p1', 'Same Title', 'movie')
    insertMediaItem('p2', 'Same Title', 'movie')

    const items = db.prepare(
      "SELECT id, title FROM media_items ORDER BY title ASC, id ASC"
    ).all() as Array<{ id: number; title: string }>

    expect(items.length).toBe(2)
    expect(items[0].id).toBeLessThan(items[1].id)
  })
})

// =============================================================================
// SERIES COMPLETENESS
// =============================================================================

describe('Series Completeness', () => {
  it('upsert with library_id scoping', () => {
    db.prepare(`
      INSERT INTO series_completeness (series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Breaking Bad', 'src1', 'lib1', 5, 62, 5, 62, '[]', '[]', 100)

    // Same title, same source, DIFFERENT library — should be separate record
    db.prepare(`
      INSERT INTO series_completeness (series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Breaking Bad', 'src1', 'lib2', 5, 62, 3, 30, '[]', '[]', 48)

    const records = db.prepare(
      'SELECT * FROM series_completeness WHERE series_title = ?'
    ).all('Breaking Bad')

    expect(records.length).toBe(2)
  })

  it('unique constraint on (series_title, source_id, library_id)', () => {
    db.prepare(`
      INSERT INTO series_completeness (series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Show A', 'src1', 'lib1', 1, 10, 1, 10, '[]', '[]', 100)

    // Same key should conflict
    expect(() => {
      db.prepare(`
        INSERT INTO series_completeness (series_title, source_id, library_id, total_seasons, total_episodes,
          owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('Show A', 'src1', 'lib1', 1, 10, 1, 10, '[]', '[]', 100)
    }).toThrow()
  })
})

// =============================================================================
// MOVIE COLLECTIONS
// =============================================================================

describe('Movie Collections', () => {
  it('unique constraint on (tmdb_collection_id, source_id, library_id)', () => {
    db.prepare(`
      INSERT INTO movie_collections (tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, owned_movie_ids, completeness_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('123', 'MCU', 'src1', 'lib1', 30, 15, '[]', '[]', 50)

    expect(() => {
      db.prepare(`
        INSERT INTO movie_collections (tmdb_collection_id, collection_name, source_id, library_id,
          total_movies, owned_movies, missing_movies, owned_movie_ids, completeness_percentage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('123', 'MCU', 'src1', 'lib1', 30, 15, '[]', '[]', 50)
    }).toThrow()
  })

  it('NOT NULL DEFAULT empty string for source_id and library_id', () => {
    db.prepare(`
      INSERT INTO movie_collections (tmdb_collection_id, collection_name,
        total_movies, owned_movies, missing_movies, owned_movie_ids, completeness_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('456', 'Collection', 3, 2, '[]', '[]', 67)

    const coll = db.prepare(
      'SELECT source_id, library_id FROM movie_collections WHERE tmdb_collection_id = ?'
    ).get('456') as Record<string, unknown>

    expect(coll.source_id).toBe('')
    expect(coll.library_id).toBe('')
  })
})

// =============================================================================
// EXCLUSIONS
// =============================================================================

describe('Exclusions', () => {
  it('add and check exclusion', () => {
    db.prepare(`
      INSERT INTO exclusions (exclusion_type, reference_id, title)
      VALUES (?, ?, ?)
    `).run('media_upgrade', 42, 'Some Movie')

    const result = db.prepare(
      'SELECT * FROM exclusions WHERE exclusion_type = ? AND reference_id = ?'
    ).get('media_upgrade', 42)

    expect(result).toBeDefined()
  })

  it('removeExclusion deletes the row', () => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO exclusions (exclusion_type, reference_key, title)
      VALUES (?, ?, ?)
    `).run('collection_movie', 'tmdb:123', 'Movie')

    db.prepare('DELETE FROM exclusions WHERE id = ?').run(lastInsertRowid)

    const result = db.prepare('SELECT * FROM exclusions WHERE id = ?').get(lastInsertRowid)
    expect(result).toBeUndefined()
  })
})

// =============================================================================
// RESET
// =============================================================================

describe('Reset Operations', () => {
  it('resetLibraryData clears media but preserves settings and exclusions', () => {
    // Insert settings
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('api_key', 'secret123')

    // Insert exclusion
    db.prepare(`
      INSERT INTO exclusions (exclusion_type, reference_key, title)
      VALUES (?, ?, ?)
    `).run('media_upgrade', 'test', 'Excluded Movie')

    // Insert source
    db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
      VALUES (?, ?, ?, ?)
    `).run('src1', 'plex', 'My Plex', '{}')

    // Insert media item
    db.prepare(`
      INSERT INTO media_items (source_id, source_type, plex_id, title, type, file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'p1', 'Movie', 'movie', '/f.mkv', 1000, 7200, '1080p', 1920, 1080, 'HEVC', 5000, 'AAC', 2, 320)

    // Simulate resetLibraryData — clear library tables but keep settings/exclusions/sources
    const libraryTables = [
      'quality_scores', 'media_item_versions', 'media_item_collections',
      'media_items', 'series_completeness', 'movie_collections',
      'music_tracks', 'music_albums', 'music_artists',
      'music_quality_scores', 'artist_completeness', 'album_completeness',
      'person_completeness', 'notifications', 'library_scans',
    ]
    for (const table of libraryTables) {
      try { db.prepare(`DELETE FROM ${table}`).run() } catch { /* table may not exist */ }
    }

    // Verify: settings preserved
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('api_key') as { value: string }
    expect(setting.value).toBe('secret123')

    // Verify: exclusions preserved
    const exclusions = db.prepare('SELECT * FROM exclusions').all()
    expect(exclusions.length).toBe(1)

    // Verify: sources preserved
    const sources = db.prepare('SELECT * FROM media_sources').all()
    expect(sources.length).toBe(1)

    // Verify: media items cleared
    const items = db.prepare('SELECT * FROM media_items').all()
    expect(items.length).toBe(0)
  })
})

// =============================================================================
// CLEANUP
// =============================================================================

describe('Cleanup Operations', () => {
  it('orphaned quality_scores deleted when media_item removed', () => {
    // Insert source + media item
    db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
      VALUES (?, ?, ?, ?)
    `).run('src1', 'plex', 'Plex', '{}')

    const { lastInsertRowid: itemId } = db.prepare(`
      INSERT INTO media_items (source_id, source_type, plex_id, title, type, file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'p1', 'Movie', 'movie', '/f.mkv', 1000, 7200, '1080p', 1920, 1080, 'HEVC', 5000, 'AAC', 2, 320)

    db.prepare(`
      INSERT INTO quality_scores (media_item_id, quality_tier, tier_quality, tier_score, overall_score, needs_upgrade,
        bitrate_tier_score, audio_tier_score, resolution_score, bitrate_score, audio_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, '1080p', 'HIGH', 85, 85, 0, 85, 80, 100, 85, 80)

    // Delete the item — FK cascade should remove quality_scores
    db.prepare('DELETE FROM media_items WHERE id = ?').run(itemId)

    const orphans = db.prepare(
      'DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)'
    ).run()
    expect(orphans.changes).toBe(0) // No orphans — cascade handled it
  })

  it('series cleanup only removes truly orphaned records', () => {
    // Insert series completeness for two different sources
    db.prepare(`
      INSERT INTO series_completeness (series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Show X', 'src1', 'lib1', 1, 10, 1, 10, '[]', '[]', 100)

    db.prepare(`
      INSERT INTO series_completeness (series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Orphan Show', 'src2', 'lib2', 1, 10, 0, 0, '[]', '[]', 0)

    // The "NOT EXISTS" cleanup should only remove records with no matching episodes
    const deleted = db.prepare(`
      DELETE FROM series_completeness WHERE id IN (
        SELECT sc.id FROM series_completeness sc
        WHERE NOT EXISTS (
          SELECT 1 FROM media_items mi
          WHERE mi.series_title = sc.series_title AND mi.type = 'episode'
        )
      )
    `).run()

    // Both should be deleted since neither has media_items
    expect(deleted.changes).toBe(2)
  })
})

// =============================================================================
// SCHEMA CONSTRAINTS
// =============================================================================

describe('Schema Constraints', () => {
  it('media_sources source_type CHECK constraint', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
        VALUES (?, ?, ?, ?)
      `).run('bad', 'invalid_type', 'Bad', '{}')
    }).toThrow()
  })

  it('media_sources allows all valid provider types', () => {
    const types = ['plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'kodi-mysql', 'local', 'mediamonkey']
    for (const type of types) {
      db.prepare(`
        INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
        VALUES (?, ?, ?, ?)
      `).run(`src_${type}`, type, `Test ${type}`, '{}')
    }

    const sources = db.prepare('SELECT * FROM media_sources').all()
    expect(sources.length).toBe(types.length)
  })

  it('settings key is UNIQUE', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('unique_key', 'val1')
    expect(() => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('unique_key', 'val2')
    }).toThrow()
  })
})

// =============================================================================
// MUSIC
// =============================================================================

describe('Music Operations', () => {
  beforeEach(() => {
    db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
      VALUES (?, ?, ?, ?)
    `).run('src1', 'plex', 'Plex', '{}')
  })

  it('upsert artist and retrieve by name', () => {
    db.prepare(`
      INSERT INTO music_artists (source_id, source_type, provider_id, name, sort_name, track_count, album_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'artist1', 'Radiohead', 'radiohead', 150, 9)

    const artist = db.prepare(
      'SELECT * FROM music_artists WHERE name = ? AND source_id = ?'
    ).get('Radiohead', 'src1') as Record<string, unknown>

    expect(artist).toBeDefined()
    expect(artist.name).toBe('Radiohead')
    expect(artist.track_count).toBe(150)
  })

  it('unique constraint on (source_id, provider_id) for artists', () => {
    db.prepare(`
      INSERT INTO music_artists (source_id, source_type, provider_id, name, sort_name, track_count, album_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'a1', 'Artist A', 'artist a', 10, 1)

    expect(() => {
      db.prepare(`
        INSERT INTO music_artists (source_id, source_type, provider_id, name, sort_name, track_count, album_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('src1', 'plex', 'a1', 'Different Name', 'different', 5, 1)
    }).toThrow()
  })

  it('upsert album linked to artist', () => {
    const { lastInsertRowid: artistId } = db.prepare(`
      INSERT INTO music_artists (source_id, source_type, provider_id, name, sort_name, track_count, album_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'a1', 'Artist', 'artist', 10, 1)

    db.prepare(`
      INSERT INTO music_albums (source_id, source_type, provider_id, title, sort_title, artist_id, artist_name, track_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'al1', 'OK Computer', 'ok computer', artistId, 'Artist', 12)

    const album = db.prepare('SELECT * FROM music_albums WHERE title = ?').get('OK Computer') as Record<string, unknown>
    expect(album).toBeDefined()
    expect(album.artist_id).toBe(artistId)
  })

  it('upsert track linked to album and artist', () => {
    const { lastInsertRowid: artistId } = db.prepare(`
      INSERT INTO music_artists (source_id, source_type, provider_id, name, sort_name, track_count, album_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'a1', 'Artist', 'artist', 10, 1)

    const { lastInsertRowid: albumId } = db.prepare(`
      INSERT INTO music_albums (source_id, source_type, provider_id, title, sort_title, artist_id, artist_name, track_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 'al1', 'Album', 'album', artistId, 'Artist', 10)

    db.prepare(`
      INSERT INTO music_tracks (source_id, source_type, provider_id, title, artist_id, artist_name, album_id, album_name,
        audio_codec, audio_bitrate, duration, file_size, file_path, track_number, disc_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('src1', 'plex', 't1', 'Paranoid Android', artistId, 'Artist', albumId, 'Album',
      'flac', 1411, 387000, 50000000, '/music/track.flac', 2, 1)

    const track = db.prepare('SELECT * FROM music_tracks WHERE title = ?').get('Paranoid Android') as Record<string, unknown>
    expect(track).toBeDefined()
    expect(track.album_id).toBe(albumId)
    expect(track.audio_codec).toBe('flac')
  })
})

// =============================================================================
// WISHLIST
// =============================================================================

describe('Wishlist Operations', () => {
  it('add and retrieve wishlist item', () => {
    db.prepare(`
      INSERT INTO wishlist_items (title, media_type, priority, reason, tmdb_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('Dune: Part Three', 'movie', 5, 'missing', '12345')

    const items = db.prepare('SELECT * FROM wishlist_items').all()
    expect(items.length).toBe(1)
    expect((items[0] as Record<string, unknown>).title).toBe('Dune: Part Three')
  })

  it('status defaults to active', () => {
    db.prepare(`
      INSERT INTO wishlist_items (title, media_type, priority, reason)
      VALUES (?, ?, ?, ?)
    `).run('Movie', 'movie', 3, 'missing')

    const item = db.prepare('SELECT status FROM wishlist_items').get() as Record<string, unknown>
    expect(item.status).toBe('active')
  })

  it('status CHECK constraint allows only active/completed', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO wishlist_items (title, media_type, priority, reason, status)
        VALUES (?, ?, ?, ?, ?)
      `).run('Movie', 'movie', 3, 'missing', 'invalid_status')
    }).toThrow()
  })
})

// =============================================================================
// NOTIFICATIONS
// =============================================================================

describe('Notification Operations', () => {
  it('create and retrieve notification', () => {
    db.prepare(`
      INSERT INTO notifications (type, title, message)
      VALUES (?, ?, ?)
    `).run('info', 'Test Title', 'Test message')

    const notifs = db.prepare('SELECT * FROM notifications').all()
    expect(notifs.length).toBe(1)
    expect((notifs[0] as Record<string, unknown>).title).toBe('Test Title')
    expect((notifs[0] as Record<string, unknown>).is_read).toBe(0)
  })

  it('defaults is_read to 0', () => {
    db.prepare(`
      INSERT INTO notifications (type, title, message)
      VALUES (?, ?, ?)
    `).run('scan_complete', 'Scan Done', 'Details')

    const notif = db.prepare('SELECT is_read FROM notifications').get() as Record<string, unknown>
    expect(notif.is_read).toBe(0)
  })
})

// =============================================================================
// LIBRARY SCANS
// =============================================================================

describe('Library Scan Operations', () => {
  beforeEach(() => {
    db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
      VALUES (?, ?, ?, ?)
    `).run('src1', 'plex', 'Plex', '{}')
  })

  it('tracks scan time per library', () => {
    db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
      VALUES (?, ?, ?, ?, datetime('now'), ?)
    `).run('src1', 'lib1', 'Movies', 'movie', 500)

    const scan = db.prepare(
      'SELECT * FROM library_scans WHERE source_id = ? AND library_id = ?'
    ).get('src1', 'lib1') as Record<string, unknown>

    expect(scan).toBeDefined()
    expect(scan.items_scanned).toBe(500)
  })

  it('unique constraint on (source_id, library_id)', () => {
    db.prepare(`
      INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
      VALUES (?, ?, ?, ?, datetime('now'), ?)
    `).run('src1', 'lib1', 'Movies', 'movie', 100)

    expect(() => {
      db.prepare(`
        INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
      `).run('src1', 'lib1', 'Movies', 'movie', 200)
    }).toThrow()
  })
})
