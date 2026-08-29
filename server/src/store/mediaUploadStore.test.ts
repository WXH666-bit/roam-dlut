import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Message } from '../types';
import { MemoryStore } from './memoryStore';

const messageData = (deviceId: string, key: string): Omit<
  Message,
  'id' | 'createdAt' | 'readers' | 'likes'
> => ({
  deviceId,
  flowerName: '测试花名',
  text: '带附件的留言',
  mediaType: 'image',
  mediaKey: key,
  lat: 38.88,
  lng: 121.52,
  moderationStatus: 'pending',
  moderationRequestedAt: 100,
});

const withStore = async (run: (store: MemoryStore, directory: string) => Promise<void>) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'here-media-upload-store-'));
  try {
    const store = new MemoryStore(path.join(directory, 'store.json'));
    await store.init();
    await run(store, directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test('media upload claim is one-time and checks owner, type, and expiry atomically', async () => {
  await withStore(async (store) => {
    const key = 'cidi-youhua/image/claim-once.jpg';
    await store.registerMediaUpload({
      key,
      deviceId: 'device-a',
      mediaType: 'image',
      createdAt: 100,
      expiresAt: 200,
    });

    assert.equal(
      await store.createMessageClaimingMedia(messageData('device-b', key), 'device-b', key, 'image', 150),
      null
    );
    assert.equal(
      await store.createMessageClaimingMedia(messageData('device-a', key), 'device-a', key, 'video', 150),
      null
    );
    assert.equal(
      await store.createMessageClaimingMedia(messageData('device-a', key), 'device-a', key, 'image', 200),
      null
    );

    const claimed = await store.createMessageClaimingMedia(
      messageData('device-a', key),
      'device-a',
      key,
      'image',
      150
    );
    assert.ok(claimed);
    assert.equal(claimed.createdAt, 150);
    assert.equal((await store.createMessageClaimingMedia(
      messageData('device-a', key),
      'device-a',
      key,
      'image',
      151
    )), null);
  });
});

test('expired media upload cleanup records persist failures and remove successes', async () => {
  await withStore(async (store, directory) => {
    const oldKey = 'cidi-youhua/audio/old.mp3';
    const futureKey = 'cidi-youhua/video/future.mp4';
    await store.registerMediaUpload({
      key: oldKey,
      deviceId: 'device-a',
      mediaType: 'audio',
      createdAt: 100,
      expiresAt: 120,
    });
    await store.registerMediaUpload({
      key: futureKey,
      deviceId: 'device-a',
      mediaType: 'video',
      createdAt: 100,
      expiresAt: 300,
    });

    let expired = await store.listExpiredMediaUploads(120, 10);
    assert.deepEqual(expired.map((item) => item.key), [oldKey]);
    const failed = await store.markMediaUploadCleanupFailure(oldKey, '对象存储暂时不可用');
    assert.equal(failed?.attempts, 1);
    assert.equal(failed?.error, '对象存储暂时不可用');

    const reloaded = new MemoryStore(path.join(directory, 'store.json'));
    await reloaded.init();
    expired = await reloaded.listExpiredMediaUploads(120, 10);
    assert.equal(expired[0]?.attempts, 1);
    assert.equal(expired[0]?.error, '对象存储暂时不可用');

    const removed = await reloaded.markMediaUploadCleanupSuccess(oldKey);
    assert.equal(removed?.key, oldKey);
    assert.deepEqual((await reloaded.listExpiredMediaUploads(120, 10)).map((item) => item.key), []);
    assert.deepEqual((await reloaded.listExpiredMediaUploads(300, 10)).map((item) => item.key), [futureKey]);
  });
});

test('expired media cleanup lease is single-owner and failure releases it', async () => {
  await withStore(async (store) => {
    const key = 'cidi-youhua/image/lease.jpg';
    await store.registerMediaUpload({
      key,
      deviceId: 'device-a',
      mediaType: 'image',
      createdAt: 100,
      expiresAt: 120,
    });

    const leased = await Promise.all([
      store.claimExpiredMediaUploadForCleanup(key, 120, 1000),
      store.claimExpiredMediaUploadForCleanup(key, 120, 1000),
    ]);
    assert.equal(leased.filter(Boolean).length, 1);
    assert.equal(leased.find(Boolean)?.cleanupLeaseUntil, 1120);

    // A clock that is behind the cleanup worker must not publish a row while
    // the cleanup lease is still valid, even though its expiry is in the
    // future relative to that older clock.
    assert.equal(
      await store.createMessageClaimingMedia(messageData('device-a', key), 'device-a', key, 'image', 110),
      null
    );
    await store.markMediaUploadCleanupFailure(key, '清理失败');
    const claimed = await store.createMessageClaimingMedia(
      messageData('device-a', key),
      'device-a',
      key,
      'image',
      110
    );
    assert.ok(claimed);
    assert.equal((await store.listExpiredMediaUploads(120)).length, 0);
  });
});
