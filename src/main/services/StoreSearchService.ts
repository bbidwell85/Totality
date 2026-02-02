/**
 * StoreSearchService
 *
 * Generates store search URLs for wishlist items.
 * Supports video (movies/TV) and music stores, including physical media retailers.
 */

import type { WishlistItem, WishlistMediaType } from '../types/database'

export interface StoreLink {
  name: string
  url: string
  icon: string
  category: 'aggregator' | 'digital' | 'physical'
}

export type StoreRegion = 'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au'

export class StoreSearchService {
  private region: StoreRegion = 'us'

  setRegion(region: StoreRegion): void {
    this.region = region
  }

  getRegion(): StoreRegion {
    return this.region
  }

  /**
   * Get store links for a wishlist item
   */
  getStoreLinks(item: WishlistItem): StoreLink[] {
    const category = this.getMediaCategory(item.media_type)

    if (category === 'video') {
      return this.getVideoStoreLinks(item)
    } else {
      return this.getMusicStoreLinks(item)
    }
  }

  private getMediaCategory(type: WishlistMediaType): 'video' | 'music' {
    return ['album', 'track'].includes(type) ? 'music' : 'video'
  }

  /**
   * Get store links for video content (movies, TV shows, episodes)
   * Only physical media stores - no digital/streaming options
   */
  private getVideoStoreLinks(item: WishlistItem): StoreLink[] {
    const searchTerm = this.buildVideoSearchTerm(item)
    const encodedTerm = encodeURIComponent(searchTerm)

    return [
      // Physical media only
      {
        name: 'Amazon',
        url: this.getAmazonUrl(searchTerm, 'physical'),
        icon: 'amazon',
        category: 'physical',
      },
      {
        name: 'eBay',
        url: `https://www.ebay.com/sch/i.html?_nkw=${encodedTerm}`,
        icon: 'ebay',
        category: 'physical',
      },
      {
        name: 'Best Buy',
        url: `https://www.bestbuy.com/site/searchpage.jsp?st=${encodedTerm}`,
        icon: 'bestbuy',
        category: 'physical',
      },
      {
        name: 'Walmart',
        url: `https://www.walmart.com/search?q=${encodedTerm}`,
        icon: 'walmart',
        category: 'physical',
      },
      {
        name: 'Target',
        url: `https://www.target.com/s?searchTerm=${encodedTerm}`,
        icon: 'target',
        category: 'physical',
      },
      {
        name: 'Deep Discount',
        url: `https://www.deepdiscount.com/search?q=${encodedTerm}`,
        icon: 'deepdiscount',
        category: 'physical',
      },
    ]
  }

  /**
   * Get store links for music content (albums, tracks)
   * Includes both physical and digital options
   */
  private getMusicStoreLinks(item: WishlistItem): StoreLink[] {
    const searchTerm = this.buildMusicSearchTerm(item)
    const encodedTerm = encodeURIComponent(searchTerm)

    return [
      // Physical media
      {
        name: 'Discogs',
        url: `https://www.discogs.com/search/?q=${encodedTerm}&type=release`,
        icon: 'discogs',
        category: 'physical',
      },
      {
        name: 'eBay (CD)',
        url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${searchTerm} cd`)}`,
        icon: 'ebay',
        category: 'physical',
      },
      {
        name: 'Amazon (Physical)',
        url: this.getAmazonUrl(`${searchTerm} cd`, 'physical'),
        icon: 'amazon',
        category: 'physical',
      },
      // Digital stores
      {
        name: 'Amazon Music',
        url: this.getAmazonUrl(searchTerm, 'music'),
        icon: 'amazon',
        category: 'digital',
      },
      {
        name: 'Apple Music',
        url: `https://music.apple.com/search?term=${encodedTerm}`,
        icon: 'apple',
        category: 'digital',
      },
      {
        name: 'Bandcamp',
        url: `https://bandcamp.com/search?q=${encodedTerm}`,
        icon: 'bandcamp',
        category: 'digital',
      },
      {
        name: 'HDtracks',
        url: `https://www.hdtracks.com/#/search/${encodedTerm}`,
        icon: 'hdtracks',
        category: 'digital',
      },
    ]
  }

  /**
   * Build search term for video content
   */
  private buildVideoSearchTerm(item: WishlistItem): string {
    // For episodes, search for the series
    if (item.media_type === 'episode' && item.series_title) {
      const parts = [item.series_title]
      if (item.season_number !== undefined) {
        parts.push(`Season ${item.season_number}`)
      }
      return parts.join(' ')
    }

    // For seasons, search for the series + season
    if (item.media_type === 'season' && item.series_title) {
      return `${item.series_title} Season ${item.season_number || 1}`
    }

    // For movies
    const parts = [item.title]
    if (item.year) {
      parts.push(item.year.toString())
    }
    return parts.join(' ')
  }

  /**
   * Build search term for music content
   */
  private buildMusicSearchTerm(item: WishlistItem): string {
    const parts: string[] = []

    if (item.artist_name) {
      parts.push(item.artist_name)
    }

    if (item.album_title) {
      parts.push(item.album_title)
    } else if (item.title) {
      parts.push(item.title)
    }

    return parts.join(' ')
  }

  /**
   * Get Amazon URL with region-appropriate TLD
   */
  private getAmazonUrl(term: string, type: 'video' | 'music' | 'physical'): string {
    const tld = this.getAmazonTLD()
    const encodedTerm = encodeURIComponent(term)

    // For physical items, search all departments
    if (type === 'physical') {
      return `https://www.amazon.${tld}/s?k=${encodedTerm}`
    }

    // For digital, specify the department
    const category = type === 'music' ? 'digital-music' : 'instant-video'
    return `https://www.amazon.${tld}/s?k=${encodedTerm}&i=${category}`
  }

  /**
   * Get Amazon TLD based on region
   */
  private getAmazonTLD(): string {
    const tldMap: Record<StoreRegion, string> = {
      us: 'com',
      uk: 'co.uk',
      de: 'de',
      fr: 'fr',
      ca: 'ca',
      au: 'com.au',
    }
    return tldMap[this.region]
  }
}

// Singleton instance
let storeSearchServiceInstance: StoreSearchService | null = null

export function getStoreSearchService(): StoreSearchService {
  if (!storeSearchServiceInstance) {
    storeSearchServiceInstance = new StoreSearchService()
  }
  return storeSearchServiceInstance
}
