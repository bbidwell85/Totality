/**
 * FileNameParser Service
 *
 * Parses media file names to extract metadata like title, year, season, episode,
 * quality indicators, etc. Handles common naming conventions used by media files.
 */

export interface ParsedMovieInfo {
  type: 'movie'
  title: string
  year?: number
  quality?: string
  resolution?: string
  source?: string
  codec?: string
  audioCodec?: string
  group?: string
  edition?: string
}

export interface ParsedEpisodeInfo {
  type: 'episode'
  seriesTitle: string
  seasonNumber: number
  episodeNumber: number
  episodeTitle?: string
  year?: number
  quality?: string
  resolution?: string
  source?: string
  codec?: string
  audioCodec?: string
  group?: string
  // For multi-episode files
  episodeNumberEnd?: number
}

export interface ParsedMusicInfo {
  type: 'music'
  artist?: string
  album?: string
  title: string
  trackNumber?: number
  discNumber?: number
  year?: number
}

export type ParsedMediaInfo = ParsedMovieInfo | ParsedEpisodeInfo | ParsedMusicInfo

// Singleton instance
let parserInstance: FileNameParser | null = null

export function getFileNameParser(): FileNameParser {
  if (!parserInstance) {
    parserInstance = new FileNameParser()
  }
  return parserInstance
}

export class FileNameParser {
  // Common video file extensions
  private readonly videoExtensions = new Set([
    '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.m2ts', '.ts', '.vob', '.ogv', '.divx', '.xvid'
  ])

  // Common audio file extensions
  private readonly audioExtensions = new Set([
    '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.alac',
    '.ape', '.opus', '.aiff', '.dsf', '.dff'
  ])

  // Quality indicators
  private readonly resolutionPatterns: [RegExp, string][] = [
    [/\b4k\b/i, '4K'],
    [/\b2160p?\b/i, '4K'],
    [/\buhd\b/i, '4K'],
    [/\b1080p?\b/i, '1080p'],
    [/\b1080i\b/i, '1080p'],
    [/\b720p?\b/i, '720p'],
    [/\b576p?\b/i, '576p'],
    [/\b480p?\b/i, '480p'],
    [/\bsd\b/i, 'SD'],
  ]

  // Source indicators
  private readonly sourcePatterns: [RegExp, string][] = [
    [/\bblu-?ray\b/i, 'BluRay'],
    [/\bbdrip\b/i, 'BluRay'],
    [/\bbrrip\b/i, 'BluRay'],
    [/\bremux\b/i, 'Remux'],
    [/\bweb-?dl\b/i, 'WEB-DL'],
    [/\bwebrip\b/i, 'WEBRip'],
    [/\bweb\b/i, 'WEB'],
    [/\bhdtv\b/i, 'HDTV'],
    [/\bpdtv\b/i, 'PDTV'],
    [/\bdvdrip\b/i, 'DVDRip'],
    [/\bdvd-?r\b/i, 'DVD'],
    [/\bdvd\b/i, 'DVD'],
    [/\bhdcam\b/i, 'HDCAM'],
    [/\bcam\b/i, 'CAM'],
    [/\bts\b/i, 'TS'],
    [/\bscreener\b/i, 'Screener'],
  ]

  // Video codec patterns
  private readonly videoCodecPatterns: [RegExp, string][] = [
    [/\bx\.?265\b/i, 'HEVC'],
    [/\bh\.?265\b/i, 'HEVC'],
    [/\bhevc\b/i, 'HEVC'],
    [/\bx\.?264\b/i, 'H.264'],
    [/\bh\.?264\b/i, 'H.264'],
    [/\bavc\b/i, 'H.264'],
    [/\bav1\b/i, 'AV1'],
    [/\bvp9\b/i, 'VP9'],
    [/\bxvid\b/i, 'XviD'],
    [/\bdivx\b/i, 'DivX'],
    [/\bmpeg-?2\b/i, 'MPEG-2'],
    [/\bvc-?1\b/i, 'VC-1'],
  ]

  // Audio codec patterns
  private readonly audioCodecPatterns: [RegExp, string][] = [
    [/\batmos\b/i, 'Atmos'],
    [/\btruehd\b/i, 'TrueHD'],
    [/\bdts-?hd[\s.-]?ma\b/i, 'DTS-HD MA'],
    [/\bdts-?hd\b/i, 'DTS-HD'],
    [/\bdts-?x\b/i, 'DTS:X'],
    [/\bdts\b/i, 'DTS'],
    [/\bdd\+|ddp|e-?ac-?3\b/i, 'DD+'],
    [/\bdd|ac-?3\b/i, 'DD'],
    [/\baac\b/i, 'AAC'],
    [/\bflac\b/i, 'FLAC'],
    [/\blpcm\b/i, 'LPCM'],
    [/\bmp3\b/i, 'MP3'],
  ]

  // Edition patterns
  private readonly editionPatterns: [RegExp, string][] = [
    [/\bextended\b/i, 'Extended'],
    [/\bdirector'?s?\s*cut\b/i, "Director's Cut"],
    [/\bunrated\b/i, 'Unrated'],
    [/\btheatrical\b/i, 'Theatrical'],
    [/\bimax\b/i, 'IMAX'],
    [/\bremastered\b/i, 'Remastered'],
    [/\bspecial\s*edition\b/i, 'Special Edition'],
    [/\bultimate\s*edition\b/i, 'Ultimate Edition'],
    [/\bcollector'?s?\s*edition\b/i, "Collector's Edition"],
  ]

  // TV Show patterns
  private readonly tvPatterns = [
    // S01E01 format (most common)
    /[Ss](\d{1,2})[Ee](\d{1,3})(?:[Ee-](\d{1,3}))?/,
    // 1x01 format
    /(\d{1,2})[xX](\d{1,3})(?:[-x](\d{1,3}))?/,
    // Season 1 Episode 1 format
    /[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,3})/i,
    // S01.E01 format
    /[Ss](\d{1,2})\.?[Ee](\d{1,3})/,
    // 101 format (less reliable, only use if others don't match)
    // /\b(\d)(\d{2})\b/,
  ]

  // Year pattern
  private readonly yearPattern = /\b(19\d{2}|20\d{2})\b/

  /**
   * Check if a file is a video file based on extension
   */
  isVideoFile(filename: string): boolean {
    const ext = this.getExtension(filename)
    return this.videoExtensions.has(ext)
  }

  /**
   * Check if a file is an audio file based on extension
   */
  isAudioFile(filename: string): boolean {
    const ext = this.getExtension(filename)
    return this.audioExtensions.has(ext)
  }

  /**
   * Check if a file is a media file (video or audio)
   */
  isMediaFile(filename: string): boolean {
    return this.isVideoFile(filename) || this.isAudioFile(filename)
  }

  /**
   * Get file extension (lowercase, with dot)
   */
  getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.')
    if (lastDot === -1) return ''
    return filename.slice(lastDot).toLowerCase()
  }

  /**
   * Parse a media filename and return extracted metadata
   */
  parse(filename: string, folderContext?: string): ParsedMediaInfo | null {
    // Remove extension for parsing
    const ext = this.getExtension(filename)
    const nameWithoutExt = filename.slice(0, filename.length - ext.length)

    // Determine file type and parse accordingly
    if (this.isAudioFile(filename)) {
      return this.parseMusic(nameWithoutExt, folderContext)
    } else if (this.isVideoFile(filename)) {
      // Check if it's a TV episode
      const episodeInfo = this.parseEpisode(nameWithoutExt, folderContext)
      if (episodeInfo) {
        return episodeInfo
      }

      // Otherwise treat as movie
      return this.parseMovie(nameWithoutExt)
    }

    return null
  }

  /**
   * Parse a movie filename
   */
  parseMovie(name: string): ParsedMovieInfo {
    const result: ParsedMovieInfo = {
      type: 'movie',
      title: '',
    }

    // Clean the name - replace common separators with spaces
    let cleanName = name
      .replace(/\./g, ' ')
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Extract year with smart detection:
    // 1. Prefer year in parentheses/brackets: (2019) or [2019]
    // 2. For multiple bare years, prefer the LAST one (release year is typically last)
    // 3. Handle numeric titles like "1917" - don't mistake title for year

    // First, look for year in parentheses or brackets
    const parenYearMatch = cleanName.match(/[\(\[](19\d{2}|20\d{2})[\)\]]/)
    // Find ALL years in the string
    const allYears = Array.from(cleanName.matchAll(/\b(19\d{2}|20\d{2})\b/g))

    let releaseYear: number | undefined
    let yearIndex: number = -1
    let charBeforeYear: string | undefined

    if (parenYearMatch) {
      // Parenthesized year takes priority - this is definitely the release year
      releaseYear = parseInt(parenYearMatch[1], 10)
      yearIndex = cleanName.indexOf(parenYearMatch[0])
      charBeforeYear = cleanName[yearIndex] // Will be '(' or '['
    } else if (allYears.length > 0) {
      // No parenthesized year - use smarter selection
      if (allYears.length === 1) {
        // Only one year found
        const match = allYears[0]
        const potentialYear = parseInt(match[1], 10)
        const idx = match.index!

        // Check if this "year" is actually a numeric title (like "1917")
        // If extracting it would leave an empty title, it's probably the title
        const titleBefore = cleanName.slice(0, idx).trim()
        if (titleBefore.length === 0 || titleBefore.match(/^[\(\[\s]*$/)) {
          // The "year" appears to be the title itself - don't extract it as year
          // Title will be extracted later from the full string
        } else {
          releaseYear = potentialYear
          yearIndex = idx
          charBeforeYear = cleanName[idx - 1]
        }
      } else {
        // Multiple years - prefer the LAST one as release year
        // e.g., "Beauty and the Beast 1991 2017" -> year=2017
        const lastMatch = allYears[allYears.length - 1]
        releaseYear = parseInt(lastMatch[1], 10)
        yearIndex = lastMatch.index!
        charBeforeYear = cleanName[yearIndex - 1]

        // Special case: "1917 2019" - first is title, second is year
        // The title is everything before the LAST year
      }
    }

    if (releaseYear !== undefined && yearIndex >= 0) {
      result.year = releaseYear

      // Title is everything before the release year
      let titleEnd = yearIndex
      // If year is preceded by "(" or "[", exclude the bracket from title
      if (charBeforeYear === '(' || charBeforeYear === '[') {
        titleEnd = yearIndex - 1
      }

      if (titleEnd > 0) {
        result.title = cleanName.slice(0, titleEnd).trim()
        cleanName = cleanName.slice(yearIndex + 4) // Skip past the 4-digit year
        // Also skip closing bracket if present
        if (cleanName.startsWith(')') || cleanName.startsWith(']')) {
          cleanName = cleanName.slice(1)
        }
      }
    }

    // Extract quality indicators from remaining string
    result.resolution = this.extractPattern(cleanName, this.resolutionPatterns)
    result.source = this.extractPattern(cleanName, this.sourcePatterns)
    result.codec = this.extractPattern(cleanName, this.videoCodecPatterns)
    result.audioCodec = this.extractPattern(cleanName, this.audioCodecPatterns)
    result.edition = this.extractPattern(cleanName, this.editionPatterns)

    // Extract release group (usually at the end after a dash)
    const groupMatch = cleanName.match(/[-\s]([A-Za-z0-9]+)$/)
    if (groupMatch && groupMatch[1].length >= 2 && groupMatch[1].length <= 15) {
      // Avoid matching quality indicators as groups
      const potentialGroup = groupMatch[1]
      if (!this.isQualityIndicator(potentialGroup)) {
        result.group = potentialGroup
      }
    }

    // If no title extracted yet, use cleaned name up to first quality indicator
    if (!result.title) {
      result.title = this.extractTitleBeforeQuality(cleanName)
    }

    // Clean up title
    result.title = this.cleanTitle(result.title)

    // Build quality string
    result.quality = [result.resolution, result.source, result.codec]
      .filter(Boolean)
      .join(' ')

    return result
  }

  /**
   * Parse a TV episode filename
   */
  parseEpisode(name: string, folderContext?: string): ParsedEpisodeInfo | null {
    // Try each TV pattern
    for (const pattern of this.tvPatterns) {
      const match = name.match(pattern)
      if (match) {
        const result: ParsedEpisodeInfo = {
          type: 'episode',
          seriesTitle: '',
          seasonNumber: parseInt(match[1], 10),
          episodeNumber: parseInt(match[2], 10),
        }

        // Check for multi-episode
        if (match[3]) {
          result.episodeNumberEnd = parseInt(match[3], 10)
        }

        // Clean the name for further parsing
        let cleanName = name
          .replace(/\./g, ' ')
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()

        // Extract series title (everything before the episode indicator)
        const matchIndex = cleanName.search(pattern)
        if (matchIndex > 0) {
          result.seriesTitle = cleanName.slice(0, matchIndex).trim()
        }

        // Try to get series title from folder context if not in filename
        if (!result.seriesTitle && folderContext) {
          result.seriesTitle = this.extractSeriesTitleFromPath(folderContext)
        }

        // Extract year from series title and remove it
        // Prefer year in parentheses: "Archer (2009)" -> title="Archer", year=2009
        const parenYearMatch = result.seriesTitle.match(/[\(\[](19\d{2}|20\d{2})[\)\]]/)
        if (parenYearMatch) {
          result.year = parseInt(parenYearMatch[1], 10)
          // Remove the year (with parentheses) from title
          result.seriesTitle = result.seriesTitle.replace(/\s*[\(\[](19\d{2}|20\d{2})[\)\]]\s*/, ' ').trim()
        } else {
          // Check for bare year at end of title
          const bareYearMatch = result.seriesTitle.match(/\s+(19\d{2}|20\d{2})$/)
          if (bareYearMatch) {
            result.year = parseInt(bareYearMatch[1], 10)
            result.seriesTitle = result.seriesTitle.replace(/\s+(19\d{2}|20\d{2})$/, '').trim()
          }
        }

        // Clean up series title
        result.seriesTitle = this.cleanTitle(result.seriesTitle)

        // Extract quality indicators
        const afterMatch = cleanName.slice(matchIndex)
        result.resolution = this.extractPattern(afterMatch, this.resolutionPatterns)
        result.source = this.extractPattern(afterMatch, this.sourcePatterns)
        result.codec = this.extractPattern(afterMatch, this.videoCodecPatterns)
        result.audioCodec = this.extractPattern(afterMatch, this.audioCodecPatterns)

        // Build quality string
        result.quality = [result.resolution, result.source, result.codec]
          .filter(Boolean)
          .join(' ')

        // Try to extract episode title (between episode number and quality indicators)
        const episodeTitle = this.extractEpisodeTitle(afterMatch, pattern)
        if (episodeTitle) {
          result.episodeTitle = episodeTitle
        }

        return result
      }
    }

    return null
  }

  /**
   * Parse a music filename
   *
   * Folder structure takes precedence for artist/album:
   *   .../Artist/Album/track.mp3
   *
   * Filename parsing is used for track number and title.
   */
  parseMusic(name: string, folderContext?: string): ParsedMusicInfo {
    const result: ParsedMusicInfo = {
      type: 'music',
      title: name,
    }

    // First, get artist and album from folder context (takes precedence)
    if (folderContext) {
      const pathParts = folderContext.split(/[/\\]/).filter(Boolean)
      if (pathParts.length >= 2) {
        // Structure: .../Artist/Album/track.mp3
        result.artist = pathParts[pathParts.length - 2]
        result.album = pathParts[pathParts.length - 1]
      } else if (pathParts.length === 1) {
        // Single folder - treat as artist folder with unknown album
        result.artist = pathParts[0]
      }
    }

    // Clean the filename
    let cleanName = name
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Try to extract track number from start (e.g., "01 - Song Title" or "01. Song Title")
    const trackMatch = cleanName.match(/^(\d{1,3})[\s.\-]+(.+)/)
    if (trackMatch) {
      result.trackNumber = parseInt(trackMatch[1], 10)
      cleanName = trackMatch[2].trim()
    }

    // Try to extract disc number (e.g., "1-01" or "CD1-01")
    const discTrackMatch = cleanName.match(/^(?:CD|Disc\s*)?(\d{1,2})[-.](\d{1,3})[\s.\-]+(.+)/i)
    if (discTrackMatch) {
      result.discNumber = parseInt(discTrackMatch[1], 10)
      result.trackNumber = parseInt(discTrackMatch[2], 10)
      cleanName = discTrackMatch[3].trim()
    }

    // Parse the remaining filename for title
    // If filename has "Artist - Title" format, only use it for title (not artist)
    // since folder structure takes precedence for artist
    const artistTitleMatch = cleanName.match(/^(.+?)\s*[-–—]\s*(.+)$/)
    if (artistTitleMatch) {
      // Only use the title part, ignore artist from filename if we have folder artist
      if (result.artist) {
        result.title = artistTitleMatch[2].trim()
      } else {
        // No folder artist, use filename parsing
        result.artist = artistTitleMatch[1].trim()
        result.title = artistTitleMatch[2].trim()
      }
    } else {
      result.title = cleanName
    }

    // Try to extract year from album name
    if (result.album) {
      const yearMatch = result.album.match(this.yearPattern)
      if (yearMatch) {
        result.year = parseInt(yearMatch[1], 10)
      }
    }

    return result
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Normalize a title for TMDB search
   * - Removes diacritics (e.g., "Pokémon" -> "Pokemon")
   * - Replaces punctuation with spaces (e.g., "A.I." -> "A I")
   * - Collapses multiple spaces and trims
   */
  normalizeForSearch(title: string): string {
    return title
      // Decompose Unicode characters (é -> e + combining accent)
      .normalize('NFD')
      // Remove combining diacritical marks
      .replace(/[\u0300-\u036f]/g, '')
      // Replace common punctuation with spaces
      .replace(/[.'":;!?&@#$%^*()[\]{}|\\/<>~`+=]/g, ' ')
      // Replace dashes and underscores with spaces
      .replace(/[-_]/g, ' ')
      // Collapse multiple spaces to single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim()
  }

  private extractPattern(text: string, patterns: [RegExp, string][]): string | undefined {
    for (const [pattern, value] of patterns) {
      if (pattern.test(text)) {
        return value
      }
    }
    return undefined
  }

  private isQualityIndicator(text: string): boolean {
    const lower = text.toLowerCase()
    const indicators = [
      'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'vp9',
      '1080p', '720p', '480p', '2160p', '4k', 'uhd',
      'bluray', 'webrip', 'webdl', 'hdtv', 'dvdrip',
      'dts', 'atmos', 'truehd', 'aac', 'flac',
      'remux', 'proper', 'repack'
    ]
    return indicators.some(ind => lower.includes(ind))
  }

  private extractTitleBeforeQuality(text: string): string {
    // Find the first quality indicator and return everything before it
    const allPatterns = [
      ...this.resolutionPatterns,
      ...this.sourcePatterns,
      ...this.videoCodecPatterns,
      ...this.audioCodecPatterns,
    ]

    let earliestIndex = text.length
    for (const [pattern] of allPatterns) {
      const match = text.match(pattern)
      if (match && match.index !== undefined && match.index < earliestIndex) {
        earliestIndex = match.index
      }
    }

    return text.slice(0, earliestIndex).trim()
  }

  private extractSeriesTitleFromPath(folderPath: string): string {
    const parts = folderPath.split(/[/\\]/).filter(Boolean)

    // Look for a folder that's not a season folder
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]
      // Skip season folders
      if (!/^[Ss]eason\s*\d+$/i.test(part) && !/^[Ss]\d+$/i.test(part)) {
        return part
      }
    }

    return parts[parts.length - 1] || ''
  }

  private extractEpisodeTitle(text: string, tvPattern: RegExp): string | undefined {
    // Remove the TV pattern match and quality indicators to find episode title
    let remaining = text.replace(tvPattern, '').trim()

    // Remove leading separators
    remaining = remaining.replace(/^[\s.\-_]+/, '')

    // Find where quality indicators start
    const allPatterns = [
      ...this.resolutionPatterns,
      ...this.sourcePatterns,
      ...this.videoCodecPatterns,
    ]

    let earliestIndex = remaining.length
    for (const [pattern] of allPatterns) {
      const match = remaining.match(pattern)
      if (match && match.index !== undefined && match.index < earliestIndex) {
        earliestIndex = match.index
      }
    }

    const title = remaining.slice(0, earliestIndex).trim()

    // Only return if it looks like a real title (not empty, not just numbers/symbols)
    if (title && title.length > 2 && /[a-zA-Z]/.test(title)) {
      return this.cleanTitle(title)
    }

    return undefined
  }

  private cleanTitle(title: string): string {
    return title
      // Remove leading/trailing separators (including parentheses/brackets)
      .replace(/^[\s.\-_\(\)\[\]]+/, '')
      .replace(/[\s.\-_\(\)\[\]]+$/, '')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Title case (optional, might want to preserve original case)
      .trim()
  }
}
