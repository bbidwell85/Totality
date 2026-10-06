/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))
vi.mock('crypto', () => ({
  default: { createHash: vi.fn() },
  createHash: vi.fn(),
}))
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => false), statSync: vi.fn() },
  existsSync: vi.fn(() => false),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  mkdirSync: vi.fn(),
}))
vi.mock('path', () => ({
  default: { join: (...args: string[]) => args.join('/'), dirname: (p: string) => p },
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p,
}))
vi.mock('http', () => ({ default: { get: vi.fn() }, get: vi.fn() }))
vi.mock('https', () => ({ default: { get: vi.fn() }, get: vi.fn() }))
vi.mock('adm-zip', () => ({
  default: vi.fn().mockImplementation(() => ({
    extractAllTo: vi.fn(),
  })),
}))
vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/appdata') },
}))

import { MediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'

function createMockProcess(stdout: string, exitCode = 0) {
  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stdout))
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0)
    }),
    kill: vi.fn(),
  }
  return proc
}

describe('MediaFileAnalyzer', () => {
  let analyzer: MediaFileAnalyzer

  beforeEach(() => {
    vi.clearAllMocks()
    analyzer = new MediaFileAnalyzer()
  })

  describe('getFFprobePath', () => {
    it('returns null initially', () => {
      expect(analyzer.getFFprobePath()).toBeNull()
    })
  })

  describe('isAvailable', () => {
    it('returns false when no ffprobe found', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess('', 1)
        proc.on = vi.fn((event: string, cb: any) => {
          if (event === 'error') setTimeout(() => cb(new Error('ENOENT')), 0)
        })
        return proc
      })
      const available = await analyzer.isAvailable()
      expect(available).toBe(false)
    })
  })

  describe('analyzeFile', () => {
    it('returns success false when file not found', async () => {
      ;(analyzer as any).ffprobePath = 'ffprobe'
      ;(analyzer as any).ffprobeChecked = true

      const result = await analyzer.analyzeFile('nonexistent.mkv')
      expect(result.success).toBe(false)
      expect(result.error).toContain('File not found')
    })

    it('returns success false when ffprobe unavailable', async () => {
      // ffprobeChecked = false, isAvailable will try paths and fail
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess('', 1)
        proc.on = vi.fn((event: string, cb: any) => {
          if (event === 'error') setTimeout(() => cb(new Error('ENOENT')), 0)
        })
        return proc
      })

      const result = await analyzer.analyzeFile('test.mkv')
      expect(result.success).toBe(false)
      expect(result.error).toContain('FFprobe is not installed')
    })
  })
})
