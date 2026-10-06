import { describe, it, expect } from 'vitest'
import {
  getQualityLevelColors,
  getResolutionColors,
  getMusicTierLabel,
} from '../../src/renderer/src/utils/qualityColors'

describe('qualityColors', () => {
  describe('getQualityLevelColors', () => {
    it('returns green for HIGH', () => {
      expect(getQualityLevelColors('HIGH')).toContain('green')
    })

    it('returns red for LOW', () => {
      expect(getQualityLevelColors('LOW')).toContain('red')
    })

    it('returns empty for MEDIUM', () => {
      expect(getQualityLevelColors('MEDIUM')).toBe('')
    })

    it('returns empty for unknown', () => {
      expect(getQualityLevelColors('unknown')).toBe('')
    })
  })

  describe('getResolutionColors', () => {
    it('returns red for SD', () => {
      expect(getResolutionColors('SD')).toContain('red')
    })

    it('returns yellow for 720p', () => {
      expect(getResolutionColors('720p')).toContain('yellow')
    })

    it('returns blue for 1080p', () => {
      expect(getResolutionColors('1080p')).toContain('blue')
    })

    it('returns green for 4K', () => {
      expect(getResolutionColors('4K')).toContain('green')
    })

    it('returns muted for unknown', () => {
      expect(getResolutionColors('unknown')).toContain('muted')
    })
  })

  describe('getMusicTierLabel', () => {
    it('returns Hi-Res for ultra', () => {
      expect(getMusicTierLabel('ultra')).toBe('Hi-Res')
    })

    it('returns Lossless for high', () => {
      expect(getMusicTierLabel('high')).toBe('Lossless')
    })

    it('returns High Lossy for high with flag', () => {
      expect(getMusicTierLabel('high', true)).toBe('High Lossy')
    })

    it('returns Medium for medium', () => {
      expect(getMusicTierLabel('medium')).toBe('Medium')
    })

    it('returns Low for low', () => {
      expect(getMusicTierLabel('low')).toBe('Low')
    })

    it('returns raw tier for unknown', () => {
      expect(getMusicTierLabel('custom')).toBe('custom')
    })
  })
})
