/**
 * All coordinates exchanged by the client are WGS-84 latitude/longitude.
 * Native Android/iOS location providers already report this datum, so the
 * client must not apply a GCJ-02 conversion to a GPS fix.
 */
// Keep the wire value aligned with the server's canonical representation.
export const LOCATION_COORDINATE_SYSTEM = 'wgs84' as const;

/** A location fix source retained for UI and quality-gate decisions. */
export type LocationSource = 'last-known' | 'expo-watch' | 'fallback';

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

type LocationQuality = Pick<LocationFix, 'accuracy' | 'timestamp' | 'source' | 'isLive'>;

/**
 * Return true only for a fresh, high-accuracy, live watch fix.  Last-known
 * coordinates intentionally fail this check: they may warm up the UI but
 * must never unlock an encounter or publish a message.
 */
export const isFreshLiveLocation = (
  fix: LocationQuality | null | undefined,
  now = Date.now()
): boolean => {
  if (!fix || !fix.isLive || (fix.source !== 'expo-watch' && fix.source !== 'fallback')) return false;
  if (fix.accuracy === null || !Number.isFinite(fix.accuracy) || fix.accuracy < 0) return false;
  if (fix.accuracy > LOCATION_MAX_ACCURACY_METERS) return false;
  if (
    fix.timestamp === null
    || !Number.isFinite(fix.timestamp)
    || fix.timestamp <= 0
    || fix.timestamp > Number.MAX_SAFE_INTEGER
  ) return false;
  if (!Number.isFinite(now)) return false;

  const age = now - fix.timestamp;
  return age >= -LOCATION_MAX_FUTURE_SKEW_MS && age <= LOCATION_MAX_AGE_MS;
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
  lastRetryAt: number
): boolean => {
  if (![now, runStartedAt, lastRetryAt].every(Number.isFinite)) return false;
  if (now - runStartedAt < LOCATION_AUTO_RETRY_GRACE_MS) return false;
  if (now - lastRetryAt < LOCATION_AUTO_RETRY_COOLDOWN_MS) return false;
  return !isFreshLiveLocation(fix, now);
};
