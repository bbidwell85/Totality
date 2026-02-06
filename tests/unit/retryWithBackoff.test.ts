import { describe, it, expect, vi } from 'vitest'
import { retryWithBackoff, getRateLimitRetryAfter } from '../../src/main/services/utils/retryWithBackoff'

describe('retryWithBackoff', () => {
  it('should succeed on first try without retry', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const result = await retryWithBackoff(fn)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should retry on retryable error and succeed', async () => {
    const error = new Error('HTTP 500: Server error') as Error & { status: number }
    error.status = 500

    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success')

    const onRetry = vi.fn()
    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelay: 10, // Very short delay for tests
      onRetry,
    })

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('should fail after max retries exhausted', async () => {
    const error = new Error('HTTP 500: Server error') as Error & { status: number }
    error.status = 500

    const fn = vi.fn().mockRejectedValue(error)

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelay: 10,
      })
    ).rejects.toThrow('HTTP 500: Server error')

    expect(fn).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('should not retry non-retryable errors (404)', async () => {
    const error = new Error('Not found') as Error & { status: number }
    error.status = 404
    const fn = vi.fn().mockRejectedValue(error)

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        retryableStatuses: [500, 502, 503],
      })
    ).rejects.toThrow('Not found')

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should call onRetry callback on each retry', async () => {
    const error = new Error('HTTP 500: Server error') as Error & { status: number }
    error.status = 500

    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success')

    const onRetry = vi.fn()
    await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelay: 10,
      onRetry,
    })

    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number))
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error), expect.any(Number))
  })

  it('should apply exponential backoff', async () => {
    const error = new Error('HTTP 500') as Error & { status: number }
    error.status = 500

    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success')

    const delays: number[] = []
    await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelay: 100,
      backoffFactor: 2,
      jitter: false, // Disable jitter for predictable test
      onRetry: (_attempt, _error, delay) => {
        delays.push(delay)
      },
    })

    // First retry: 100 * 2^0 = 100ms
    // Second retry: 100 * 2^1 = 200ms
    expect(delays[0]).toBe(100)
    expect(delays[1]).toBe(200)
  })

  it('should respect maxDelay', async () => {
    const error = new Error('HTTP 500') as Error & { status: number }
    error.status = 500

    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success')

    const delays: number[] = []
    await retryWithBackoff(fn, {
      maxRetries: 4,
      initialDelay: 100,
      maxDelay: 150,
      backoffFactor: 2,
      jitter: false,
      onRetry: (_attempt, _error, delay) => {
        delays.push(delay)
      },
    })

    // Third retry would be 100 * 2^2 = 400, but capped at 150
    expect(delays[2]).toBe(150)
  })

  it('should retry on timeout errors', async () => {
    const error = new Error('AbortError: Request timed out')
    error.name = 'AbortError'

    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success')

    const result = await retryWithBackoff(fn, {
      maxRetries: 2,
      initialDelay: 10,
    })

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('getRateLimitRetryAfter', () => {
  it('should return null for non-429 responses', () => {
    const response = { status: 200, headers: { get: () => null } } as unknown as Response
    expect(getRateLimitRetryAfter(response)).toBeNull()
  })

  it('should return delay from Retry-After header in seconds', () => {
    const response = {
      status: 429,
      headers: { get: (name: string) => name === 'Retry-After' ? '30' : null }
    } as unknown as Response
    expect(getRateLimitRetryAfter(response)).toBe(30000) // 30 seconds in ms
  })

  it('should return default 60s if no Retry-After header', () => {
    const response = {
      status: 429,
      headers: { get: () => null }
    } as unknown as Response
    expect(getRateLimitRetryAfter(response)).toBe(60000) // 60 seconds default
  })
})
