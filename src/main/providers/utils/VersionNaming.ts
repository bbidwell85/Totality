/**
 * VersionNaming - Smart version name extraction via filename diffing
 *
 * Compares filenames across all versions of a media item, strips the common
 * title prefix and technical metadata tokens, and uses whatever meaningful
 * text remains as the edition/version name.
 */

// Minimum fields needed from a version object
interface VersionInput {
  file_path: string
  edition?: string
  label?: string
  resolution: string
  hdr_format?: string
}

// Plex {edition-X} tag format
const EDITION_TAG_REGEX = /\{edition-([^}]+)\}/i

// Technical tokens that should NOT be treated as edition names
const TECHNICAL_TOKENS = new Set([
  // Resolutions
  '480p', '576p', '720p', '1080p', '1080i', '2160p', '4k', 'uhd', 'sd',
  // Sources
  'bluray', 'blu-ray', 'bdrip', 'brrip', 'remux', 'web-dl', 'webdl',
  'webrip', 'web', 'hdtv', 'pdtv', 'dvdrip', 'dvd', 'dvd-r',
  // Video codecs
  'x264', 'x265', 'h264', 'h265', 'h.264', 'h.265', 'hevc', 'avc',
  'av1', 'vp9', 'xvid', 'divx', 'mpeg-2', 'mpeg2', 'vc-1', 'vc1',
  // Audio codecs
  'dts', 'dts-hd', 'dts-hdma', 'dtsx', 'dts-x', 'dts:x',
  'truehd', 'atmos', 'dd+', 'ddp', 'dd', 'eac3', 'e-ac-3', 'ac3', 'ac-3',
  'aac', 'flac', 'lpcm', 'mp3', 'pcm', 'opus',
  // HDR
  'hdr', 'hdr10', 'hdr10+', 'hdr10plus', 'dv', 'hlg', 'sdr',
  // Other technical
  'proper', 'repack', 'internal', '10bit', '10-bit', '8bit', '8-bit',
  'hybrid', '5.1', '7.1', '2.0',
])

// Multi-word technical phrases to strip before word-level filtering
const TECHNICAL_PHRASES = [
  'dolby vision', 'dolby atmos', 'dts-hd ma', 'dts hd ma', 'dts-hd',
  'blu-ray', 'web-dl',
]

/**
 * Get the basename from a file path (handles both Windows and POSIX separators).
 */
function getBasename(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return idx >= 0 ? filePath.substring(idx + 1) : filePath
}

/**
 * Strip extension from a filename.
 */
function stripExtension(filename: string): string {
  const dotIdx = filename.lastIndexOf('.')
  if (dotIdx > 0) {
    const ext = filename.substring(dotIdx + 1).toLowerCase()
    // Only strip known media extensions to avoid stripping e.g. "Vol.1"
    const mediaExts = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'mpg', 'mpeg'])
    if (mediaExts.has(ext)) {
      return filename.substring(0, dotIdx)
    }
  }
  return filename
}

/**
 * Normalize a filename: dots/underscores to spaces, collapse whitespace.
 */
function normalize(name: string): string {
  return name
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find the longest common word prefix across all strings.
 */
function longestCommonWordPrefix(strings: string[]): string {
  if (strings.length === 0) return ''

  const wordArrays = strings.map(s => s.split(/\s+/))
  const minLen = Math.min(...wordArrays.map(w => w.length))

  let commonCount = 0
  for (let i = 0; i < minLen; i++) {
    const word = wordArrays[0][i].toLowerCase()
    if (wordArrays.every(w => w[i].toLowerCase() === word)) {
      commonCount = i + 1
    } else {
      break
    }
  }

  return wordArrays[0].slice(0, commonCount).join(' ')
}

/**
 * Strip bracketed sections [...] and braced sections {...} from text.
 */
function stripBrackets(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/[()]/g, ' ') // strip paren characters but keep content inside
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip known technical tokens from text, leaving only edition-like words.
 */
function stripTechnicalTokens(text: string): string {
  // First strip multi-word technical phrases
  let cleaned = text
  for (const phrase of TECHNICAL_PHRASES) {
    cleaned = cleaned.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
  }

  // Split into words and filter out technical tokens
  const words = cleaned.split(/\s+/)
  const filtered = words.filter(word => {
    const lower = word.toLowerCase().replace(/[[\](){},-]/g, '')
    if (!lower || lower.length === 0) return false
    if (TECHNICAL_TOKENS.has(lower)) return false
    // Any NNNp resolution pattern
    if (/^\d+p$/i.test(lower)) return false
    // Bit depth patterns
    if (/^\d+bit$/i.test(lower)) return false
    // Pure numbers (channel counts, bitrates, etc.)
    if (/^\d+$/.test(lower)) return false
    // Release group tags (single word at end, often after dash)
    return true
  })
  return filtered.join(' ').trim()
}

/**
 * Title-case a string: capitalize first letter of each word.
 */
function titleCase(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Clean up leading/trailing punctuation (dashes, dots, etc.) from edition text.
 */
function cleanEdges(text: string): string {
  return text.replace(/^[\s\-–—_.]+/, '').replace(/[\s\-–—_.]+$/, '').trim()
}

/**
 * Examine all version filenames together, extract meaningful edition names
 * by diffing what's unique across versions after stripping technical metadata.
 *
 * Mutates the `edition` and `label` fields on each version in-place.
 * Only sets edition when a meaningful non-technical difference is found.
 */
export function extractVersionNames<T extends VersionInput>(versions: T[]): T[] {
  if (versions.length <= 1) return versions

  // Phase 1: Extract {edition-X} Plex tags from filenames
  for (const v of versions) {
    if (v.edition) continue // Already has edition from FileNameParser or API

    const basename = getBasename(v.file_path)
    const tagMatch = basename.match(EDITION_TAG_REGEX)
    if (tagMatch) {
      v.edition = tagMatch[1].trim()
    }
  }

  // Phase 2: For versions still missing edition, diff the filenames
  const needsDiff = versions.filter(v => !v.edition)

  if (needsDiff.length >= 2) {
    // Get normalized basenames without extension
    const basenames = needsDiff.map(v => {
      const base = getBasename(v.file_path)
      const noExt = stripExtension(base)
      return normalize(noExt)
    })

    // Find common prefix (by words) — this is the title + year
    const commonPrefix = longestCommonWordPrefix(basenames)

    // Strip common prefix from each
    const remainders = basenames.map(name => {
      let r = name
      if (commonPrefix && r.toLowerCase().startsWith(commonPrefix.toLowerCase())) {
        r = r.substring(commonPrefix.length)
      }
      return r.trim()
    })

    // Strip brackets and technical tokens from each remainder
    const editions = remainders.map(r => {
      const noBrackets = stripBrackets(r)
      const noTech = stripTechnicalTokens(noBrackets)
      return cleanEdges(noTech)
    })

    // Only apply if at least one version has a non-empty result
    const hasAnyEdition = editions.some(e => e.length > 0)
    if (hasAnyEdition) {
      for (let i = 0; i < needsDiff.length; i++) {
        if (editions[i]) {
          needsDiff[i].edition = titleCase(editions[i])
        }
      }
    }
  }

  // Phase 3: Regenerate labels for all versions
  for (const v of versions) {
    const parts = [v.resolution]
    if (v.hdr_format && v.hdr_format !== 'None') parts.push(v.hdr_format)
    if (v.edition) parts.push(v.edition)
    v.label = parts.join(' ')
  }

  return versions
}
