import {
  isFreshLiveLocation,
  LOCATION_COORDINATE_SYSTEM,
  LOCATION_MAX_ACCURACY_METERS,
  LOCATION_MAX_AGE_MS,
  LOCATION_MAX_FUTURE_SKEW_MS,
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

describe('isFreshLiveLocation', () => {
  it('accepts a fresh live fix at the accuracy boundary', () => {
    expect(isFreshLiveLocation(liveFix({ accuracy: LOCATION_MAX_ACCURACY_METERS }), now)).toBe(true);
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
