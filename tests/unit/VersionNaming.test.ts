import { extractVersionNames } from '../../src/main/providers/utils/VersionNaming'

function makeVersion(file_path: string, resolution = '1080p', overrides: Record<string, unknown> = {}) {
  return {
    file_path,
    resolution,
    hdr_format: 'None',
    edition: undefined as string | undefined,
    label: undefined as string | undefined,
    ...overrides,
  }
}

describe('extractVersionNames', () => {
  describe('single version', () => {
    it('returns single version unchanged', () => {
      const versions = [makeVersion('/movies/The Matrix (1999).mkv')]
      extractVersionNames(versions)
      expect(versions[0].edition).toBeUndefined()
    })
  })

  describe('Plex {edition-X} tags', () => {
    it('extracts edition from {edition-X} tag', () => {
      const versions = [
        makeVersion('/movies/Apocalypse Now (1979) {edition-Redux} [Remux-1080p].mkv'),
        makeVersion('/movies/Apocalypse Now (1979) {edition-Final Cut} [Remux-2160p].mkv', '4K'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Redux')
      expect(versions[1].edition).toBe('Final Cut')
    })

    it('preserves existing edition from FileNameParser', () => {
      const versions = [
        makeVersion('/movies/Aliens (1986) Extended.mkv', '1080p', { edition: 'Extended' }),
        makeVersion('/movies/Aliens (1986).mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Extended')
      // Second version has no edition — falls through
    })
  })

  describe('filename diffing', () => {
    it('extracts edition by diffing filenames', () => {
      const versions = [
        makeVersion('/movies/Blade Runner (1982)/Blade Runner (1982) Final Cut.mkv'),
        makeVersion('/movies/Blade Runner (1982)/Blade Runner (1982) Theatrical.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Final Cut')
      expect(versions[1].edition).toBe('Theatrical')
    })

    it('handles dots as separators', () => {
      const versions = [
        makeVersion('/movies/Blade.Runner.1982.Final.Cut.1080p.BluRay.x264.mkv'),
        makeVersion('/movies/Blade.Runner.1982.Theatrical.1080p.BluRay.x264.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Final Cut')
      expect(versions[1].edition).toBe('Theatrical')
    })

    it('handles underscores as separators', () => {
      const versions = [
        makeVersion('/movies/Blade_Runner_1982_Directors_Cut.mkv'),
        makeVersion('/movies/Blade_Runner_1982_Theatrical.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Directors Cut')
      expect(versions[1].edition).toBe('Theatrical')
    })
  })

  describe('technical-only differences', () => {
    it('does not extract edition when only resolution differs', () => {
      const versions = [
        makeVersion('/movies/The Matrix (1999) [Bluray-2160p].mkv', '4K', { hdr_format: 'HDR10' }),
        makeVersion('/movies/The Matrix (1999) [Bluray-1080p].mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBeUndefined()
      expect(versions[1].edition).toBeUndefined()
    })

    it('does not extract edition when only codec differs', () => {
      const versions = [
        makeVersion('/movies/Movie (2020) x265.mkv'),
        makeVersion('/movies/Movie (2020) x264.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBeUndefined()
      expect(versions[1].edition).toBeUndefined()
    })
  })

  describe('mixed editions', () => {
    it('handles one version with {edition-X} and another without', () => {
      const versions = [
        makeVersion('/movies/Avatar (2009) {edition-Extended} [Bluray-2160p].mkv', '4K'),
        makeVersion('/movies/Avatar (2009) [Bluray-1080p].mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Extended')
      expect(versions[1].edition).toBeUndefined()
    })
  })

  describe('3+ versions', () => {
    it('extracts editions for multiple versions', () => {
      const versions = [
        makeVersion('/movies/Blade Runner (1982)/Blade Runner (1982) Final Cut.mkv'),
        makeVersion('/movies/Blade Runner (1982)/Blade Runner (1982) Theatrical.mkv'),
        makeVersion('/movies/Blade Runner (1982)/Blade Runner (1982) Directors Cut.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Final Cut')
      expect(versions[1].edition).toBe('Theatrical')
      expect(versions[2].edition).toBe('Directors Cut')
    })
  })

  describe('label regeneration', () => {
    it('regenerates labels with edition included', () => {
      const versions = [
        makeVersion('/movies/Blade Runner (1982)/Blade Runner (1982) Final Cut.mkv', '4K', { hdr_format: 'HDR10' }),
        makeVersion('/movies/Blade Runner (1982)/Blade Runner (1982) Theatrical.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].label).toBe('4K HDR10 Final Cut')
      expect(versions[1].label).toBe('1080p Theatrical')
    })

    it('regenerates labels without edition for technical-only diffs', () => {
      const versions = [
        makeVersion('/movies/The Matrix (1999) [2160p].mkv', '4K', { hdr_format: 'HDR10' }),
        makeVersion('/movies/The Matrix (1999) [1080p].mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].label).toBe('4K HDR10')
      expect(versions[1].label).toBe('1080p')
    })
  })

  describe('edge cases', () => {
    it('handles Windows-style paths', () => {
      const versions = [
        makeVersion('D:\\Movies\\Blade Runner (1982)\\Blade Runner (1982) Final Cut.mkv'),
        makeVersion('D:\\Movies\\Blade Runner (1982)\\Blade Runner (1982) Theatrical.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Final Cut')
      expect(versions[1].edition).toBe('Theatrical')
    })

    it('handles empty versions array', () => {
      const versions: ReturnType<typeof makeVersion>[] = []
      extractVersionNames(versions)
      expect(versions).toHaveLength(0)
    })

    it('extracts edition from parenthesized text like (Colorized)', () => {
      const versions = [
        makeVersion('P:\\Movies\\It\'s A Wonderful Life (1946)\\It\'s A Wonderful Life (1946) (Colorized).m4v'),
        makeVersion('P:\\Movies\\It\'s A Wonderful Life (1946)\\It\'s A Wonderful Life (1946).m4v'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Colorized')
      expect(versions[1].edition).toBeUndefined()
    })

    it('strips HDR tokens from edition', () => {
      const versions = [
        makeVersion('/movies/Movie (2020) Extended HDR10 2160p.mkv', '4K', { hdr_format: 'HDR10' }),
        makeVersion('/movies/Movie (2020) Theatrical 1080p.mkv'),
      ]
      extractVersionNames(versions)
      expect(versions[0].edition).toBe('Extended')
      expect(versions[1].edition).toBe('Theatrical')
    })
  })
})
