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
  'video/x-matroska': { mediaType: 'video', extension: 'mkv' },
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

const asciiAt = (buffer: Buffer, start: number, length: number): string => (
  buffer.subarray(start, start + length).toString('ascii')
);

const hasIsoBaseMediaHeader = (buffer: Buffer): boolean => (
  buffer.length >= 12 && asciiAt(buffer, 4, 4) === 'ftyp'
);

/**
 * Cheap magic-byte verification before storage. This is not a malware scanner,
 * but prevents arbitrary bytes from being trusted solely because the client
 * supplied a supported Content-Type.
 */
export const uploadSignatureMatches = (
  descriptor: UploadMediaDescriptor,
  buffer: Buffer
): boolean => {
  if (buffer.length < 4) return false;
  const type = descriptor.contentType;
  if (type === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (type === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (type === 'image/gif') return /^GIF8[79]a$/.test(asciiAt(buffer, 0, 6));
  if (type === 'image/webp') {
    return buffer.length >= 12 && asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WEBP';
  }
  if (type === 'image/bmp') return asciiAt(buffer, 0, 2) === 'BM';
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/avif') {
    if (!hasIsoBaseMediaHeader(buffer)) return false;
    const brand = asciiAt(buffer, 8, 4).toLowerCase();
    return type === 'image/avif'
      ? brand === 'avif' || brand === 'avis'
      : ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
  }
  if (type === 'video/mp4' || type === 'video/quicktime' || type === 'video/x-m4v'
    || type === 'video/3gpp' || type === 'audio/mp4' || type === 'audio/x-m4a') {
    return hasIsoBaseMediaHeader(buffer);
  }
  if (type === 'video/webm' || type === 'video/x-matroska' || type === 'audio/webm') {
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }
  if (type === 'video/mpeg') {
    return buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01
      && (buffer[3] === 0xba || buffer[3] === 0xb3);
  }
  if (type === 'audio/mpeg' || type === 'audio/mp3') {
    return asciiAt(buffer, 0, 3) === 'ID3'
      || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  }
  if (type === 'audio/aac' || type === 'audio/x-aac') {
    return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  }
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') {
    return buffer.length >= 12 && asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WAVE';
  }
  if (type === 'audio/flac' || type === 'audio/x-flac') return asciiAt(buffer, 0, 4) === 'fLaC';
  return false;
};

export const isMessageMediaType = (value: unknown): value is MediaType => (
  value === 'none' || value === 'image' || value === 'video' || value === 'audio'
);
