import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface BackgroundGuardianConfig {
  /** The server origin, for example `https://example.test`. */
  baseUrl: string;
  /** The current installation/identity id used by the API. */
  deviceId: string;
  /** Optional identity token sent as `x-device-token`. */
  deviceToken?: string | null;
  /** Backwards-compatible alias used by the app service wrapper. */
  token?: string | null;
  /** Message ids already opened by this installation. */
  readIds: string[];
  /** Nearby threshold in metres. Defaults to 50. */
  radiusMeters?: number;
  /** Backwards-compatible alias used by the app service wrapper. */
  radius?: number;
  /** Whether the JS app is currently visible. */
  appInForeground?: boolean;
  /** Set only after the app's onboarding/privacy disclosure has been accepted. */
  amapPrivacyAccepted?: boolean;
  /** Optional polling interval. The native default is 30 seconds. */
  pollIntervalMs?: number;
  /** JS event cursor captured immediately before native polling takes ownership. */
  initialEventCursor?: number;
}

type BackgroundGuardianNative = {
  start(config: BackgroundGuardianConfig): Promise<void>;
  updateConfig(config: BackgroundGuardianConfig): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  getLastEventId(): Promise<number | null>;
};

// This module intentionally has no iOS implementation. The wrapper is a no-op on
// iOS so the app can share its orchestration code while using the platform's
// native/background-location path there.
const nativeModule: BackgroundGuardianNative | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<BackgroundGuardianNative>('BackgroundGuardian')
    : null;

const normalizeConfig = (config: BackgroundGuardianConfig): BackgroundGuardianConfig => ({
  ...config,
  deviceToken: config.deviceToken ?? config.token ?? null,
  radiusMeters: config.radiusMeters ?? config.radius ?? 50,
});

export async function start(config: BackgroundGuardianConfig): Promise<void> {
  await nativeModule?.start(normalizeConfig(config));
}

export async function updateConfig(config: BackgroundGuardianConfig): Promise<void> {
  await nativeModule?.updateConfig(normalizeConfig(config));
}

export async function stop(): Promise<void> {
  await nativeModule?.stop();
}

export async function isRunning(): Promise<boolean> {
  return (await nativeModule?.isRunning()) ?? false;
}

export async function getLastEventId(): Promise<number | undefined> {
  const value = await nativeModule?.getLastEventId();
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export const backgroundGuardian = {
  start,
  updateConfig,
  stop,
  isRunning,
  getLastEventId,
  startGuardian: start,
  updateGuardian: updateConfig,
  update: updateConfig,
  stopGuardian: stop,
};

export const isBackgroundGuardianAvailable = nativeModule !== null;

// Aliases make the module tolerant of the short-lived bridge names used by
// older JS callers while keeping the documented API above canonical.
export const startGuardian = start;
export const updateGuardian = updateConfig;
export const update = updateConfig;
export const stopGuardian = stop;

export default backgroundGuardian;
