/**
 * Shared format utilities for the main process.
 * Used by various main process services.
 */

export const formatSize = (b: number): string =>
  b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB`
    : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB`
    : `${(b / 1e6).toFixed(0)} MB`
