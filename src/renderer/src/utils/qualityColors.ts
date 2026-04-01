/**
 * Shared quality color/label utilities for resolution tiers and quality levels.
 */

/** Returns Tailwind CSS classes for a quality level (LOW/MEDIUM/HIGH). */
export function getQualityLevelColors(tierQuality: string): string {
  switch (tierQuality) {
    case 'HIGH':
      return 'bg-green-500/15 hover:bg-green-500/25'
    case 'LOW':
      return 'bg-red-500/15 hover:bg-red-500/25'
    default:
      return ''
  }
}

/** Returns Tailwind CSS classes for a resolution tier badge (SD/720p/1080p/4K). */
export function getResolutionColors(qualityTier: string): string {
  switch (qualityTier) {
    case 'SD':
      return 'bg-red-500/20 text-red-400'
    case '720p':
      return 'bg-yellow-500/20 text-yellow-400'
    case '1080p':
      return 'bg-blue-500/20 text-blue-400'
    case '4K':
      return 'bg-green-500/20 text-green-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

/** Returns a human-readable label for a music quality tier. */
export function getMusicTierLabel(tier: string, isHighLossy?: boolean): string {
  switch (tier) {
    case 'ultra':
      return 'Hi-Res'
    case 'high':
      return isHighLossy ? 'High Lossy' : 'Lossless'
    case 'medium':
      return 'Medium'
    case 'low':
      return 'Low'
    default:
      return tier
  }
}
