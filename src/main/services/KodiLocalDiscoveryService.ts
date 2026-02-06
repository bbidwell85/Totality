import { getErrorMessage } from './utils/errorUtils'
/**
 * KodiLocalDiscoveryService
 *
 * Detects local Kodi installation and provides access to its SQLite database.
 * Works without Kodi running by reading the database files directly.
 *
 * Windows path: %APPDATA%\Kodi\userdata\Database\
 * macOS path: ~/Library/Application Support/Kodi/userdata/Database/
 * Linux path: ~/.kodi/userdata/Database/
 */

import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface KodiLocalInstallation {
  path: string            // Kodi userdata folder
  databasePath: string    // Full path to MyVideos*.db
  databaseVersion: number // Version number extracted from filename
  musicDatabasePath: string | null    // Full path to MyMusic*.db (if found)
  musicDatabaseVersion: number | null // Version number extracted from music db filename
  kodiRunning: boolean    // Warning if Kodi is running (database may be locked)
}

let discoveryServiceInstance: KodiLocalDiscoveryService | null = null

export function getKodiLocalDiscoveryService(): KodiLocalDiscoveryService {
  if (!discoveryServiceInstance) {
    discoveryServiceInstance = new KodiLocalDiscoveryService()
  }
  return discoveryServiceInstance
}

export class KodiLocalDiscoveryService {
  /**
   * Get the default Kodi userdata path for the current platform
   */
  getDefaultKodiPath(): string {
    const platform = process.platform

    if (platform === 'win32') {
      // Windows: %APPDATA%\Kodi\userdata
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
      return path.join(appData, 'Kodi', 'userdata')
    } else if (platform === 'darwin') {
      // macOS: ~/Library/Application Support/Kodi/userdata
      const home = process.env.HOME || ''
      return path.join(home, 'Library', 'Application Support', 'Kodi', 'userdata')
    } else {
      // Linux: ~/.kodi/userdata
      const home = process.env.HOME || ''
      return path.join(home, '.kodi', 'userdata')
    }
  }

  /**
   * Find a database file matching a pattern with the highest version number
   */
  private findDatabaseFile(databaseDir: string, pattern: RegExp): { path: string; version: number } | null {
    if (!fs.existsSync(databaseDir)) {
      return null
    }

    const files = fs.readdirSync(databaseDir)

    let highestVersion = 0
    let selectedFile: string | null = null

    for (const file of files) {
      const match = file.match(pattern)
      if (match) {
        const version = parseInt(match[1], 10)
        if (version > highestVersion) {
          highestVersion = version
          selectedFile = file
        }
      }
    }

    if (selectedFile) {
      return {
        path: path.join(databaseDir, selectedFile),
        version: highestVersion,
      }
    }

    return null
  }

  /**
   * Find the MyVideos database file with the highest version number
   */
  private findVideoDatabaseFile(databaseDir: string): { path: string; version: number } | null {
    // Look for MyVideos*.db files (e.g., MyVideos121.db, MyVideos131.db)
    return this.findDatabaseFile(databaseDir, /^MyVideos(\d+)\.db$/i)
  }

  /**
   * Find the MyMusic database file with the highest version number
   */
  private findMusicDatabaseFile(databaseDir: string): { path: string; version: number } | null {
    // Look for MyMusic*.db files (e.g., MyMusic72.db, MyMusic83.db)
    return this.findDatabaseFile(databaseDir, /^MyMusic(\d+)\.db$/i)
  }

  /**
   * Check if Kodi process is currently running
   */
  async isKodiRunning(): Promise<boolean> {
    const platform = process.platform

    try {
      if (platform === 'win32') {
        // Windows: use tasklist
        const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq kodi.exe" /NH')
        return stdout.toLowerCase().includes('kodi.exe')
      } else if (platform === 'darwin') {
        // macOS: use pgrep
        try {
          await execAsync('pgrep -x Kodi')
          return true
        } catch {
          return false
        }
      } else {
        // Linux: use pgrep
        try {
          await execAsync('pgrep -x kodi')
          return true
        } catch {
          return false
        }
      }
    } catch (error) {
      // If command fails, assume Kodi is not running
      return false
    }
  }

  /**
   * Check if database file is readable (not locked)
   */
  private isDatabaseReadable(dbPath: string): boolean {
    try {
      // Try to open the file for reading
      const fd = fs.openSync(dbPath, 'r')
      fs.closeSync(fd)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Detect local Kodi installation
   * Returns null if Kodi is not installed or no database found
   */
  async detectLocalInstallation(): Promise<KodiLocalInstallation | null> {
    try {
      const userdataPath = this.getDefaultKodiPath()
      const databaseDir = path.join(userdataPath, 'Database')

      console.log(`[KodiLocalDiscovery] Checking for Kodi database at: ${databaseDir}`)

      // Check if Database directory exists
      if (!fs.existsSync(databaseDir)) {
        console.log('[KodiLocalDiscovery] Database directory not found')
        return null
      }

      // Find the video database file
      const videoDbInfo = this.findVideoDatabaseFile(databaseDir)

      // Find the music database file
      const musicDbInfo = this.findMusicDatabaseFile(databaseDir)

      // Need at least one database to continue
      if (!videoDbInfo && !musicDbInfo) {
        console.log('[KodiLocalDiscovery] No Kodi database files found')
        return null
      }

      if (videoDbInfo) {
        console.log(`[KodiLocalDiscovery] Found video database: ${videoDbInfo.path} (version ${videoDbInfo.version})`)
      }
      if (musicDbInfo) {
        console.log(`[KodiLocalDiscovery] Found music database: ${musicDbInfo.path} (version ${musicDbInfo.version})`)
      }

      // Check if Kodi is running
      const kodiRunning = await this.isKodiRunning()
      if (kodiRunning) {
        console.log('[KodiLocalDiscovery] Warning: Kodi is currently running')
      }

      // Check if at least one database is readable
      const videoReadable = videoDbInfo ? this.isDatabaseReadable(videoDbInfo.path) : false
      const musicReadable = musicDbInfo ? this.isDatabaseReadable(musicDbInfo.path) : false

      if (!videoReadable && !musicReadable) {
        console.log('[KodiLocalDiscovery] No database files are readable (may be locked)')
        // Still return the installation info, but with running flag
        return {
          path: userdataPath,
          databasePath: videoDbInfo?.path || '',
          databaseVersion: videoDbInfo?.version || 0,
          musicDatabasePath: musicDbInfo?.path || null,
          musicDatabaseVersion: musicDbInfo?.version || null,
          kodiRunning: true, // Mark as running if we can't read
        }
      }

      return {
        path: userdataPath,
        databasePath: videoDbInfo?.path || '',
        databaseVersion: videoDbInfo?.version || 0,
        musicDatabasePath: musicDbInfo?.path || null,
        musicDatabaseVersion: musicDbInfo?.version || null,
        kodiRunning,
      }
    } catch (error: unknown) {
      console.error('[KodiLocalDiscovery] Error detecting installation:', getErrorMessage(error))
      return null
    }
  }

  /**
   * Validate a custom database path
   */
  validateDatabasePath(dbPath: string): { valid: boolean; error?: string } {
    if (!fs.existsSync(dbPath)) {
      return { valid: false, error: 'Database file not found' }
    }

    // Check file extension
    if (!dbPath.toLowerCase().endsWith('.db')) {
      return { valid: false, error: 'File must have .db extension' }
    }

    // Check filename pattern
    const filename = path.basename(dbPath)
    if (!filename.match(/^MyVideos\d+\.db$/i)) {
      return { valid: false, error: 'File must be a Kodi MyVideos database (e.g., MyVideos121.db)' }
    }

    // Check if readable
    if (!this.isDatabaseReadable(dbPath)) {
      return { valid: false, error: 'Database file is locked or not readable' }
    }

    return { valid: true }
  }

  /**
   * Extract version number from database filename
   */
  extractVersionFromPath(dbPath: string): number {
    const filename = path.basename(dbPath)
    const match = filename.match(/^MyVideos(\d+)\.db$/i)
    return match ? parseInt(match[1], 10) : 0
  }
}
