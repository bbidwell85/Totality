import { beforeEach, describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'

const mockGetMediaItemByPath = vi.hoisted(() => vi.fn())
const mockGetMusicTrackByPath = vi.hoisted(() => vi.fn())
const mockDeleteMediaItem = vi.hoisted(() => vi.fn())
const mockDeleteMusicTrack = vi.hoisted(() => vi.fn())
const mockUpdateSourceScanTime = vi.hoisted(() => vi.fn())
const mockGetMediaItems = vi.hoisted(() => vi.fn())
const mockParseMusic = vi.hoisted(() => vi.fn())
const mockGetSetting = vi.hoisted(() => vi.fn((key: string) => key === 'ffprobe_batch_size' ? '25' : 'false'))

// Mock all heavy dependencies of LocalFolderProvider module
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), statSync: vi.fn() },
  existsSync: vi.fn(),
  statSync: vi.fn(),
  promises: { readdir: vi.fn() },
}))
vi.mock('fs/promises', () => ({
  default: { readdir: vi.fn(), stat: vi.fn() },
  readdir: vi.fn(),
  stat: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}))
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: mockGetSetting,
    getMediaItemByPath: mockGetMediaItemByPath,
    getMusicTrackByPath: mockGetMusicTrackByPath,
    deleteMediaItem: mockDeleteMediaItem,
    deleteMusicTrack: mockDeleteMusicTrack,
    updateSourceScanTime: mockUpdateSourceScanTime,
    getMediaItems: mockGetMediaItems,
    startBatch: vi.fn(),
    endBatch: vi.fn(),
  })),
}))
vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({ loadThresholdsFromDatabase: vi.fn(async () => {}) })),
}))
vi.mock('../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: vi.fn(() => ({ isAvailable: vi.fn(async () => false) })),
}))
vi.mock('../../src/main/services/FileNameParser', () => ({
  getFileNameParser: vi.fn(() => ({
    isVideoFile: vi.fn(() => true),
    isAudioFile: vi.fn(() => true),
    parseMusic: mockParseMusic,
  })),
}))
vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({ verbose: vi.fn() })),
}))
vi.mock('../../src/main/services/MusicBrainzService', () => ({
  getMusicBrainzService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/GeminiService', () => ({
  getGeminiService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/MediaNormalizer', () => ({
  normalizeVideoCodec: vi.fn((c: string) => c),
  normalizeResolution: vi.fn(() => '1080p'),
  normalizeAudioCodec: vi.fn((c: string) => c),
}))

import { isExtrasContent, readFfprobeBatchSize, LocalFolderProvider } from '@main/providers/local/LocalFolderProvider'

describe('isExtrasContent', () => {
  it('detects sample files', () => {
    expect(isExtrasContent('sample.mkv')).toBe(true)
    expect(isExtrasContent('Movie.Sample.mkv')).toBe(true)
  })

  it('detects featurettes', () => {
    expect(isExtrasContent('featurette-making.mkv')).toBe(true)
    expect(isExtrasContent('Featurettes.mkv')).toBe(true)
  })

  it('detects behind the scenes', () => {
    expect(isExtrasContent('behind-the-scenes.mkv')).toBe(true)
    expect(isExtrasContent('Behind The Scenes.mkv')).toBe(true)
  })

  it('detects deleted scenes', () => {
    expect(isExtrasContent('deleted-scenes.mkv')).toBe(true)
    expect(isExtrasContent('Deleted Scene.mkv')).toBe(true)
  })

  it('detects gag reel', () => {
    expect(isExtrasContent('gag reel.mkv')).toBe(true)
  })

  it('detects bloopers', () => {
    expect(isExtrasContent('bloopers.mkv')).toBe(true)
    expect(isExtrasContent('Blooper.mkv')).toBe(true)
  })

  it('detects making of', () => {
    expect(isExtrasContent('making of.mkv')).toBe(true)
    expect(isExtrasContent('Making_Of.mkv')).toBe(true)
  })

  it('detects trailers', () => {
    expect(isExtrasContent('trailer.mkv')).toBe(true)
    expect(isExtrasContent('Official Teaser.mkv')).toBe(true)
  })

  it('detects commentary', () => {
    expect(isExtrasContent('commentary.mkv')).toBe(true)
  })

  it('detects bonus content', () => {
    expect(isExtrasContent('bonus content.mkv')).toBe(true)
    expect(isExtrasContent('bonus.mkv')).toBe(true)
  })

  it('detects BTS', () => {
    expect(isExtrasContent('BTS.mkv')).toBe(true)
  })

  it('detects outtakes', () => {
    expect(isExtrasContent('outtakes.mkv')).toBe(true)
  })

  it('detects numbered scenes', () => {
    expect(isExtrasContent('scene-2.mkv')).toBe(true)
  })

  it('detects alternate endings', () => {
    expect(isExtrasContent('alternate ending.mkv')).toBe(true)
  })

  it('detects extended cuts', () => {
    expect(isExtrasContent('extended cut.mkv')).toBe(true)
    expect(isExtrasContent('extended scene.mkv')).toBe(true)
  })

  it('does NOT flag normal movie titles', () => {
    expect(isExtrasContent('The.Matrix.1999.1080p.BluRay.mkv')).toBe(false)
    expect(isExtrasContent('Inception.2010.4K.mkv')).toBe(false)
    expect(isExtrasContent('Interstellar.mkv')).toBe(false)
  })

  it('is case insensitive', () => {
    expect(isExtrasContent('FEATURETTE.MKV')).toBe(true)
    expect(isExtrasContent('BEHIND THE SCENES.MKV')).toBe(true)
  })
})

describe('LocalFolderProvider scan safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses configured defaults only when the setting is absent', () => {
    expect(readFfprobeBatchSize(null, 25)).toBe(25)
    expect(readFfprobeBatchSize('', 50)).toBe(50)
    expect(readFfprobeBatchSize('  ', 25)).toBe(25)
    expect(readFfprobeBatchSize('8', 25)).toBe(8)
    expect(readFfprobeBatchSize('128', 25)).toBe(128)
  })

  it.each(['0', '-1', '1.5', '12items', '129', 'NaN', 'Infinity'])(
    'rejects invalid ffprobe_batch_size %s instead of looping indefinitely',
    setting => {
      expect(() => readFfprobeBatchSize(setting, 25)).toThrow('Invalid ffprobe_batch_size')
    }
  )

  it('rejects an incomplete directory enumeration rather than treating it as a deletion', async () => {
    vi.mocked(fs.promises.readdir).mockRejectedValueOnce(new Error('EACCES'))
    const provider = new LocalFolderProvider({
      sourceId: 'test-local',
      connectionConfig: { folderPath: '/media', mediaType: 'movies' },
    } as ConstructorParameters<typeof LocalFolderProvider>[0])

    const discover = Reflect.get(provider, 'discoverMediaFiles') as (
      dir: string, type: 'movie' | 'episode'
    ) => Promise<unknown>
    await expect(discover.call(provider, '/media', 'movie')).rejects.toThrow(
      'Cannot complete media inventory'
    )
  })

  it('treats an empty incremental inventory as a successful no-op', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const provider = new LocalFolderProvider({
      sourceId: 'test-local',
      connectionConfig: { folderPath: '/media', mediaType: 'movies' },
    } as ConstructorParameters<typeof LocalFolderProvider>[0])
    const discoverSpy = vi.spyOn(Object.getPrototypeOf(provider), 'discoverMediaFiles').mockResolvedValue([])

    const result = await provider.scanLibrary('movies', { sinceTimestamp: new Date('2026-01-01') })
    discoverSpy.mockRestore()

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(mockGetMediaItems).not.toHaveBeenCalled()
    expect(mockUpdateSourceScanTime).not.toHaveBeenCalled()
  })
  it('retains a missing video when a targeted watcher event cannot prove deletion', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    mockGetMediaItemByPath.mockReturnValue({ id: 21 })
    const provider = new LocalFolderProvider({
      sourceId: 'test-local',
      connectionConfig: { folderPath: '/media', mediaType: 'movies' },
    } as ConstructorParameters<typeof LocalFolderProvider>[0])
    const scan = Reflect.get(provider, 'scanTargetedFiles') as
      (libraryId: string, files: string[]) => Promise<{ success: boolean; itemsRemoved: number; errors: string[] }>
    const result = await scan.call(provider, 'movies', ['/unavailable/Movie.mkv'])
    expect(result.success).toBe(false)
    expect(result.itemsRemoved).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(mockDeleteMediaItem).not.toHaveBeenCalled()
  })

  it('retains a missing track when a targeted watcher event cannot prove deletion', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    mockGetMusicTrackByPath.mockReturnValue({ id: 22 })
    const provider = new LocalFolderProvider({
      sourceId: 'test-local',
      connectionConfig: { folderPath: '/music', mediaType: 'music' },
    } as ConstructorParameters<typeof LocalFolderProvider>[0])
    const scan = Reflect.get(provider, 'scanTargetedMusicFiles') as
      (files: string[]) => Promise<{ success: boolean; itemsRemoved: number; errors: string[] }>
    const result = await scan.call(provider, ['/unavailable/Song.flac'])
    expect(result.success).toBe(false)
    expect(result.itemsRemoved).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(mockDeleteMusicTrack).not.toHaveBeenCalled()
  })

  it('preserves the music scan cursor when a discovered track fails processing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    mockParseMusic.mockImplementationOnce(() => { throw new Error('Invalid music metadata') })
    const provider = new LocalFolderProvider({
      sourceId: 'test-local',
      connectionConfig: { folderPath: '/music', mediaType: 'music' },
    } as ConstructorParameters<typeof LocalFolderProvider>[0])
    const discoverSpy = vi.spyOn(Object.getPrototypeOf(provider), 'discoverAudioFiles')
      .mockResolvedValue([{ filePath: '/music/bad.flac', relativePath: 'bad.flac' }])
    const scan = Reflect.get(provider, 'scanMusicLibrary') as
      (onProgress?: unknown, scanPath?: string) => Promise<{ success: boolean; errors: string[] }>
    const result = await scan.call(provider, undefined, '/music')
    discoverSpy.mockRestore()
    expect(result.success).toBe(false)
    expect(result.errors.join(' ')).toContain('Invalid music metadata')
    expect(mockUpdateSourceScanTime).not.toHaveBeenCalled()
  })

  it('rejects inaccessible music subdirectories as incomplete inventory', async () => {
    vi.mocked(fs.promises.readdir).mockRejectedValueOnce(new Error('EACCES'))
    const provider = new LocalFolderProvider({
      sourceId: 'test-local',
      connectionConfig: { folderPath: '/music', mediaType: 'music' },
    } as ConstructorParameters<typeof LocalFolderProvider>[0])
    const discover = Reflect.get(provider, 'discoverAudioFiles') as (root: string) => Promise<unknown>
    await expect(discover.call(provider, '/music')).rejects.toThrow('Cannot complete music inventory')
  })

})
