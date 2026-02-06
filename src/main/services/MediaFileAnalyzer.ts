import { getErrorMessage } from './utils/errorUtils'
/**
 * MediaFileAnalyzer Service
 *
 * Analyzes media files using FFprobe to extract accurate quality metadata.
 * This is used when providers (like Kodi) don't have complete metadata.
 *
 * Can use system FFprobe or download it automatically.
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import * as https from 'https'
import { app } from 'electron'
import { createWriteStream, mkdirSync } from 'fs'
import { pipeline } from 'stream/promises'

// FFprobe JSON output types
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
  field_order?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  bit_rate?: string
  bits_per_raw_sample?: string
  sample_rate?: string
  channels?: number
  channel_layout?: string
  sample_fmt?: string
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
    dub: number
    original: number
    comment: number
    lyrics: number
    karaoke: number
    forced: number
    hearing_impaired: number
    visual_impaired: number
    clean_effects: number
    attached_pic: number
    timed_thumbnails: number
  }
  side_data_list?: Array<{
    side_data_type: string
    [key: string]: unknown
  }>
}

interface FFprobeFormat {
  filename: string
  nb_streams: number
  nb_programs: number
  format_name: string
  format_long_name: string
  start_time?: string
  duration?: string
  size?: string
  bit_rate?: string
  probe_score: number
  tags?: {
    [key: string]: string
  }
}

interface FFprobeOutput {
  streams: FFprobeStream[]
  format: FFprobeFormat
}

// Analyzed result types
export interface AnalyzedVideoStream {
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

export interface AnalyzedAudioStream {
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

export interface AnalyzedSubtitleStream {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault: boolean
  isForced: boolean
}

export interface EmbeddedArtwork {
  hasArtwork: boolean
  mimeType?: string
  streamIndex?: number
}

/**
 * Embedded metadata tags extracted from file container (MKV, MP4, etc.)
 * These are authoritatively set in the file and should be prioritized over filename parsing
 */
export interface EmbeddedMetadataTags {
  title?: string           // Movie/episode title from container tags
  year?: number            // Release year (from date or year tag)
  description?: string     // Plot synopsis/description
  // TV-specific tags
  showName?: string        // Series name (for TV episodes)
  seasonNumber?: number    // Season number
  episodeNumber?: number   // Episode number (sort order)
  episodeTitle?: string    // Episode title (if different from main title)
}

export interface FileAnalysisResult {
  success: boolean
  error?: string
  filePath: string
  container?: string
  duration?: number // milliseconds
  fileSize?: number // bytes
  overallBitrate?: number // kbps

  video?: AnalyzedVideoStream
  audioTracks: AnalyzedAudioStream[]
  subtitleTracks: AnalyzedSubtitleStream[]
  embeddedArtwork?: EmbeddedArtwork
  embeddedMetadata?: EmbeddedMetadataTags
}

// Singleton instance
let analyzerInstance: MediaFileAnalyzer | null = null

export function getMediaFileAnalyzer(): MediaFileAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new MediaFileAnalyzer()
  }
  return analyzerInstance
}

export class MediaFileAnalyzer {
  private ffprobePath: string | null = null
  private ffprobeChecked: boolean = false

  /**
   * Check if FFprobe is available on the system
   */
  async isAvailable(): Promise<boolean> {
    if (this.ffprobeChecked && this.ffprobePath) {
      return true
    }

    // Try common FFprobe locations
    const possiblePaths = this.getPossibleFFprobePaths()

    for (const probePath of possiblePaths) {
      try {
        const available = await this.testFFprobe(probePath)
        if (available) {
          this.ffprobePath = probePath
          this.ffprobeChecked = true
          console.log(`[MediaFileAnalyzer] Found FFprobe at: ${probePath}`)
          return true
        }
      } catch {
        // Continue to next path
      }
    }

    this.ffprobeChecked = true
    console.log('[MediaFileAnalyzer] FFprobe not found on system')
    return false
  }

  /**
   * Get FFprobe version string
   */
  async getVersion(): Promise<string | null> {
    if (!await this.isAvailable()) {
      return null
    }

    return new Promise((resolve) => {
      const proc = spawn(this.ffprobePath!, ['-version'])
      let output = ''

      proc.stdout.on('data', (data) => {
        output += data.toString()
      })

      proc.on('close', () => {
        const match = output.match(/ffprobe version (\S+)/)
        resolve(match ? match[1] : 'unknown')
      })

      proc.on('error', () => {
        resolve(null)
      })
    })
  }

  /**
   * Check if FFprobe can be installed on this platform
   */
  canInstall(): boolean {
    // We support Windows, macOS, and Linux x64
    const platform = process.platform
    const arch = process.arch
    return (platform === 'win32' || platform === 'darwin' || platform === 'linux') && arch === 'x64'
  }

  /**
   * Check the latest available FFprobe version from download sources
   */
  async checkLatestVersion(): Promise<string | null> {
    const platform = process.platform

    try {
      if (platform === 'win32') {
        return await this.fetchLatestVersionWindows()
      } else if (platform === 'darwin') {
        return await this.fetchLatestVersionMacOS()
      } else if (platform === 'linux') {
        return await this.fetchLatestVersionLinux()
      }
    } catch (error) {
      console.error('[MediaFileAnalyzer] Failed to check latest version:', error)
    }
    return null
  }

  /**
   * Fetch latest version for Windows from gyan.dev
   */
  private fetchLatestVersionWindows(): Promise<string | null> {
    return new Promise((resolve) => {
      https.get('https://www.gyan.dev/ffmpeg/builds/release-version', (response) => {
        if (response.statusCode !== 200) {
          resolve(null)
          return
        }

        let data = ''
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => {
          const version = data.trim()
          resolve(version || null)
        })
        response.on('error', () => resolve(null))
      }).on('error', () => resolve(null))
    })
  }

  /**
   * Fetch latest version for macOS from evermeet.cx
   * Uses HEAD request to get redirect URL which contains version
   */
  private fetchLatestVersionMacOS(): Promise<string | null> {
    return new Promise((resolve) => {
      const req = https.request('https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip', {
        method: 'HEAD',
      }, (response) => {
        // Look for redirect with version in URL
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
          const location = response.headers.location
          if (location) {
            // Parse version from /ffmpeg/ffprobe-8.0.1.zip
            const match = location.match(/ffprobe-([0-9.]+)\.zip/)
            if (match) {
              resolve(match[1])
              return
            }
          }
        }
        resolve(null)
      })
      req.on('error', () => resolve(null))
      req.end()
    })
  }

  /**
   * Fetch latest version for Linux from johnvansickle.com
   */
  private fetchLatestVersionLinux(): Promise<string | null> {
    return new Promise((resolve) => {
      https.get('https://johnvansickle.com/ffmpeg/release-readme.txt', (response) => {
        if (response.statusCode !== 200) {
          resolve(null)
          return
        }

        let data = ''
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => {
          // Parse "version: X.Y.Z" line
          const match = data.match(/version:\s*([0-9.]+)/i)
          resolve(match ? match[1] : null)
        })
        response.on('error', () => resolve(null))
      }).on('error', () => resolve(null))
    })
  }

  /**
   * Extract numeric version from version string
   * E.g., "7.0.2-essentials_build-www.gyan.dev" -> "7.0.2"
   */
  private normalizeVersion(version: string): string {
    // Extract leading numeric version (X.Y.Z format)
    const match = version.match(/^(\d+(?:\.\d+)*)/)
    return match ? match[1] : version
  }

  /**
   * Compare two version strings (semver-like)
   * Returns: 1 if a > b, -1 if a < b, 0 if equal
   */
  compareVersions(a: string, b: string): number {
    // Normalize versions to just numeric parts
    const normA = this.normalizeVersion(a)
    const normB = this.normalizeVersion(b)

    const partsA = normA.split('.').map(Number)
    const partsB = normB.split('.').map(Number)
    const maxLen = Math.max(partsA.length, partsB.length)

    for (let i = 0; i < maxLen; i++) {
      const numA = partsA[i] || 0
      const numB = partsB[i] || 0
      if (numA > numB) return 1
      if (numA < numB) return -1
    }
    return 0
  }

  /**
   * Check if an update is available
   */
  async checkForUpdate(): Promise<{
    currentVersion: string | null
    latestVersion: string | null
    updateAvailable: boolean
  }> {
    const currentVersion = await this.getVersion()
    const latestVersion = await this.checkLatestVersion()

    const updateAvailable = currentVersion && latestVersion
      ? this.compareVersions(latestVersion, currentVersion) > 0
      : false

    return { currentVersion, latestVersion, updateAvailable }
  }

  /**
   * Get the download URL for FFprobe based on current platform
   * Uses trusted sources for each platform
   */
  private getDownloadInfo(): { url: string; isZip: boolean; extractPath: string } | null {
    const platform = process.platform

    // FFprobe download URLs from trusted sources
    // These are direct links to ffprobe-only or minimal builds where possible
    if (platform === 'win32') {
      // gyan.dev provides trusted Windows builds
      // Using the essentials build which includes ffprobe
      return {
        url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        isZip: true,
        extractPath: 'ffmpeg-*-essentials_build/bin/ffprobe.exe',
      }
    } else if (platform === 'darwin') {
      // evermeet.cx provides trusted macOS builds (ffprobe only)
      return {
        url: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
        isZip: true,
        extractPath: 'ffprobe',
      }
    } else if (platform === 'linux') {
      // johnvansickle.com provides trusted Linux static builds
      return {
        url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
        isZip: false, // tar.xz
        extractPath: 'ffmpeg-*-amd64-static/ffprobe',
      }
    }

    return null
  }

  /**
   * Download and install FFprobe
   * @param onProgress Callback for download progress (0-100)
   */
  async installFFprobe(
    onProgress?: (progress: { stage: string; percent: number }) => void
  ): Promise<{ success: boolean; error?: string; path?: string }> {
    const downloadInfo = this.getDownloadInfo()

    if (!downloadInfo) {
      return {
        success: false,
        error: `FFprobe installation is not supported on ${process.platform}/${process.arch}`,
      }
    }

    const userDataPath = app.getPath('userData')
    const ffprobeDir = path.join(userDataPath, 'ffprobe')
    const tempDir = path.join(userDataPath, 'ffprobe-temp')
    const finalPath = this.getBundledFFprobePath()

    try {
      // Create directories
      mkdirSync(ffprobeDir, { recursive: true })
      mkdirSync(tempDir, { recursive: true })

      onProgress?.({ stage: 'Downloading FFprobe...', percent: 0 })

      // Download the file
      const archivePath = path.join(tempDir, 'ffprobe-download' + (downloadInfo.isZip ? '.zip' : '.tar.xz'))
      await this.downloadFile(downloadInfo.url, archivePath, (percent) => {
        onProgress?.({ stage: 'Downloading FFprobe...', percent: Math.round(percent * 0.7) })
      })

      onProgress?.({ stage: 'Extracting FFprobe...', percent: 70 })

      // Extract the file
      await this.extractFFprobe(archivePath, tempDir, downloadInfo.extractPath, finalPath)

      onProgress?.({ stage: 'Verifying installation...', percent: 90 })

      // Verify it works
      const works = await this.testFFprobe(finalPath)
      if (!works) {
        throw new Error('FFprobe was installed but failed verification')
      }

      // Update our cached path
      this.ffprobePath = finalPath
      this.ffprobeChecked = true

      // Cleanup temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }

      onProgress?.({ stage: 'Installation complete!', percent: 100 })

      console.log(`[MediaFileAnalyzer] FFprobe installed successfully at: ${finalPath}`)

      return {
        success: true,
        path: finalPath,
      }
    } catch (error: unknown) {
      console.error('[MediaFileAnalyzer] FFprobe installation failed:', error)

      // Cleanup on error
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        error: getErrorMessage(error) || 'Installation failed',
      }
    }
  }

  /**
   * Download a file with progress callback
   */
  private async downloadFile(
    url: string,
    destPath: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const doRequest = (requestUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'))
          return
        }

        const protocol = requestUrl.startsWith('https') ? https : http

        protocol.get(requestUrl, (response: http.IncomingMessage) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
            response.destroy() // Clean up the redirect response
            const location = response.headers.location
            if (location) {
              // Resolve relative URLs against the current request URL
              const redirectUrl = new URL(location, requestUrl).href
              doRequest(redirectUrl, redirectCount + 1)
              return
            }
          }

          if (response.statusCode !== 200) {
            response.destroy()
            reject(new Error(`Download failed with status ${response.statusCode}`))
            return
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10)
          let downloadedSize = 0

          const fileStream = createWriteStream(destPath)

          // Handle response stream errors (network failures mid-download)
          response.on('error', (err: Error) => {
            fileStream.destroy()
            reject(new Error(`Download stream error: ${err.message}`))
          })

          response.on('data', (chunk: Buffer) => {
            downloadedSize += chunk.length
            if (totalSize > 0 && onProgress) {
              onProgress((downloadedSize / totalSize) * 100)
            }
          })

          pipeline(response, fileStream)
            .then(() => resolve())
            .catch((err) => {
              fileStream.destroy()
              reject(err)
            })
        }).on('error', reject)
      }

      doRequest(url)
    })
  }

  /**
   * Extract FFprobe from archive
   */
  private async extractFFprobe(
    archivePath: string,
    tempDir: string,
    _extractPattern: string, // Pattern kept for potential future use
    destPath: string
  ): Promise<void> {
    const platform = process.platform

    if (platform === 'win32') {
      // Use PowerShell to extract zip on Windows
      await this.runCommand('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${tempDir}" -Force`
      ])

      // Find and copy ffprobe.exe
      const ffprobeSource = await this.findFileInDir(tempDir, 'ffprobe.exe')
      if (!ffprobeSource) {
        throw new Error('ffprobe.exe not found in archive')
      }
      fs.copyFileSync(ffprobeSource, destPath)
    } else if (platform === 'darwin') {
      // Use unzip on macOS
      await this.runCommand('unzip', ['-o', archivePath, '-d', tempDir])

      // Find and copy ffprobe
      const ffprobeSource = await this.findFileInDir(tempDir, 'ffprobe')
      if (!ffprobeSource) {
        throw new Error('ffprobe not found in archive')
      }
      fs.copyFileSync(ffprobeSource, destPath)
      fs.chmodSync(destPath, 0o755) // Make executable
    } else {
      // Use tar on Linux
      await this.runCommand('tar', ['-xf', archivePath, '-C', tempDir])

      // Find and copy ffprobe
      const ffprobeSource = await this.findFileInDir(tempDir, 'ffprobe')
      if (!ffprobeSource) {
        throw new Error('ffprobe not found in archive')
      }
      fs.copyFileSync(ffprobeSource, destPath)
      fs.chmodSync(destPath, 0o755) // Make executable
    }
  }

  /**
   * Run a command and wait for completion
   */
  private runCommand(command: string, args: string[], timeoutMs = 120000): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stderr = ''
      let settled = false

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          proc.kill('SIGKILL')
          reject(new Error(`Command timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`))
        }
      })

      proc.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /**
   * Recursively find a file in a directory
   */
  private async findFileInDir(dir: string, filename: string): Promise<string | null> {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        const found = await this.findFileInDir(fullPath, filename)
        if (found) return found
      } else if (entry.name === filename) {
        return fullPath
      }
    }

    return null
  }

  /**
   * Uninstall bundled FFprobe
   */
  async uninstallFFprobe(): Promise<boolean> {
    const bundledPath = this.getBundledFFprobePath()

    try {
      if (fs.existsSync(bundledPath)) {
        fs.unlinkSync(bundledPath)
      }

      // Reset cached state
      if (this.ffprobePath === bundledPath) {
        this.ffprobePath = null
        this.ffprobeChecked = false
      }

      console.log('[MediaFileAnalyzer] FFprobe uninstalled')
      return true
    } catch (error: unknown) {
      console.error('[MediaFileAnalyzer] Failed to uninstall FFprobe:', error)
      return false
    }
  }

  /**
   * Check if FFprobe is the bundled version
   */
  async isBundledVersion(): Promise<boolean> {
    if (!this.ffprobePath) {
      await this.isAvailable()
    }
    return this.ffprobePath === this.getBundledFFprobePath()
  }

  /**
   * Analyze a media file and return detailed metadata
   */
  async analyzeFile(filePath: string): Promise<FileAnalysisResult> {
    // Check if FFprobe is available
    if (!await this.isAvailable()) {
      return {
        success: false,
        error: 'FFprobe is not installed. Please install FFmpeg to enable file analysis.',
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }

    try {
      const ffprobeOutput = await this.runFFprobe(filePath)
      const result = this.parseFFprobeOutput(filePath, ffprobeOutput)

      // Note: Packet analysis for accurate bitrates was removed for performance.
      // MKV files without bitrate metadata will use codec-based estimates instead.

      return result
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Failed to analyze file',
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }
  }

  /**
   * Analyze multiple files with progress callback (sequential)
   */
  async analyzeFiles(
    filePaths: string[],
    onProgress?: (current: number, total: number, currentFile: string) => void
  ): Promise<Map<string, FileAnalysisResult>> {
    const results = new Map<string, FileAnalysisResult>()
    const total = filePaths.length

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i]
      onProgress?.(i + 1, total, path.basename(filePath))

      const result = await this.analyzeFile(filePath)
      results.set(filePath, result)
    }

    return results
  }

  /**
   * Analyze multiple files in parallel using worker threads
   * Falls back to sequential analysis if workers fail to initialize
   */
  async analyzeFilesParallel(
    filePaths: string[],
    onProgress?: (current: number, total: number, currentFile: string) => void
  ): Promise<Map<string, FileAnalysisResult>> {
    // Check if FFprobe is available
    if (!await this.isAvailable()) {
      const results = new Map<string, FileAnalysisResult>()
      for (const filePath of filePaths) {
        results.set(filePath, {
          success: false,
          error: 'FFprobe is not installed',
          filePath,
          audioTracks: [],
          subtitleTracks: [],
        })
      }
      return results
    }

    try {
      // Dynamically import worker pool to avoid circular dependencies
      const { getFFprobeWorkerPool } = await import('./FFprobeWorkerPool')
      const pool = getFFprobeWorkerPool()

      // Initialize pool with FFprobe path if needed
      await pool.initialize(this.ffprobePath!)

      console.log(`[MediaFileAnalyzer] Analyzing ${filePaths.length} files in parallel`)
      return await pool.analyzeFiles(filePaths, onProgress)
    } catch (error) {
      console.warn(`[MediaFileAnalyzer] Worker pool failed, falling back to sequential: ${getErrorMessage(error)}`)
      // Fallback to sequential analysis
      return this.analyzeFiles(filePaths, onProgress)
    }
  }

  /**
   * Get the current FFprobe path (for worker initialization)
   */
  getFFprobePath(): string | null {
    return this.ffprobePath
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Get the directory where bundled FFprobe will be installed
   */
  getBundledFFprobePath(): string {
    const userDataPath = app.getPath('userData')
    const ffprobeDir = path.join(userDataPath, 'ffprobe')

    if (process.platform === 'win32') {
      return path.join(ffprobeDir, 'ffprobe.exe')
    } else {
      return path.join(ffprobeDir, 'ffprobe')
    }
  }

  private getPossibleFFprobePaths(): string[] {
    const paths: string[] = []

    // Try bundled FFprobe first (installed by the app)
    paths.push(this.getBundledFFprobePath())

    // Try 'ffprobe' directly (works if it's in PATH)
    paths.push('ffprobe')

    if (process.platform === 'win32') {
      // Common Windows installation locations
      paths.push('C:\\ffmpeg\\bin\\ffprobe.exe')
      paths.push('C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe')
      paths.push('C:\\Program Files (x86)\\ffmpeg\\bin\\ffprobe.exe')

      // Check common package manager locations
      const localAppData = process.env.LOCALAPPDATA
      if (localAppData) {
        paths.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Packages', '**', 'ffprobe.exe'))
        paths.push(path.join(localAppData, 'Programs', 'ffmpeg', 'bin', 'ffprobe.exe'))
      }

      // Chocolatey
      paths.push('C:\\ProgramData\\chocolatey\\bin\\ffprobe.exe')

      // Scoop
      const userProfile = process.env.USERPROFILE
      if (userProfile) {
        paths.push(path.join(userProfile, 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffprobe.exe'))
      }
    } else if (process.platform === 'darwin') {
      // macOS - Homebrew locations
      paths.push('/usr/local/bin/ffprobe')
      paths.push('/opt/homebrew/bin/ffprobe')
      paths.push('/opt/local/bin/ffprobe') // MacPorts
    } else {
      // Linux
      paths.push('/usr/bin/ffprobe')
      paths.push('/usr/local/bin/ffprobe')
      paths.push('/snap/bin/ffprobe')
    }

    return paths
  }

  private async testFFprobe(probePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(probePath, ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      proc.on('close', (code) => {
        resolve(code === 0)
      })

      proc.on('error', () => {
        resolve(false)
      })
    })
  }

  private async runFFprobe(filePath: string): Promise<FFprobeOutput> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ]

      const proc = spawn(this.ffprobePath!, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000, // 60 second timeout for large files
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
        reject(new Error(`Failed to run FFprobe: ${getErrorMessage(error)}`))
      })
    })
  }

  private parseFFprobeOutput(filePath: string, output: FFprobeOutput): FileAnalysisResult {
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

      // Extract embedded metadata tags from container
      if (output.format.tags) {
        const tags = output.format.tags
        const embeddedMetadata: EmbeddedMetadataTags = {}

        // Title - try multiple common tag names
        const titleTag = tags.title || tags.TITLE
        if (titleTag && titleTag.trim()) {
          embeddedMetadata.title = titleTag.trim()
        }

        // Year - from date, year, or DATE tags
        const dateTag = tags.date || tags.DATE || tags.year || tags.YEAR || tags.creation_time
        if (dateTag) {
          // Extract year from various formats: "2020", "2020-01-15", "2020-01-15T00:00:00Z"
          const yearMatch = dateTag.match(/^(\d{4})/)
          if (yearMatch) {
            embeddedMetadata.year = parseInt(yearMatch[1], 10)
          }
        }

        // Description/synopsis
        const descriptionTag = tags.description || tags.DESCRIPTION || tags.synopsis || tags.SYNOPSIS || tags.comment || tags.COMMENT
        if (descriptionTag && descriptionTag.trim()) {
          embeddedMetadata.description = descriptionTag.trim()
        }

        // TV show specific tags (common in MKV)
        const showTag = tags.show || tags.SHOW || tags['WM/WMCollectionGroupID'] || tags.album // album used for show in some cases
        if (showTag && showTag.trim()) {
          embeddedMetadata.showName = showTag.trim()
        }

        // Season number
        const seasonTag = tags.season_number || tags.SEASON_NUMBER || tags['WM/MediaClassSeasonNumber'] || tags.season || tags.SEASON
        if (seasonTag) {
          const seasonNum = parseInt(seasonTag, 10)
          if (!isNaN(seasonNum) && seasonNum > 0) {
            embeddedMetadata.seasonNumber = seasonNum
          }
        }

        // Episode number (sort order)
        const episodeTag = tags.episode_sort || tags.EPISODE_SORT || tags.episode || tags.EPISODE ||
                          tags['WM/MediaClassTrackNumber'] || tags.track || tags.TRACK
        if (episodeTag) {
          const episodeNum = parseInt(episodeTag, 10)
          if (!isNaN(episodeNum) && episodeNum > 0) {
            embeddedMetadata.episodeNumber = episodeNum
          }
        }

        // Episode title (might be different from main title for TV)
        const episodeTitleTag = tags.episode_id || tags.EPISODE_ID
        if (episodeTitleTag && episodeTitleTag.trim()) {
          embeddedMetadata.episodeTitle = episodeTitleTag.trim()
        }

        // Only add if we found any metadata
        if (Object.keys(embeddedMetadata).length > 0) {
          result.embeddedMetadata = embeddedMetadata
        }
      }
    }

    // Parse streams
    for (const stream of output.streams) {
      // Check for embedded artwork (attached picture)
      if (stream.disposition?.attached_pic === 1) {
        result.embeddedArtwork = {
          hasArtwork: true,
          mimeType: this.getArtworkMimeType(stream.codec_name),
          streamIndex: stream.index,
        }
        continue // Skip adding as video stream
      }

      switch (stream.codec_type) {
        case 'video':
          // Only use first video stream (and not attached pictures)
          if (!result.video) {
            result.video = this.parseVideoStream(stream, result.duration)
          }
          break
        case 'audio':
          result.audioTracks.push(this.parseAudioStream(stream, result.duration))
          break
        case 'subtitle':
          result.subtitleTracks.push(this.parseSubtitleStream(stream))
          break
      }
    }

    // Calculate video bitrate from file size and duration (more accurate than metadata)
    // MKV files frequently have inaccurate bitrate values in their metadata tags
    if (result.video && result.fileSize && result.duration) {
      const durationSeconds = result.duration / 1000

      // Calculate total bitrate from file: (bytes * 8) / seconds / 1000 = kbps
      const calculatedTotalBitrate = Math.round((result.fileSize * 8) / durationSeconds / 1000)

      // Sum audio bitrates (from metadata or estimates)
      let totalAudioBitrate = result.audioTracks.reduce((sum, t) => sum + (t.bitrate || 0), 0)

      // Cap audio at 30% of total - audio can't exceed this in a typical video file
      // This prevents over-estimated lossless audio (TrueHD/DTS-HD MA) from inflating audio total
      const maxAudioBitrate = Math.round(calculatedTotalBitrate * 0.30)
      if (totalAudioBitrate > maxAudioBitrate) {
        console.log(`[MediaFileAnalyzer] Audio estimate (${totalAudioBitrate} kbps) exceeds 30% of total (${calculatedTotalBitrate} kbps). Capping at ${maxAudioBitrate} kbps.`)
        totalAudioBitrate = maxAudioBitrate
      }

      const calculatedVideoBitrate = Math.max(0, calculatedTotalBitrate - totalAudioBitrate)

      const metadataBitrate = result.video.bitrate
      if (metadataBitrate) {
        // If stream metadata bitrate differs significantly from calculated (< 50% or > 150%), use calculated
        const ratio = metadataBitrate / calculatedVideoBitrate
        if (ratio < 0.5 || ratio > 1.5) {
          console.log(`[MediaFileAnalyzer] Stream bitrate (${metadataBitrate} kbps) differs significantly from calculated (${calculatedVideoBitrate} kbps). Using calculated.`)
          result.video.bitrate = calculatedVideoBitrate
        } else {
          console.log(`[MediaFileAnalyzer] Stream bitrate (${metadataBitrate} kbps) matches calculated (${calculatedVideoBitrate} kbps). Using metadata.`)
        }
      } else {
        // No metadata bitrate, use calculated
        result.video.bitrate = calculatedVideoBitrate
        console.log(`[MediaFileAnalyzer] Video bitrate: ${calculatedVideoBitrate} kbps (total: ${calculatedTotalBitrate} - audio: ${totalAudioBitrate})`)
      }
    } else if (result.video && result.overallBitrate && !result.video.bitrate) {
      // Fallback: use overall bitrate from format if no file size available
      let totalAudioBitrate = result.audioTracks.reduce((sum, t) => sum + (t.bitrate || 0), 0)
      // Cap audio at 30% of overall bitrate
      const maxAudioBitrate = Math.round(result.overallBitrate * 0.30)
      if (totalAudioBitrate > maxAudioBitrate) {
        totalAudioBitrate = maxAudioBitrate
      }
      result.video.bitrate = Math.max(0, result.overallBitrate - totalAudioBitrate)
      console.log(`[MediaFileAnalyzer] Using format bitrate fallback: ${result.video.bitrate} kbps (overall: ${result.overallBitrate} - audio: ${totalAudioBitrate})`)
    }

    return result
  }

  /**
   * Get MIME type for artwork based on codec name
   */
  private getArtworkMimeType(codecName?: string): string {
    if (!codecName) return 'image/jpeg'
    const codec = codecName.toLowerCase()
    if (codec === 'png') return 'image/png'
    if (codec === 'bmp') return 'image/bmp'
    if (codec === 'gif') return 'image/gif'
    if (codec === 'webp') return 'image/webp'
    return 'image/jpeg' // Default to JPEG (most common for album art)
  }

  /**
   * Extract embedded artwork from an audio file
   * @param audioFilePath Path to the audio file with embedded artwork
   * @param outputPath Path where the artwork image should be saved
   * @returns True if extraction was successful
   */
  async extractArtwork(audioFilePath: string, outputPath: string): Promise<boolean> {
    if (!this.ffprobePath) {
      await this.isAvailable()
    }

    if (!this.ffprobePath) {
      return false
    }

    // Derive ffmpeg path from ffprobe path
    const ffmpegPath = this.ffprobePath.replace(/ffprobe(\.exe)?$/i, (match) => {
      return match.toLowerCase().includes('.exe') ? 'ffmpeg.exe' : 'ffmpeg'
    })

    // Check if ffmpeg exists
    if (!fs.existsSync(ffmpegPath) && !await this.isFFmpegInPath()) {
      console.warn('[MediaFileAnalyzer] FFmpeg not found, cannot extract artwork')
      return false
    }

    const actualFFmpegPath = fs.existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg'

    return new Promise((resolve) => {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      // Extract artwork using ffmpeg
      // -an: no audio, -vcodec copy: copy video (image) stream directly
      const args = [
        '-i', audioFilePath,
        '-an',           // No audio output
        '-vcodec', 'copy', // Copy the image stream directly
        '-y',            // Overwrite output file
        outputPath
      ]

      const proc = spawn(actualFFmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      })

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          // Verify file has content
          const stats = fs.statSync(outputPath)
          if (stats.size > 0) {
            console.log(`[MediaFileAnalyzer] Extracted artwork to: ${outputPath}`)
            resolve(true)
          } else {
            fs.unlinkSync(outputPath)
            resolve(false)
          }
        } else {
          resolve(false)
        }
      })

      proc.on('error', () => {
        resolve(false)
      })
    })
  }

  /**
   * Check if ffmpeg is in the system PATH
   */
  private async isFFmpegInPath(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      proc.on('close', (code) => {
        resolve(code === 0)
      })

      proc.on('error', () => {
        resolve(false)
      })
    })
  }

  private parseVideoStream(stream: FFprobeStream, durationMs?: number): AnalyzedVideoStream {
    const bitrate = this.extractBitrate(stream, durationMs)
    const frameRate = this.parseFrameRate(stream.avg_frame_rate || stream.r_frame_rate)
    const bitDepth = this.extractBitDepth(stream)
    const hdrFormat = this.detectHdrFormat(stream)

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

  private parseAudioStream(stream: FFprobeStream, durationMs?: number): AnalyzedAudioStream {
    let bitrate = this.extractBitrate(stream, durationMs)
    const hasObjectAudio = this.detectObjectAudio(stream)
    const codec = stream.codec_name?.toLowerCase() || 'unknown'
    const channels = stream.channels || 2

    // Estimate bitrate for codecs that don't report it
    if (!bitrate) {
      bitrate = this.estimateAudioBitrate(codec, channels, stream.profile, stream.sample_rate)
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
   * Estimate audio bitrate for codecs that don't report it in metadata
   */
  private estimateAudioBitrate(codec: string, channels: number, profile?: string, sampleRateStr?: string): number | undefined {
    const codecLower = codec.toLowerCase()
    const sampleRate = sampleRateStr ? parseInt(sampleRateStr, 10) : 48000

    // AC3 (Dolby Digital) - standard bitrates based on channels
    if (codecLower === 'ac3') {
      if (channels <= 2) return 192
      if (channels <= 6) return 448  // 5.1
      return 640  // Max AC3 bitrate
    }

    // EAC3 (Dolby Digital Plus) - higher bitrates
    if (codecLower === 'eac3') {
      if (channels <= 2) return 256
      if (channels <= 6) return 640  // 5.1
      if (channels <= 8) return 1024  // 7.1
      return 1536  // Atmos object audio
    }

    // TrueHD - lossless, estimate based on channels and sample rate
    if (codecLower === 'truehd') {
      // TrueHD typical bitrates: ~2500-4500 kbps for 5.1, 4000-8000+ for 7.1/Atmos
      const baseRate = sampleRate > 48000 ? 4000 : 2500
      if (channels <= 2) return Math.round(baseRate * 0.4)
      if (channels <= 6) return baseRate  // 5.1
      if (channels <= 8) return Math.round(baseRate * 1.6)  // 7.1
      return Math.round(baseRate * 2)  // Atmos with many objects
    }

    // DTS - standard bitrates
    if (codecLower === 'dts') {
      const profileLower = profile?.toLowerCase() || ''
      // DTS-HD MA (lossless)
      if (profileLower.includes('ma') || profileLower.includes('hd ma')) {
        if (channels <= 2) return 1500
        if (channels <= 6) return 3000  // 5.1
        if (channels <= 8) return 4500  // 7.1
        return 6000  // DTS:X
      }
      // DTS-HD HRA (high resolution)
      if (profileLower.includes('hra') || profileLower.includes('hd hra')) {
        if (channels <= 6) return 1500
        return 2000
      }
      // Standard DTS
      if (channels <= 2) return 768
      if (channels <= 6) return 1509  // 5.1 typical
      return 1509
    }

    // FLAC - lossless, estimate based on sample rate and bit depth
    if (codecLower === 'flac') {
      // FLAC typically compresses to 50-70% of uncompressed
      // Estimate: channels * sampleRate * 16bits * 0.6 / 1000 for kbps
      const bitDepth = 16  // Assume 16-bit if unknown
      const compressionRatio = 0.6
      return Math.round((channels * sampleRate * bitDepth * compressionRatio) / 1000)
    }

    // PCM - uncompressed
    if (codecLower.includes('pcm')) {
      const bitDepth = 16
      return Math.round((channels * sampleRate * bitDepth) / 1000)
    }

    return undefined
  }

  private parseSubtitleStream(stream: FFprobeStream): AnalyzedSubtitleStream {
    return {
      index: stream.index,
      codec: stream.codec_name || 'unknown',
      language: stream.tags?.language,
      title: stream.tags?.title,
      isDefault: stream.disposition?.default === 1,
      isForced: stream.disposition?.forced === 1,
    }
  }

  private extractBitrate(stream: FFprobeStream, durationMs?: number): number | undefined {
    // Try stream bit_rate first
    if (stream.bit_rate) {
      const bitrate = Math.round(parseInt(stream.bit_rate, 10) / 1000)
      console.log(`[MediaFileAnalyzer] Bitrate from stream.bit_rate: ${bitrate} kbps`)
      return bitrate
    }

    // Try BPS tag (common in MKV statistics tags)
    const bps = stream.tags?.BPS || stream.tags?.['BPS-eng']
    if (bps) {
      const bitrate = Math.round(parseInt(bps, 10) / 1000)
      console.log(`[MediaFileAnalyzer] Bitrate from BPS tag: ${bitrate} kbps`)
      return bitrate
    }

    // Try calculating from NUMBER_OF_BYTES (MKV statistics tag)
    const numBytes = stream.tags?.NUMBER_OF_BYTES || stream.tags?.['NUMBER_OF_BYTES-eng']
    const streamDuration = stream.duration ? parseFloat(stream.duration) * 1000 : durationMs
    if (numBytes && streamDuration && streamDuration > 0) {
      const bytes = parseInt(numBytes, 10)
      const durationSec = streamDuration / 1000
      const bitrate = Math.round((bytes * 8) / durationSec / 1000)
      console.log(`[MediaFileAnalyzer] Bitrate from NUMBER_OF_BYTES: ${bitrate} kbps (${bytes} bytes / ${durationSec.toFixed(1)}s)`)
      return bitrate
    }

    console.log(`[MediaFileAnalyzer] No bitrate found in stream metadata`)
    return undefined
  }

  private parseFrameRate(frameRateStr?: string): number | undefined {
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

  private extractBitDepth(stream: FFprobeStream): number | undefined {
    // Try bits_per_raw_sample first
    if (stream.bits_per_raw_sample) {
      return parseInt(stream.bits_per_raw_sample, 10)
    }

    // Infer from pixel format
    const pixFmt = stream.pix_fmt?.toLowerCase() || ''

    if (pixFmt.includes('12le') || pixFmt.includes('12be')) return 12
    if (pixFmt.includes('10le') || pixFmt.includes('10be') || pixFmt.includes('p010')) return 10
    if (pixFmt.includes('yuv420p') || pixFmt.includes('yuv422p') || pixFmt.includes('yuv444p')) return 8

    return undefined
  }

  private detectHdrFormat(stream: FFprobeStream): string | undefined {
    const colorTransfer = stream.color_transfer?.toLowerCase() || ''
    const colorPrimaries = stream.color_primaries?.toLowerCase() || ''
    const colorSpace = stream.color_space?.toLowerCase() || ''

    // Check side data for HDR metadata
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

    // Dolby Vision (check side data and profile)
    if (hasDolbyVision) {
      return 'Dolby Vision'
    }

    // HDR10+ (dynamic metadata)
    if (hasHdr10Plus) {
      return 'HDR10+'
    }

    // HDR10 (static metadata with BT.2020 + PQ)
    if (
      (colorTransfer.includes('smpte2084') || colorTransfer.includes('pq')) &&
      (colorPrimaries.includes('bt2020') || colorSpace.includes('bt2020'))
    ) {
      if (hasMasteringDisplay || hasContentLight) {
        return 'HDR10'
      }
      return 'PQ'
    }

    // HLG
    if (colorTransfer.includes('arib-std-b67') || colorTransfer.includes('hlg')) {
      return 'HLG'
    }

    return undefined
  }

  private detectObjectAudio(stream: FFprobeStream): boolean {
    const codec = stream.codec_name?.toLowerCase() || ''
    const profile = stream.profile?.toLowerCase() || ''
    const title = stream.tags?.title?.toLowerCase() || ''

    // Dolby Atmos
    if (codec === 'truehd' && (profile.includes('atmos') || title.includes('atmos'))) {
      return true
    }
    if (codec === 'eac3' && (profile.includes('atmos') || title.includes('atmos'))) {
      return true
    }

    // DTS:X
    if (codec.includes('dts') && (profile.includes('x') || title.includes('dts:x') || title.includes('dts-x'))) {
      return true
    }

    return false
  }
}
