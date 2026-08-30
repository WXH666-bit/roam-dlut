/**
 * All coordinates exchanged by the client are WGS-84 latitude/longitude.
 * Native Android/iOS providers already report this datum. AMap is the only
 * exception: locations marked GCJ-02 are converted once at its adapter edge.
 */
// Keep the wire value aligned with the server's canonical representation.
export const LOCATION_COORDINATE_SYSTEM = 'wgs84' as const;

/** A location fix source retained for UI and quality-gate decisions. */
export type LocationSource = 'last-known' | 'expo-watch' | 'fallback' | 'amap';

/**
 * A coordinate plus the metadata needed to decide whether it is safe for a
 * 50 m action.  `isLive` describes how the fix was obtained; freshness is
 * checked separately because even a live fix becomes stale over time.
 */
export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: number | null;
  source: LocationSource;
  isLive: boolean;
  coordinateSystem: typeof LOCATION_COORDINATE_SYSTEM;
}

/** Maximum age of a fix that may drive a foreground proximity action. */
export const LOCATION_MAX_AGE_MS = 30_000;

/** Maximum reported horizontal uncertainty accepted for a 50 m action. */
export const LOCATION_MAX_ACCURACY_METERS = 30;

/** Tolerate tiny native timestamp/JS clock scheduling differences. */
export const LOCATION_MAX_FUTURE_SKEW_MS = 5_000;

/** Give a newly started engine time to improve a coarse/cached first fix. */
export const LOCATION_AUTO_RETRY_GRACE_MS = 15_000;

/** Avoid repeatedly restarting GPS when the environment cannot reach 30 m. */
export const LOCATION_AUTO_RETRY_COOLDOWN_MS = 45_000;

/** After two recovery restarts, keep the live engines warm and wait for a better fix. */
export const LOCATION_AUTO_RETRY_LIMIT = 2;

type LocationQuality = Pick<LocationFix, 'accuracy' | 'timestamp' | 'source' | 'isLive'>;

export interface GeographicCoordinate {
  lat: number;
  lng: number;
}

const GCJ_PI = Math.PI;
const GCJ_ELLIPSOID_A = 6378245.0;
const GCJ_ECCENTRICITY_SQUARED = 0.006693421622965943;

const isOutsideGcjCoverage = (lat: number, lng: number): boolean =>
  lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;

const transformGcjLatitude = (x: number, y: number): number => {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y
    + 0.2 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3;
  value += (20 * Math.sin(y * GCJ_PI) + 40 * Math.sin(y / 3 * GCJ_PI)) * 2 / 3;
  value += (160 * Math.sin(y / 12 * GCJ_PI) + 320 * Math.sin(y * GCJ_PI / 30)) * 2 / 3;
  return value;
};

/**
 * Whether a provider is actively delivering a current fix, independent of its
 * reported uncertainty. This lets AMap remain the selected Android provider
 * while an indoor network fix is still improving toward the 30 m action gate.
 */
export const isFreshLiveProviderLocation = (
  fix: LocationQuality | null | undefined,
  now = Date.now()
): boolean => {
  if (
    !fix
    || !fix.isLive
    || (fix.source !== 'expo-watch' && fix.source !== 'fallback' && fix.source !== 'amap')
    || fix.timestamp === null
    || !Number.isFinite(fix.timestamp)
    || fix.timestamp <= 0
    || fix.timestamp > Number.MAX_SAFE_INTEGER
    || !Number.isFinite(now)
  ) return false;

  const age = now - fix.timestamp;
  return age >= -LOCATION_MAX_FUTURE_SKEW_MS && age <= LOCATION_MAX_AGE_MS;
};

const transformGcjLongitude = (x: number, y: number): number => {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y
    + 0.1 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3;
  value += (20 * Math.sin(x * GCJ_PI) + 40 * Math.sin(x / 3 * GCJ_PI)) * 2 / 3;
  value += (150 * Math.sin(x / 12 * GCJ_PI) + 300 * Math.sin(x / 30 * GCJ_PI)) * 2 / 3;
  return value;
};

export const wgs84ToGcj02 = (lat: number, lng: number): GeographicCoordinate => {
  if (isOutsideGcjCoverage(lat, lng)) return { lat, lng };
  let latitudeDelta = transformGcjLatitude(lng - 105, lat - 35);
  let longitudeDelta = transformGcjLongitude(lng - 105, lat - 35);
  const latitudeRadians = lat / 180 * GCJ_PI;
  const latitudeSin = Math.sin(latitudeRadians);
  const magic = 1 - GCJ_ECCENTRICITY_SQUARED * latitudeSin * latitudeSin;
  const magicRoot = Math.sqrt(magic);
  latitudeDelta = latitudeDelta * 180
    / ((GCJ_ELLIPSOID_A * (1 - GCJ_ECCENTRICITY_SQUARED)) / (magic * magicRoot) * GCJ_PI);
  longitudeDelta = longitudeDelta * 180
    / (GCJ_ELLIPSOID_A / magicRoot * Math.cos(latitudeRadians) * GCJ_PI);
  return { lat: lat + latitudeDelta, lng: lng + longitudeDelta };
};

/** Iteratively invert an AMap GCJ-02 result to the app's WGS-84 contract. */
export const gcj02ToWgs84 = (lat: number, lng: number): GeographicCoordinate => {
  if (isOutsideGcjCoverage(lat, lng)) return { lat, lng };
  let latitudeLow = lat - 0.01;
  let latitudeHigh = lat + 0.01;
  let longitudeLow = lng - 0.01;
  let longitudeHigh = lng + 0.01;
  let candidate = { lat, lng };

  for (let index = 0; index < 32; index += 1) {
    candidate = {
      lat: (latitudeLow + latitudeHigh) / 2,
      lng: (longitudeLow + longitudeHigh) / 2,
    };
    const projected = wgs84ToGcj02(candidate.lat, candidate.lng);
    if (projected.lat > lat) latitudeHigh = candidate.lat;
    else latitudeLow = candidate.lat;
    if (projected.lng > lng) longitudeHigh = candidate.lng;
    else longitudeLow = candidate.lng;
  }
  return candidate;
};

/**
 * Return true only for a fresh, high-accuracy, live watch fix.  Last-known
 * coordinates intentionally fail this check: they may warm up the UI but
 * must never unlock an encounter or publish a message.
 */
export const isFreshLiveLocation = (
  fix: LocationQuality | null | undefined,
  now = Date.now()
): boolean => {
  if (!fix || !isFreshLiveProviderLocation(fix, now)) return false;
  if (fix.accuracy === null || !Number.isFinite(fix.accuracy) || fix.accuracy < 0) return false;
  if (fix.accuracy > LOCATION_MAX_ACCURACY_METERS) return false;
  return true;
};

/**
 * Foreground recovery policy for stale, missing, or persistently inaccurate
 * fixes. The caller separately excludes permission-denied/actively-locating
 * states before restarting the native engines.
 */
export const shouldAutoRetryLocation = (
  fix: LocationQuality | null | undefined,
  now: number,
  runStartedAt: number,
  lastRetryAt: number,
  retryCount = 0
): boolean => {
  if (![now, runStartedAt, lastRetryAt].every(Number.isFinite)) return false;
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount >= LOCATION_AUTO_RETRY_LIMIT) return false;
  if (now - runStartedAt < LOCATION_AUTO_RETRY_GRACE_MS) return false;
  if (now - lastRetryAt < LOCATION_AUTO_RETRY_COOLDOWN_MS) return false;
  return !isFreshLiveLocation(fix, now);
};
