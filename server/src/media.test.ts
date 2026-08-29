import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUploadMime, isMessageMediaType } from './media';

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
