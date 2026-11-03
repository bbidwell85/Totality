import { ipcMain } from 'electron'
import { getBarcodeLookupService } from '../services/BarcodeLookupService'
import { validateInput } from '../validation/schemas'
import { z } from 'zod/v4'

const BarcodeSchema = z.string().min(8).max(20).regex(/^\d+$/)

export function registerBarcodeHandlers(): void {
  ipcMain.handle('barcode:lookup', async (_event, barcode: unknown) => {
    try {
      const validBarcode = validateInput(BarcodeSchema, barcode, 'barcode:lookup')
      const service = getBarcodeLookupService()
      return await service.lookup(validBarcode)
    } catch (error) {
      console.error('[barcode:lookup] Error:', error)
      throw error
    }
  })
}
