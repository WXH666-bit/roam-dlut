import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type AmapCoordinateSystem = 'gcj02' | 'wgs84';

export interface AmapLocationEvent {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: number | null;
  coordinateSystem: AmapCoordinateSystem;
  locationType: number;
  isLive: boolean;
}

export interface AmapLocationErrorEvent {
  code: number;
  message: string;
}

export interface AmapLocationStartOptions {
  /** Must only be true after the user has accepted the disclosed AMap policy. */
  privacyAccepted: boolean;
  /** Continuous high-accuracy update interval. Native code clamps this value. */
  intervalMs?: number;
}

type EventSubscription = { remove(): void };

type AmapLocationNative = {
  start(options: AmapLocationStartOptions): Promise<boolean>;
  stop(): Promise<void>;
  isConfigured(): Promise<boolean>;
  addListener(
    eventName: 'onLocation',
    listener: (event: AmapLocationEvent) => void
  ): EventSubscription;
  addListener(
    eventName: 'onError',
    listener: (event: AmapLocationErrorEvent) => void
  ): EventSubscription;
};

const nativeModule: AmapLocationNative | null = Platform.OS === 'android'
  ? requireOptionalNativeModule<AmapLocationNative>('AmapLocation')
  : null;

export const isAmapLocationAvailable = nativeModule !== null;

export async function isAmapLocationConfigured(): Promise<boolean> {
  return (await nativeModule?.isConfigured()) ?? false;
}

export async function startAmapLocation(options: AmapLocationStartOptions): Promise<boolean> {
  return (await nativeModule?.start(options)) ?? false;
}

export async function stopAmapLocation(): Promise<void> {
  await nativeModule?.stop();
}

export function addAmapLocationListener(
  listener: (event: AmapLocationEvent) => void
): EventSubscription | null {
  return nativeModule?.addListener('onLocation', listener) ?? null;
}

export function addAmapLocationErrorListener(
  listener: (event: AmapLocationErrorEvent) => void
): EventSubscription | null {
  return nativeModule?.addListener('onError', listener) ?? null;
}
