/**
 * AudioCodecRanker
 *
 * Centralized service for ranking audio codecs by quality tier
 * and selecting the best audio track from a collection.
 *
 * Quality Tiers:
 * - Tier 5 (OBJECT_AUDIO): Dolby Atmos, DTS:X - immersive object-based audio
 * - Tier 4 (LOSSLESS): TrueHD, DTS-HD MA, FLAC, ALAC, PCM - bit-perfect lossless
 * - Tier 3 (NEAR_LOSSLESS): DTS-HD HRA - high-resolution but lossy
 * - Tier 2 (HIGH_LOSSY): EAC3/DD+, DTS - high-bitrate lossy
 * - Tier 1 (STANDARD): AC3, AAC, MP3 - standard lossy compression
 */

export interface AudioTrackInfo {
  index: number
  codec: string
  channels: number
  bitrate: number
  sampleRate?: number
  language?: string
  title?: string
  hasObjectAudio?: boolean
  isDefault?: boolean
}

export class AudioCodecRanker {
  // Quality tier constants
  static readonly TIER_OBJECT_AUDIO = 5  // Atmos, DTS:X
  static readonly TIER_LOSSLESS = 4      // TrueHD, DTS-HD MA, FLAC, ALAC, PCM
  static readonly TIER_NEAR_LOSSLESS = 3 // DTS-HD HRA
  static readonly TIER_HIGH_LOSSY = 2    // EAC3, DTS
  static readonly TIER_STANDARD = 1      // AC3, AAC, MP3

  // Codec patterns for each tier
  private static readonly LOSSLESS_CODECS = [
    'truehd', 'dts-hd ma', 'dtshd_ma', 'dtsma', 'dts-hd.ma',
    'flac', 'alac', 'pcm', 'lpcm', 'wav', 'aiff'
  ]

  private static readonly NEAR_LOSSLESS_CODECS = [
    'dts-hd hra', 'dtshd_hra', 'dts-hd.hra', 'dtshra'
  ]

  private static readonly HIGH_LOSSY_CODECS = [
    'dts', 'eac3', 'ec-3', 'dd+', 'ddp', 'dolby digital plus',
    'e-ac-3', 'atsc a/52b'
  ]

  /**
   * Get the quality tier for an audio codec
   * @param codec The audio codec name
   * @param hasObjectAudio Whether the track has object-based audio (Atmos/DTS:X)
   * @returns Quality tier (1-5)
   */
  static getTier(codec: string, hasObjectAudio = false): number {
    // Object audio always gets top tier
    if (hasObjectAudio) {
      return AudioCodecRanker.TIER_OBJECT_AUDIO
    }

    const codecLower = codec.toLowerCase()

    // Check for object audio markers in codec name
    if (codecLower.includes('atmos') || codecLower.includes('dts:x') || codecLower.includes('dtsx')) {
      return AudioCodecRanker.TIER_OBJECT_AUDIO
    }

    // Check lossless codecs
    if (AudioCodecRanker.LOSSLESS_CODECS.some(lc => codecLower.includes(lc))) {
      return AudioCodecRanker.TIER_LOSSLESS
    }

    // Check near-lossless codecs
    if (AudioCodecRanker.NEAR_LOSSLESS_CODECS.some(nlc => codecLower.includes(nlc))) {
      return AudioCodecRanker.TIER_NEAR_LOSSLESS
    }

    // Check high-quality lossy codecs
    if (AudioCodecRanker.HIGH_LOSSY_CODECS.some(hq => codecLower.includes(hq))) {
      return AudioCodecRanker.TIER_HIGH_LOSSY
    }

    // Everything else is standard tier
    return AudioCodecRanker.TIER_STANDARD
  }

  /**
   * Select the best audio track from a collection based on quality criteria
   *
   * Selection priority:
   * 1. Highest quality tier (object audio > lossless > near-lossless > high-lossy > standard)
   * 2. Most channels (7.1 > 5.1 > stereo)
   * 3. Highest bitrate
   *
   * @param tracks Array of audio tracks to compare
   * @returns The best audio track, or undefined if array is empty
   */
  static selectBestTrack(tracks: AudioTrackInfo[]): AudioTrackInfo | undefined {
    if (!tracks || tracks.length === 0) {
      return undefined
    }

    return tracks.reduce((best, current) => {
      const bestTier = AudioCodecRanker.getTier(best.codec, best.hasObjectAudio || false)
      const currentTier = AudioCodecRanker.getTier(current.codec, current.hasObjectAudio || false)

      // Compare by tier first
      if (currentTier > bestTier) return current
      if (bestTier > currentTier) return best

      // Same tier: compare by channels
      if (current.channels > best.channels) return current
      if (best.channels > current.channels) return best

      // Same channels: compare by bitrate
      if (current.bitrate > best.bitrate) return current

      return best
    }, tracks[0])
  }

  /**
   * Get a human-readable tier name
   * @param tier Quality tier number (1-5)
   * @returns Human-readable tier name
   */
  static getTierName(tier: number): string {
    switch (tier) {
      case AudioCodecRanker.TIER_OBJECT_AUDIO:
        return 'Object Audio'
      case AudioCodecRanker.TIER_LOSSLESS:
        return 'Lossless'
      case AudioCodecRanker.TIER_NEAR_LOSSLESS:
        return 'Near-Lossless'
      case AudioCodecRanker.TIER_HIGH_LOSSY:
        return 'High-Quality Lossy'
      case AudioCodecRanker.TIER_STANDARD:
        return 'Standard'
      default:
        return 'Unknown'
    }
  }

  /**
   * Check if a codec is lossless
   * @param codec The audio codec name
   * @returns true if the codec is lossless
   */
  static isLossless(codec: string): boolean {
    const tier = AudioCodecRanker.getTier(codec)
    return tier >= AudioCodecRanker.TIER_LOSSLESS
  }

  /**
   * Check if a codec supports object audio
   * @param codec The audio codec name
   * @param profile Optional codec profile
   * @param title Optional track title (may contain "Atmos" etc.)
   * @returns true if the codec supports object audio
   */
  static hasObjectAudioSupport(codec: string, profile?: string, title?: string): boolean {
    const codecLower = codec.toLowerCase()
    const profileLower = (profile || '').toLowerCase()
    const titleLower = (title || '').toLowerCase()

    // Direct object audio codec names
    if (codecLower.includes('atmos') || codecLower.includes('dts:x') || codecLower.includes('dtsx')) {
      return true
    }

    // TrueHD with Atmos in profile or title
    if (codecLower.includes('truehd') && (profileLower.includes('atmos') || titleLower.includes('atmos'))) {
      return true
    }

    // DTS-HD MA with DTS:X in profile or title
    if ((codecLower.includes('dts-hd') || codecLower.includes('dtshd')) &&
        (profileLower.includes('dts:x') || profileLower.includes('dtsx') ||
         titleLower.includes('dts:x') || titleLower.includes('dtsx'))) {
      return true
    }

    // EAC3 with Atmos in profile or title (Dolby Digital Plus Atmos)
    if ((codecLower.includes('eac3') || codecLower.includes('dd+') || codecLower.includes('ddp')) &&
        (profileLower.includes('atmos') || titleLower.includes('atmos'))) {
      return true
    }

    return false
  }
}
