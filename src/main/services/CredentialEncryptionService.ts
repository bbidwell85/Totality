/**
 * CredentialEncryptionService
 *
 * Provides encryption/decryption for sensitive credentials using Electron's safeStorage API.
 * This ensures credentials are encrypted at rest using OS-level encryption mechanisms:
 * - Windows: DPAPI (Data Protection API)
 * - macOS: Keychain
 * - Linux: libsecret
 *
 * The service encrypts sensitive fields within connection configs and settings
 * before storing them in the SQLite database.
 */

import { safeStorage } from 'electron'

// Fields that should be encrypted in connection configs
const SENSITIVE_CONFIG_FIELDS = [
  'token',
  'accessToken',
  'apiKey',
  'password',
  'secret',
]

// Settings keys that should be encrypted
const SENSITIVE_SETTINGS_KEYS = [
  'plex_token',
  'tmdb_api_key',
  'musicbrainz_api_token',
]

// Prefix to identify encrypted values
const ENCRYPTED_PREFIX = 'ENC:'

export class CredentialEncryptionService {
  private isAvailable: boolean

  constructor() {
    // Check if safeStorage is available on this platform
    this.isAvailable = safeStorage.isEncryptionAvailable()
    if (!this.isAvailable) {
      console.warn('[CredentialEncryption] safeStorage not available - credentials will be stored in plain text')
    } else {
      console.log('[CredentialEncryption] Encryption available using OS secure storage')
    }
  }

  /**
   * Check if encryption is available on this platform
   */
  isEncryptionAvailable(): boolean {
    return this.isAvailable
  }

  /**
   * Encrypt a string value
   * Returns the encrypted value prefixed with 'ENC:' for identification
   */
  encrypt(value: string): string {
    if (!this.isAvailable || !value) {
      return value
    }

    try {
      const encrypted = safeStorage.encryptString(value)
      // Convert to base64 for storage
      return ENCRYPTED_PREFIX + encrypted.toString('base64')
    } catch (error) {
      console.error('[CredentialEncryption] Failed to encrypt value:', error)
      return value
    }
  }

  /**
   * Decrypt a string value
   * Only decrypts values that have the 'ENC:' prefix
   */
  decrypt(value: string): string {
    if (!this.isAvailable || !value) {
      return value
    }

    // Only decrypt values with our prefix
    if (!value.startsWith(ENCRYPTED_PREFIX)) {
      return value
    }

    try {
      const encryptedBase64 = value.slice(ENCRYPTED_PREFIX.length)
      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64')
      return safeStorage.decryptString(encryptedBuffer)
    } catch (error) {
      console.error('[CredentialEncryption] Failed to decrypt value — credential may need to be re-entered:', error)
      // Return empty string on failure to force re-authentication,
      // rather than returning the encrypted blob which would be used as a raw credential
      return ''
    }
  }

  /**
   * Check if a value is encrypted
   */
  isEncrypted(value: string): boolean {
    return value?.startsWith(ENCRYPTED_PREFIX) ?? false
  }

  /**
   * Encrypt sensitive fields in a connection config object
   * Returns a new object with sensitive fields encrypted
   */
  encryptConnectionConfig(config: Record<string, unknown>): Record<string, unknown> {
    if (!this.isAvailable || !config) {
      return config
    }

    const encrypted: Record<string, unknown> = { ...config }

    for (const field of SENSITIVE_CONFIG_FIELDS) {
      if (typeof encrypted[field] === 'string' && encrypted[field]) {
        // Don't re-encrypt already encrypted values
        if (!this.isEncrypted(encrypted[field] as string)) {
          encrypted[field] = this.encrypt(encrypted[field] as string)
        }
      }
    }

    return encrypted
  }

  /**
   * Decrypt sensitive fields in a connection config object
   * Returns a new object with sensitive fields decrypted
   */
  decryptConnectionConfig(config: Record<string, unknown>): Record<string, unknown> {
    if (!config) {
      return config
    }

    const decrypted: Record<string, unknown> = { ...config }

    for (const field of SENSITIVE_CONFIG_FIELDS) {
      if (typeof decrypted[field] === 'string' && decrypted[field]) {
        decrypted[field] = this.decrypt(decrypted[field] as string)
      }
    }

    return decrypted
  }

  /**
   * Check if a settings key should be encrypted
   */
  isSensitiveSetting(key: string): boolean {
    return SENSITIVE_SETTINGS_KEYS.includes(key)
  }

  /**
   * Encrypt a setting value if it's a sensitive key
   */
  encryptSetting(key: string, value: string): string {
    if (!this.isAvailable || !this.isSensitiveSetting(key)) {
      return value
    }

    // Don't re-encrypt already encrypted values
    if (this.isEncrypted(value)) {
      return value
    }

    return this.encrypt(value)
  }

  /**
   * Decrypt a setting value if it's encrypted
   */
  decryptSetting(key: string, value: string): string {
    if (!this.isSensitiveSetting(key)) {
      return value
    }

    return this.decrypt(value)
  }

  /**
   * Migrate existing plain-text credentials to encrypted format
   * Call this during app initialization to encrypt any existing unencrypted credentials
   */
  async migrateCredentials(
    getMediaSources: () => Array<{ source_id: string; connection_config: string }>,
    updateMediaSource: (sourceId: string, connectionConfig: string) => Promise<void>,
    getSettings: () => Record<string, string>,
    setSetting: (key: string, value: string) => Promise<void>
  ): Promise<{ sourcesEncrypted: number; settingsEncrypted: number }> {
    let sourcesEncrypted = 0
    let settingsEncrypted = 0

    if (!this.isAvailable) {
      console.log('[CredentialEncryption] Skipping migration - encryption not available')
      return { sourcesEncrypted, settingsEncrypted }
    }

    console.log('[CredentialEncryption] Starting credential migration...')

    // Migrate media source credentials
    const sources = getMediaSources()
    for (const source of sources) {
      try {
        const config = JSON.parse(source.connection_config)
        let needsUpdate = false

        // Check if any sensitive field is unencrypted
        for (const field of SENSITIVE_CONFIG_FIELDS) {
          if (typeof config[field] === 'string' && config[field] && !this.isEncrypted(config[field])) {
            needsUpdate = true
            break
          }
        }

        if (needsUpdate) {
          const encrypted = this.encryptConnectionConfig(config)
          await updateMediaSource(source.source_id, JSON.stringify(encrypted))
          sourcesEncrypted++
          console.log(`[CredentialEncryption] Encrypted credentials for source: ${source.source_id}`)
        }
      } catch (error) {
        console.error(`[CredentialEncryption] Failed to migrate source ${source.source_id}:`, error)
      }
    }

    // Migrate sensitive settings
    const settings = getSettings()
    for (const key of SENSITIVE_SETTINGS_KEYS) {
      const value = settings[key]
      if (value && !this.isEncrypted(value)) {
        try {
          const encrypted = this.encrypt(value)
          await setSetting(key, encrypted)
          settingsEncrypted++
          console.log(`[CredentialEncryption] Encrypted setting: ${key}`)
        } catch (error) {
          console.error(`[CredentialEncryption] Failed to migrate setting ${key}:`, error)
        }
      }
    }

    console.log(`[CredentialEncryption] Migration complete: ${sourcesEncrypted} sources, ${settingsEncrypted} settings encrypted`)
    return { sourcesEncrypted, settingsEncrypted }
  }
}

// Singleton instance
let credentialEncryptionInstance: CredentialEncryptionService | null = null

export function getCredentialEncryptionService(): CredentialEncryptionService {
  if (!credentialEncryptionInstance) {
    credentialEncryptionInstance = new CredentialEncryptionService()
  }
  return credentialEncryptionInstance
}
