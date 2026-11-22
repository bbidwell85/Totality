import { afterEach, expect, test, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetterSQLiteService } from '../src/main/database/BetterSQLiteService'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let temporaryDirectory: string | undefined

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = undefined
  }
})

test('upgrades a real upstream 0.4.2 database and preserves user data', () => {
  const schemaSource = readFileSync('legacy/src/main/database/schema.ts', 'utf8')
  const schema = schemaSource.split('`')[1]
  expect(schemaSource.split('`')).toHaveLength(3)

  temporaryDirectory = mkdtempSync(join(tmpdir(), 'totality-upgrade-'))
  const databasePath = join(temporaryDirectory, 'totality-v2.db')

  const original = new Database(databasePath)
  try {
    original.exec(schema)
    original.prepare(
      'INSERT INTO media_sources (source_id, source_type, display_name) VALUES (?, ?, ?)',
    ).run('upgrade-source', 'plex', 'Legacy Source')
    original.prepare(`INSERT INTO media_items (
      source_id, source_type, library_id, plex_id, title, type,
      file_path, file_size, duration, resolution, width, height,
      video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'upgrade-source', 'plex', 'films', 'legacy-film',
      'Persisted Movie', 'movie', '/legacy/movie.mkv', 12345,
      7200, '1080p', 1920, 1080, 'H264', 6000, 'AAC', 2, 192,
    )
    original.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'upgrade_integrity_sentinel', 'retained',
    )
  } finally {
    original.close()
  }

  const service = new BetterSQLiteService(databasePath)
  try {
    service.initialize()
  } finally {
    service.close()
  }

  const upgraded = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    expect(upgraded.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    expect(upgraded.pragma('foreign_key_check')).toEqual([])
    expect(upgraded.prepare(
      "SELECT value FROM settings WHERE key = 'upgrade_integrity_sentinel'",
    ).get()).toEqual({ value: 'retained' })
    expect(upgraded.prepare(
      'SELECT source_id, display_name FROM media_sources WHERE source_id = ?',
    ).get('upgrade-source')).toEqual({
      source_id: 'upgrade-source', display_name: 'Legacy Source',
    })
    expect(upgraded.prepare(
      'SELECT plex_id, title, file_path FROM media_items WHERE source_id = ?',
    ).get('upgrade-source')).toEqual({
      plex_id: 'legacy-film', title: 'Persisted Movie', file_path: '/legacy/movie.mkv',
    })
    expect(upgraded.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get('idx_wishlist_items_status')).toEqual({ name: 'idx_wishlist_items_status' })
  } finally {
    upgraded.close()
  }
})

test('global TV search returns the series TMDB identity using production SQLite and FTS5', () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'totality-global-search-'))
  const databasePath = join(temporaryDirectory, 'totality-v2.db')
  const service = new BetterSQLiteService(databasePath)

  try {
    service.initialize()
    const database = new Database(databasePath)
    try {
      database.prepare(`INSERT INTO media_sources (source_id, source_type, display_name)
        VALUES (?, ?, ?)`).run('search-source', 'plex', 'Search Source')
      database.prepare(`INSERT INTO media_items (
        source_id, source_type, plex_id, title, type, file_path, series_title,
        file_size, duration, resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate, season_number, episode_number,
        tmdb_id, series_tmdb_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('search-source', 'plex', 'episode-1', 'Pilot', 'episode', '/shows/example-s01e01.mkv', 'Example Series',
          1, 3600, '1080p', 1920, 1080, 'H264', 5000, 'AAC', 2, 192, 1, 1, '111', '999')
    } finally {
      database.close()
    }

    const results = service.globalSearch('Example Series')
    expect(results.tvShows).toHaveLength(1)
    expect(results.tvShows[0].tmdb_id).toBe('999')
  } finally {
    service.close()
  }
})
