import {
  VIDEO_MAX_DURATION_MS,
  fileExtensionOf,
  imagePickerVideoDurationMs,
  resolveSupportedAudioFile,
} from './media';

describe('media helpers', () => {
  test('normalizes common music and recording formats', () => {
    expect(resolveSupportedAudioFile('voice.M4A', 'application/octet-stream')).toEqual({
      extension: 'm4a',
      mimeType: 'audio/mp4',
    });
    expect(resolveSupportedAudioFile('song', 'audio/mpeg')).toEqual({
      extension: 'mp3',
      mimeType: 'audio/mpeg',
    });
    expect(resolveSupportedAudioFile('notes.txt', 'text/plain')).toBeNull();
    expect(resolveSupportedAudioFile('movie.mp4', 'video/mp4')).toBeNull();
    expect(fileExtensionOf('content://provider/music.FLAC?token=1')).toBe('flac');
  });

  test('normalizes ImagePicker video duration across native and web', () => {
    expect(imagePickerVideoDurationMs({ duration: 119_999 }, 'ios')).toBeLessThan(
      VIDEO_MAX_DURATION_MS
    );
    expect(imagePickerVideoDurationMs({ duration: 120_000 }, 'android')).toBe(
      VIDEO_MAX_DURATION_MS
    );
    expect(imagePickerVideoDurationMs({ duration: 120 }, 'web')).toBe(
      VIDEO_MAX_DURATION_MS
    );
    expect(imagePickerVideoDurationMs({ duration: 120.001 }, 'web')).toBeGreaterThan(
      VIDEO_MAX_DURATION_MS
    );
    expect(imagePickerVideoDurationMs({ duration: null }, 'ios')).toBeNull();
  });
});
