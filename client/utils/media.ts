import type { ImagePickerAsset } from 'expo-image-picker';

// Keep a separate size ceiling: allowing a 2-minute video must not let a
// single in-memory upload exhaust the small competition server.
export const MEDIA_MAX_BYTES = 120 * 1024 * 1024;
export const VIDEO_MAX_DURATION_SECONDS = 120;
export const VIDEO_MAX_DURATION_MS = VIDEO_MAX_DURATION_SECONDS * 1000;

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  wave: 'audio/wav',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

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

export interface SupportedAudioFile {
  extension: string;
  mimeType: string;
}

export const fileExtensionOf = (nameOrUri: string): string => {
  const clean = nameOrUri.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
};

/**
 * Resolve a selected/recorded audio file to a portable MIME and extension.
 * MP3, M4A/AAC, WAV and FLAC cover the common recorder/music formats on
 * Android and iOS. WebM is retained for recordings made by the web runtime.
 */
export const resolveSupportedAudioFile = (
  nameOrUri: string,
  mimeType?: string | null
): SupportedAudioFile | null => {
  const normalizedMime = mimeType?.trim().toLowerCase().split(';', 1)[0] ?? '';
  const extension = fileExtensionOf(nameOrUri);
  if (extension && AUDIO_MIME_BY_EXTENSION[extension]) {
    if (
      normalizedMime
      && normalizedMime !== 'application/octet-stream'
      && !normalizedMime.startsWith('audio/')
    ) return null;
    return { extension, mimeType: AUDIO_MIME_BY_EXTENSION[extension] };
  }
  const inferredExtension = AUDIO_EXTENSION_BY_MIME[normalizedMime];
  return inferredExtension
    ? { extension: inferredExtension, mimeType: AUDIO_MIME_BY_EXTENSION[inferredExtension] }
    : null;
};

/** Expo ImagePicker reports native durations in ms, but its web adapter uses HTML seconds. */
export const imagePickerVideoDurationMs = (
  asset: Pick<ImagePickerAsset, 'duration'>,
  platform: 'android' | 'ios' | 'web'
): number | null => {
  const raw = asset.duration;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return platform === 'web' ? raw * 1000 : raw;
};

export const formatMediaDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};
