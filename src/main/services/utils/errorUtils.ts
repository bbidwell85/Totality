/**
 * Error Handling Utilities
 *
 * Type-safe error handling helpers for use across services and providers.
 */

/**
 * Get a consistent error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Type guard for Node.js system errors (with code property)
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * Type guard for Axios errors (with response property)
 */
export function isAxiosError(error: unknown): error is { response?: { status: number; data?: unknown }; message: string } {
  return error instanceof Error && 'response' in error
}

/**
 * Extract axios error details for error handling
 * Returns response status, data, and message if available
 */
export function getAxiosErrorDetails(error: unknown): { status?: number; data?: unknown; message: string } {
  if (isAxiosError(error)) {
    return {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    }
  }
  return { message: getErrorMessage(error) }
}

/**
 * Get error code for Node.js errors (ENOENT, ECONNREFUSED, etc.)
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isNodeError(error)) {
    return error.code
  }
  return undefined
}
