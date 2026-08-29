import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { activeRestriction } from '../moderationPolicy';
import { MemoryStore } from './memoryStore';

const pendingMessage = (deviceId: string, text: string) => ({
  deviceId,
  flowerName: '测试花名',
  text,
  mediaType: 'none' as const,
  mediaKey: null,
  lat: 38.88,
  lng: 121.52,
  moderationStatus: 'pending' as const,
  moderationRequestedAt: Date.now(),
});

test('pending messages publish only after a safe outcome or administrator approval', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'here-moderation-store-'));
  try {
    const store = new MemoryStore(path.join(directory, 'store.json'));
    await store.init();
    await store.ensureUser('dev-safe');
    const message = await store.createMessage(pendingMessage('dev-safe', '校园晚风'));
    assert.equal((await store.listPendingMessages()).some((item) => item.id === message.id), true);

    const published = await store.applyModerationOutcome(message.id, {
      verdict: 'safe',
      severity: 'low',
      reason: 'safe',
      categories: [],
      model: 'step-3.7-flash',
      decidedAt: Date.now(),
    }, true);
    assert.equal(published?.moderationStatus, 'published');
    assert.equal((await store.listPendingMessages()).some((item) => item.id === message.id), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('only confirmed rejections count as violations and the second triggers a temporary ban', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'here-moderation-strikes-'));
  try {
    const store = new MemoryStore(path.join(directory, 'store.json'));
    await store.init();
    await store.ensureUser('dev-repeat');

    for (let index = 0; index < 2; index += 1) {
      const message = await store.createMessage(pendingMessage('dev-repeat', `待审 ${index}`));
      const result = await store.reviewPendingMessage(message.id, {
        decision: 'reject',
        reviewerId: 'tester',
        banMode: 'auto',
      });
      assert.ok(result);
      assert.equal(await store.findMessage(message.id), undefined);
    }

    const restriction = await store.getDeviceModeration('dev-repeat');
    assert.equal(restriction?.violationCount, 2);
    assert.ok(activeRestriction(restriction));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejected media is durably queued and retains its key across failed cleanup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'here-media-cleanup-'));
  const dataFile = path.join(directory, 'store.json');
  try {
    const store = new MemoryStore(dataFile);
    await store.init();
    await store.ensureUser('dev-media');
    const message = await store.createMessage({
      ...pendingMessage('dev-media', '待清理附件'),
      mediaType: 'image',
      mediaKey: 'uploads/dev-media/photo.jpg',
    });

    const review = await store.reviewPendingMessage(message.id, {
      decision: 'reject',
      reviewerId: 'tester',
      banMode: 'auto',
    });
    assert.ok(review);

    let tasks = await store.listMediaCleanupTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.id, message.id);
    assert.equal(tasks[0]?.mediaKey, 'uploads/dev-media/photo.jpg');
    assert.equal(tasks[0]?.attempt, 0);
    assert.equal(tasks[0]?.error, null);

    const failed = await store.markMediaCleanupFailure(message.id, '对象存储暂时不可用');
    assert.equal(failed?.mediaKey, 'uploads/dev-media/photo.jpg');
    assert.equal(failed?.attempt, 1);
    assert.equal(failed?.error, '对象存储暂时不可用');

    const reloaded = new MemoryStore(dataFile);
    await reloaded.init();
    tasks = await reloaded.listMediaCleanupTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.mediaKey, 'uploads/dev-media/photo.jpg');
    assert.equal(tasks[0]?.attempt, 1);
    assert.equal(tasks[0]?.error, '对象存储暂时不可用');

    const succeeded = await reloaded.markMediaCleanupSuccess(message.id);
    assert.equal(succeeded?.mediaKey, null);
    assert.equal(succeeded?.error, null);
    assert.equal((await reloaded.listMediaCleanupTasks()).length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
