import type { MediaType } from './types';

export const MEDIA_MAX_BYTES = 120 * 1024 * 1024;

export interface UploadMediaDescriptor {
  mediaType: Exclude<MediaType, 'none'>;
  directory: 'images' | 'videos' | 'audio';
  extension: string;
  contentType: string;
}

const AUDIO_EXTENSION_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/webm': 'webm',
};

const VISUAL_MEDIA_BY_MIME: Record<string, {
  mediaType: 'image' | 'video';
  extension: string;
}> = {
  'image/jpeg': { mediaType: 'image', extension: 'jpg' },
  'image/png': { mediaType: 'image', extension: 'png' },
  'image/gif': { mediaType: 'image', extension: 'gif' },
  'image/webp': { mediaType: 'image', extension: 'webp' },
  'image/heic': { mediaType: 'image', extension: 'heic' },
  'image/heif': { mediaType: 'image', extension: 'heif' },
  'image/avif': { mediaType: 'image', extension: 'avif' },
  'image/bmp': { mediaType: 'image', extension: 'bmp' },
  'video/mp4': { mediaType: 'video', extension: 'mp4' },
  'video/quicktime': { mediaType: 'video', extension: 'mov' },
  'video/webm': { mediaType: 'video', extension: 'webm' },
  'video/x-m4v': { mediaType: 'video', extension: 'm4v' },
  'video/mpeg': { mediaType: 'video', extension: 'mpeg' },
  'video/3gpp': { mediaType: 'video', extension: '3gp' },
};

export const describeUploadMime = (value: string): UploadMediaDescriptor | null => {
  const contentType = value.trim().toLowerCase().split(';', 1)[0];
  const audioExtension = AUDIO_EXTENSION_BY_MIME[contentType];
  if (audioExtension) {
    return { mediaType: 'audio', directory: 'audio', extension: audioExtension, contentType };
  }

  const visual = VISUAL_MEDIA_BY_MIME[contentType];
  if (!visual) return null;
  return {
    mediaType: visual.mediaType,
    directory: visual.mediaType === 'image' ? 'images' : 'videos',
    extension: visual.extension,
    contentType,
  };
};

export const isMessageMediaType = (value: unknown): value is MediaType => (
  value === 'none' || value === 'image' || value === 'video' || value === 'audio'
);
