/**
 * ProgressTracker Unit Tests
 *
 * Tests for CancellableOperation, wasRecentlyAnalyzed,
 * calculatePercentage, and createProgress utilities.
 */

import { describe, it, expect } from 'vitest'
import {
  CancellableOperation,
  wasRecentlyAnalyzed,
  calculatePercentage,
  createProgress,
  DEFAULT_ANALYSIS_OPTIONS,
} from '../../src/main/services/utils/ProgressTracker'

// ============================================================================
// CancellableOperation
// ============================================================================

describe('CancellableOperation', () => {
  // Subclass to expose protected resetCancellation
  class TestOperation extends CancellableOperation {
    reset() {
      this.resetCancellation()
    }
  }

  it('should not be cancelled initially', () => {
    const op = new TestOperation()
    expect(op.isCancelled()).toBe(false)
  })

  it('should be cancelled after cancel()', () => {
    const op = new TestOperation()
    op.cancel()
    expect(op.isCancelled()).toBe(true)
  })

  it('should reset cancellation', () => {
    const op = new TestOperation()
    op.cancel()
    expect(op.isCancelled()).toBe(true)
    op.reset()
    expect(op.isCancelled()).toBe(false)
  })

  it('should allow multiple cancel/reset cycles', () => {
    const op = new TestOperation()
    op.cancel()
    op.reset()
    op.cancel()
    expect(op.isCancelled()).toBe(true)
    op.reset()
    expect(op.isCancelled()).toBe(false)
  })
})

// ============================================================================
// wasRecentlyAnalyzed
// ============================================================================

describe('wasRecentlyAnalyzed', () => {
  it('should return false when lastSyncAt is undefined', () => {
    expect(wasRecentlyAnalyzed(undefined, 7)).toBe(false)
  })

  it('should return true when analyzed within the window', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    expect(wasRecentlyAnalyzed(oneHourAgo, 7)).toBe(true)
  })

  it('should return false when analyzed outside the window', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    expect(wasRecentlyAnalyzed(tenDaysAgo, 7)).toBe(false)
  })

  it('should return true when analyzed exactly at the boundary', () => {
    // 6.9 days ago, window is 7 days
    const justInside = new Date(Date.now() - 6.9 * 24 * 60 * 60 * 1000).toISOString()
    expect(wasRecentlyAnalyzed(justInside, 7)).toBe(true)
  })

  it('should handle 0-day window (always re-analyze)', () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
    expect(wasRecentlyAnalyzed(oneMinuteAgo, 0)).toBe(false)
  })
})

// ============================================================================
// calculatePercentage
// ============================================================================

describe('calculatePercentage', () => {
  it('should return 100 when total is 0', () => {
    expect(calculatePercentage(0, 0)).toBe(100)
  })

  it('should return 0 at start', () => {
    expect(calculatePercentage(0, 100)).toBe(0)
  })

  it('should return 50 at midpoint', () => {
    expect(calculatePercentage(50, 100)).toBe(50)
  })

  it('should return 100 at completion', () => {
    expect(calculatePercentage(100, 100)).toBe(100)
  })

  it('should round to nearest integer', () => {
    expect(calculatePercentage(1, 3)).toBe(33)
    expect(calculatePercentage(2, 3)).toBe(67)
  })
})

// ============================================================================
// createProgress
// ============================================================================

describe('createProgress', () => {
  it('should create a progress object with all fields', () => {
    const progress = createProgress(5, 10, 'Movie.mkv', 'analyzing', 2)
    expect(progress).toEqual({
      current: 5,
      total: 10,
      currentItem: 'Movie.mkv',
      phase: 'analyzing',
      percentage: 50,
      skipped: 2,
    })
  })

  it('should handle omitted skipped parameter', () => {
    const progress = createProgress(0, 5, 'First Item', 'scanning')
    expect(progress.skipped).toBeUndefined()
    expect(progress.percentage).toBe(0)
  })

  it('should support custom phase types', () => {
    const progress = createProgress<'fetching' | 'complete'>(10, 10, 'Done', 'complete')
    expect(progress.phase).toBe('complete')
    expect(progress.percentage).toBe(100)
  })
})

// ============================================================================
// DEFAULT_ANALYSIS_OPTIONS
// ============================================================================

describe('DEFAULT_ANALYSIS_OPTIONS', () => {
  it('should have expected defaults', () => {
    expect(DEFAULT_ANALYSIS_OPTIONS.skipRecentlyAnalyzed).toBe(true)
    expect(DEFAULT_ANALYSIS_OPTIONS.reanalyzeAfterDays).toBe(7)
  })
})
