import { describe, it, expect } from 'vitest'
import { getArtistAlbumsCombined } from '@main/services/utils/musicUtils'

describe('musicUtils', () => {
  describe('getArtistAlbumsCombined', () => {
    it('returns empty when both queries return empty', () => {
      const db = {
        getMusicAlbums: () => [],
        getMusicAlbumsByArtistName: () => [],
      }
      expect(getArtistAlbumsCombined(db, 1, 'Artist')).toEqual([])
    })

    it('returns albums found by FK only', () => {
      const albums = [{ id: 1, name: 'Album A' }]
      const db = {
        getMusicAlbums: () => albums,
        getMusicAlbumsByArtistName: () => [],
      }
      expect(getArtistAlbumsCombined(db, 1, 'Artist')).toEqual(albums)
    })

    it('returns albums found by name only', () => {
      const albums = [{ id: 2, name: 'Album B' }]
      const db = {
        getMusicAlbums: () => [],
        getMusicAlbumsByArtistName: () => albums,
      }
      expect(getArtistAlbumsCombined(db, 1, 'Artist')).toEqual(albums)
    })

    it('deduplicates albums from both queries by id', () => {
      const album = { id: 1, name: 'Album A' }
      const db = {
        getMusicAlbums: () => [album],
        getMusicAlbumsByArtistName: () => [album],
      }
      expect(getArtistAlbumsCombined(db, 1, 'Artist')).toHaveLength(1)
    })

    it('merges non-overlapping albums', () => {
      const db = {
        getMusicAlbums: () => [{ id: 1, name: 'A' }],
        getMusicAlbumsByArtistName: () => [{ id: 2, name: 'B' }],
      }
      expect(getArtistAlbumsCombined(db, 1, 'Artist')).toHaveLength(2)
    })

    it('filters out albums without id', () => {
      const db = {
        getMusicAlbums: () => [{ id: undefined, name: 'No ID' }],
        getMusicAlbumsByArtistName: () => [{ id: 1, name: 'Has ID' }],
      }
      expect(getArtistAlbumsCombined(db, 1, 'Artist')).toHaveLength(1)
      expect(getArtistAlbumsCombined(db, 1, 'Artist')[0].name).toBe('Has ID')
    })
  })
})
