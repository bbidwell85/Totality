/**
 * MediaMonkeyDiscoveryService
 *
 * Detects local MediaMonkey installation and provides database paths.
 * Checks default installation paths for both MM4 and MM5.
 *
 * Windows path (MM4): %APPDATA%\MediaMonkey\MM.DB
 * Windows path (MM5): %APPDATA%\MediaMonkey5\MM5.DB
 */

import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface MediaMonkeyInstallation {
  version: 4 | 5
  databasePath: string
  exists: boolean
}

export interface MediaMonkeyDetectionResult {
  installations: MediaMonkeyInstallation[]
  isRunning: boolean
}

let discoveryServiceInstance: MediaMonkeyDiscoveryService | null = null

export function getMediaMonkeyDiscoveryService(): MediaMonkeyDiscoveryService {
  if (!discoveryServiceInstance) {
    discoveryServiceInstance = new MediaMonkeyDiscoveryService()
  }
  return discoveryServiceInstance
}

export class MediaMonkeyDiscoveryService {
  /**
   * Get the default MediaMonkey database path for a given version
   */
  getDefaultDatabasePath(version: 4 | 5): string {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')

    if (version === 5) {
      return path.join(appData, 'MediaMonkey5', 'MM5.DB')
    }
    return path.join(appData, 'MediaMonkey', 'MM.DB')
  }

  /**
   * Detect all MediaMonkey installations
   */
  async detect(): Promise<MediaMonkeyDetectionResult> {
    const installations: MediaMonkeyInstallation[] = []

    // Check MM4
    const mm4Path = this.getDefaultDatabasePath(4)
    installations.push({
      version: 4,
      databasePath: mm4Path,
      exists: fs.existsSync(mm4Path),
    })

    // Check MM5
    const mm5Path = this.getDefaultDatabasePath(5)
    installations.push({
      version: 5,
      databasePath: mm5Path,
      exists: fs.existsSync(mm5Path),
    })

    const isRunning = await this.isMediaMonkeyRunning()

    return { installations, isRunning }
  }

  /**
   * Check if MediaMonkey is currently running
   */
  async isMediaMonkeyRunning(): Promise<boolean> {
    if (process.platform !== 'win32') return false

    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq MediaMonkey.exe" /NH')
      return stdout.toLowerCase().includes('mediamonkey.exe')
    } catch {
      return false
    }
  }

  /**
   * Validate a database path is a valid MediaMonkey database
   */
  validateDatabasePath(dbPath: string): { valid: boolean; error?: string } {
    if (!fs.existsSync(dbPath)) {
      return { valid: false, error: 'Database file not found' }
    }

    try {
      // Check file is readable
      fs.accessSync(dbPath, fs.constants.R_OK)
    } catch {
      return { valid: false, error: 'Database file is not readable' }
    }

    // Check file has reasonable size (at least a few KB for a valid SQLite DB)
    const stats = fs.statSync(dbPath)
    if (stats.size < 1024) {
      return { valid: false, error: 'Database file appears to be empty or corrupt' }
    }

    return { valid: true }
  }
}
