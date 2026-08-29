import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUploadMime, isMessageMediaType, uploadSignatureMatches } from './media';

test('classifies common audio, image and video MIME types', () => {
  assert.deepEqual(describeUploadMime('audio/mpeg'), {
    mediaType: 'audio',
    directory: 'audio',
    extension: 'mp3',
    contentType: 'audio/mpeg',
  });
  assert.equal(describeUploadMime('image/jpeg')?.mediaType, 'image');
  assert.deepEqual(describeUploadMime('video/quicktime'), {
    mediaType: 'video',
    directory: 'videos',
    extension: 'mov',
    contentType: 'video/quicktime',
  });
});

test('rejects unsupported MIME types and accepts audio messages', () => {
  assert.equal(describeUploadMime('application/octet-stream'), null);
  assert.equal(describeUploadMime('text/html'), null);
  assert.equal(describeUploadMime('image/svg+xml'), null);
  assert.equal(isMessageMediaType('audio'), true);
  assert.equal(isMessageMediaType('archive'), false);
});

test('verifies media signatures instead of trusting the declared MIME alone', () => {
  const png = describeUploadMime('image/png');
  assert.ok(png);
  assert.equal(uploadSignatureMatches(
    png,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ), true);
  assert.equal(uploadSignatureMatches(png, Buffer.from('not a png')), false);

  const mp4 = describeUploadMime('video/mp4');
  assert.ok(mp4);
  assert.equal(uploadSignatureMatches(mp4, Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ])), true);
});
