import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))

// Mock dependencies
vi.mock('../../src/main/ipc/utils/safeSend', () => ({
  safeSend: vi.fn(),
}))

vi.mock('../../src/main/services/SourceManager', () => ({
  getSourceManager: vi.fn().mockReturnValue({
    getProvider: vi.fn(),
    getSources: vi.fn().mockReturnValue([]),
  }),
}))

vi.mock('../../src/main/services/SeriesCompletenessService', () => ({
  getSeriesCompletenessService: vi.fn().mockReturnValue({
    analyzeLibraryCompleteness: vi.fn(),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/MovieCollectionService', () => ({
  getMovieCollectionService: vi.fn().mockReturnValue({
    analyzeCollections: vi.fn(),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/MusicBrainzService', () => ({
  getMusicBrainzService: vi.fn().mockReturnValue({
    analyzeArtistCompleteness: vi.fn(),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn().mockReturnValue({
    getSources: vi.fn().mockReturnValue([]),
    getMediaItems: vi.fn().mockReturnValue([]),
  }),
}))

vi.mock('../../src/main/services/LiveMonitoringService', () => ({
  getLiveMonitoringService: vi.fn().mockReturnValue({
    pauseMonitoring: vi.fn(),
    resumeMonitoring: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isActiveAndEnabled: vi.fn().mockReturnValue(false),
  }),
}))

// Import after mocks
import { TaskQueueService, TaskDefinition } from '../../src/main/services/TaskQueueService'

describe('TaskQueueService', () => {
  let service: TaskQueueService

  beforeEach(() => {
    service = new TaskQueueService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('queue management', () => {
    it('should add a task to the queue', () => {
      const definition: TaskDefinition = {
        type: 'library-scan',
        label: 'Scan All Libraries',
      }

      const taskId = service.addTask(definition)

      expect(taskId).toBeDefined()
      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/)

      const state = service.getQueueState()
      expect(state.queue.length + (state.currentTask ? 1 : 0)).toBe(1)
    })

    it('should add multiple tasks to the queue', () => {
      service.addTask({ type: 'library-scan', label: 'Task 1' })
      service.addTask({ type: 'source-scan', label: 'Task 2', sourceId: 'src1' })
      service.addTask({ type: 'series-completeness', label: 'Task 3' })

      const state = service.getQueueState()
      // First task might be running, rest in queue
      const totalTasks = state.queue.length + (state.currentTask ? 1 : 0)
      expect(totalTasks).toBe(3)
    })

    it('should remove a queued task', () => {
      const taskId = service.addTask({ type: 'library-scan', label: 'Test' })

      // If task is already running, removeTask returns false for running tasks
      const state = service.getQueueState()
      if (state.queue.find(t => t.id === taskId)) {
        const removed = service.removeTask(taskId)
        expect(removed).toBe(true)
      }
    })

    it('should return false when removing non-existent task', () => {
      const removed = service.removeTask('non-existent-id')
      expect(removed).toBe(false)
    })

    it('should generate unique task IDs', () => {
      const id1 = service.addTask({ type: 'library-scan', label: 'Task 1' })
      const id2 = service.addTask({ type: 'library-scan', label: 'Task 2' })

      expect(id1).not.toBe(id2)
    })
  })

  describe('queue state', () => {
    it('should return queue state', () => {
      const state = service.getQueueState()

      expect(state).toHaveProperty('currentTask')
      expect(state).toHaveProperty('queue')
      expect(state).toHaveProperty('isPaused')
      expect(state).toHaveProperty('completedTasks')
      expect(Array.isArray(state.queue)).toBe(true)
      expect(Array.isArray(state.completedTasks)).toBe(true)
    })

    it('should track paused state', () => {
      expect(service.getQueueState().isPaused).toBe(false)

      service.pauseQueue()
      expect(service.getQueueState().isPaused).toBe(true)

      service.resumeQueue()
      expect(service.getQueueState().isPaused).toBe(false)
    })
  })

  describe('pause/resume', () => {
    it('should pause the queue', () => {
      service.pauseQueue()

      const state = service.getQueueState()
      expect(state.isPaused).toBe(true)
    })

    it('should resume the queue', () => {
      service.pauseQueue()
      service.resumeQueue()

      const state = service.getQueueState()
      expect(state.isPaused).toBe(false)
    })
  })

  describe('monitoring history', () => {
    it('should return monitoring history', () => {
      const history = service.getMonitoringHistory()
      expect(Array.isArray(history)).toBe(true)
    })
  })

  describe('task definitions', () => {
    it('should accept library-scan task', () => {
      const id = service.addTask({ type: 'library-scan', label: 'Scan' })
      expect(id).toBeDefined()
    })

    it('should accept source-scan task with sourceId', () => {
      const id = service.addTask({
        type: 'source-scan',
        label: 'Scan Source',
        sourceId: 'test-source',
      })
      expect(id).toBeDefined()
    })

    it('should accept music-scan task', () => {
      const id = service.addTask({
        type: 'music-scan',
        label: 'Scan Music',
        sourceId: 'test-source',
        libraryId: 'test-library',
      })
      expect(id).toBeDefined()
    })

    it('should accept series-completeness task', () => {
      const id = service.addTask({
        type: 'series-completeness',
        label: 'Analyze Series',
      })
      expect(id).toBeDefined()
    })

    it('should accept collection-completeness task', () => {
      const id = service.addTask({
        type: 'collection-completeness',
        label: 'Analyze Collections',
      })
      expect(id).toBeDefined()
    })

    it('should accept music-completeness task', () => {
      const id = service.addTask({
        type: 'music-completeness',
        label: 'Analyze Music',
      })
      expect(id).toBeDefined()
    })
  })
})
