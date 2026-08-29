/**
 * Location metadata accepted by the publish API.
 *
 * Native Android/iOS location APIs report WGS-84 coordinates.  The server
 * stores that datum as the only canonical coordinate system.  Older clients
 * did not send metadata at all, so a completely metadata-free payload is
 * treated as an implicit (legacy) WGS-84 location.
 */

export const WGS84_COORDINATE_SYSTEM = 'wgs84' as const;
export type CoordinateSystem = typeof WGS84_COORDINATE_SYSTEM;

/** The client target is 30 seconds; the server allows upload/clock slack. */
export const MAX_LOCATION_AGE_MS = 2 * 60 * 1000;
/** Permit a small amount of device clock skew in either direction. */
export const MAX_LOCATION_FUTURE_SKEW_MS = 2 * 60 * 1000;
export const MAX_LOCATION_ACCURACY_METERS = 30;

export interface GeographicCoordinate {
  lat: number;
  lng: number;
}

// GCJ-02 conversion is intentionally kept at the legacy seed-data boundary.
// Phone GPS fixes and API payloads must never pass through these functions.
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

/** Iteratively invert GCJ-02 to WGS-84 to sub-metre precision. */
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

export interface StoredLocationMetadata {
  /** Canonical internal spelling.  Omitted means a legacy row. */
  coordinateSystem?: CoordinateSystem;
  /** Horizontal accuracy in metres, when supplied by the client. */
  accuracy?: number;
  /** Device location-fix timestamp in Unix milliseconds. */
  capturedAt?: number;
}

export interface ValidatedPublishLocation extends StoredLocationMetadata {
  lat: number;
  lng: number;
  /** True when the request used the pre-metadata API shape. */
  legacy: boolean;
}

export type LocationValidationCode =
  | 'invalid_coordinates'
  | 'unsupported_coordinate_system'
  | 'location_metadata_incomplete'
  | 'invalid_accuracy'
  | 'accuracy_exceeded'
  | 'invalid_captured_at'
  | 'location_stale'
  | 'location_from_future';

export interface LocationValidationFailure {
  ok: false;
  code: LocationValidationCode;
  message: string;
}

export interface LocationValidationSuccess {
  ok: true;
  value: ValidatedPublishLocation;
}

export type LocationValidationResult =
  | LocationValidationSuccess
  | LocationValidationFailure;

interface FieldValue {
  present: boolean;
  value: unknown;
}

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * The public API is snake_case, but accepting camelCase aliases makes staged
 * client/hot updates safe.  If both are present, the canonical snake_case
 * field wins, just like the rest of this API's wire format.
 */
const readField = (
  body: Record<string, unknown>,
  ...keys: string[]
): FieldValue => {
  for (const key of keys) {
    if (hasOwn(body, key)) return { present: true, value: body[key] };
  }
  return { present: false, value: undefined };
};

/** Normalize common spellings while always storing `wgs84`. */
export const canonicalCoordinateSystem = (
  value: unknown
): CoordinateSystem | undefined => {
  if (typeof value !== 'string') return undefined;
  const compact = value.trim().toLowerCase().replace(/[\s_:\-]+/g, '');
  return compact === 'wgs84' || compact === 'epsg4326'
    ? WGS84_COORDINATE_SYSTEM
    : undefined;
};

const failure = (
  code: LocationValidationCode,
  message: string
): LocationValidationFailure => ({ ok: false, code, message });

/**
 * Validate and canonicalize the location portion of a publish request.
 * `now` is captured at the beginning of the HTTP handler, so elapsed upload
 * time is naturally included in freshness checks without depending on the
 * message creation timestamp.
 */
export const validatePublishLocation = (
  input: unknown,
  now = Date.now()
): LocationValidationResult => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('invalid_coordinates', '坐标不合法');
  }
  const body = input as Record<string, unknown>;
  const lat = body.lat;
  const lng = body.lng;
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90
    || typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180
  ) {
    return failure('invalid_coordinates', '坐标不合法');
  }

  const coordinateSystem = readField(body, 'coordinate_system', 'coordinateSystem');
  const accuracy = readField(body, 'accuracy', 'location_accuracy', 'accuracy_m');
  const capturedAt = readField(body, 'captured_at', 'capturedAt');
  const hasMetadata = coordinateSystem.present || accuracy.present || capturedAt.present;

  // The metadata-free shape is the old API.  Keep accepting it while making
  // the implicit datum explicit inside the server contract; do not fabricate
  // accuracy or capture time for old records.
  if (!hasMetadata) {
    return {
      ok: true,
      value: { lat, lng, coordinateSystem: WGS84_COORDINATE_SYSTEM, legacy: true },
    };
  }

  if (
    !coordinateSystem.present || !accuracy.present || !capturedAt.present
  ) {
    return failure(
      'location_metadata_incomplete',
      '定位元数据不完整，请重新获取位置后再试'
    );
  }

  if (!canonicalCoordinateSystem(coordinateSystem.value)) {
    return failure('unsupported_coordinate_system', '仅支持 WGS-84 坐标');
  }

  if (
    typeof accuracy.value !== 'number'
    || !Number.isFinite(accuracy.value)
    || accuracy.value < 0
  ) {
    return failure('invalid_accuracy', '定位精度不合法');
  }
  if (accuracy.value > MAX_LOCATION_ACCURACY_METERS) {
    return failure('accuracy_exceeded', '定位精度需不超过 30 米');
  }

  if (
    typeof capturedAt.value !== 'number'
    || !Number.isFinite(capturedAt.value)
    || !Number.isSafeInteger(capturedAt.value)
    || capturedAt.value <= 0
  ) {
    return failure('invalid_captured_at', '定位时间不合法');
  }
  const age = now - capturedAt.value;
  if (age > MAX_LOCATION_AGE_MS) {
    return failure('location_stale', '定位信息已过期，请重新定位');
  }
  if (age < -MAX_LOCATION_FUTURE_SKEW_MS) {
    return failure('location_from_future', '定位时间无效，请检查设备时间');
  }

  return {
    ok: true,
    value: {
      lat,
      lng,
      coordinateSystem: WGS84_COORDINATE_SYSTEM,
      accuracy: accuracy.value,
      capturedAt: capturedAt.value,
      legacy: false,
    },
  };
};
