/**
 * CredentialEncryptionService Unit Tests
 *
 * The global setup (tests/setup.ts) mocks safeStorage with isEncryptionAvailable: false.
 * Individual describe blocks override this to test both available/unavailable states.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { safeStorage } from 'electron'
import { CredentialEncryptionService } from '../../src/main/services/CredentialEncryptionService'

describe('CredentialEncryptionService — encryption unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
  })

  it('rejects credential and sensitive-setting writes without OS encryption', () => {
    const svc = new CredentialEncryptionService()
    expect(() => svc.encrypt('my-secret-token')).toThrow('OS credential encryption unavailable')
    expect(() => svc.encryptSetting('web_access_pin', '123456')).toThrow('OS credential encryption unavailable')
    expect(() => svc.encryptConnectionConfig({ token: 'my-secret-token' })).toThrow('OS credential encryption unavailable')
    expect(svc.encryptSetting('language', 'he')).toBe('he')
  })

  it('does not return encrypted credentials as plaintext when OS encryption is unavailable', () => {
    const svc = new CredentialEncryptionService()
    expect(() => svc.decrypt('ENC:YWJj')).toThrow('OS credential encryption unavailable')
  })

  it('isEncryptionAvailable() returns false', () => {
    const svc = new CredentialEncryptionService()
    expect(svc.isEncryptionAvailable()).toBe(false)
  })

  it('isEncrypted() returns false for plain text', () => {
    const svc = new CredentialEncryptionService()
    expect(svc.isEncrypted('plain-text')).toBe(false)
  })

  it('decrypt() returns plain value as-is for non-ENC: values', () => {
    const svc = new CredentialEncryptionService()
    expect(svc.decrypt('plain-text')).toBe('plain-text')
  })
})

describe('CredentialEncryptionService — encryption available', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    vi.mocked(safeStorage.encryptString).mockImplementation(
      (str: string) => Buffer.from(`encrypted:${str}`)
    )
    vi.mocked(safeStorage.decryptString).mockImplementation(
      (buf: Buffer) => buf.toString().replace('encrypted:', '')
    )
  })

  it('encrypt() returns ENC:-prefixed value', () => {
    const svc = new CredentialEncryptionService()
    const result = svc.encrypt('my-secret-token')
    expect(result.startsWith('ENC:')).toBe(true)
  })

  it('isEncrypted() returns true for ENC:-prefixed value', () => {
    const svc = new CredentialEncryptionService()
    const encrypted = svc.encrypt('my-secret-token')
    expect(svc.isEncrypted(encrypted)).toBe(true)
  })

  it('decrypt() recovers original value (round-trip)', () => {
    const svc = new CredentialEncryptionService()
    const original = 'my-secret-token'
    const encrypted = svc.encrypt(original)
    expect(svc.decrypt(encrypted)).toBe(original)
  })

  it('decrypt() returns empty string on decryption failure', () => {
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('Decryption failed')
    })
    const svc = new CredentialEncryptionService()
    const result = svc.decrypt('ENC:aW52YWxpZA==')
    expect(result).toBe('')
  })

  it('hasDecryptionFailed() returns true after a decryption failure', () => {
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('Decryption failed')
    })
    const svc = new CredentialEncryptionService()
    svc.decrypt('ENC:aW52YWxpZA==')
    expect(svc.hasDecryptionFailed()).toBe(true)
  })

  it('hasDecryptionFailed() resets to false after being read', () => {
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('fail')
    })
    const svc = new CredentialEncryptionService()
    svc.decrypt('ENC:aW52YWxpZA==')
    svc.hasDecryptionFailed() // first read — true, resets flag
    expect(svc.hasDecryptionFailed()).toBe(false)
  })

  it('encrypt() throws instead of silently storing plaintext when encryptString fails', () => {
    vi.mocked(safeStorage.encryptString).mockImplementation(() => {
      throw new Error('OS encryption error')
    })
    const svc = new CredentialEncryptionService()
    expect(() => svc.encrypt('my-secret')).toThrow('Encryption failed')
  })
})
