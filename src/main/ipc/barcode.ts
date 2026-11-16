import { ipcMain } from 'electron'
import { getBarcodeLookupService } from '../services/BarcodeLookupService'
import type { BarcodeResult } from '../services/BarcodeLookupService'
import { getDatabase } from '../database/getDatabase'
import { validateInput } from '../validation/schemas'
import { z } from 'zod/v4'

const BarcodeSchema = z.string().min(8).max(20).regex(/^\d+$/)

export function registerBarcodeHandlers(): void {
  ipcMain.handle('barcode:lookup', async (_event, barcode: unknown) => {
    try {
      const validBarcode = validateInput(BarcodeSchema, barcode, 'barcode:lookup')
      const service = getBarcodeLookupService()
      const results = await service.lookup(validBarcode)

      // Enrich results with ownership and quality data
      const db = getDatabase()
      for (const result of results) {
        enrichWithOwnership(db, result)
      }

      return results
    } catch (error) {
      console.error('[barcode:lookup] Error:', error)
      throw error
    }
  })
}

function enrichWithOwnership(db: ReturnType<typeof getDatabase>, result: BarcodeResult): void {
  try {
    if ((result.type === 'movie' || result.type === 'tv') && result.tmdb_id) {
      const items = db.getMediaItemsByTmdbIds([String(result.tmdb_id)])
      const item = items.get(String(result.tmdb_id))
      if (item) {
        result.owned = true
        const score = db.getQualityScore(item.id!)
        result.quality_tier = score?.quality_tier || undefined
        result.tier_quality = score?.tier_quality || undefined
      }
    } else if (result.type === 'album' && result.musicbrainz_id) {
      const albums = db.getMusicAlbumsByMusicbrainzIds([result.musicbrainz_id])
      const album = albums.get(result.musicbrainz_id)
      if (album) {
        result.owned = true
        const qualityScore = db.getMusicQualityScore(album.id!)
        if (qualityScore) {
          result.quality_tier = qualityScore.quality_tier || undefined
        }
      }
    }
  } catch (err) {
    console.warn('[barcode:lookup] Ownership check failed:', (err as Error).message)
  }
}
