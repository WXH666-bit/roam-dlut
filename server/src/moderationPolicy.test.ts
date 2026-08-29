import assert from 'node:assert/strict';
import test from 'node:test';
import { activeRestriction, restrictionAfterConfirmedViolation } from './moderationPolicy';

test('confirmed violations escalate only after administrator confirmation', () => {
  const now = 1_000_000;
  const first = restrictionAfterConfirmedViolation(undefined, 'dev-1', 'auto', '', now);
  assert.equal(first.violationCount, 1);
  assert.equal(activeRestriction(first, now), null);

  const second = restrictionAfterConfirmedViolation(first, 'dev-1', 'auto', '', now);
  assert.equal(second.violationCount, 2);
  assert.equal(second.bannedUntil, now + 24 * 60 * 60 * 1000);

  let current = second;
  current = restrictionAfterConfirmedViolation(current, 'dev-1', 'auto', '', now);
  current = restrictionAfterConfirmedViolation(current, 'dev-1', 'auto', '', now);
  current = restrictionAfterConfirmedViolation(current, 'dev-1', 'auto', '', now);
  assert.equal(current.violationCount, 5);
  assert.equal(current.permanent, true);
  assert.equal(current.bannedUntil, null);
});

test('explicit permanent penalty can be applied to a first serious violation', () => {
  const result = restrictionAfterConfirmedViolation(
    undefined,
    'dev-2',
    'permanent',
    '严重违规',
    123
  );
  assert.equal(result.violationCount, 1);
  assert.equal(result.permanent, true);
  assert.equal(result.reason, '严重违规');
});
