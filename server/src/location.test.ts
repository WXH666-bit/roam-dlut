import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_LOCATION_ACCURACY_METERS,
  MAX_LOCATION_AGE_MS,
  MAX_LOCATION_FUTURE_SKEW_MS,
  gcj02ToWgs84,
  validatePublishLocation,
  wgs84ToGcj02,
} from './location';
import { BUILT_IN_SEED_MESSAGE_IDS, buildSeedMessages } from './seeds';

const now = 1_800_000_000_000;

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  lat: 38.883,
  lng: 121.526,
  coordinate_system: 'wgs84',
  accuracy: 8,
  captured_at: now,
  ...overrides,
});

test('accepts the legacy metadata-free payload as implicit WGS-84', () => {
  const result = validatePublishLocation({ lat: 38.883, lng: 121.526 }, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.coordinateSystem, 'wgs84');
    assert.equal(result.value.legacy, true);
    assert.equal(result.value.accuracy, undefined);
    assert.equal(result.value.capturedAt, undefined);
  }
});

test('canonicalizes WGS-84 spellings and preserves fix metadata', () => {
  const result = validatePublishLocation(
    validPayload({ coordinate_system: ' WGS-84 ', accuracy: MAX_LOCATION_ACCURACY_METERS }),
    now
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      lat: 38.883,
      lng: 121.526,
      coordinateSystem: 'wgs84',
      accuracy: MAX_LOCATION_ACCURACY_METERS,
      capturedAt: now,
      legacy: false,
    });
  }
});

test('accepts EPSG:4326 as an explicit WGS-84 alias', () => {
  const result = validatePublishLocation(
    validPayload({ coordinate_system: 'EPSG:4326' }),
    now
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.coordinateSystem, 'wgs84');
});

test('converts the legacy campus GCJ-02 demo point to WGS-84', () => {
  const converted = gcj02ToWgs84(38.8828, 121.5265);
  assert.ok(Math.abs(converted.lat - 38.88192768) < 1e-7);
  assert.ok(Math.abs(converted.lng - 121.52139591) < 1e-7);
  const roundTrip = wgs84ToGcj02(converted.lat, converted.lng);
  assert.ok(Math.abs(roundTrip.lat - 38.8828) < 1e-7);
  assert.ok(Math.abs(roundTrip.lng - 121.5265) < 1e-7);
});

test('builds every reserved demo message with explicit WGS-84 coordinates', () => {
  const seeds = buildSeedMessages(now);
  assert.ok(seeds.length > 0);
  assert.deepEqual(seeds.map((seed) => seed.id), BUILT_IN_SEED_MESSAGE_IDS);
  for (const seed of seeds) {
    assert.equal(seed.deviceId, 'seed-device');
    assert.equal(seed.coordinateSystem, 'wgs84');
    assert.ok(Number.isFinite(seed.lat));
    assert.ok(Number.isFinite(seed.lng));
  }
});

test('rejects non-WGS-84 coordinate systems', () => {
  const result = validatePublishLocation(validPayload({ coordinate_system: 'gcj02' }), now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'unsupported_coordinate_system');
});

test('rejects partially declared location metadata', () => {
  const result = validatePublishLocation(
    { lat: 38.883, lng: 121.526, coordinate_system: 'wgs84' },
    now
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'location_metadata_incomplete');
});

test('rejects inaccurate fixes and malformed accuracy values', () => {
  for (const accuracy of [MAX_LOCATION_ACCURACY_METERS + 0.001, Infinity, -1, null]) {
    const result = validatePublishLocation(validPayload({ accuracy }), now);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.code === 'accuracy_exceeded' || result.code === 'invalid_accuracy');
    }
  }
});

test('allows the server upload/clock grace window but rejects stale fixes', () => {
  const withinGrace = validatePublishLocation(
    validPayload({ captured_at: now - MAX_LOCATION_AGE_MS }),
    now
  );
  assert.equal(withinGrace.ok, true);

  const stale = validatePublishLocation(
    validPayload({ captured_at: now - MAX_LOCATION_AGE_MS - 1 }),
    now
  );
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, 'location_stale');
});

test('rejects timestamps beyond the allowed future clock skew', () => {
  const result = validatePublishLocation(
    validPayload({ captured_at: now + MAX_LOCATION_FUTURE_SKEW_MS + 1 }),
    now
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'location_from_future');
});

test('rejects non-finite or out-of-range coordinates', () => {
  for (const overrides of [
    { lat: NaN },
    { lng: Infinity },
    { lat: 90.000001 },
    { lng: -180.000001 },
  ]) {
    const result = validatePublishLocation({ lat: 38.883, lng: 121.526, ...overrides }, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid_coordinates');
  }
});
