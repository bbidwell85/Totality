import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))
vi.mock('chokidar', () => ({
  default: { watch: vi.fn() },
  watch: vi.fn(),
}))
vi.mock('child_process', () => ({
  exec: vi.fn(),
}))
vi.mock('util', () => ({
  promisify: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
    getMediaSources: vi.fn(() => []),
  })),
}))
vi.mock('../../src/main/services/SourceManager', () => ({
  getSourceManager: vi.fn(() => ({
    getProviders: vi.fn(() => []),
  })),
}))
vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))
vi.mock('../../src/main/services/SeriesCompletenessService', () => ({
  getSeriesCompletenessService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/TaskQueueService', () => ({
  getTaskQueueService: vi.fn(() => ({
    hasActiveTask: vi.fn(() => false),
  })),
}))
vi.mock('../../src/main/ipc/utils/safeSend', () => ({
  safeSend: vi.fn(),
}))
vi.mock('../../src/main/ipc/utils/notificationEmitter', () => ({
  emitNotificationCreated: vi.fn(),
}))

import { isNetworkPath } from '@main/services/LiveMonitoringService'

describe('LiveMonitoringService', () => {
  // ==========================================================================
  // isNetworkPath
  // ==========================================================================
  describe('isNetworkPath', () => {
    it('detects Windows UNC paths', () => {
      expect(isNetworkPath('\\\\server\\share\\file.mkv')).toBe(true)
    })

    it('detects /mnt/ paths', () => {
      expect(isNetworkPath('/mnt/nas/movies/file.mkv')).toBe(true)
    })

    it('detects /Volumes/ paths', () => {
      expect(isNetworkPath('/Volumes/NAS/movies/file.mkv')).toBe(true)
    })

    it('detects paths with /smb/', () => {
      expect(isNetworkPath('/run/user/1000/gvfs/smb/share/file.mkv')).toBe(true)
    })

    it('detects paths with /nfs/', () => {
      expect(isNetworkPath('/run/user/nfs/export/file.mkv')).toBe(true)
    })

    it('returns false for local Windows path', () => {
      expect(isNetworkPath('C:\\Movies\\file.mkv')).toBe(false)
    })

    it('returns false for local Linux path', () => {
      expect(isNetworkPath('/home/user/movies/file.mkv')).toBe(false)
    })

    it('returns false for relative path', () => {
      expect(isNetworkPath('./movies/file.mkv')).toBe(false)
    })
  })
})
