import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { getGeminiService } from './GeminiService'
import type { SeriesCompleteness, MovieCollection } from '../types/database'
import {
  QUALITY_REPORT_SYSTEM_PROMPT,
  UPGRADE_PRIORITIES_SYSTEM_PROMPT,
  COMPLETENESS_INSIGHTS_SYSTEM_PROMPT,
  WISHLIST_ADVICE_SYSTEM_PROMPT,
  STORAGE_OPTIMIZATION_SYSTEM_PROMPT,
  MUSIC_QUALITY_SYSTEM_PROMPT,
} from './ai-system-prompts'

/** Strip null/undefined/empty fields to reduce token usage */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') result[k] = v
  }
  return result
}

/**
 * GeminiAnalysisService — Pre-fetches library data and sends to Gemini
 * with specialized prompts for generating reports and insights.
 *
 * Each method streams results back via an onDelta callback.
 */

export class GeminiAnalysisService {
  /**
   * Generate a quality health report for the library.
   */
  async generateQualityReport(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()
    const stats = db.getLibraryStats()
    const distribution = getQualityAnalyzer().getQualityDistribution()

    const lowQualityItems = db.getMediaItems({
      tierQuality: 'LOW',
      sortBy: 'title',
      sortOrder: 'asc',
      limit: 20,
    })

    const dataContext = [
      '## Library Stats',
      JSON.stringify(stats),
      '',
      '## Quality Distribution',
      JSON.stringify(distribution),
      '',
      '## Sample Low-Quality Items (up to 20)',
      JSON.stringify(
        lowQualityItems.map((item: Record<string, unknown>) => compact({
          title: item.title,
          year: item.year,
          type: item.type,
          resolution: item.resolution,
          video_codec: item.video_codec,
          video_bitrate: item.video_bitrate,
          quality_tier: item.quality_tier,
          tier_quality: item.tier_quality,
        })),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my media library data. Please generate a quality health report.\n\n${dataContext}`,
          },
        ],
        system: QUALITY_REPORT_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate prioritized upgrade recommendations.
   */
  async generateUpgradePriorities(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()

    const lowItems = db.getMediaItems({
      tierQuality: 'LOW',
      sortBy: 'title',
      sortOrder: 'asc',
      limit: 30,
    })
    const mediumItems = db.getMediaItems({
      tierQuality: 'MEDIUM',
      sortBy: 'title',
      sortOrder: 'asc',
      limit: 20,
    })

    const stats = db.getLibraryStats()

    const dataContext = [
      '## Library Overview',
      JSON.stringify(stats),
      '',
      '## LOW Quality Items (up to 30)',
      JSON.stringify(
        lowItems.map((item: Record<string, unknown>) => compact({
          title: item.title,
          year: item.year,
          type: item.type,
          series_title: item.series_title,
          resolution: item.resolution,
          video_codec: item.video_codec,
          video_bitrate: item.video_bitrate,
          quality_tier: item.quality_tier,
          tier_quality: item.tier_quality,
        })),
      ),
      '',
      '## MEDIUM Quality Items (up to 20)',
      JSON.stringify(
        mediumItems.map((item: Record<string, unknown>) => compact({
          title: item.title,
          year: item.year,
          type: item.type,
          series_title: item.series_title,
          resolution: item.resolution,
          video_codec: item.video_codec,
          video_bitrate: item.video_bitrate,
          quality_tier: item.quality_tier,
          tier_quality: item.tier_quality,
        })),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here are the items in my library that may need quality upgrades. Please prioritize them.\n\n${dataContext}`,
          },
        ],
        system: UPGRADE_PRIORITIES_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate completeness insights.
   */
  async generateCompletenessInsights(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()

    const incompleteSeries = db.getIncompleteSeries()
    const incompleteCollections = db.getIncompleteMovieCollections()
    const stats = db.getLibraryStats()

    const dataContext = [
      '## Library Overview',
      JSON.stringify(stats),
      '',
      `## Incomplete TV Series (${incompleteSeries.length} total, showing up to 30)`,
      JSON.stringify(
        (incompleteSeries as SeriesCompleteness[]).slice(0, 30).map((s) => {
          const missingEps = s.missing_episodes || []
          const missingCount = missingEps.length
          const missingSample = missingEps.slice(0, 5).map((e) =>
            `S${e.season_number}E${e.episode_number}`,
          )
          return compact({
            series_title: s.series_title,
            total_episodes: s.total_episodes,
            owned_episodes: s.owned_episodes,
            completeness_percentage: s.completeness_percentage,
            status: s.status,
            missing_count: missingCount,
            missing_sample: missingSample.length > 0 ? missingSample : undefined,
          })
        }),
      ),
      '',
      `## Incomplete Movie Collections (${incompleteCollections.length} total, showing up to 30)`,
      JSON.stringify(
        (incompleteCollections as MovieCollection[]).slice(0, 30).map((c) => {
          const missingMovies = c.missing_movies || []
          const missingCount = missingMovies.length
          const missingSample = missingMovies.slice(0, 5).map((m) =>
            m.year ? `${m.title} (${m.year})` : `${m.title}`,
          )
          return compact({
            collection_name: c.collection_name,
            total_movies: c.total_movies,
            owned_movies: c.owned_movies,
            completeness_percentage: c.completeness_percentage,
            missing_count: missingCount,
            missing_sample: missingSample.length > 0 ? missingSample : undefined,
          })
        }),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my collection and series completeness data. Please analyze it and provide insights.\n\n${dataContext}`,
          },
        ],
        system: COMPLETENESS_INSIGHTS_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate shopping advice for wishlist items.
   */
  async generateWishlistAdvice(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()

    const wishlistItems = db.getWishlistItems({ status: 'active', limit: 50 })
    const stats = db.getLibraryStats()

    const dataContext = [
      '## Library Overview',
      JSON.stringify(stats),
      '',
      `## Wishlist Items (${wishlistItems.length})`,
      JSON.stringify(
        wishlistItems.map((item: Record<string, unknown>) => compact({
          title: item.title,
          year: item.year,
          media_type: item.media_type,
          reason: item.reason,
          priority: item.priority,
          notes: item.notes,
          series_title: item.series_title,
          collection_name: item.collection_name,
          current_quality_tier: item.current_quality_tier,
          current_quality_level: item.current_quality_level,
        })),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my wishlist. Please analyze it and provide shopping advice.\n\n${dataContext}`,
          },
        ],
        system: WISHLIST_ADVICE_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate a storage optimization report.
   */
  async generateStorageOptimization(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()
    const stats = db.getLibraryStats()
    const analytics = db.getStorageAnalytics()

    const formatSize = (b: number) => b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`

    const dataContext = [
      '## Library Stats',
      JSON.stringify(stats),
      '',
      '## Storage Analytics',
      JSON.stringify({
        total_size: formatSize(analytics.totalSize),
        total_items: analytics.totalItems,
        by_codec: analytics.byCodec.map((c: { codec: string; count: number; size: number }) => ({
          codec: c.codec, count: c.count, size: formatSize(c.size),
        })),
        by_tier: analytics.byTier.map((t: { tier: string; count: number; size: number }) => ({
          tier: t.tier, count: t.count, size: formatSize(t.size),
        })),
        codec_migration: {
          h264_count: analytics.codecMigration.h264Count,
          modern_count: analytics.codecMigration.modernCount,
          total: analytics.codecMigration.totalCount,
          modern_percentage: analytics.codecMigration.totalCount > 0
            ? Math.round((analytics.codecMigration.modernCount / analytics.codecMigration.totalCount) * 100) : 0,
        },
      }),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my library storage and codec data. Please analyze it and recommend an optimization strategy.\n\n${dataContext}`,
          },
        ],
        system: STORAGE_OPTIMIZATION_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate a music quality report.
   */
  async generateMusicQualityReport(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()
    const musicStats = db.getMusicStats()

    // Get quality distribution
    const allAlbums = db.getMusicAlbums({ limit: 10000 }) as Record<string, unknown>[]
    const tiers: Record<string, number> = {
      HI_RES: 0, LOSSLESS: 0, LOSSY_HIGH: 0, LOSSY_MID: 0, LOSSY_LOW: 0, UNSCORED: 0,
    }
    for (const album of allAlbums) {
      const quality = db.getMusicQualityScore(album.id as number)
      if (quality) {
        const tier = (quality as Record<string, unknown>).quality_tier as string
        if (tier in tiers) tiers[tier]++
        else tiers.UNSCORED++
      } else {
        tiers.UNSCORED++
      }
    }

    // Get albums needing upgrade
    const upgradeAlbums = db.getAlbumsNeedingUpgrade(20)

    // Get artist completeness summary
    const artistCompleteness = db.getAllArtistCompleteness() as Record<string, unknown>[]
    const incompleteArtists = artistCompleteness
      .filter(a => (a.completeness_percentage as number) < 100)
      .slice(0, 15)

    const dataContext = [
      '## Music Library Stats',
      JSON.stringify(musicStats),
      '',
      '## Quality Distribution',
      JSON.stringify({ total_albums: allAlbums.length, distribution: tiers,
        lossless_percentage: allAlbums.length > 0
          ? Math.round(((tiers.LOSSLESS + tiers.HI_RES) / allAlbums.length) * 100) : 0,
      }),
      '',
      '## Albums Needing Upgrade (up to 20)',
      JSON.stringify(upgradeAlbums.map((a: Record<string, unknown>) => compact({
        title: a.title,
        artist_name: a.artist_name,
        best_audio_codec: a.best_audio_codec,
        avg_audio_bitrate: a.avg_audio_bitrate,
        track_count: a.track_count,
      }))),
      '',
      `## Incomplete Artists (${incompleteArtists.length} of ${artistCompleteness.length})`,
      JSON.stringify(incompleteArtists.map((a: Record<string, unknown>) => compact({
        artist_name: a.artist_name,
        total_albums: a.total_albums,
        owned_albums: a.owned_albums,
        completeness_percentage: a.completeness_percentage,
      }))),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my music library quality data. Please analyze it and recommend a quality upgrade strategy.\n\n${dataContext}`,
          },
        ],
        system: MUSIC_QUALITY_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }
}

// Singleton
let analysisServiceInstance: GeminiAnalysisService | null = null

export function getGeminiAnalysisService(): GeminiAnalysisService {
  if (!analysisServiceInstance) {
    analysisServiceInstance = new GeminiAnalysisService()
  }
  return analysisServiceInstance
}
