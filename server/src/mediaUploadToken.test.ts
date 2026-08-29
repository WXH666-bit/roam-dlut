import assert from 'node:assert/strict';
import test from 'node:test';
import { issueMediaUploadToken, mediaUploadTokenValid } from './mediaUploadToken';

test('media upload token binds owner, key, type and expiry', () => {
  const now = 1000;
  const key = 'cidi-youhua/images/a.jpg';
  const token = issueMediaUploadToken('dev-a', key, 'image', now);
  assert.equal(mediaUploadTokenValid(token, 'dev-a', key, 'image', now), true);
  assert.equal(mediaUploadTokenValid(token, 'dev-b', key, 'image', now), false);
  assert.equal(mediaUploadTokenValid(token, 'dev-a', `${key}.other`, 'image', now), false);
  assert.equal(mediaUploadTokenValid(token, 'dev-a', key, 'video', now), false);
  assert.equal(mediaUploadTokenValid(token, 'dev-a', key, 'image', now + 60 * 60 * 1000 + 1), false);
});
