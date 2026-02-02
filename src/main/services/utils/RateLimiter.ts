/**
 * RateLimiter Utilities
 *
 * Shared rate limiting implementations for external API services.
 * Ensures compliance with API terms of service while maximizing throughput.
 */

/**
 * Base interface for rate limiters
 */
export interface RateLimiter {
  /**
   * Wait until a request slot is available
   * Call this before making each API request
   */
  waitForSlot(): Promise<void>

  /**
   * Reset the rate limiter state
   */
  reset(): void
}

/**
 * Sliding Window Rate Limiter
 *
 * Allows up to maxRequests within windowMs, using a sliding window algorithm.
 * Tracks timestamps of recent requests and waits if limit is reached.
 *
 * Best for APIs with "X requests per Y seconds" limits (e.g., TMDB: 40 req/10s)
 *
 * @example
 * const limiter = new SlidingWindowRateLimiter(40, 10000) // 40 requests per 10 seconds
 * await limiter.waitForSlot()
 * await fetch(...)
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private requestTimestamps: number[] = []
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly bufferMs: number

  /**
   * @param maxRequests Maximum number of requests allowed in the window
   * @param windowMs Time window in milliseconds
   * @param bufferMs Extra buffer time to add after waiting (default: 100ms)
   */
  constructor(maxRequests: number, windowMs: number, bufferMs: number = 100) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.bufferMs = bufferMs
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now()

    // Remove timestamps outside the window
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < this.windowMs
    )

    // If at capacity, wait until oldest request expires
    if (this.requestTimestamps.length >= this.maxRequests) {
      const oldestTimestamp = this.requestTimestamps[0]
      const waitTime = this.windowMs - (now - oldestTimestamp) + this.bufferMs

      if (waitTime > 0) {
        await this.delay(waitTime)
        // Recursively check again after waiting
        return this.waitForSlot()
      }
    }

    // Record this request
    this.requestTimestamps.push(Date.now())
  }

  reset(): void {
    this.requestTimestamps = []
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get current usage statistics
   */
  getStats(): { currentCount: number; maxRequests: number; windowMs: number } {
    const now = Date.now()
    const currentCount = this.requestTimestamps.filter(
      ts => now - ts < this.windowMs
    ).length

    return {
      currentCount,
      maxRequests: this.maxRequests,
      windowMs: this.windowMs,
    }
  }
}

/**
 * Simple Delay Rate Limiter
 *
 * Ensures minimum time between consecutive requests.
 * Simpler than sliding window, best for APIs with strict per-second limits.
 *
 * Best for APIs with "1 request per X seconds" limits (e.g., MusicBrainz: 1 req/s)
 *
 * @example
 * const limiter = new SimpleDelayRateLimiter(1500) // 1.5 seconds between requests
 * await limiter.waitForSlot()
 * await fetch(...)
 */
export class SimpleDelayRateLimiter implements RateLimiter {
  private lastRequestTime: number = 0
  private readonly delayMs: number

  /**
   * @param delayMs Minimum milliseconds between requests
   */
  constructor(delayMs: number) {
    this.delayMs = delayMs
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRequestTime
    const remainingWait = this.delayMs - elapsed

    if (remainingWait > 0) {
      await this.delay(remainingWait)
    }

    this.lastRequestTime = Date.now()
  }

  reset(): void {
    this.lastRequestTime = 0
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get current state
   */
  getTimeSinceLastRequest(): number {
    return Date.now() - this.lastRequestTime
  }
}

/**
 * Pre-configured rate limiters for known APIs
 */
export const RateLimiters = {
  /**
   * TMDB API: ~40 requests per second per IP
   * Using 40 req/1s to maximize throughput while staying within limits
   */
  createTMDBLimiter(): SlidingWindowRateLimiter {
    return new SlidingWindowRateLimiter(40, 1000, 25)
  },

  /**
   * MusicBrainz API: 1 request per second (strict enforcement)
   * Using 1.5s to be safe and respectful of the service
   */
  createMusicBrainzLimiter(): SimpleDelayRateLimiter {
    return new SimpleDelayRateLimiter(1500)
  },
}
