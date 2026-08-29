import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeModerationBudget,
  consumeRegistration,
  consumeUploadBudget,
  resetRequestLimitsForTests,
} from './requestLimits';

test('registration limits only the configured number of new identities per IP', () => {
  resetRequestLimitsForTests();
  process.env.REGISTRATION_IP_HOURLY_LIMIT = '2';
  assert.equal(consumeRegistration('127.0.0.1', 1).allowed, true);
  assert.equal(consumeRegistration('127.0.0.1', 2).allowed, true);
  assert.equal(consumeRegistration('127.0.0.1', 3).allowed, false);
  assert.equal(consumeRegistration('127.0.0.2', 3).allowed, true);
  delete process.env.REGISTRATION_IP_HOURLY_LIMIT;
});

test('moderation enforces both IP and global budgets', () => {
  resetRequestLimitsForTests();
  process.env.MODERATION_IP_HOURLY_LIMIT = '2';
  process.env.MODERATION_GLOBAL_DAILY_LIMIT = '3';
  assert.equal(consumeModerationBudget('a', 1).allowed, true);
  assert.equal(consumeModerationBudget('a', 2).allowed, true);
  assert.equal(consumeModerationBudget('a', 3).allowed, false);
  assert.equal(consumeModerationBudget('b', 4).allowed, true);
  const global = consumeModerationBudget('c', 5);
  assert.equal(global.allowed, false);
  if (!global.allowed) assert.equal(global.reason, 'global_budget');
  delete process.env.MODERATION_IP_HOURLY_LIMIT;
  delete process.env.MODERATION_GLOBAL_DAILY_LIMIT;
});

test('upload budget is bounded by both IP and device', () => {
  resetRequestLimitsForTests();
  process.env.UPLOAD_IP_HOURLY_LIMIT = '3';
  process.env.UPLOAD_DEVICE_HOURLY_LIMIT = '1';
  assert.equal(consumeUploadBudget('a', 'one', 1).allowed, true);
  assert.equal(consumeUploadBudget('a', 'one', 2).allowed, false);
  assert.equal(consumeUploadBudget('a', 'two', 3).allowed, true);
  delete process.env.UPLOAD_IP_HOURLY_LIMIT;
  delete process.env.UPLOAD_DEVICE_HOURLY_LIMIT;
});
