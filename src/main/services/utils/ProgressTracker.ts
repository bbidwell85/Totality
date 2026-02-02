/**
 * ProgressTracker Utilities
 *
 * Shared progress tracking and cancellation support for analysis services.
 * Provides consistent progress reporting and operation cancellation across services.
 */

/**
 * Generic progress interface for analysis operations
 * @template Phase String union type for phase names (e.g., 'scanning' | 'analyzing' | 'complete')
 */
export interface AnalysisProgress<Phase extends string = string> {
  /** Current item number being processed (0-indexed) */
  current: number
  /** Total number of items to process */
  total: number
  /** Display name of the current item being processed */
  currentItem: string
  /** Current phase of the analysis */
  phase: Phase
  /** Completion percentage (0-100) - optional for backward compatibility */
  percentage?: number
  /** Number of items skipped (e.g., recently analyzed) */
  skipped?: number
}

/**
 * Standard phases for media analysis operations
 */
export type StandardAnalysisPhase = 'scanning' | 'analyzing' | 'fetching' | 'complete'

/**
 * Options for analysis operations with skip-recently-analyzed support
 */
export interface AnalysisOptions {
  /** Skip items that were already analyzed recently (default: true) */
  skipRecentlyAnalyzed?: boolean
  /** How many days before re-analyzing (default: 7) */
  reanalyzeAfterDays?: number
}

/**
 * Default analysis options
 */
export const DEFAULT_ANALYSIS_OPTIONS: Required<AnalysisOptions> = {
  skipRecentlyAnalyzed: true,
  reanalyzeAfterDays: 7,
}

/**
 * Base class for cancellable operations
 * Provides consistent cancellation support across all analysis services
 *
 * @example
 * class MyService extends CancellableOperation {
 *   async analyze() {
 *     this.resetCancellation()
 *     for (const item of items) {
 *       if (this.isCancelled()) {
 *         return { completed: false }
 *       }
 *       await processItem(item)
 *     }
 *     return { completed: true }
 *   }
 * }
 */
export class CancellableOperation {
  private cancelled = false

  /**
   * Request cancellation of the current operation
   */
  cancel(): void {
    this.cancelled = true
  }

  /**
   * Check if cancellation has been requested
   */
  isCancelled(): boolean {
    return this.cancelled
  }

  /**
   * Reset the cancellation flag (call at start of new operation)
   */
  protected resetCancellation(): void {
    this.cancelled = false
  }
}

/**
 * Check if an item was recently analyzed based on its last sync/update timestamp
 *
 * @param lastSyncAt ISO timestamp of last analysis (or undefined if never analyzed)
 * @param reanalyzeAfterDays Number of days before re-analyzing
 * @returns true if the item was analyzed within the specified window
 *
 * @example
 * if (wasRecentlyAnalyzed(item.updated_at, 7)) {
 *   skipped++
 *   continue
 * }
 */
export function wasRecentlyAnalyzed(
  lastSyncAt: string | undefined,
  reanalyzeAfterDays: number
): boolean {
  if (!lastSyncAt) return false
  const lastSync = new Date(lastSyncAt)
  const daysSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24)
  return daysSinceSync < reanalyzeAfterDays
}

/**
 * Calculate progress percentage
 *
 * @param current Current item index (0-indexed)
 * @param total Total number of items
 * @returns Percentage (0-100)
 */
export function calculatePercentage(current: number, total: number): number {
  if (total === 0) return 100
  return Math.round((current / total) * 100)
}

/**
 * Create a progress object with standard fields
 *
 * @param current Current item index
 * @param total Total number of items
 * @param currentItem Display name of current item
 * @param phase Current phase
 * @param skipped Number of skipped items (optional)
 */
export function createProgress<Phase extends string>(
  current: number,
  total: number,
  currentItem: string,
  phase: Phase,
  skipped?: number
): AnalysisProgress<Phase> {
  return {
    current,
    total,
    currentItem,
    phase,
    percentage: calculatePercentage(current, total),
    skipped,
  }
}

/**
 * Result type for analysis operations
 */
export interface AnalysisResult {
  /** Whether the analysis completed successfully (false if cancelled) */
  completed: boolean
  /** Number of items analyzed */
  analyzed: number
  /** Number of items skipped (recently analyzed) */
  skipped: number
}
