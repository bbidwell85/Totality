import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { getDatabaseService } from '../services/DatabaseService'
import { getStoreSearchService } from '../services/StoreSearchService'
import type { WishlistItem, WishlistFilters } from '../types/database'
import type { StoreRegion } from '../services/StoreSearchService'

// Valid enum values for validation
const VALID_MEDIA_TYPES = ['movie', 'episode', 'season', 'album', 'track']
const VALID_REASONS = ['missing', 'upgrade']

/**
 * Validate a wishlist item before adding
 */
function validateWishlistItem(item: Partial<WishlistItem>): void {
  // Title is required and must be non-empty
  if (!item.title || typeof item.title !== 'string' || item.title.trim() === '') {
    throw new Error('Title is required and must be a non-empty string')
  }

  // Media type must be valid
  if (!item.media_type || !VALID_MEDIA_TYPES.includes(item.media_type)) {
    throw new Error(`Invalid media_type: must be one of ${VALID_MEDIA_TYPES.join(', ')}`)
  }

  // Priority must be 1-5 if provided
  if (item.priority !== undefined && (typeof item.priority !== 'number' || item.priority < 1 || item.priority > 5)) {
    throw new Error('Priority must be a number between 1 and 5')
  }

  // Reason must be valid if provided
  if (item.reason && !VALID_REASONS.includes(item.reason)) {
    throw new Error(`Invalid reason: must be one of ${VALID_REASONS.join(', ')}`)
  }
}

/**
 * Sanitize a wishlist item (trim strings, etc.)
 */
function sanitizeWishlistItem(item: Partial<WishlistItem>): Partial<WishlistItem> {
  const sanitized = { ...item }

  // Trim string fields
  if (sanitized.title) sanitized.title = sanitized.title.trim()
  if (sanitized.notes) sanitized.notes = sanitized.notes.trim()
  if (sanitized.subtitle) sanitized.subtitle = sanitized.subtitle.trim()
  if (sanitized.series_title) sanitized.series_title = sanitized.series_title.trim()
  if (sanitized.artist_name) sanitized.artist_name = sanitized.artist_name.trim()
  if (sanitized.album_title) sanitized.album_title = sanitized.album_title.trim()
  if (sanitized.collection_name) sanitized.collection_name = sanitized.collection_name.trim()

  return sanitized
}

/**
 * Register all wishlist-related IPC handlers
 */
export function registerWishlistHandlers() {
  const db = getDatabaseService()
  const storeService = getStoreSearchService()

  // ============================================================================
  // WISHLIST CRUD
  // ============================================================================

  /**
   * Add an item to the wishlist
   */
  ipcMain.handle('wishlist:add', async (_event, item: Partial<WishlistItem>) => {
    try {
      // Validate input
      validateWishlistItem(item)

      // Sanitize input
      const sanitizedItem = sanitizeWishlistItem(item)

      return await db.addWishlistItem(sanitizedItem)
    } catch (error) {
      console.error('Error adding wishlist item:', error)
      throw error
    }
  })

  /**
   * Update a wishlist item
   */
  ipcMain.handle('wishlist:update', async (_event, id: number, updates: Partial<WishlistItem>) => {
    try {
      await db.updateWishlistItem(id, updates)
      return { success: true }
    } catch (error) {
      console.error('Error updating wishlist item:', error)
      throw error
    }
  })

  /**
   * Remove an item from the wishlist
   */
  ipcMain.handle('wishlist:remove', async (_event, id: number) => {
    try {
      await db.removeWishlistItem(id)
      return { success: true }
    } catch (error) {
      console.error('Error removing wishlist item:', error)
      throw error
    }
  })

  /**
   * Get all wishlist items with optional filters
   */
  ipcMain.handle('wishlist:getAll', async (_event, filters?: WishlistFilters) => {
    try {
      return db.getWishlistItems(filters)
    } catch (error) {
      console.error('Error getting wishlist items:', error)
      throw error
    }
  })

  /**
   * Get a single wishlist item by ID
   */
  ipcMain.handle('wishlist:getById', async (_event, id: number) => {
    try {
      return db.getWishlistItemById(id)
    } catch (error) {
      console.error('Error getting wishlist item:', error)
      throw error
    }
  })

  /**
   * Get the total count of wishlist items
   */
  ipcMain.handle('wishlist:getCount', async () => {
    try {
      return db.getWishlistCount()
    } catch (error) {
      console.error('Error getting wishlist count:', error)
      throw error
    }
  })

  /**
   * Check if an item already exists in the wishlist
   */
  ipcMain.handle('wishlist:checkExists', async (_event, tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) => {
    try {
      return db.wishlistItemExists(tmdbId, musicbrainzId, mediaItemId)
    } catch (error) {
      console.error('Error checking wishlist existence:', error)
      throw error
    }
  })

  /**
   * Get wishlist counts by reason (missing vs upgrade)
   */
  ipcMain.handle('wishlist:getCountsByReason', async () => {
    try {
      return db.getWishlistCountsByReason()
    } catch (error) {
      console.error('Error getting wishlist counts by reason:', error)
      throw error
    }
  })

  /**
   * Add multiple items to the wishlist (bulk operation)
   */
  ipcMain.handle('wishlist:addBulk', async (_event, items: Partial<WishlistItem>[]) => {
    try {
      // Validate and sanitize all items
      const sanitizedItems = items.map(item => {
        validateWishlistItem(item)
        return sanitizeWishlistItem(item)
      })

      const added = await db.addWishlistItemsBulk(sanitizedItems)
      return { success: true, added }
    } catch (error) {
      console.error('Error bulk adding wishlist items:', error)
      throw error
    }
  })

  // ============================================================================
  // STORE SEARCH
  // ============================================================================

  /**
   * Get store search links for a wishlist item
   */
  ipcMain.handle('wishlist:getStoreLinks', async (_event, item: WishlistItem) => {
    try {
      return storeService.getStoreLinks(item)
    } catch (error) {
      console.error('Error getting store links:', error)
      throw error
    }
  })

  /**
   * Open a store link in the default browser
   * SECURITY: Only allows https:// and http:// URLs to prevent malicious schemes
   */
  ipcMain.handle('wishlist:openStoreLink', async (_event, url: string) => {
    try {
      // Validate URL format and scheme
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        throw new Error('Invalid URL format')
      }

      // Only allow safe URL schemes
      const allowedSchemes = ['https:', 'http:']
      if (!allowedSchemes.includes(parsedUrl.protocol)) {
        console.warn('[Security] Blocked unsafe URL scheme:', parsedUrl.protocol)
        throw new Error(`URL scheme not allowed: ${parsedUrl.protocol}`)
      }

      await shell.openExternal(parsedUrl.toString())
      return { success: true }
    } catch (error) {
      console.error('Error opening store link:', error)
      throw error
    }
  })

  /**
   * Set the store region preference
   */
  ipcMain.handle('wishlist:setRegion', async (_event, region: StoreRegion) => {
    try {
      storeService.setRegion(region)
      // Save to settings
      await db.setSetting('store_region', region)
      return { success: true }
    } catch (error) {
      console.error('Error setting store region:', error)
      throw error
    }
  })

  /**
   * Get the current store region
   */
  ipcMain.handle('wishlist:getRegion', async () => {
    try {
      const region = db.getSetting('store_region')
      return region || 'us'
    } catch (error) {
      console.error('Error getting store region:', error)
      return 'us'
    }
  })

  // ============================================================================
  // EXPORT
  // ============================================================================

  /**
   * Export wishlist to CSV file
   */
  ipcMain.handle('wishlist:exportCsv', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      // Show save dialog
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Wishlist',
        defaultPath: `Totality Wishlist - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).replace(',', '')}.csv`,
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true }
      }

      // Get all items sorted for export
      const items = db.getWishlistItems({
        sortBy: 'priority',
        sortOrder: 'desc'
      })

      // Generate CSV content
      const csvContent = generateWishlistCsv(items)

      // Write file
      await fs.writeFile(result.filePath, csvContent, 'utf-8')

      return { success: true, path: result.filePath, count: items.length }
    } catch (error) {
      console.error('Error exporting wishlist:', error)
      throw error
    }
  })

  console.log('Wishlist IPC handlers registered')
}

/**
 * Generate branded CSV content from wishlist items
 */
function generateWishlistCsv(items: WishlistItem[]): string {
  // BOM for Excel UTF-8 compatibility
  const BOM = '\uFEFF'
  const numColumns = 10
  const emptyRow = ','.repeat(numColumns - 1)

  // Escape CSV field (handle commas, quotes, newlines)
  const escapeField = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // Create a row with content in first cell, rest empty (for headers/labels)
  const labelRow = (text: string): string => {
    return escapeField(text) + ','.repeat(numColumns - 1)
  }

  // Format priority as stars
  const formatPriority = (priority: number): string => {
    return '\u2605'.repeat(priority) + '\u2606'.repeat(5 - priority)
  }

  // Format quality info for upgrades
  const formatQuality = (item: WishlistItem): string => {
    if (item.reason !== 'upgrade') return ''
    const parts: string[] = []
    if (item.current_resolution) parts.push(item.current_resolution)
    if (item.current_quality_level) parts.push(`(${item.current_quality_level})`)
    if (item.current_video_codec) parts.push(item.current_video_codec.toUpperCase())
    return parts.join(' ')
  }

  // Format media type for display
  const formatMediaType = (type: string): string => {
    const typeMap: Record<string, string> = {
      movie: 'Movie',
      season: 'TV Season',
      episode: 'TV Episode',
      album: 'Album',
      track: 'Track'
    }
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1)
  }

  // Separate items by reason
  const missingItems = items.filter(i => i.reason === 'missing')
  const upgradeItems = items.filter(i => i.reason === 'upgrade')

  // Sort within each group: by media_type, then by priority desc, then by title
  const sortGroup = (group: WishlistItem[]): WishlistItem[] => {
    return [...group].sort((a, b) => {
      if (a.media_type !== b.media_type) {
        return a.media_type.localeCompare(b.media_type)
      }
      if (a.priority !== b.priority) {
        return b.priority - a.priority
      }
      return a.title.localeCompare(b.title)
    })
  }

  const sortedMissing = sortGroup(missingItems)
  const sortedUpgrade = sortGroup(upgradeItems)

  // Count by media type
  const countByType = (group: WishlistItem[]): string => {
    const movies = group.filter(i => i.media_type === 'movie').length
    const tv = group.filter(i => ['season', 'episode'].includes(i.media_type)).length
    const music = group.filter(i => ['album', 'track'].includes(i.media_type)).length
    const parts: string[] = []
    if (movies > 0) parts.push(`${movies} movie${movies !== 1 ? 's' : ''}`)
    if (tv > 0) parts.push(`${tv} TV`)
    if (music > 0) parts.push(`${music} music`)
    return parts.join(' · ')
  }

  // Format date nicely
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Build the CSV
  const rows: string[] = []

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANDED HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  rows.push(labelRow('╔══════════════════════════════════════════════════════════════════════════════╗'))
  rows.push(labelRow('║                           TOTALITY MEDIA WISHLIST                            ║'))
  rows.push(labelRow('╚══════════════════════════════════════════════════════════════════════════════╝'))
  rows.push(emptyRow)

  // Export info
  const exportDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  rows.push(labelRow(`Exported: ${exportDate}`))
  rows.push(labelRow(`Total Items: ${items.length}`))
  rows.push(emptyRow)

  // Summary stats
  if (missingItems.length > 0) {
    rows.push(labelRow(`▸ Complete Collection: ${missingItems.length} items (${countByType(missingItems)})`))
  }
  if (upgradeItems.length > 0) {
    rows.push(labelRow(`▸ Quality Upgrades: ${upgradeItems.length} items (${countByType(upgradeItems)})`))
  }
  rows.push(emptyRow)
  rows.push(emptyRow)

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE COLLECTION SECTION
  // ═══════════════════════════════════════════════════════════════════════════
  if (sortedMissing.length > 0) {
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(labelRow(`COMPLETE YOUR COLLECTION (${sortedMissing.length} items)`))
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(emptyRow)

    // Column headers for this section
    const missingHeaders = ['', 'Type', 'Title', 'Year', 'Series/Artist', 'Season', 'Priority', '', 'Notes', 'Added']
    rows.push(missingHeaders.map(escapeField).join(','))

    for (const item of sortedMissing) {
      const row = [
        '☐',  // Checkbox for shopping
        formatMediaType(item.media_type),
        item.title,
        item.year || '',
        item.series_title || item.artist_name || '',
        item.media_type === 'season' && item.season_number !== undefined ? `Season ${item.season_number}` : '',
        formatPriority(item.priority),
        '',
        item.notes || '',
        item.added_at ? formatDate(item.added_at) : ''
      ]
      rows.push(row.map(escapeField).join(','))
    }
    rows.push(emptyRow)
    rows.push(emptyRow)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUALITY UPGRADES SECTION
  // ═══════════════════════════════════════════════════════════════════════════
  if (sortedUpgrade.length > 0) {
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(labelRow(`QUALITY UPGRADES (${sortedUpgrade.length} items)`))
    rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    rows.push(emptyRow)

    // Column headers for this section
    const upgradeHeaders = ['', 'Type', 'Title', 'Year', 'Series/Artist', 'Season', 'Priority', 'Current Quality', 'Notes', 'Added']
    rows.push(upgradeHeaders.map(escapeField).join(','))

    for (const item of sortedUpgrade) {
      const row = [
        '☐',  // Checkbox for shopping
        formatMediaType(item.media_type),
        item.title,
        item.year || '',
        item.series_title || item.artist_name || '',
        item.media_type === 'season' && item.season_number !== undefined ? `Season ${item.season_number}` : '',
        formatPriority(item.priority),
        formatQuality(item),
        item.notes || '',
        item.added_at ? formatDate(item.added_at) : ''
      ]
      rows.push(row.map(escapeField).join(','))
    }
    rows.push(emptyRow)
    rows.push(emptyRow)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════════════════════════════════════
  rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  rows.push(labelRow('SHOPPING TIPS'))
  rows.push(labelRow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  rows.push(labelRow('• Compare prices across multiple retailers before purchasing'))
  rows.push(labelRow('• Check for used/pre-owned copies for rare or out-of-print titles'))
  rows.push(labelRow('• Watch for seasonal sales (Black Friday, Prime Day, etc.)'))
  rows.push(labelRow('• For upgrades, verify the new version has improved quality before buying'))
  rows.push(emptyRow)
  rows.push(labelRow('Generated by Totality — Your Media Quality Companion'))
  rows.push(labelRow('https://github.com/your-repo/totality'))

  return BOM + rows.join('\r\n')
}
