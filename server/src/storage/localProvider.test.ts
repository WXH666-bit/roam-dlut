import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalDriver, localMediaRequestValid } from './localProvider';

test('local media URLs require an unexpired server signature', async () => {
  const driver = createLocalDriver();
  const key = 'cidi-youhua/images/example.jpg';
  const url = new URL(await driver.getPublicUrl(key));
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');
  assert.equal(localMediaRequestValid(key, expires, signature), true);
  assert.equal(localMediaRequestValid(`${key}.tampered`, expires, signature), false);
  assert.equal(localMediaRequestValid(key, '1', signature), false);
});
