// Plex API type definitions

export interface PlexServer {
  name: string
  host: string
  port: number
  machineIdentifier: string
  version: string
  scheme: 'http' | 'https'
  address: string
  uri: string
  localAddresses?: string
  owned: boolean
  accessToken: string
}

export interface PlexLibrary {
  key: string
  title: string
  type: 'movie' | 'show' | 'artist' | 'photo'
  agent: string
  scanner: string
  language: string
  uuid: string
  updatedAt: number
  createdAt: number
  scannedAt: number
  content: boolean
  directory: boolean
  contentChangedAt: number
  hidden: number
  count?: number  // Number of items in the library (optional)
}

export interface PlexMediaItem {
  ratingKey: string
  key: string
  guid: string
  studio?: string
  type: 'movie' | 'episode' | 'show'
  title: string
  contentRating?: string
  summary?: string
  rating?: number
  audienceRating?: number
  year?: number
  editionTitle?: string
  tagline?: string
  thumb?: string
  art?: string
  duration: number
  originallyAvailableAt?: string
  addedAt: number
  updatedAt: number

  // Video/Audio stream info
  Media?: PlexMedia[]

  // For TV shows
  grandparentTitle?: string
  parentTitle?: string
  grandparentKey?: string
  parentKey?: string
  grandparentThumb?: string
  parentThumb?: string
  index?: number
  parentIndex?: number

  // External IDs
  Guid?: PlexGuid[]

  // Collections this item belongs to (from TMDB/metadata agent)
  Collection?: PlexCollectionTag[]
}

export interface PlexCollectionTag {
  tag: string
}

export interface PlexMedia {
  id: number
  duration: number
  bitrate: number
  width: number
  height: number
  aspectRatio: number
  audioChannels: number
  audioCodec: string
  videoCodec: string
  videoResolution: string
  container: string
  videoFrameRate: string
  audioProfile?: string
  videoProfile?: string

  Part?: PlexPart[]
}

export interface PlexPart {
  id: number
  key: string
  duration: number
  file: string
  size: number
  audioProfile?: string
  container: string
  videoProfile?: string

  Stream?: PlexStream[]
}

export interface PlexStream {
  id: number
  streamType: number // 1=video, 2=audio, 3=subtitle
  codec: string
  index: number
  bitrate?: number
  language?: string
  languageCode?: string
  languageTag?: string

  // Video stream properties
  width?: number
  height?: number
  displayTitle?: string
  extendedDisplayTitle?: string
  bitDepth?: number
  chromaLocation?: string
  chromaSubsampling?: string
  colorPrimaries?: string
  colorRange?: string
  colorSpace?: string
  colorTrc?: string
  frameRate?: number
  level?: number
  profile?: string
  refFrames?: number
  scanType?: string

  // Audio stream properties
  audioChannelLayout?: string
  channels?: number
  samplingRate?: number
  selected?: boolean
  title?: string
}

export interface PlexGuid {
  id: string
}

export interface PlexAuthPin {
  id: number
  code: string
  product: string
  trusted: boolean
  clientIdentifier: string
  location: {
    code: string
    european_union_member: boolean
    continent_code: string
    country: string
    city: string
    time_zone: string
    postal_code: string
    in_privacy_restricted_country: boolean
    subdivisions: string
    coordinates: string
  }
  expiresIn: number
  createdAt: string
  expiresAt: string
  authToken?: string
  newRegistration?: boolean
}

export interface PlexUser {
  id: number
  uuid: string
  email: string
  joined_at: string
  username: string
  title: string
  thumb: string
  hasPassword: boolean
  authToken: string
  subscription: {
    active: boolean
    status: string
    plan: string
    features: string[]
  }
  roles: {
    roles: string[]
  }
  entitlements: string[]
}

export interface PlexServerResponse {
  size: number
  Server?: PlexServer[]
}

export interface PlexLibraryResponse {
  size: number
  Directory?: PlexLibrary[]
}

export interface PlexMetadataResponse {
  size: number
  Metadata?: PlexMediaItem[]
}

// Scan progress
export interface ScanProgress {
  scanned: number
  total: number
  currentItem: string
  percentage: number
}

// Plex Collections
export interface PlexCollection {
  ratingKey: string
  key: string
  guid: string
  type: 'collection'
  title: string
  summary?: string
  thumb?: string
  art?: string
  childCount: number
  addedAt: number
  updatedAt: number
  minYear?: number
  maxYear?: number
}

export interface PlexCollectionsResponse {
  size: number
  Metadata?: PlexCollection[]
}

// ============================================================================
// MUSIC TYPES
// ============================================================================

export interface PlexMusicArtist {
  ratingKey: string
  key: string
  guid: string
  type: 'artist'
  title: string
  summary?: string
  index?: number
  thumb?: string
  art?: string
  addedAt: number
  updatedAt: number

  // Artist metadata
  Country?: { tag: string }[]
  Genre?: { tag: string }[]

  // External IDs
  Guid?: PlexGuid[]
}

export interface PlexMusicAlbum {
  ratingKey: string
  key: string
  parentRatingKey?: string // Artist rating key
  guid: string
  type: 'album'
  title: string
  summary?: string
  index?: number
  year?: number
  thumb?: string
  art?: string
  addedAt: number
  updatedAt: number
  originallyAvailableAt?: string
  loudnessAnalysisVersion?: number

  // Parent artist info
  parentKey?: string
  parentTitle?: string // Artist name
  parentThumb?: string
  parentGuid?: string

  // Album metadata
  studio?: string // Record label
  Genre?: { tag: string }[]

  // External IDs
  Guid?: PlexGuid[]
}

export interface PlexMusicTrack {
  ratingKey: string
  key: string
  parentRatingKey?: string // Album rating key
  grandparentRatingKey?: string // Artist rating key
  guid: string
  type: 'track'
  title: string
  summary?: string
  index?: number // Track number
  parentIndex?: number // Disc number
  duration: number
  addedAt: number
  updatedAt: number

  // Parent album info
  parentKey?: string
  parentTitle?: string // Album name
  parentThumb?: string

  // Grandparent artist info
  grandparentKey?: string
  grandparentTitle?: string // Artist name
  grandparentThumb?: string

  // External IDs
  Guid?: PlexGuid[]

  // Audio stream info
  Media?: PlexMusicMedia[]
}

export interface PlexMusicMedia {
  id: number
  duration: number
  bitrate: number
  audioChannels: number
  audioCodec: string
  container: string

  Part?: PlexMusicPart[]
}

export interface PlexMusicPart {
  id: number
  key: string
  duration: number
  file: string
  size: number
  container: string

  Stream?: PlexMusicStream[]
}

export interface PlexMusicStream {
  id: number
  streamType: number // 2=audio
  codec: string
  index: number
  bitrate?: number
  channels?: number
  samplingRate?: number
  bitDepth?: number
  profile?: string
  displayTitle?: string
  selected?: boolean
}

// ============================================================================
// PLEX API RESOURCE TYPES (for server discovery)
// ============================================================================

/**
 * Connection info for a Plex resource
 */
export interface PlexResourceConnection {
  protocol: 'http' | 'https'
  address: string
  port: number
  uri: string
  local: boolean
  relay?: boolean
  IPv6?: boolean
}

/**
 * Plex resource from the /resources API endpoint
 */
export interface PlexResource {
  name: string
  product: string
  productVersion: string
  platform: string
  platformVersion: string
  device: string
  clientIdentifier: string
  createdAt: string
  lastSeenAt: string
  provides: string // 'server', 'client', 'controller', etc.
  ownerId?: number
  sourceTitle?: string
  publicAddress?: string
  accessToken?: string
  owned: boolean | number // Can be boolean or 1/0
  home: boolean
  synced: boolean
  relay: boolean
  presence: boolean
  httpsRequired: boolean
  publicAddressMatches: boolean
  dnsRebindingProtection: boolean
  natLoopbackSupported: boolean
  connections?: PlexResourceConnection[]
}
