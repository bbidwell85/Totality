import { getErrorMessage } from './utils/errorUtils'
/**
 * KodiMySQLConnectionService
 *
 * Manages MySQL/MariaDB connections for Kodi shared database access.
 * Handles connection pooling, database detection, and query execution.
 *
 * Note: mysql2 is an optional dependency. If not installed, Kodi MySQL
 * features will be unavailable but the app will still function normally.
 */

// Dynamic import for optional mysql2 dependency
let mysql: typeof import('mysql2/promise') | null = null
let mysqlAvailable = false

// Try to load mysql2 - it's optional
try {
   
  mysql = require('mysql2/promise')
  mysqlAvailable = true
} catch {
  console.log('[KodiMySQLConnectionService] mysql2 not installed - Kodi MySQL features unavailable')
}

// Type definitions (used even when mysql2 is not available)
type Pool = import('mysql2/promise').Pool
type PoolConnection = import('mysql2/promise').PoolConnection
type Connection = import('mysql2/promise').Connection

export interface KodiMySQLConfig {
  host: string
  port: number
  username: string
  password: string
  videoDatabaseName?: string
  musicDatabaseName?: string
  databasePrefix?: string
  ssl?: boolean
  connectionTimeout?: number
}

export interface KodiMySQLConnectionTestResult {
  success: boolean
  error?: string
  serverVersion?: string
  videoDatabaseName?: string
  videoDatabaseVersion?: number
  musicDatabaseName?: string
  musicDatabaseVersion?: number
  latencyMs?: number
}

export interface DetectedDatabases {
  videoDatabase: string | null
  videoVersion: number | null
  musicDatabase: string | null
  musicVersion: number | null
}

class KodiMySQLConnectionService {
  private pools: Map<string, Pool> = new Map()

  /**
   * Check if mysql2 is available
   */
  isAvailable(): boolean {
    return mysqlAvailable && mysql !== null
  }

  /**
   * Throw an error if mysql2 is not available
   */
  private ensureAvailable(): void {
    if (!this.isAvailable()) {
      throw new Error(
        'MySQL support not available. Please install the mysql2 package: npm install mysql2'
      )
    }
  }

  /**
   * Create a connection pool for the given config
   */
  async createPool(config: KodiMySQLConfig): Promise<Pool> {
    this.ensureAvailable()
    const poolKey = this.getPoolKey(config)

    // Return existing pool if available
    if (this.pools.has(poolKey)) {
      return this.pools.get(poolKey)!
    }

    const pool = mysql!.createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.username,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: config.connectionTimeout || 10000,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    })

    this.pools.set(poolKey, pool)
    return pool
  }

  /**
   * Close and remove a connection pool
   */
  async closePool(config: KodiMySQLConfig): Promise<void> {
    const poolKey = this.getPoolKey(config)
    const pool = this.pools.get(poolKey)

    if (pool) {
      await pool.end()
      this.pools.delete(poolKey)
    }
  }

  /**
   * Close all connection pools
   */
  async closeAllPools(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.end()
    }
    this.pools.clear()
  }

  /**
   * Test connection and detect available databases
   */
  async testConnection(config: KodiMySQLConfig): Promise<KodiMySQLConnectionTestResult> {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'MySQL support not available. Please install the mysql2 package: npm install mysql2',
      }
    }

    const startTime = Date.now()
    let connection: Connection | null = null

    try {
      // Create temporary connection (not pooled) for testing
      connection = await mysql!.createConnection({
        host: config.host,
        port: config.port || 3306,
        user: config.username,
        password: config.password,
        connectTimeout: config.connectionTimeout || 10000,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      })

      // Get server version
      const [versionRows] = await connection.query('SELECT VERSION() as version')
      const serverVersion = (versionRows as Array<{ version?: string }>)[0]?.version || 'Unknown'

      // Detect databases
      const detected = await this.detectDatabasesWithConnection(connection, config.databasePrefix)

      await connection.end()

      return {
        success: true,
        serverVersion,
        videoDatabaseName: detected.videoDatabase || undefined,
        videoDatabaseVersion: detected.videoVersion || undefined,
        musicDatabaseName: detected.musicDatabase || undefined,
        musicDatabaseVersion: detected.musicVersion || undefined,
        latencyMs: Date.now() - startTime,
      }
    } catch (error: unknown) {
      if (connection) {
        try {
          await connection.end()
        } catch {
          // Ignore close errors
        }
      }

      // Sanitize error message (don't expose passwords)
      let errorMessage = getErrorMessage(error) || 'Connection failed'
      if (errorMessage.includes('Access denied')) {
        errorMessage = 'Access denied - check username and password'
      } else if (errorMessage.includes('ECONNREFUSED')) {
        errorMessage = `Connection refused - check host (${config.host}) and port (${config.port || 3306})`
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ENOTFOUND')) {
        errorMessage = `Cannot reach host ${config.host} - check network connection`
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Detect Kodi databases using an existing connection
   */
  private async detectDatabasesWithConnection(
    connection: Connection | PoolConnection,
    prefix?: string
  ): Promise<DetectedDatabases> {
    const dbPrefix = prefix || 'kodi_'

    // Query for video databases
    const [videoRows] = await connection.query(
      `SHOW DATABASES LIKE '${dbPrefix}video%'`
    )
    const videoDatabases = (videoRows as Array<Record<string, string>>).map(row => Object.values(row)[0])

    // Query for music databases
    const [musicRows] = await connection.query(
      `SHOW DATABASES LIKE '${dbPrefix}music%'`
    )
    const musicDatabases = (musicRows as Array<Record<string, string>>).map(row => Object.values(row)[0])

    // Find highest version for each type
    const videoDb = this.findHighestVersion(videoDatabases, `${dbPrefix}video`)
    const musicDb = this.findHighestVersion(musicDatabases, `${dbPrefix}music`)

    return {
      videoDatabase: videoDb.name,
      videoVersion: videoDb.version,
      musicDatabase: musicDb.name,
      musicVersion: musicDb.version,
    }
  }

  /**
   * Detect available Kodi databases
   */
  async detectDatabases(config: KodiMySQLConfig): Promise<DetectedDatabases> {
    const pool = await this.createPool(config)
    const connection = await pool.getConnection()

    try {
      return await this.detectDatabasesWithConnection(connection, config.databasePrefix)
    } finally {
      connection.release()
    }
  }

  /**
   * Execute a query on a specific database
   */
  async query<T>(
    pool: Pool,
    database: string,
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    const connection = await pool.getConnection()

    try {
      // Switch to the target database
      await connection.query(`USE \`${database}\``)

      // Execute the query
      const [rows] = await connection.query(sql, params)
      return rows as T[]
    } finally {
      connection.release()
    }
  }

  /**
   * Find the database with the highest version number
   */
  private findHighestVersion(
    databases: string[],
    prefix: string
  ): { name: string | null; version: number | null } {
    if (databases.length === 0) {
      return { name: null, version: null }
    }

    let highestVersion = -1
    let highestName: string | null = null

    for (const db of databases) {
      // Extract version number from database name (e.g., "kodi_video121" -> 121)
      const versionStr = db.replace(prefix, '')
      const version = parseInt(versionStr, 10)

      if (!isNaN(version) && version > highestVersion) {
        highestVersion = version
        highestName = db
      }
    }

    return {
      name: highestName,
      version: highestVersion >= 0 ? highestVersion : null,
    }
  }

  /**
   * Generate a unique key for the pool map
   */
  private getPoolKey(config: KodiMySQLConfig): string {
    return `${config.host}:${config.port || 3306}:${config.username}`
  }
}

// Singleton instance
let serviceInstance: KodiMySQLConnectionService | null = null

export function getKodiMySQLConnectionService(): KodiMySQLConnectionService {
  if (!serviceInstance) {
    serviceInstance = new KodiMySQLConnectionService()
  }
  return serviceInstance
}
