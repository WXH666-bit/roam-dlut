import {
  gcj02ToWgs84,
  isFreshLiveLocation,
  isFreshLiveProviderLocation,
  LOCATION_COORDINATE_SYSTEM,
  LOCATION_MAX_ACCURACY_METERS,
  LOCATION_MAX_AGE_MS,
  LOCATION_MAX_FUTURE_SKEW_MS,
  LOCATION_AUTO_RETRY_COOLDOWN_MS,
  LOCATION_AUTO_RETRY_GRACE_MS,
  LOCATION_AUTO_RETRY_LIMIT,
  shouldAutoRetryLocation,
  wgs84ToGcj02,
  type LocationFix,
} from './location';

const now = 1_800_000_000_000;

const liveFix = (overrides: Partial<LocationFix> = {}): LocationFix => ({
  lat: 38.88192768,
  lng: 121.52139591,
  accuracy: 10,
  timestamp: now,
  source: 'expo-watch',
  isLive: true,
  coordinateSystem: LOCATION_COORDINATE_SYSTEM,
  ...overrides,
});

describe('shouldAutoRetryLocation', () => {
  it('retries stale or inaccurate fixes only after the grace period', () => {
    const startedAt = now - LOCATION_AUTO_RETRY_GRACE_MS;
    expect(shouldAutoRetryLocation(liveFix({ accuracy: 45 }), now, startedAt, 0)).toBe(true);
    expect(shouldAutoRetryLocation(
      liveFix({ timestamp: now - LOCATION_MAX_AGE_MS - 1 }),
      now,
      startedAt,
      0
    )).toBe(true);
    expect(shouldAutoRetryLocation(
      liveFix({ accuracy: 45 }),
      now,
      now - LOCATION_AUTO_RETRY_GRACE_MS + 1,
      0
    )).toBe(false);
  });

  it('does not restart a fresh fix or retry again during cooldown', () => {
    const startedAt = now - LOCATION_AUTO_RETRY_GRACE_MS;
    expect(shouldAutoRetryLocation(liveFix(), now, startedAt, 0)).toBe(false);
    expect(shouldAutoRetryLocation(
      liveFix({ accuracy: 45 }),
      now,
      startedAt,
      now - LOCATION_AUTO_RETRY_COOLDOWN_MS + 1
    )).toBe(false);
    expect(shouldAutoRetryLocation(
      liveFix({ accuracy: 45 }),
      now,
      startedAt,
      0,
      LOCATION_AUTO_RETRY_LIMIT
    )).toBe(false);
  });
});

describe('isFreshLiveLocation', () => {
  it('accepts a fresh live fix at the accuracy boundary', () => {
    expect(isFreshLiveLocation(liveFix({ accuracy: LOCATION_MAX_ACCURACY_METERS }), now)).toBe(true);
    expect(isFreshLiveLocation(liveFix({ source: 'amap' }), now)).toBe(true);
  });

  it('rejects cached, inaccurate, stale, and unknown fixes', () => {
    expect(isFreshLiveLocation(liveFix({ source: 'last-known', isLive: false }), now)).toBe(false);
    expect(isFreshLiveLocation(liveFix({ accuracy: LOCATION_MAX_ACCURACY_METERS + 0.1 }), now)).toBe(false);
    expect(isFreshLiveLocation(liveFix({ timestamp: now - LOCATION_MAX_AGE_MS - 1 }), now)).toBe(false);
    expect(isFreshLiveLocation(liveFix({ accuracy: null }), now)).toBe(false);
    expect(isFreshLiveLocation(liveFix({ accuracy: -1 }), now)).toBe(false);
    expect(isFreshLiveLocation(liveFix({ timestamp: null }), now)).toBe(false);
    expect(isFreshLiveLocation(liveFix({ timestamp: -1 }), now)).toBe(false);
  });

  it('allows small future skew but rejects a clearly future timestamp', () => {
    // iOS Core Location can expose sub-millisecond precision before the app
    // normalizes the value for the integer wire contract.
    expect(isFreshLiveLocation(liveFix({ timestamp: now - 0.25 }), now)).toBe(true);
    expect(isFreshLiveLocation(liveFix({ timestamp: now + LOCATION_MAX_FUTURE_SKEW_MS }), now)).toBe(true);
    expect(isFreshLiveLocation(liveFix({ timestamp: now + LOCATION_MAX_FUTURE_SKEW_MS + 1 }), now)).toBe(false);
  });
});

describe('isFreshLiveProviderLocation', () => {
  it('keeps a fresh AMap provider selected while indoor accuracy is still coarse', () => {
    expect(isFreshLiveProviderLocation(liveFix({ source: 'amap', accuracy: 58 }), now)).toBe(true);
    expect(isFreshLiveLocation(liveFix({ source: 'amap', accuracy: 58 }), now)).toBe(false);
  });

  it('rejects cached and stale provider results', () => {
    expect(isFreshLiveProviderLocation(liveFix({ source: 'last-known', isLive: false }), now)).toBe(false);
    expect(isFreshLiveProviderLocation(
      liveFix({ source: 'amap', timestamp: now - LOCATION_MAX_AGE_MS - 1 }),
      now
    )).toBe(false);
  });
});

describe('AMap coordinate normalization', () => {
  it('converts the campus GCJ-02 point to WGS-84 and round-trips precisely', () => {
    const converted = gcj02ToWgs84(38.8828, 121.5265);
    expect(Math.abs(converted.lat - 38.88192768)).toBeLessThan(1e-7);
    expect(Math.abs(converted.lng - 121.52139591)).toBeLessThan(1e-7);
    const roundTrip = wgs84ToGcj02(converted.lat, converted.lng);
    expect(Math.abs(roundTrip.lat - 38.8828)).toBeLessThan(1e-7);
    expect(Math.abs(roundTrip.lng - 121.5265)).toBeLessThan(1e-7);
  });
});
