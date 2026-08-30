import { Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  backgroundGuardian,
  isBackgroundGuardianAvailable,
  type BackgroundGuardianConfig,
} from '@/modules/background-guardian';
import { getApiBaseUrl } from '@/utils/api';

export type AndroidGuardianConfig = BackgroundGuardianConfig;

let guardianSyncQueue: Promise<boolean> = Promise.resolve(false);

/** Start or update the Android native foreground-service guardian. */
export const syncAndroidGuardian = async (args: {
  deviceId: string | null;
  token: string | null;
  readIds: Set<string>;
  appInForeground: boolean;
  amapPrivacyAccepted: boolean;
  initialEventCursor?: number;
  radius?: number;
}): Promise<boolean> => {
  if (Platform.OS !== 'android' || !args.deviceId || !isBackgroundGuardianAvailable) return false;
  const config: AndroidGuardianConfig = {
    baseUrl: getApiBaseUrl(),
    deviceId: args.deviceId,
    deviceToken: args.token,
    readIds: [...args.readIds],
    radiusMeters: args.radius ?? 50,
    appInForeground: args.appInForeground,
    // Persist the onboarding disclosure decision so a sticky service never
    // invents AMap consent after the JS process exits.
    amapPrivacyAccepted: args.amapPrivacyAccepted,
    pollIntervalMs: 30_000,
    initialEventCursor: args.initialEventCursor,
  };
  // React effects can refresh read ids, identity and visibility almost at the
  // same time. Serialize native writes so an older async call cannot overwrite
  // the newest guardian configuration after an identity switch.
  guardianSyncQueue = guardianSyncQueue.catch(() => false).then(async () => {
    try {
      // The native wrapper exposes start/updateConfig. Starting once persists a
      // sticky foreground service; subsequent calls only refresh its config.
      const running = await backgroundGuardian.isRunning();
      if (!running) {
        // Android 14 rejects a location FGS without active location permission
        // and system location services. Only start it from a visible Activity.
        if (!args.appInForeground) return false;
        const [foreground, servicesEnabled] = await Promise.all([
          Location.getForegroundPermissionsAsync(),
          Location.hasServicesEnabledAsync(),
        ]);
        if (foreground.status !== 'granted' || !servicesEnabled) return false;
        await backgroundGuardian.start(config);
      } else {
        await backgroundGuardian.updateConfig(config);
      }
      return true;
    } catch (error) {
      console.warn('[background-guardian] start/update failed:', error);
      return false;
    }
  });
  return guardianSyncQueue;
};

/** Whether Android's native service currently owns like polling and sounds. */
export const isAndroidGuardianRunning = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  try {
    return await backgroundGuardian.isRunning();
  } catch {
    return false;
  }
};

/** Read the native service's durable cursor before JS takes polling back. */
export const getAndroidGuardianEventCursor = async (): Promise<number | undefined> => {
  if (Platform.OS !== 'android' || !isBackgroundGuardianAvailable) return undefined;
  try {
    return await backgroundGuardian.getLastEventId();
  } catch {
    return undefined;
  }
};

export const stopAndroidGuardian = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  // Stop shares the same queue as start/update. Permission revocation can race
  // an async cursor handoff; ordering all native calls ensures the last React
  // state transition wins.
  guardianSyncQueue = guardianSyncQueue.catch(() => false).then(async () => {
    try {
      await backgroundGuardian.stop();
    } catch {
      // Best effort only; Android will stop the service if its permission is revoked.
    }
    return false;
  });
  await guardianSyncQueue;
};
