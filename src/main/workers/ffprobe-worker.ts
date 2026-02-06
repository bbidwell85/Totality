/**
 * FFprobe Worker Thread
 *
 * Runs FFprobe analysis in a separate thread to enable parallel processing.
 * Receives file paths, executes FFprobe, and returns parsed results.
 */

import { parentPort, workerData } from 'worker_threads'
import { spawn } from 'child_process'

// Types mirrored from MediaFileAnalyzer (can't import due to worker isolation)
interface FFprobeStream {
  index: number
  codec_name?: string
  codec_long_name?: string
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  profile?: string
  level?: number
  width?: number
  height?: number
  coded_width?: number
  coded_height?: number
  pix_fmt?: string
  color_space?: string
  color_transfer?: string
  color_primaries?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  bit_rate?: string
  bits_per_raw_sample?: string
  sample_rate?: string
  channels?: number
  channel_layout?: string
  bits_per_sample?: number
  duration?: string
  tags?: {
    language?: string
    title?: string
    BPS?: string
    'BPS-eng'?: string
    NUMBER_OF_BYTES?: string
    'NUMBER_OF_BYTES-eng'?: string
    [key: string]: string | undefined
  }
  disposition?: {
    default: number
    forced: number
    attached_pic: number
    [key: string]: number
  }
  side_data_list?: Array<{
    side_data_type: string
    [key: string]: unknown
  }>
}

interface FFprobeFormat {
  filename: string
  nb_streams: number
  format_name: string
  duration?: string
  size?: string
  bit_rate?: string
  tags?: Record<string, string>
}

interface FFprobeOutput {
  streams: FFprobeStream[]
  format: FFprobeFormat
}

interface WorkerTask {
  taskId: string
  filePath: string
}

interface AnalyzedVideoStream {
  index: number
  codec: string
  profile?: string
  level?: number
  width: number
  height: number
  bitrate?: number
  frameRate?: number
  bitDepth?: number
  pixelFormat?: string
  colorSpace?: string
  colorTransfer?: string
  colorPrimaries?: string
  hdrFormat?: string
}

interface AnalyzedAudioStream {
  index: number
  codec: string
  profile?: string
  channels: number
  channelLayout?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  language?: string
  title?: string
  isDefault: boolean
  hasObjectAudio: boolean
}

interface AnalyzedSubtitleStream {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault: boolean
  isForced: boolean
}

interface EmbeddedMetadataTags {
  title?: string
  year?: number
  description?: string
  showName?: string
  seasonNumber?: number
  episodeNumber?: number
  episodeTitle?: string
}

interface FileAnalysisResult {
  success: boolean
  error?: string
  filePath: string
  container?: string
  duration?: number
  fileSize?: number
  overallBitrate?: number
  video?: AnalyzedVideoStream
  audioTracks: AnalyzedAudioStream[]
  subtitleTracks: AnalyzedSubtitleStream[]
  embeddedArtwork?: {
    hasArtwork: boolean
    mimeType?: string
    streamIndex?: number
  }
  embeddedMetadata?: EmbeddedMetadataTags
}

interface WorkerResult {
  taskId: string
  result: FileAnalysisResult
}

// Get FFprobe path from worker data
const ffprobePath: string = workerData?.ffprobePath || 'ffprobe'

/**
 * Run FFprobe on a file and return raw JSON output
 */
function runFFprobe(filePath: string): Promise<FFprobeOutput> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]

    const proc = spawn(ffprobePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        try {
          const output = JSON.parse(stdout) as FFprobeOutput
          resolve(output)
        } catch (e) {
          reject(new Error(`Failed to parse FFprobe output: ${e}`))
        }
      } else {
        reject(new Error(stderr || `FFprobe exited with code ${code}`))
      }
    })

    proc.on('error', (error) => {
      reject(new Error(`Failed to run FFprobe: ${error.message}`))
    })
  })
}

/**
 * Parse frame rate string (e.g., "24000/1001") to number
 */
function parseFrameRate(frameRateStr?: string): number | undefined {
  if (!frameRateStr || frameRateStr === '0/0') return undefined

  const parts = frameRateStr.split('/')
  if (parts.length === 2) {
    const num = parseInt(parts[0], 10)
    const den = parseInt(parts[1], 10)
    if (den !== 0) {
      return Math.round((num / den) * 100) / 100
    }
  }

  const parsed = parseFloat(frameRateStr)
  return isNaN(parsed) ? undefined : Math.round(parsed * 100) / 100
}

/**
 * Extract bitrate from stream metadata
 */
function extractBitrate(stream: FFprobeStream, durationMs?: number): number | undefined {
  if (stream.bit_rate) {
    return Math.round(parseInt(stream.bit_rate, 10) / 1000)
  }

  const bps = stream.tags?.BPS || stream.tags?.['BPS-eng']
  if (bps) {
    return Math.round(parseInt(bps, 10) / 1000)
  }

  const numBytes = stream.tags?.NUMBER_OF_BYTES || stream.tags?.['NUMBER_OF_BYTES-eng']
  const streamDuration = stream.duration ? parseFloat(stream.duration) * 1000 : durationMs
  if (numBytes && streamDuration && streamDuration > 0) {
    const bytes = parseInt(numBytes, 10)
    const durationSec = streamDuration / 1000
    return Math.round((bytes * 8) / durationSec / 1000)
  }

  return undefined
}

/**
 * Extract bit depth from video stream
 */
function extractBitDepth(stream: FFprobeStream): number | undefined {
  if (stream.bits_per_raw_sample) {
    return parseInt(stream.bits_per_raw_sample, 10)
  }

  const pixFmt = stream.pix_fmt?.toLowerCase() || ''
  if (pixFmt.includes('12le') || pixFmt.includes('12be')) return 12
  if (pixFmt.includes('10le') || pixFmt.includes('10be') || pixFmt.includes('p010')) return 10
  if (pixFmt.includes('yuv420p') || pixFmt.includes('yuv422p') || pixFmt.includes('yuv444p')) return 8

  return undefined
}

/**
 * Detect HDR format from stream metadata
 */
function detectHdrFormat(stream: FFprobeStream): string | undefined {
  const colorTransfer = stream.color_transfer?.toLowerCase() || ''
  const colorPrimaries = stream.color_primaries?.toLowerCase() || ''
  const colorSpace = stream.color_space?.toLowerCase() || ''

  const sideData = stream.side_data_list || []
  const hasDolbyVision = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('dolby vision')
  )
  const hasHdr10Plus = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('hdr10+') ||
    sd.side_data_type?.toLowerCase().includes('dynamic hdr')
  )
  const hasMasteringDisplay = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('mastering display')
  )
  const hasContentLight = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('content light')
  )

  if (hasDolbyVision) return 'Dolby Vision'
  if (hasHdr10Plus) return 'HDR10+'

  if (
    (colorTransfer.includes('smpte2084') || colorTransfer.includes('pq')) &&
    (colorPrimaries.includes('bt2020') || colorSpace.includes('bt2020'))
  ) {
    if (hasMasteringDisplay || hasContentLight) return 'HDR10'
    return 'PQ'
  }

  if (colorTransfer.includes('arib-std-b67') || colorTransfer.includes('hlg')) {
    return 'HLG'
  }

  return undefined
}

/**
 * Detect object-based audio (Atmos, DTS:X)
 */
function detectObjectAudio(stream: FFprobeStream): boolean {
  const codec = stream.codec_name?.toLowerCase() || ''
  const profile = stream.profile?.toLowerCase() || ''
  const title = stream.tags?.title?.toLowerCase() || ''

  if (codec === 'truehd' && (profile.includes('atmos') || title.includes('atmos'))) {
    return true
  }
  if (codec === 'eac3' && (profile.includes('atmos') || title.includes('atmos'))) {
    return true
  }
  if (codec.includes('dts') && (profile.includes('x') || title.includes('dts:x') || title.includes('dts-x'))) {
    return true
  }

  return false
}

/**
 * Estimate audio bitrate for codecs that don't report it
 */
function estimateAudioBitrate(codec: string, channels: number, profile?: string, sampleRateStr?: string): number | undefined {
  const codecLower = codec.toLowerCase()
  const sampleRate = sampleRateStr ? parseInt(sampleRateStr, 10) : 48000

  if (codecLower === 'ac3') {
    if (channels <= 2) return 192
    if (channels <= 6) return 448
    return 640
  }

  if (codecLower === 'eac3') {
    if (channels <= 2) return 256
    if (channels <= 6) return 640
    if (channels <= 8) return 1024
    return 1536
  }

  if (codecLower === 'truehd') {
    const baseRate = sampleRate > 48000 ? 4000 : 2500
    if (channels <= 2) return Math.round(baseRate * 0.4)
    if (channels <= 6) return baseRate
    if (channels <= 8) return Math.round(baseRate * 1.6)
    return Math.round(baseRate * 2)
  }

  if (codecLower === 'dts') {
    const profileLower = profile?.toLowerCase() || ''
    if (profileLower.includes('ma') || profileLower.includes('hd ma')) {
      if (channels <= 2) return 1500
      if (channels <= 6) return 3000
      if (channels <= 8) return 4500
      return 6000
    }
    if (profileLower.includes('hra') || profileLower.includes('hd hra')) {
      if (channels <= 6) return 1500
      return 2000
    }
    if (channels <= 2) return 768
    if (channels <= 6) return 1509
    return 1509
  }

  if (codecLower === 'flac') {
    const bitDepth = 16
    const compressionRatio = 0.6
    return Math.round((channels * sampleRate * bitDepth * compressionRatio) / 1000)
  }

  if (codecLower.includes('pcm')) {
    const bitDepth = 16
    return Math.round((channels * sampleRate * bitDepth) / 1000)
  }

  return undefined
}

/**
 * Parse video stream
 */
function parseVideoStream(stream: FFprobeStream, durationMs?: number): AnalyzedVideoStream {
  const bitrate = extractBitrate(stream, durationMs)
  const frameRate = parseFrameRate(stream.avg_frame_rate || stream.r_frame_rate)
  const bitDepth = extractBitDepth(stream)
  const hdrFormat = detectHdrFormat(stream)

  return {
    index: stream.index,
    codec: stream.codec_name || 'unknown',
    profile: stream.profile,
    level: stream.level,
    width: stream.width || stream.coded_width || 0,
    height: stream.height || stream.coded_height || 0,
    bitrate,
    frameRate,
    bitDepth,
    pixelFormat: stream.pix_fmt,
    colorSpace: stream.color_space,
    colorTransfer: stream.color_transfer,
    colorPrimaries: stream.color_primaries,
    hdrFormat,
  }
}

/**
 * Parse audio stream
 */
function parseAudioStream(stream: FFprobeStream, durationMs?: number): AnalyzedAudioStream {
  let bitrate = extractBitrate(stream, durationMs)
  const hasObjectAudio = detectObjectAudio(stream)
  const codec = stream.codec_name?.toLowerCase() || 'unknown'
  const channels = stream.channels || 2

  if (!bitrate) {
    bitrate = estimateAudioBitrate(codec, channels, stream.profile, stream.sample_rate)
  }

  return {
    index: stream.index,
    codec: stream.codec_name || 'unknown',
    profile: stream.profile,
    channels,
    channelLayout: stream.channel_layout,
    bitrate,
    sampleRate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : undefined,
    bitDepth: stream.bits_per_sample || (stream.bits_per_raw_sample ? parseInt(stream.bits_per_raw_sample, 10) : undefined),
    language: stream.tags?.language,
    title: stream.tags?.title,
    isDefault: stream.disposition?.default === 1,
    hasObjectAudio,
  }
}

/**
 * Parse subtitle stream
 */
function parseSubtitleStream(stream: FFprobeStream): AnalyzedSubtitleStream {
  return {
    index: stream.index,
    codec: stream.codec_name || 'unknown',
    language: stream.tags?.language,
    title: stream.tags?.title,
    isDefault: stream.disposition?.default === 1,
    isForced: stream.disposition?.forced === 1,
  }
}

/**
 * Get MIME type for embedded artwork
 */
function getArtworkMimeType(codecName?: string): string {
  if (!codecName) return 'image/jpeg'
  const codec = codecName.toLowerCase()
  if (codec === 'png') return 'image/png'
  if (codec === 'bmp') return 'image/bmp'
  if (codec === 'gif') return 'image/gif'
  if (codec === 'webp') return 'image/webp'
  return 'image/jpeg'
}

/**
 * Parse FFprobe output into FileAnalysisResult
 */
function parseFFprobeOutput(filePath: string, output: FFprobeOutput): FileAnalysisResult {
  const result: FileAnalysisResult = {
    success: true,
    filePath,
    audioTracks: [],
    subtitleTracks: [],
  }

  // Parse format info
  if (output.format) {
    result.container = output.format.format_name
    result.fileSize = output.format.size ? parseInt(output.format.size, 10) : undefined
    result.duration = output.format.duration
      ? Math.round(parseFloat(output.format.duration) * 1000)
      : undefined
    result.overallBitrate = output.format.bit_rate
      ? Math.round(parseInt(output.format.bit_rate, 10) / 1000)
      : undefined

    // Extract embedded metadata
    if (output.format.tags) {
      const tags = output.format.tags
      const embeddedMetadata: EmbeddedMetadataTags = {}

      const titleTag = tags.title || tags.TITLE
      if (titleTag?.trim()) {
        embeddedMetadata.title = titleTag.trim()
      }

      const dateTag = tags.date || tags.DATE || tags.year || tags.YEAR || tags.creation_time
      if (dateTag) {
        const yearMatch = dateTag.match(/^(\d{4})/)
        if (yearMatch) {
          embeddedMetadata.year = parseInt(yearMatch[1], 10)
        }
      }

      const descriptionTag = tags.description || tags.DESCRIPTION || tags.synopsis || tags.SYNOPSIS || tags.comment || tags.COMMENT
      if (descriptionTag?.trim()) {
        embeddedMetadata.description = descriptionTag.trim()
      }

      const showTag = tags.show || tags.SHOW || tags.album
      if (showTag?.trim()) {
        embeddedMetadata.showName = showTag.trim()
      }

      const seasonTag = tags.season_number || tags.SEASON_NUMBER || tags.season || tags.SEASON
      if (seasonTag) {
        const seasonNum = parseInt(seasonTag, 10)
        if (!isNaN(seasonNum) && seasonNum > 0) {
          embeddedMetadata.seasonNumber = seasonNum
        }
      }

      const episodeTag = tags.episode_sort || tags.EPISODE_SORT || tags.episode || tags.EPISODE || tags.track || tags.TRACK
      if (episodeTag) {
        const episodeNum = parseInt(episodeTag, 10)
        if (!isNaN(episodeNum) && episodeNum > 0) {
          embeddedMetadata.episodeNumber = episodeNum
        }
      }

      const episodeTitleTag = tags.episode_id || tags.EPISODE_ID
      if (episodeTitleTag?.trim()) {
        embeddedMetadata.episodeTitle = episodeTitleTag.trim()
      }

      if (Object.keys(embeddedMetadata).length > 0) {
        result.embeddedMetadata = embeddedMetadata
      }
    }
  }

  // Parse streams
  for (const stream of output.streams) {
    if (stream.disposition?.attached_pic === 1) {
      result.embeddedArtwork = {
        hasArtwork: true,
        mimeType: getArtworkMimeType(stream.codec_name),
        streamIndex: stream.index,
      }
      continue
    }

    switch (stream.codec_type) {
      case 'video':
        if (!result.video) {
          result.video = parseVideoStream(stream, result.duration)
        }
        break
      case 'audio':
        result.audioTracks.push(parseAudioStream(stream, result.duration))
        break
      case 'subtitle':
        result.subtitleTracks.push(parseSubtitleStream(stream))
        break
    }
  }

  // Calculate video bitrate from file size
  if (result.video && result.fileSize && result.duration) {
    const durationSeconds = result.duration / 1000
    const calculatedTotalBitrate = Math.round((result.fileSize * 8) / durationSeconds / 1000)

    let totalAudioBitrate = result.audioTracks.reduce((sum, t) => sum + (t.bitrate || 0), 0)
    const maxAudioBitrate = Math.round(calculatedTotalBitrate * 0.30)
    if (totalAudioBitrate > maxAudioBitrate) {
      totalAudioBitrate = maxAudioBitrate
    }

    const calculatedVideoBitrate = Math.max(0, calculatedTotalBitrate - totalAudioBitrate)
    const metadataBitrate = result.video.bitrate

    if (metadataBitrate) {
      const ratio = metadataBitrate / calculatedVideoBitrate
      if (ratio < 0.5 || ratio > 1.5) {
        result.video.bitrate = calculatedVideoBitrate
      }
    } else {
      result.video.bitrate = calculatedVideoBitrate
    }
  } else if (result.video && result.overallBitrate && !result.video.bitrate) {
    let totalAudioBitrate = result.audioTracks.reduce((sum, t) => sum + (t.bitrate || 0), 0)
    const maxAudioBitrate = Math.round(result.overallBitrate * 0.30)
    if (totalAudioBitrate > maxAudioBitrate) {
      totalAudioBitrate = maxAudioBitrate
    }
    result.video.bitrate = Math.max(0, result.overallBitrate - totalAudioBitrate)
  }

  return result
}

/**
 * Analyze a single file
 */
async function analyzeFile(filePath: string): Promise<FileAnalysisResult> {
  try {
    const output = await runFFprobe(filePath)
    return parseFFprobeOutput(filePath, output)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      filePath,
      audioTracks: [],
      subtitleTracks: [],
    }
  }
}

// Handle messages from main thread
if (parentPort) {
  parentPort.on('message', async (task: WorkerTask) => {
    const result = await analyzeFile(task.filePath)
    const response: WorkerResult = {
      taskId: task.taskId,
      result,
    }
    parentPort!.postMessage(response)
  })
}
