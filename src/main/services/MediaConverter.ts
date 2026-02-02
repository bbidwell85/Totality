/**
 * MediaConverter
 *
 * Centralized utility for converting MediaMetadata to MediaItem format.
 * Uses MediaNormalizer functions for consistent codec/resolution normalization
 * and AudioCodecRanker for best audio track selection.
 */

import type { MediaMetadata, AudioStreamInfo, ProviderType } from '../providers/base/MediaProvider'
import type { MediaItem, AudioTrack } from '../types/database'
import {
  normalizeVideoCodec,
  normalizeAudioCodec,
  normalizeResolution,
  normalizeHdrFormat,
  normalizeBitrate,
  normalizeFrameRate,
  normalizeAudioChannels,
  normalizeSampleRate,
  normalizeContainer,
} from './MediaNormalizer'
import { AudioCodecRanker, AudioTrackInfo } from './AudioCodecRanker'

export interface ConversionOptions {
  sourceId: string
  sourceType: ProviderType
  libraryId?: string
}

export class MediaConverter {
  /**
   * Convert MediaMetadata to MediaItem for database storage
   *
   * @param metadata The source metadata from a provider
   * @param options Conversion options including source info
   * @returns MediaItem ready for database insertion
   */
  static toMediaItem(metadata: MediaMetadata, options: ConversionOptions): MediaItem {
    // Process audio tracks and select the best one
    const audioTracks = MediaConverter.convertAudioTracks(metadata.audioTracks)
    const bestTrack = MediaConverter.selectBestAudioTrack(audioTracks, metadata)

    // Normalize resolution from dimensions if not provided
    const resolution = metadata.resolution ||
      (metadata.width && metadata.height
        ? normalizeResolution(metadata.width, metadata.height)
        : 'SD')

    // Build the MediaItem
    const mediaItem: MediaItem = {
      // Provider identification
      plex_id: metadata.itemId,
      source_id: options.sourceId,
      source_type: options.sourceType,
      library_id: options.libraryId,

      // Core metadata
      title: metadata.title,
      year: metadata.year,
      type: metadata.type,

      // Episode-specific
      series_title: metadata.seriesTitle,
      season_number: metadata.seasonNumber,
      episode_number: metadata.episodeNumber,

      // File info
      file_path: metadata.filePath || '',
      file_size: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      container: metadata.container ? normalizeContainer(metadata.container) : undefined,

      // Video quality
      resolution,
      width: metadata.width || 0,
      height: metadata.height || 0,
      video_codec: metadata.videoCodec ? normalizeVideoCodec(metadata.videoCodec) : '',
      video_bitrate: metadata.videoBitrate ? normalizeBitrate(metadata.videoBitrate) : 0,
      video_frame_rate: metadata.videoFrameRate ? normalizeFrameRate(metadata.videoFrameRate) : undefined,
      color_bit_depth: metadata.colorBitDepth,
      hdr_format: metadata.hdrFormat ? normalizeHdrFormat(metadata.hdrFormat, undefined, undefined, metadata.colorBitDepth, metadata.videoProfile) : undefined,
      color_space: metadata.colorSpace,
      video_profile: metadata.videoProfile,

      // Audio quality (from best track or primary)
      audio_codec: bestTrack?.codec || (metadata.audioCodec ? normalizeAudioCodec(metadata.audioCodec) : ''),
      audio_channels: bestTrack?.channels || metadata.audioChannels || 2,
      audio_bitrate: bestTrack?.bitrate || metadata.audioBitrate || 0,
      audio_profile: metadata.audioProfile,
      audio_sample_rate: metadata.audioSampleRate ? normalizeSampleRate(metadata.audioSampleRate) : undefined,
      has_object_audio: bestTrack?.hasObjectAudio || metadata.hasObjectAudio || false,

      // All audio tracks as JSON
      audio_tracks: audioTracks.length > 0 ? JSON.stringify(audioTracks) : undefined,

      // External IDs
      imdb_id: metadata.imdbId,
      tmdb_id: metadata.tmdbId?.toString(),
      series_tmdb_id: metadata.seriesTmdbId?.toString(),

      // Artwork
      poster_url: metadata.posterUrl,
      episode_thumb_url: metadata.episodeThumbUrl,
      season_poster_url: metadata.seasonPosterUrl,

      // Timestamps
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    return mediaItem
  }

  /**
   * Convert provider audio stream info to database AudioTrack format
   */
  static convertAudioTracks(audioStreams?: AudioStreamInfo[]): AudioTrack[] {
    if (!audioStreams || audioStreams.length === 0) {
      return []
    }

    return audioStreams.map((stream, index) => ({
      index: stream.index ?? index,
      codec: normalizeAudioCodec(stream.codec),
      channels: stream.channels ? normalizeAudioChannels(stream.channels, undefined) : 2,
      bitrate: stream.bitrate ? normalizeBitrate(stream.bitrate) : 0,
      sampleRate: stream.sampleRate ? normalizeSampleRate(stream.sampleRate) : undefined,
      language: stream.language,
      title: stream.title,
      isDefault: stream.isDefault || false,
      hasObjectAudio: stream.hasObjectAudio || false,
    }))
  }

  /**
   * Select the best audio track from a MediaMetadata's audio tracks
   */
  static selectBestAudioTrack(
    audioTracks: AudioTrack[],
    metadata: MediaMetadata
  ): AudioTrack | undefined {
    if (audioTracks.length === 0) {
      // No tracks array, create a single track from primary metadata
      if (metadata.audioCodec) {
        return {
          index: 0,
          codec: normalizeAudioCodec(metadata.audioCodec),
          channels: metadata.audioChannels || 2,
          bitrate: metadata.audioBitrate || 0,
          hasObjectAudio: metadata.hasObjectAudio || false,
        }
      }
      return undefined
    }

    // Convert to AudioTrackInfo for the ranker
    const trackInfos: AudioTrackInfo[] = audioTracks.map(track => ({
      index: track.index,
      codec: track.codec,
      channels: track.channels,
      bitrate: track.bitrate,
      sampleRate: track.sampleRate,
      language: track.language,
      hasObjectAudio: track.hasObjectAudio,
      isDefault: track.isDefault,
    }))

    const bestInfo = AudioCodecRanker.selectBestTrack(trackInfos)
    if (!bestInfo) {
      return audioTracks[0]
    }

    // Return the AudioTrack with matching index
    return audioTracks.find(t => t.index === bestInfo.index) || audioTracks[0]
  }

  /**
   * Create a minimal MediaItem from just identification info
   * (useful for placeholder items that will be updated later)
   */
  static createPlaceholder(
    itemId: string,
    title: string,
    type: 'movie' | 'episode',
    options: ConversionOptions
  ): MediaItem {
    return {
      plex_id: itemId,
      source_id: options.sourceId,
      source_type: options.sourceType,
      library_id: options.libraryId,
      title,
      type,
      file_path: '',
      file_size: 0,
      duration: 0,
      resolution: 'SD',
      width: 0,
      height: 0,
      video_codec: '',
      video_bitrate: 0,
      audio_codec: '',
      audio_channels: 2,
      audio_bitrate: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Merge updates into an existing MediaItem
   * Only updates fields that are present in the updates object
   */
  static mergeUpdates(existing: MediaItem, updates: Partial<MediaItem>): MediaItem {
    return {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    }
  }
}
