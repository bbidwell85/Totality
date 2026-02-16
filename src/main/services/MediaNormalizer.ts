/**
 * MediaNormalizer Service
 *
 * Provides unified normalization for media metadata across all providers
 * (Plex, Jellyfin, Emby, Kodi). Ensures consistent codec names, bitrates,
 * resolutions, and other technical properties.
 */

// ============================================================================
// VIDEO CODEC NORMALIZATION
// ============================================================================

/**
 * Normalize video codec to a standard display name
 * Maps various codec identifiers to consistent names
 */
export function normalizeVideoCodec(codec: string | null | undefined): string {
  if (!codec) return ''

  const codecLower = codec.toLowerCase().trim()

  // HEVC / H.265
  if (
    codecLower === 'hevc' ||
    codecLower === 'h265' ||
    codecLower === 'h.265' ||
    codecLower === 'x265' ||
    codecLower.includes('hevc')
  ) {
    return 'HEVC'
  }

  // H.264 / AVC
  if (
    codecLower === 'h264' ||
    codecLower === 'h.264' ||
    codecLower === 'avc' ||
    codecLower === 'x264' ||
    codecLower.includes('avc') ||
    codecLower.includes('h264')
  ) {
    return 'H.264'
  }

  // AV1
  if (codecLower === 'av1' || codecLower.includes('av01')) {
    return 'AV1'
  }

  // VP9
  if (codecLower === 'vp9' || codecLower.includes('vp9')) {
    return 'VP9'
  }

  // VP8
  if (codecLower === 'vp8' || codecLower.includes('vp8')) {
    return 'VP8'
  }

  // MPEG-4 Part 2 (DivX, Xvid)
  if (
    codecLower === 'mpeg4' ||
    codecLower === 'mp4v' ||
    codecLower === 'divx' ||
    codecLower === 'xvid' ||
    codecLower.includes('mpeg4') ||
    codecLower.includes('divx') ||
    codecLower.includes('xvid')
  ) {
    return 'MPEG-4'
  }

  // MPEG-2
  if (
    codecLower === 'mpeg2' ||
    codecLower === 'mpeg2video' ||
    codecLower === 'mp2v' ||
    codecLower.includes('mpeg2')
  ) {
    return 'MPEG-2'
  }

  // VC-1 (Windows Media Video 9)
  if (
    codecLower === 'vc1' ||
    codecLower === 'vc-1' ||
    codecLower === 'wmv3' ||
    codecLower === 'wvc1' ||
    codecLower.includes('vc1') ||
    codecLower.includes('wmv')
  ) {
    return 'VC-1'
  }

  // MPEG-1
  if (codecLower === 'mpeg1' || codecLower === 'mpeg1video') {
    return 'MPEG-1'
  }

  // ProRes
  if (codecLower.includes('prores')) {
    return 'ProRes'
  }

  // DNxHD/DNxHR
  if (codecLower.includes('dnxh')) {
    return 'DNxHD'
  }

  // Return uppercase version of unknown codec
  return codec.toUpperCase()
}

// ============================================================================
// AUDIO CODEC NORMALIZATION
// ============================================================================

/**
 * Normalize audio codec to a standard display name
 * Maps various codec identifiers to consistent names
 */
export function normalizeAudioCodec(codec: string | null | undefined, profile?: string): string {
  if (!codec) return ''

  const codecLower = codec.toLowerCase().trim()
  const profileLower = (profile || '').toLowerCase().trim()

  // Plex/FFprobe sends DTS variants as codec 'dca'/'dts' + profile to distinguish
  if (codecLower === 'dca' || (codecLower === 'dts' && profileLower)) {
    if (profileLower === 'ma' || profileLower.includes('dts-hd ma')) return 'DTS-HD MA'
    if (profileLower === 'hra' || profileLower.includes('dts-hd hra') || profileLower.includes('dts-hd hr')) return 'DTS-HD'
    if (profileLower.includes('dts:x') || profileLower.includes('dtsx') || profileLower === 'x') return 'DTS:X'
    if (codecLower === 'dca') return 'DTS'
  }

  // TrueHD (with or without Atmos)
  if (codecLower.includes('truehd')) {
    return 'TrueHD'
  }

  // DTS-HD Master Audio
  if (
    codecLower.includes('dts-hd ma') ||
    codecLower.includes('dtshd_ma') ||
    codecLower.includes('dts-hd.ma') ||
    codecLower === 'dts-hd ma'
  ) {
    return 'DTS-HD MA'
  }

  // DTS-HD High Resolution
  if (
    codecLower.includes('dts-hd hr') ||
    codecLower.includes('dts-hd') ||
    codecLower.includes('dtshd')
  ) {
    return 'DTS-HD'
  }

  // DTS:X (usually signaled by profile, not codec)
  if (codecLower.includes('dts:x') || codecLower.includes('dtsx')) {
    return 'DTS:X'
  }

  // DTS (standard)
  if (
    codecLower === 'dts' ||
    codecLower === 'dca' ||
    codecLower.includes('dts')
  ) {
    return 'DTS'
  }

  // E-AC-3 / Dolby Digital Plus (with or without Atmos)
  if (
    codecLower === 'eac3' ||
    codecLower === 'ec3' ||
    codecLower === 'e-ac-3' ||
    codecLower === 'ec-3' ||
    codecLower.includes('eac3') ||
    codecLower.includes('dolby digital plus')
  ) {
    return 'EAC3'
  }

  // AC-3 / Dolby Digital
  if (
    codecLower === 'ac3' ||
    codecLower === 'ac-3' ||
    codecLower === 'a52' ||
    codecLower.includes('dolby digital')
  ) {
    return 'AC3'
  }

  // AAC
  if (
    codecLower === 'aac' ||
    codecLower.includes('aac')
  ) {
    return 'AAC'
  }

  // FLAC
  if (codecLower === 'flac' || codecLower.includes('flac')) {
    return 'FLAC'
  }

  // ALAC (Apple Lossless)
  if (codecLower === 'alac' || codecLower.includes('alac')) {
    return 'ALAC'
  }

  // PCM / LPCM
  if (
    codecLower === 'pcm' ||
    codecLower === 'lpcm' ||
    codecLower.includes('pcm_')
  ) {
    return 'PCM'
  }

  // MP3
  if (
    codecLower === 'mp3' ||
    codecLower === 'mp3float' ||
    codecLower.includes('mp3') ||
    codecLower.includes('mpeg audio')
  ) {
    return 'MP3'
  }

  // Opus
  if (codecLower === 'opus' || codecLower.includes('opus')) {
    return 'Opus'
  }

  // Vorbis
  if (codecLower === 'vorbis' || codecLower.includes('vorbis')) {
    return 'Vorbis'
  }

  // WMA
  if (codecLower.includes('wma') || codecLower.includes('wmav')) {
    return 'WMA'
  }

  // Return uppercase version of unknown codec
  return codec.toUpperCase()
}

// ============================================================================
// AUDIO CODEC WITH ATMOS/DTS:X DETECTION
// ============================================================================

/**
 * Get full audio codec name including object audio format (Atmos, DTS:X)
 */
export function getFullAudioCodecName(
  codec: string | null | undefined,
  profile: string | null | undefined,
  title: string | null | undefined,
  channelLayout: string | null | undefined
): string {
  const normalizedCodec = normalizeAudioCodec(codec)
  if (!normalizedCodec) return ''

  const profileLower = (profile || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()
  const layoutLower = (channelLayout || '').toLowerCase()

  // Check for Atmos
  const hasAtmos =
    profileLower.includes('atmos') ||
    titleLower.includes('atmos') ||
    layoutLower.includes('atmos')

  // Check for DTS:X
  const hasDtsX =
    profileLower.includes('dts:x') ||
    profileLower.includes('dtsx') ||
    titleLower.includes('dts:x') ||
    titleLower.includes('dts-x')

  if (normalizedCodec === 'TrueHD' && hasAtmos) {
    return 'TrueHD Atmos'
  }

  if (normalizedCodec === 'EAC3' && hasAtmos) {
    return 'EAC3 Atmos'
  }

  if ((normalizedCodec === 'DTS' || normalizedCodec === 'DTS-HD MA') && hasDtsX) {
    return 'DTS:X'
  }

  return normalizedCodec
}

// ============================================================================
// RESOLUTION NORMALIZATION
// ============================================================================

/**
 * Normalize resolution to a standard label
 */
export function normalizeResolution(
  width: number | null | undefined,
  height: number | null | undefined
): string {
  const w = width || 0
  const h = height || 0

  // Use height as primary indicator, width as secondary
  if (h >= 2160 || w >= 3840) return '4K'
  if (h >= 1080 || w >= 1920) return '1080p'
  if (h >= 720 || w >= 1280) return '720p'
  if (h >= 480 || w >= 720) return '480p'
  if (h > 0 || w > 0) return 'SD'
  return ''
}

// ============================================================================
// HDR FORMAT NORMALIZATION
// ============================================================================

/**
 * Normalize HDR format from various sources
 */
export function normalizeHdrFormat(
  hdrType: string | null | undefined,
  colorTrc: string | null | undefined,
  colorPrimaries: string | null | undefined,
  bitDepth: number | null | undefined,
  profile: string | null | undefined
): string | undefined {
  // Check explicit HDR type first (Kodi, some Jellyfin)
  if (hdrType) {
    const hdrLower = hdrType.toLowerCase()

    if (hdrLower.includes('dolbyvision') || hdrLower.includes('dolby vision') || hdrLower.includes('dovi')) {
      return 'Dolby Vision'
    }
    if (hdrLower.includes('hdr10+') || hdrLower.includes('hdr10plus')) {
      return 'HDR10+'
    }
    if (hdrLower.includes('hdr10') || hdrLower === 'hdr') {
      return 'HDR10'
    }
    if (hdrLower.includes('hlg')) {
      return 'HLG'
    }
  }

  // Check profile for Dolby Vision
  if (profile) {
    const profileLower = profile.toLowerCase()
    if (profileLower.includes('dolby vision') || profileLower.includes('dovi')) {
      return 'Dolby Vision'
    }
  }

  // Check color primaries and transfer characteristics (Plex style)
  const trcLower = (colorTrc || '').toLowerCase()
  const primariesLower = (colorPrimaries || '').toLowerCase()

  // Dolby Vision detection
  if (trcLower.includes('dovi') || primariesLower.includes('dovi')) {
    return 'Dolby Vision'
  }

  // HDR10+ detection
  if (trcLower.includes('hdr10+') || trcLower.includes('smpte2094')) {
    return 'HDR10+'
  }

  // HLG detection
  if (trcLower.includes('hlg') || trcLower === 'arib-std-b67') {
    return 'HLG'
  }

  // HDR10 detection (BT.2020 with PQ transfer)
  if (
    (primariesLower.includes('bt2020') || primariesLower.includes('rec2020')) &&
    (trcLower.includes('smpte2084') || trcLower.includes('pq') || trcLower.includes('st2084'))
  ) {
    return 'HDR10'
  }

  // Generic HDR detection by bit depth
  if (bitDepth && bitDepth >= 10) {
    if (primariesLower.includes('bt2020') || primariesLower.includes('rec2020')) {
      return 'HDR10'
    }
  }

  return undefined
}

// ============================================================================
// BITRATE NORMALIZATION
// ============================================================================

/**
 * Normalize bitrate to kbps (kilobits per second)
 * Handles various input formats from different providers
 */
export function normalizeBitrate(
  bitrate: number | string | null | undefined,
  sourceUnit: 'bps' | 'kbps' | 'mbps' | 'auto' = 'auto'
): number {
  if (bitrate === null || bitrate === undefined) return 0

  const value = typeof bitrate === 'string' ? parseFloat(bitrate) : bitrate
  if (isNaN(value) || value <= 0) return 0

  if (sourceUnit === 'bps') {
    return Math.round(value / 1000)
  }
  if (sourceUnit === 'mbps') {
    return Math.round(value * 1000)
  }
  if (sourceUnit === 'kbps') {
    return Math.round(value)
  }

  // Auto-detect: if value > 100000, it's likely bps
  if (value > 100000) {
    return Math.round(value / 1000)
  }
  // If value < 100, it's likely Mbps
  if (value < 100) {
    return Math.round(value * 1000)
  }
  // Otherwise assume kbps
  return Math.round(value)
}

// ============================================================================
// FRAME RATE NORMALIZATION
// ============================================================================

/**
 * Normalize frame rate to a number
 * Handles string formats like "23.976", "24000/1001", "29.97fps"
 */
export function normalizeFrameRate(
  frameRate: number | string | null | undefined
): number | undefined {
  if (frameRate === null || frameRate === undefined) return undefined

  if (typeof frameRate === 'number') {
    return frameRate > 0 ? Math.round(frameRate * 1000) / 1000 : undefined
  }

  const str = frameRate.toString().toLowerCase().replace('fps', '').trim()

  // Handle fraction format (e.g., "24000/1001")
  if (str.includes('/')) {
    const [num, den] = str.split('/')
    const numerator = parseFloat(num)
    const denominator = parseFloat(den)
    if (denominator > 0) {
      return Math.round((numerator / denominator) * 1000) / 1000
    }
    return undefined
  }

  const value = parseFloat(str)
  return value > 0 ? Math.round(value * 1000) / 1000 : undefined
}

// ============================================================================
// AUDIO CHANNELS NORMALIZATION
// ============================================================================

/**
 * Normalize audio channels to an integer
 * Handles various formats from different providers
 */
export function normalizeAudioChannels(
  channels: number | string | null | undefined,
  channelLayout: string | null | undefined
): number {
  // Direct channel count
  if (typeof channels === 'number' && channels > 0) {
    return Math.round(channels)
  }

  if (typeof channels === 'string') {
    const parsed = parseInt(channels, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }

  // Parse from channel layout string
  if (channelLayout) {
    const layout = channelLayout.toLowerCase()

    // Common layout patterns
    if (layout.includes('7.1')) return 8
    if (layout.includes('6.1')) return 7
    if (layout.includes('5.1')) return 6
    if (layout.includes('5.0')) return 5
    if (layout.includes('4.1')) return 5
    if (layout.includes('4.0') || layout.includes('quad')) return 4
    if (layout.includes('stereo') || layout.includes('2.0')) return 2
    if (layout.includes('mono') || layout.includes('1.0')) return 1

    // Count channels from layout (e.g., "FL+FR+FC+LFE+BL+BR")
    const channelCount = (layout.match(/\+/g) || []).length + 1
    if (channelCount > 1) return channelCount
  }

  return 2 // Default to stereo
}

// ============================================================================
// AUDIO SAMPLE RATE NORMALIZATION
// ============================================================================

/**
 * Normalize audio sample rate to Hz
 */
export function normalizeSampleRate(
  sampleRate: number | string | null | undefined
): number | undefined {
  if (sampleRate === null || sampleRate === undefined) return undefined

  const value = typeof sampleRate === 'string' ? parseInt(sampleRate, 10) : sampleRate
  if (isNaN(value) || value <= 0) return undefined

  // If value is small, it might be in kHz
  if (value < 1000) {
    return value * 1000
  }

  return value
}

// ============================================================================
// CONTAINER NORMALIZATION
// ============================================================================

/**
 * Normalize container format
 */
export function normalizeContainer(container: string | null | undefined): string {
  if (!container) return ''

  // Emby may return comma-separated containers (e.g., "matroska,webm") — use the first
  const containerLower = container.split(',')[0].toLowerCase().trim()

  // Common video containers
  if (containerLower === 'mkv' || containerLower === 'matroska') return 'MKV'
  if (containerLower === 'mp4' || containerLower === 'm4v') return 'MP4'
  if (containerLower === 'avi') return 'AVI'
  if (containerLower === 'mov' || containerLower === 'quicktime') return 'MOV'
  if (containerLower === 'wmv' || containerLower === 'asf') return 'WMV'
  if (containerLower === 'ts' || containerLower === 'mpegts') return 'TS'
  if (containerLower === 'webm') return 'WebM'
  if (containerLower === 'flv') return 'FLV'
  if (containerLower === 'ogm' || containerLower === 'ogg') return 'OGG'

  return container.toUpperCase()
}

// ============================================================================
// OBJECT AUDIO DETECTION
// ============================================================================

/**
 * Detect if audio track has object-based audio (Atmos, DTS:X)
 */
export function hasObjectAudio(
  codec: string | null | undefined,
  profile: string | null | undefined,
  title: string | null | undefined,
  channelLayout: string | null | undefined
): boolean {
  const codecLower = (codec || '').toLowerCase()
  const profileLower = (profile || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()
  const layoutLower = (channelLayout || '').toLowerCase()

  // Atmos detection
  const hasAtmos =
    profileLower.includes('atmos') ||
    titleLower.includes('atmos') ||
    layoutLower.includes('atmos')

  // DTS:X detection
  const hasDtsX =
    profileLower.includes('dts:x') ||
    profileLower.includes('dtsx') ||
    titleLower.includes('dts:x') ||
    titleLower.includes('dts-x')

  // Atmos can be in TrueHD or E-AC-3
  if (hasAtmos && (codecLower.includes('truehd') || codecLower.includes('eac3') || codecLower.includes('ec3'))) {
    return true
  }

  // DTS:X is based on DTS-HD MA
  if (hasDtsX && codecLower.includes('dts')) {
    return true
  }

  return false
}

// ============================================================================
// CONVENIENCE FUNCTION FOR FULL NORMALIZATION
// ============================================================================

export interface RawMediaInfo {
  // Video
  videoCodec?: string | null
  videoWidth?: number | null
  videoHeight?: number | null
  videoBitrate?: number | null
  videoBitrateUnit?: 'bps' | 'kbps' | 'mbps' | 'auto'
  videoFrameRate?: number | string | null
  videoBitDepth?: number | null
  videoProfile?: string | null
  videoLevel?: string | null
  hdrType?: string | null
  colorTrc?: string | null
  colorPrimaries?: string | null
  colorSpace?: string | null

  // Audio (primary track)
  audioCodec?: string | null
  audioChannels?: number | string | null
  audioChannelLayout?: string | null
  audioBitrate?: number | null
  audioBitrateUnit?: 'bps' | 'kbps' | 'mbps' | 'auto'
  audioSampleRate?: number | string | null
  audioProfile?: string | null
  audioTitle?: string | null

  // Container
  container?: string | null
}

export interface NormalizedMediaInfo {
  // Video
  videoCodec: string
  resolution: string
  width: number
  height: number
  videoBitrate: number
  videoFrameRate?: number
  videoBitDepth?: number
  videoProfile?: string
  videoLevel?: string
  hdrFormat?: string
  colorSpace?: string

  // Audio
  audioCodec: string
  audioCodecFull: string
  audioChannels: number
  audioBitrate: number
  audioSampleRate?: number
  audioProfile?: string
  hasObjectAudio: boolean

  // Container
  container: string
}

/**
 * Normalize all media info at once
 */
export function normalizeMediaInfo(raw: RawMediaInfo): NormalizedMediaInfo {
  const width = raw.videoWidth || 0
  const height = raw.videoHeight || 0

  return {
    // Video
    videoCodec: normalizeVideoCodec(raw.videoCodec),
    resolution: normalizeResolution(width, height),
    width,
    height,
    videoBitrate: normalizeBitrate(raw.videoBitrate, raw.videoBitrateUnit || 'auto'),
    videoFrameRate: normalizeFrameRate(raw.videoFrameRate),
    videoBitDepth: raw.videoBitDepth || undefined,
    videoProfile: raw.videoProfile || undefined,
    videoLevel: raw.videoLevel || undefined,
    hdrFormat: normalizeHdrFormat(
      raw.hdrType,
      raw.colorTrc,
      raw.colorPrimaries,
      raw.videoBitDepth,
      raw.videoProfile
    ),
    colorSpace: raw.colorSpace || undefined,

    // Audio
    audioCodec: normalizeAudioCodec(raw.audioCodec),
    audioCodecFull: getFullAudioCodecName(
      raw.audioCodec,
      raw.audioProfile,
      raw.audioTitle,
      raw.audioChannelLayout
    ),
    audioChannels: normalizeAudioChannels(raw.audioChannels, raw.audioChannelLayout),
    audioBitrate: normalizeBitrate(raw.audioBitrate, raw.audioBitrateUnit || 'auto'),
    audioSampleRate: normalizeSampleRate(raw.audioSampleRate),
    audioProfile: raw.audioProfile || undefined,
    hasObjectAudio: hasObjectAudio(
      raw.audioCodec,
      raw.audioProfile,
      raw.audioTitle,
      raw.audioChannelLayout
    ),

    // Container
    container: normalizeContainer(raw.container),
  }
}
