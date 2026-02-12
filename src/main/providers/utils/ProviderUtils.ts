/**
 * ProviderUtils
 *
 * Shared utility functions used across media providers.
 * Extracted to avoid code duplication between providers.
 */

import { AudioCodecRanker } from '../../services/AudioCodecRanker'

/**
 * Audio track interface for provider utilities
 */
export interface AudioTrackInfo {
  index: number
  codec: string
  channels: number
  bitrate: number
  hasObjectAudio?: boolean
  language?: string
  title?: string
  isDefault?: boolean
}

/**
 * Select the best audio track from a list based on quality ranking
 *
 * Priority order:
 * 1. Codec tier (Atmos > DTS:X > TrueHD > DTS-HD MA > etc.)
 * 2. Channel count
 * 3. Bitrate
 *
 * @param audioTracks Array of audio tracks to choose from
 * @returns The best audio track, or undefined if no tracks provided
 */
export function selectBestAudioTrack<T extends AudioTrackInfo>(audioTracks: T[]): T | undefined {
  if (!audioTracks || audioTracks.length === 0) {
    return undefined
  }

  // Filter out commentary tracks for best-track selection
  const nonCommentary = audioTracks.filter(t => !isCommentaryTrack(t))
  const candidates = nonCommentary.length > 0 ? nonCommentary : audioTracks

  return candidates.reduce((best, current) => {
    const bestTier = AudioCodecRanker.getTier(best.codec, best.hasObjectAudio || false)
    const currentTier = AudioCodecRanker.getTier(current.codec, current.hasObjectAudio || false)

    if (currentTier > bestTier) return current
    if (bestTier > currentTier) return best
    if (current.channels > best.channels) return current
    if (best.channels > current.channels) return best
    if (current.bitrate > best.bitrate) return current
    return best
  }, candidates[0])
}

/**
 * Check if an audio track is a commentary track based on its title
 */
export function isCommentaryTrack(track: { title?: string }): boolean {
  if (!track.title) return false
  const t = track.title.toLowerCase()
  return t.includes('commentary')
}

/**
 * Estimate audio bitrate based on codec and channel count
 *
 * Used as fallback when actual bitrate is not available from the media server.
 * Returns estimated bitrate in kbps.
 *
 * @param codec Audio codec name
 * @param channels Number of audio channels
 * @returns Estimated bitrate in kbps
 */
export function estimateAudioBitrate(codec: string | null | undefined, channels: number | null | undefined): number {
  const codecLower = (codec || '').toLowerCase()
  const ch = channels || 2

  // Lossless codecs - higher bitrates
  if (codecLower.includes('truehd') || codecLower.includes('atmos')) {
    // TrueHD Atmos typically 4-8 Mbps for 7.1, 2-4 Mbps for 5.1
    return ch >= 8 ? 6000 : ch >= 6 ? 4000 : 2500
  }
  if (codecLower.includes('dtshd_ma') || codecLower.includes('dts-hd ma') || codecLower.includes('dts-hd.ma')) {
    // DTS-HD MA typically 3-6 Mbps
    return ch >= 8 ? 5000 : ch >= 6 ? 3500 : 2000
  }
  if (codecLower.includes('dtshd') || codecLower.includes('dts-hd')) {
    return ch >= 6 ? 2500 : 1500
  }
  if (codecLower.includes('flac') || codecLower.includes('pcm') || codecLower.includes('lpcm')) {
    return ch >= 6 ? 3000 : 1500
  }

  // Lossy codecs
  if (codecLower.includes('dts')) {
    return ch >= 6 ? 1509 : 768
  }
  if (codecLower.includes('eac3') || codecLower.includes('e-ac-3') || codecLower.includes('ec3')) {
    return ch >= 8 ? 1024 : ch >= 6 ? 640 : 384
  }
  if (codecLower.includes('ac3') || codecLower.includes('ac-3')) {
    return ch >= 6 ? 640 : 384
  }
  if (codecLower.includes('aac')) {
    return ch >= 6 ? 384 : 256
  }
  if (codecLower.includes('mp3')) {
    return ch >= 6 ? 320 : 192
  }
  if (codecLower.includes('opus')) {
    return ch >= 6 ? 256 : 128
  }

  // Default fallback
  return ch >= 6 ? 640 : 256
}

/**
 * Calculate audio bitrate from total file bitrate minus video bitrate
 *
 * More accurate than estimation for lossless codecs when file/video bitrate is known.
 *
 * @param totalBitrate Total file bitrate in kbps
 * @param videoBitrate Video bitrate in kbps
 * @param numAudioTracks Number of audio tracks
 * @returns Audio bitrate per track in kbps, or 0 if can't be calculated
 */
export function calculateAudioBitrateFromFile(
  totalBitrate: number,
  videoBitrate: number,
  numAudioTracks: number
): number {
  if (totalBitrate <= 0 || videoBitrate <= 0 || numAudioTracks <= 0) {
    return 0
  }

  // Remaining bitrate after video is for audio + subtitles + overhead
  // Assume ~5% overhead for container/subtitles
  const audioBitrate = (totalBitrate - videoBitrate) * 0.95

  if (audioBitrate <= 0) {
    return 0
  }

  // Divide among tracks (assume roughly equal distribution)
  return Math.round(audioBitrate / numAudioTracks)
}

/**
 * Check if a bitrate appears to be estimated rather than actual
 *
 * Our estimated bitrates fall into specific values, so we can detect them.
 *
 * @param bitrate Bitrate in kbps to check
 * @returns true if the bitrate looks like an estimated value
 */
export function isEstimatedBitrate(bitrate: number): boolean {
  const estimatedValues = [
    128, 192, 256, 320, 384, 640, 768, 1024, 1500, 1509,
    2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000
  ]
  return estimatedValues.includes(bitrate)
}
