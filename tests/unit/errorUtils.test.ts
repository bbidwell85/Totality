/**
 * errorUtils Unit Tests
 *
 * Tests for error handling utility functions.
 */

import { describe, it, expect } from 'vitest'
import {
  getErrorMessage,
  isNodeError,
  isAxiosError,
  getAxiosErrorDetails,
  getErrorCode,
} from '../../src/main/services/utils/errorUtils'

// ============================================================================
// getErrorMessage
// ============================================================================

describe('getErrorMessage', () => {
  it('should extract message from Error instance', () => {
    expect(getErrorMessage(new Error('something failed'))).toBe('something failed')
  })

  it('should convert string to message', () => {
    expect(getErrorMessage('raw string error')).toBe('raw string error')
  })

  it('should convert number to string', () => {
    expect(getErrorMessage(404)).toBe('404')
  })

  it('should convert null to string', () => {
    expect(getErrorMessage(null)).toBe('null')
  })

  it('should convert undefined to string', () => {
    expect(getErrorMessage(undefined)).toBe('undefined')
  })

  it('should convert object to string', () => {
    expect(getErrorMessage({ code: 'ERR' })).toBe('[object Object]')
  })
})

// ============================================================================
// isNodeError
// ============================================================================

describe('isNodeError', () => {
  it('should return true for Error with code property', () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    expect(isNodeError(err)).toBe(true)
  })

  it('should return false for plain Error without code', () => {
    expect(isNodeError(new Error('plain error'))).toBe(false)
  })

  it('should return false for non-Error objects', () => {
    expect(isNodeError({ code: 'ENOENT' })).toBe(false)
  })

  it('should return false for strings', () => {
    expect(isNodeError('ENOENT')).toBe(false)
  })

  it('should return false for null', () => {
    expect(isNodeError(null)).toBe(false)
  })
})

// ============================================================================
// isAxiosError
// ============================================================================

describe('isAxiosError', () => {
  it('should return true for Error with response property', () => {
    const err = Object.assign(new Error('Request failed'), {
      response: { status: 404, data: 'Not found' },
    })
    expect(isAxiosError(err)).toBe(true)
  })

  it('should return false for plain Error without response', () => {
    expect(isAxiosError(new Error('network error'))).toBe(false)
  })

  it('should return false for non-Error objects', () => {
    expect(isAxiosError({ response: { status: 500 } })).toBe(false)
  })
})

// ============================================================================
// getAxiosErrorDetails
// ============================================================================

describe('getAxiosErrorDetails', () => {
  it('should extract status, data, and message from axios error', () => {
    const err = Object.assign(new Error('Request failed'), {
      response: { status: 403, data: { error: 'forbidden' } },
    })
    const details = getAxiosErrorDetails(err)
    expect(details.status).toBe(403)
    expect(details.data).toEqual({ error: 'forbidden' })
    expect(details.message).toBe('Request failed')
  })

  it('should handle axios error without response', () => {
    const err = Object.assign(new Error('Network Error'), {
      response: undefined,
    })
    const details = getAxiosErrorDetails(err)
    expect(details.status).toBeUndefined()
    expect(details.data).toBeUndefined()
    expect(details.message).toBe('Network Error')
  })

  it('should fall back to getErrorMessage for non-axios errors', () => {
    const details = getAxiosErrorDetails('string error')
    expect(details.status).toBeUndefined()
    expect(details.message).toBe('string error')
  })

  it('should handle null error', () => {
    const details = getAxiosErrorDetails(null)
    expect(details.message).toBe('null')
  })
})

// ============================================================================
// getErrorCode
// ============================================================================

describe('getErrorCode', () => {
  it('should return code from Node.js error', () => {
    const err = new Error('File not found') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    expect(getErrorCode(err)).toBe('ENOENT')
  })

  it('should return undefined for plain Error', () => {
    expect(getErrorCode(new Error('plain'))).toBeUndefined()
  })

  it('should return undefined for non-Error', () => {
    expect(getErrorCode('string')).toBeUndefined()
  })
})
