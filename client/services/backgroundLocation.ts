import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { fetchAliveMessages, type AliveMessageBrief } from '@/utils/api';
import { haversineMeters } from '@/utils/haversine';
import {
  APP_IN_FOREGROUND_STORAGE_KEY,
  IOS_BACKGROUND_CONFIG_STORAGE_KEY,
  MAX_STORED_PROXIMITY_IDS,
  READ_IDS_STORAGE_KEY,
  proximityNotificationIdsStorageKey,
} from '@/utils/notificationStorage';
import { showLocalNotification } from './notificationRuntime';

/**
 * Coordinate contract: Expo/Core Location supplies raw WGS-84 coordinates.
 * Keep them unconverted here; the server and local distance calculation use
 * the same datum, and map-provider conversion belongs only at display time.
 */
export const IOS_LOCATION_TASK_NAME = 'cidi-ios-background-location';
export const IOS_GEOFENCE_TASK_NAME = 'cidi-ios-proximity-geofence';
export const PROXIMITY_RADIUS_METERS = 50;
export const IOS_MAX_GEOFENCES = 20;
const GEOFENCE_SYNC_MIN_INTERVAL_MS = 60_000;
// A 50 m proximity action must be backed by a genuinely useful fix.  Keep
// these guards local to the background worker: OS-delivered callbacks can be
// resumed much later than the foreground location flow and must be checked at
// the point where they trigger a notification.
const MAX_BACKGROUND_LOCATION_ACCURACY_METERS = 30;
const MAX_BACKGROUND_LOCATION_AGE_MS = 60_000;
const IOS_GEOFENCE_LOCATION_MAX_AGE_MS = 30_000;
const CURRENT_LOCATION_TIMEOUT_MS = 10_000;
let proximityClaimQueue: Promise<void> = Promise.resolve();
let iosLocationOperationQueue: Promise<void> = Promise.resolve();
let iosGeofenceOperationQueue: Promise<void> = Promise.resolve();
let lastGeofenceSignature = '';

const queueIosLocationOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = iosLocationOperationQueue.catch(() => undefined).then(operation);
  iosLocationOperationQueue = result.then(() => undefined, () => undefined);
  return result;
};

const queueIosGeofenceOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = iosGeofenceOperationQueue.catch(() => undefined).then(operation);
  iosGeofenceOperationQueue = result.then(() => undefined, () => undefined);
  return result;
};

export interface BackgroundLocationConfig {
  deviceId: string;
  deviceToken: string | null;
  radius: number;
}

type LocationTaskData = {
  locations?: Array<{
    timestamp?: number;
    coords?: { latitude?: number; longitude?: number; accuracy?: number | null };
  }>;
};

type GeofenceTaskData = {
  eventType?: unknown;
  region?: { identifier?: string };
};

type LocationCoords = {
  latitude?: number;
  longitude?: number;
  accuracy?: number | null;
};

const hasUsableCoordinates = (
  coords: LocationCoords | null | undefined
): coords is LocationCoords & { latitude: number; longitude: number } => {
  if (
    !coords
    || typeof coords.latitude !== 'number'
    || !Number.isFinite(coords.latitude)
    || typeof coords.longitude !== 'number'
    || !Number.isFinite(coords.longitude)
  ) return false;

  // A missing uncertainty is not safe for a 50 m decision.  Native iOS
  // locations normally provide it; rejecting null also protects mocked/OEM
  // payloads from silently bypassing the precision gate.
  if (typeof coords.accuracy !== 'number') return false;
  return Number.isFinite(coords.accuracy)
    && coords.accuracy >= 0
    && coords.accuracy <= MAX_BACKGROUND_LOCATION_ACCURACY_METERS;
};

const hasFreshTimestamp = (timestamp?: number | null, now = Date.now()): boolean => {
  // Native LocationObject values always carry a timestamp.  A missing one
  // cannot prove freshness, so it must not drive a proximity notification.
  if (typeof timestamp !== 'number') return false;
  return Number.isFinite(timestamp)
    && timestamp >= now - MAX_BACKGROUND_LOCATION_AGE_MS
    && timestamp <= now + 5_000;
};

const readJsonArray = async (key: string): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const isAppInForeground = async (): Promise<boolean> => {
  try {
    // Missing state is treated as foreground-safe.  The root bridge writes the
    // explicit background value before an OS task is allowed to notify.
    return (await AsyncStorage.getItem(APP_IN_FOREGROUND_STORAGE_KEY)) !== '0';
  } catch {
    return true;
  }
};

const rememberProximityNotification = async (deviceId: string, messageId: string): Promise<boolean> => {
  // Continuous updates and a geofence entry can arrive together. Serialize the
  // read-modify-write so both callbacks cannot schedule the same notification.
  let claimed = false;
  const operation = proximityClaimQueue.then(async () => {
    const ids = await readJsonArray(proximityNotificationIdsStorageKey(deviceId));
    if (ids.includes(messageId)) return;
    const next = [...ids, messageId].slice(-MAX_STORED_PROXIMITY_IDS);
    try {
      await AsyncStorage.setItem(proximityNotificationIdsStorageKey(deviceId), JSON.stringify(next));
    } catch {
      // If persistence fails, still send this one notification.
    }
    claimed = true;
  });
  proximityClaimQueue = operation.catch(() => undefined);
  await operation;
  return claimed;
};

const notifyNearbyMessage = async (deviceId: string, messageId: string): Promise<void> => {
  if (await isAppInForeground()) return;
  const readIds = new Set(await readJsonArray(READ_IDS_STORAGE_KEY));
  if (readIds.has(messageId)) return;
  if (!(await rememberProximityNotification(deviceId, messageId))) return;
  await showLocalNotification({ type: 'nearby_message', messageId, playSound: false });
};

const processLocationTask = async (args: unknown): Promise<void> => {
  const value = args as { data?: LocationTaskData; error?: unknown };
  if (value.error) return;
  const latestUpdate = value.data?.locations?.at(-1);
  const latest = latestUpdate?.coords;
  if (!hasUsableCoordinates(latest) || !hasFreshTimestamp(latestUpdate?.timestamp)) return;
  if (await isAppInForeground()) return;

  // Do not send the message body or coordinates through the notification.  The
  // task only uses coordinates transiently for the local radius calculation.
  try {
    const config = await readBackgroundLocationConfig();
    if (!config) return;
    const radius = config.radius;
    const readIds = new Set(await readJsonArray(READ_IDS_STORAGE_KEY));
    const notifiedIds = new Set(await readJsonArray(proximityNotificationIdsStorageKey(config.deviceId)));
    const data = await fetchAliveMessages();
    for (const message of data.list) {
      if (readIds.has(message.id) || notifiedIds.has(message.id)) continue;
      const distance = haversineMeters(
        latest.latitude,
        latest.longitude,
        message.lat,
        message.lng
      );
      if (distance <= radius) await notifyNearbyMessage(config.deviceId, message.id);
    }
  } catch (error) {
    console.warn('[background-location] task check failed:', error);
  }
};

const processGeofenceTask = async (args: unknown): Promise<void> => {
  const value = args as { data?: GeofenceTaskData; error?: unknown };
  if (value.error || await isAppInForeground()) return;
  const eventType = value.data?.eventType;
  // Expo's enum is numeric on native; accept strings as well for mocked builds.
  if (!(eventType === 1 || eventType === 'enter' || eventType === 'ENTER')) return;
  const messageId = value.data?.region?.identifier;
  if (!messageId) return;
  const config = await readBackgroundLocationConfig();
  if (!config) return;
  try {
    // Verify the event still points to an alive message before notifying. This
    // avoids stale OS regions producing a notification after a message expires.
    const alive = await fetchAliveMessages();
    const message = alive.list.find((item) => item.id === messageId);
    if (!message) return;

    // Core Location can deliver a region callback with some boundary latency.
    // Re-check the actual last-known/current location so a false wake outside
    // the strict 50m radius never becomes a user-visible alert.
    let position = await Location.getLastKnownPositionAsync({
      maxAge: IOS_GEOFENCE_LOCATION_MAX_AGE_MS,
      requiredAccuracy: MAX_BACKGROUND_LOCATION_ACCURACY_METERS,
    });
    // A mocked/OEM implementation can still return a value outside the
    // requested bounds.  Fall back to a fresh high-accuracy read before
    // deciding whether an enter event is real.
    if (
      !position
      || !hasUsableCoordinates(position.coords)
      || !hasFreshTimestamp(position.timestamp)
    ) {
      position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), CURRENT_LOCATION_TIMEOUT_MS)),
      ]);
    }
    if (
      !position
      || !hasUsableCoordinates(position.coords)
      || !hasFreshTimestamp(position.timestamp)
    ) return;
    if (
      haversineMeters(position.coords.latitude, position.coords.longitude, message.lat, message.lng)
      > config.radius
    ) return;
  } catch {
    // A transient network failure should not turn an OS geofence wake-up into
    // a crash.  The continuous task will retry on its next location update.
    return;
  }
  await notifyNearbyMessage(config.deviceId, messageId);
};

/**
 * Task definitions must happen at module evaluation time so iOS can relaunch
 * the JS runtime for a background wake without rendering the React tree first.
 */
let tasksDefined = false;
let lastGeofenceSyncAt = 0;
try {
  TaskManager.defineTask(IOS_LOCATION_TASK_NAME, processLocationTask);
  TaskManager.defineTask(IOS_GEOFENCE_TASK_NAME, processGeofenceTask);
  tasksDefined = true;
} catch {
  // Hot reload can evaluate this module twice; the native task registry is
  // already populated in that case.
  tasksDefined = true;
}

export const writeBackgroundLocationConfig = async (
  config: BackgroundLocationConfig
): Promise<void> => {
  try {
    await AsyncStorage.setItem(IOS_BACKGROUND_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // The task will simply skip if it cannot obtain an identity.
  }
};

export const readBackgroundLocationConfig = async (): Promise<BackgroundLocationConfig | null> => {
  try {
    const raw = await AsyncStorage.getItem(IOS_BACKGROUND_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BackgroundLocationConfig>;
    if (typeof value.deviceId !== 'string' || !value.deviceId) return null;
    return {
      deviceId: value.deviceId,
      deviceToken: typeof value.deviceToken === 'string' ? value.deviceToken : null,
      radius: typeof value.radius === 'number' && value.radius > 0
        ? value.radius
        : PROXIMITY_RADIUS_METERS,
    };
  } catch {
    return null;
  }
};

const backgroundLocationOptions = {
  // High is required for a 50 m action; Balanced can report a fix whose
  // uncertainty is already larger than the proximity radius.
  accuracy: Location.Accuracy.High,
  distanceInterval: 25,
  timeInterval: 30_000,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: false,
};

/** Start iOS continuous background updates once Always permission is granted. */
export const startIosBackgroundLocation = async (
  config: BackgroundLocationConfig
): Promise<boolean> => {
  if (Platform.OS !== 'ios' || !tasksDefined) return false;
  return queueIosLocationOperation(async () => {
    await writeBackgroundLocationConfig(config);
    try {
      const background = await Location.getBackgroundPermissionsAsync();
      if (background.status !== 'granted') return false;
      const started = await Location.hasStartedLocationUpdatesAsync(IOS_LOCATION_TASK_NAME);
      if (!started) {
        await Location.startLocationUpdatesAsync(IOS_LOCATION_TASK_NAME, backgroundLocationOptions);
      }
      return true;
    } catch (error) {
      console.warn('[background-location] iOS start failed:', error);
      return false;
    }
  });
};

export const stopIosBackgroundLocation = async (): Promise<void> => {
  if (Platform.OS !== 'ios') return;
  await queueIosLocationOperation(async () => {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(IOS_LOCATION_TASK_NAME)) {
        await Location.stopLocationUpdatesAsync(IOS_LOCATION_TASK_NAME);
      }
    } catch {
      // Best effort only; the user can revoke the permission from Settings.
    }
  });
};

export const stopIosGeofences = async (): Promise<void> => {
  if (Platform.OS !== 'ios') return;
  await queueIosGeofenceOperation(async () => {
    try {
      if (await Location.hasStartedGeofencingAsync(IOS_GEOFENCE_TASK_NAME)) {
        await Location.stopGeofencingAsync(IOS_GEOFENCE_TASK_NAME);
      }
    } catch {
      // Revoking location permission can make the native stop call reject.
    } finally {
      lastGeofenceSyncAt = 0;
      lastGeofenceSignature = '';
    }
  });
};

/**
 * Register up to 20 nearest unread messages as 50m iOS geofences.  Android is
 * intentionally excluded: its geofence provider is GMS-dependent and is not
 * reliable on the target Honor 90 Pro; the native guardian handles Android.
 */
export const syncIosGeofences = async (
  currentLocation: { lat: number; lng: number } | null,
  aliveMessages: AliveMessageBrief[],
  readIds: Set<string>
): Promise<boolean> => {
  if (Platform.OS !== 'ios' || !currentLocation || !tasksDefined) return false;
  return queueIosGeofenceOperation(async () => {
    try {
      const background = await Location.getBackgroundPermissionsAsync();
      if (background.status !== 'granted') return false;
      const regions = aliveMessages
        .filter((message) => !readIds.has(message.id))
        .map((message) => ({
          identifier: message.id,
          latitude: message.lat,
          longitude: message.lng,
          radius: PROXIMITY_RADIUS_METERS,
          notifyOnEnter: true,
          notifyOnExit: false,
        }))
        .sort((a, b) => haversineMeters(currentLocation.lat, currentLocation.lng, a.latitude, a.longitude)
          - haversineMeters(currentLocation.lat, currentLocation.lng, b.latitude, b.longitude))
        .slice(0, IOS_MAX_GEOFENCES);
      const signature = regions.map((region) => region.identifier).join('\u0000');
      // Location updates arrive every few seconds on the foreground path.  Do
      // not churn Core Location's monitored-region registry on every fix; a
      // changed message/read set bypasses the throttle immediately.
      if (
        signature === lastGeofenceSignature
        && Date.now() - lastGeofenceSyncAt < GEOFENCE_SYNC_MIN_INTERVAL_MS
      ) return true;
      if (regions.length === 0) {
        if (await Location.hasStartedGeofencingAsync(IOS_GEOFENCE_TASK_NAME)) {
          await Location.stopGeofencingAsync(IOS_GEOFENCE_TASK_NAME);
        }
        lastGeofenceSyncAt = Date.now();
        lastGeofenceSignature = signature;
        return true;
      }
      await Location.startGeofencingAsync(IOS_GEOFENCE_TASK_NAME, regions);
      lastGeofenceSyncAt = Date.now();
      lastGeofenceSignature = signature;
      return true;
    } catch (error) {
      console.warn('[background-location] iOS geofence sync failed:', error);
      return false;
    }
  });
};
