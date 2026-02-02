/**
 * Vitest Global Setup
 *
 * This file runs before each test file.
 * Use it to set up mocks and global test utilities.
 */

import { vi } from 'vitest'

// Mock Electron-specific modules that don't work in Node test environment
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      switch (name) {
        case 'userData': return '/mock/user/data'
        case 'appData': return '/mock/app/data'
        case 'temp': return '/mock/temp'
        default: return `/mock/${name}`
      }
    }),
    getName: vi.fn(() => 'totality-test'),
    getVersion: vi.fn(() => '0.1.0-test'),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    webContents: {
      send: vi.fn(),
    },
  })),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}))

// Mock sql.js for database tests
vi.mock('sql.js', () => {
  const mockDb = {
    exec: vi.fn(() => []),
    run: vi.fn(),
    close: vi.fn(),
    export: vi.fn(() => new Uint8Array()),
    getRowsModified: vi.fn(() => 0),
  }

  return {
    default: vi.fn(() => Promise.resolve({
      Database: vi.fn(() => mockDb),
    })),
  }
})

// Global test utilities
declare global {
  var __TEST__: boolean
}
globalThis.__TEST__ = true
