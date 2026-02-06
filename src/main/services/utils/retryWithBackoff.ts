/**
 * Retry with Exponential Backoff
 *
 * Provides a utility for retrying failed operations with configurable
 * exponential backoff and jitter to prevent thundering herd problems.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number
  /** Backoff multiplier (default: 2) */
  backoffFactor?: number
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter?: boolean
  /** HTTP status codes that should trigger a retry (default: [429, 500, 502, 503, 504]) */
  retryableStatuses?: number[]
  /** Optional callback when a retry occurs */
  onRetry?: (attempt: number, error: Error, delay: number) => void
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
  retryableStatuses: [429, 500, 502, 503, 504]
}

/**
 * Check if an error is retryable based on status code
 */
function isRetryableError(error: unknown, retryableStatuses: number[]): boolean {
  // Network errors (no response) are retryable
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true
  }

  // Timeout errors are retryable
  if (error instanceof Error && error.name === 'AbortError') {
    return true
  }

  // Check for HTTP status in error message or properties
  if (error instanceof Error) {
    // Check for status in error message (e.g., "HTTP 503")
    const statusMatch = error.message.match(/\b(4\d{2}|5\d{2})\b/)
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10)
      return retryableStatuses.includes(status)
    }

    // Check for status property on error
    const errorWithStatus = error as Error & { status?: number; statusCode?: number }
    const status = errorWithStatus.status ?? errorWithStatus.statusCode
    if (status && retryableStatuses.includes(status)) {
      return true
    }
  }

  return false
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffFactor: number,
  jitter: boolean
): number {
  // Exponential backoff: initialDelay * (backoffFactor ^ attempt)
  let delay = initialDelay * Math.pow(backoffFactor, attempt)

  // Cap at max delay
  delay = Math.min(delay, maxDelay)

  // Add jitter (0-50% of delay) to prevent thundering herd
  if (jitter) {
    const jitterAmount = delay * 0.5 * Math.random()
    delay += jitterAmount
  }

  return Math.floor(delay)
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry a function with exponential backoff
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   () => fetch('https://api.example.com/data'),
 *   {
 *     maxRetries: 3,
 *     initialDelay: 1000,
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`)
 *     }
 *   }
 * )
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error = new Error('Unknown error')

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry if we've exhausted attempts
      if (attempt >= config.maxRetries) {
        break
      }

      // Don't retry non-retryable errors
      if (!isRetryableError(error, config.retryableStatuses)) {
        throw lastError
      }

      // Calculate delay
      const delay = calculateDelay(
        attempt,
        config.initialDelay,
        config.maxDelay,
        config.backoffFactor,
        config.jitter
      )

      // Call retry callback if provided
      if (options.onRetry) {
        options.onRetry(attempt + 1, lastError, delay)
      }

      // Wait before retrying
      await sleep(delay)
    }
  }

  // All retries exhausted
  throw lastError
}

/**
 * Create a wrapped fetch function with retry logic
 *
 * @example
 * ```typescript
 * const fetchWithRetry = createRetryFetch({
 *   maxRetries: 3,
 *   onRetry: (attempt, error, delay) => console.log(`Retry ${attempt}...`)
 * })
 *
 * const response = await fetchWithRetry('https://api.example.com/data')
 * ```
 */
export function createRetryFetch(options: RetryOptions = {}) {
  return async (
    url: string | URL,
    init?: RequestInit
  ): Promise<Response> => {
    return retryWithBackoff(async () => {
      const response = await fetch(url.toString(), init)

      // Throw for retryable HTTP errors so retry logic can catch them
      if (!response.ok && (options.retryableStatuses ?? DEFAULT_OPTIONS.retryableStatuses).includes(response.status)) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & { status: number }
        error.status = response.status
        throw error
      }

      return response
    }, options)
  }
}

/**
 * Check if a response indicates rate limiting (429)
 * and extract retry-after header if present
 */
export function getRateLimitRetryAfter(response: Response): number | null {
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    if (retryAfter) {
      // Could be seconds or a date string
      const seconds = parseInt(retryAfter, 10)
      if (!isNaN(seconds)) {
        return seconds * 1000 // Convert to ms
      }
      // Parse as date
      const date = new Date(retryAfter)
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now())
      }
    }
    // Default to 60 seconds if no Retry-After header
    return 60000
  }
  return null
}
