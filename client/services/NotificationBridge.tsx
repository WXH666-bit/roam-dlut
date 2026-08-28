import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, type AppStateStatus } from 'react-native';
import { LetterOverlay } from '@/components/LetterOverlay';
import { useApp } from '@/contexts/AppContext';
import { playLike } from '@/utils/sound';
import { READ_IDS_STORAGE_KEY } from '@/utils/notificationStorage';
import {
  abandonNotificationEvent,
  addNotificationResponseListener,
  addNotificationReceivedListener,
  adoptNotificationCursorFromGuardian,
  confirmNotificationEvent,
  consumeNotificationEvent,
  configureNotificationChannels,
  configureNotificationHandler,
  getLastNotificationResponse,
  pollLikeEvents,
  prepareNotificationCursorForGuardian,
  registerIosRemoteToken,
  requestNotificationPermission,
  setAppInForeground,
  showLocalNotification,
  type NotificationRuntimePayload,
  unregisterIosRemoteToken,
} from './notificationRuntime';
import {
  PROXIMITY_RADIUS_METERS,
  startIosBackgroundLocation,
  stopIosBackgroundLocation,
  stopIosGeofences,
  syncIosGeofences,
} from './backgroundLocation';
import {
  getAndroidGuardianEventCursor,
  isAndroidGuardianRunning,
  stopAndroidGuardian,
  syncAndroidGuardian,
} from './androidGuardian';

const PERMISSION_GUIDE_KEY = 'cidi:permission_guide_v1';
const POLL_INTERVAL_MS = 30_000;

const waitForChoice = (title: string, message: string): Promise<boolean> => new Promise((resolve) => {
  Alert.alert(
    title,
    message,
    [
      { text: '暂不', style: 'cancel', onPress: () => resolve(false) },
      { text: '继续开启', onPress: () => resolve(true) },
    ],
    { cancelable: true, onDismiss: () => resolve(false) }
  );
});

/** Android 11+ opens the system settings page for background location. */
const requestBackgroundLocation = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  try {
    let foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      foreground = await Location.requestForegroundPermissionsAsync();
    }
    if (foreground.status !== 'granted') return false;

    let background = await Location.getBackgroundPermissionsAsync();
    if (background.status === 'granted') return true;

    if (Platform.OS === 'android' && Number(Platform.Version) >= 30) {
      const confirmed = await waitForChoice(
        '允许后台守候',
        '为了在你暂时离开「此地有话」时发现 50 米内的留言，请在接下来的系统页面中选择“始终允许”。不想开启也不影响正常使用。'
      );
      if (!confirmed) return false;
      background = await Location.requestBackgroundPermissionsAsync();
      return background.status === 'granted';
    }

    if (Platform.OS === 'ios') {
      const confirmed = await waitForChoice(
        '允许始终访问位置',
        '开启“始终允许”后，App 关闭时也能守候附近留言。位置只用于附近 50 米判断，不会上传轨迹。'
      );
      if (!confirmed) return false;
    }
    background = await Location.requestBackgroundPermissionsAsync();
    return background.status === 'granted';
  } catch (error) {
    console.warn('[notifications] background location permission unavailable:', error);
    return false;
  }
};

const showPermissionGuideOnce = async (): Promise<boolean> => {
  try {
    if (await AsyncStorage.getItem(PERMISSION_GUIDE_KEY)) return true;
    const accepted = await waitForChoice(
      '开启通知与后台守候',
      '开启通知，你会知道有人喜欢了你的留言；允许始终访问位置，App 不在前台时也能提醒附近 50 米内的新留言。两项权限都可以稍后在系统设置里修改。'
    );
    await AsyncStorage.setItem(PERMISSION_GUIDE_KEY, '1');
    return accepted;
  } catch {
    return false;
  }
};

const extractMessageId = (payload: { messageId?: string }): string | null => (
  typeof payload.messageId === 'string' && payload.messageId.length > 0 ? payload.messageId : null
);

const extractMessageIdFromUrl = (url: string): string | null => {
  try {
    const parsed = Linking.parse(url);
    const value = parsed.queryParams?.messageId ?? parsed.queryParams?.message_id;
    if (typeof value === 'string' && value) return value;
  } catch {
    // Fall back to a small query parser for mocked/web URL implementations.
  }
  const match = /[?&]message_?id=([^&#]+)/i.exec(url);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

/**
 * Root-level bridge for OS notifications, background location and like-event
 * polling. It deliberately renders no UI except a letter opened from a tapped
 * notification, so permission failures cannot block the normal app flow.
 */
export function NotificationBridge() {
  const router = useRouter();
  const {
    onboarded,
    deviceId,
    deviceToken,
    location,
    aliveMessages,
    readIds,
    readIdsReady,
  } = useApp();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [permissionRevision, setPermissionRevision] = useState(0);
  const [backgroundLocationGranted, setBackgroundLocationGranted] = useState(false);
  const [openedMessageId, setOpenedMessageId] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const routerRef = useRef(router);
  const suppressNextPollRef = useRef(true);
  const previousDeviceIdRef = useRef<string | null>(null);
  const previousDeviceTokenRef = useRef<string | null>(null);
  const androidGuardianHandoffCountRef = useRef(0);
  const androidGuardianOwnedEventsRef = useRef(false);
  const pendingLikePayloadsRef = useRef<NotificationRuntimePayload[]>([]);
  const renderedIdentityRef = useRef(deviceId);
  const identityGenerationRef = useRef(0);
  if (renderedIdentityRef.current !== deviceId) {
    renderedIdentityRef.current = deviceId;
    identityGenerationRef.current += 1;
  }
  const identityGeneration = identityGenerationRef.current;

  // Keep navigation current without making the OS listener effects resubscribe
  // whenever expo-router returns a new router object.
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Configure presentation and handle cold-start/tapped notification responses.
  useEffect(() => {
    configureNotificationHandler();
    void configureNotificationChannels();
    const openMessage = (payload: { messageId?: string }) => {
      const id = extractMessageId(payload);
      if (!id) return;
      routerRef.current.replace('/');
      // Let the stack settle before mounting the modal above it.
      setTimeout(() => setOpenedMessageId(id), 0);
    };
    const remove = addNotificationResponseListener(openMessage);
    let cancelled = false;
    void getLastNotificationResponse().then((payload) => {
      if (!cancelled && payload) openMessage(payload);
    });
    return () => {
      cancelled = true;
      remove();
    };
  }, []);

  // Android's native foreground service opens the cidi:// deep link directly,
  // so it does not pass through expo-notifications' response listener.
  useEffect(() => {
    const openUrl = (url: string | null) => {
      if (!url) return;
      const id = extractMessageIdFromUrl(url);
      if (!id) return;
      routerRef.current.replace('/');
      setTimeout(() => setOpenedMessageId(id), 0);
    };
    let cancelled = false;
    void Linking.getInitialURL().then((url) => {
      if (!cancelled) openUrl(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => openUrl(url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const handleForegroundLikePayload = useCallback((payload: NotificationRuntimePayload) => {
    if (!deviceId) {
      // AppContext restores the installation identity asynchronously. Keep a
      // foreground push until that restore completes, otherwise the initial
      // suppress poll could advance past an event the user never heard.
      const pending = pendingLikePayloadsRef.current;
      const duplicate = payload.eventId
        ? pending.some((entry) => entry.eventId === payload.eventId)
        : false;
      if (!duplicate) {
        pending.push(payload);
      }
      return;
    }

    void (async () => {
      const identityIsCurrent = () => (
        identityGenerationRef.current === identityGeneration
        && renderedIdentityRef.current === deviceId
      );
      if (!identityIsCurrent()) return;
      const eventId = payload.eventId;
      if (eventId) {
        const fresh = await consumeNotificationEvent(deviceId, eventId);
        if (!fresh) return;
        if (!identityIsCurrent()) {
          // Clearing the pending barrier without confirming delivery lets the
          // old identity's ordered poll retry if that identity is restored.
          await abandonNotificationEvent(deviceId, eventId);
          return;
        }
        if (appStateRef.current === 'active') {
          const played = await playLike(identityIsCurrent);
          if (!played) {
            await abandonNotificationEvent(deviceId, eventId);
            return;
          }
        } else {
          // The push arrived while foreground presentation was suppressed,
          // but the app moved away before playback. Replace it with a local
          // banner so the event cannot disappear in the transition.
          const scheduled = await showLocalNotification({
            type: 'message_like',
            messageId: payload.messageId,
            playSound: true,
            shouldDeliver: identityIsCurrent,
          });
          if (!scheduled) {
            await abandonNotificationEvent(deviceId, eventId);
            return;
          }
        }
        await confirmNotificationEvent(deviceId, eventId);
        return;
      }

      // Be tolerant of an older server payload without event_id. There is no
      // identity to de-duplicate, so deliver it once and silently align poll.
      if (!identityIsCurrent()) return;
      if (appStateRef.current === 'active') {
        if (!(await playLike(identityIsCurrent))) return;
      } else {
        const scheduled = await showLocalNotification({
          type: 'message_like',
          messageId: payload.messageId,
          playSound: true,
          shouldDeliver: identityIsCurrent,
        });
        if (!scheduled) return;
      }
      if (!identityIsCurrent()) return;
      await pollLikeEvents(deviceId, deviceToken, { suppressSound: true });
    })();
  }, [deviceId, deviceToken, identityGeneration]);

  // A remote push arriving while the app is visible should be a sound only;
  // the push payload carries the event id so the next 30-second poll cannot
  // play it a second time.
  useEffect(() => {
    // Android deliberately has no remote-token registration: its native
    // guardian owns event polling and notification delivery end to end.
    if (Platform.OS !== 'ios') return undefined;
    return addNotificationReceivedListener((payload) => {
      if (payload.type !== 'message_like' || appStateRef.current !== 'active') return;
      handleForegroundLikePayload(payload);
    });
  }, [handleForegroundLikePayload]);

  // Drain cold-start pushes before the foreground polling effect below gets a
  // chance to run its initial suppression pass. consumeNotificationEvent()
  // installs its barrier synchronously for every queued event.
  useEffect(() => {
    if (!deviceId || pendingLikePayloadsRef.current.length === 0) return;
    const pending = pendingLikePayloadsRef.current.splice(0);
    pending.forEach(handleForegroundLikePayload);
  }, [deviceId, handleForegroundLikePayload]);

  // Persist app visibility for background tasks and suppress old events on resume.
  useEffect(() => {
    void setAppInForeground(appStateRef.current === 'active');
    const sub = AppState.addEventListener('change', (nextState) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;
      setAppState(nextState);
      void setAppInForeground(nextState === 'active');
      if (!wasActive && nextState === 'active') suppressNextPollRef.current = true;
    });
    return () => sub.remove();
  }, []);

  // Explain permissions only after onboarding, then request them in a readable order.
  useEffect(() => {
    if (!onboarded || !deviceId || Platform.OS === 'web') return;
    let cancelled = false;
    void (async () => {
      const accepted = await showPermissionGuideOnce();
      if (cancelled) return;
      // “暂不” really defers both permission flows until a later launch.
      if (!accepted) return;
      await requestNotificationPermission();
      // Even if notification permission is declined, try the location flow: the
      // core app and the Android guardian remain useful without notifications.
      const locationGranted = await requestBackgroundLocation();
      if (!cancelled) {
        setBackgroundLocationGranted(locationGranted);
        setPermissionRevision((revision) => revision + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onboarded, deviceId]);

  // Pick up a permission changed manually in Settings when the app becomes
  // active again. A denied “Always” permission never starts the guardian.
  useEffect(() => {
    if (permissionRevision === 0 || appState !== 'active' || Platform.OS === 'web') return;
    let cancelled = false;
    void Location.getBackgroundPermissionsAsync().then((permission) => {
      if (!cancelled) setBackgroundLocationGranted(permission.status === 'granted');
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appState, permissionRevision]);

  // iOS is the only platform registering an APNs/Expo remote token.
  useEffect(() => {
    if (
      !onboarded || !deviceId || permissionRevision === 0
      || Platform.OS !== 'ios' || appState !== 'active'
    ) return;
    void registerIosRemoteToken(deviceId, deviceToken);
  }, [onboarded, deviceId, deviceToken, appState, permissionRevision]);

  // A reclaim changes the logical identity but not the physical APNs token;
  // remove the old mapping before registering it for the new identity.
  useEffect(() => {
    const previousId = previousDeviceIdRef.current;
    if (Platform.OS === 'ios' && previousId && deviceId && previousId !== deviceId) {
      void unregisterIosRemoteToken(previousId, previousDeviceTokenRef.current);
    }
    previousDeviceIdRef.current = deviceId;
    previousDeviceTokenRef.current = deviceToken;
  }, [deviceId, deviceToken]);

  // Keep the Android service's identity config current after a reclaim, token
  // refresh, read-id change or visibility transition. iOS serializes and
  // writes its own config in startIosBackgroundLocation below.
  useEffect(() => {
    if (
      !onboarded || !deviceId || permissionRevision === 0 ||
      !backgroundLocationGranted || Platform.OS !== 'android'
    ) return;
    const inForeground = appState === 'active';
    let cancelled = false;
    void (async () => {
      const ownsAndroidHandoff = Platform.OS === 'android';
      if (ownsAndroidHandoff) androidGuardianHandoffCountRef.current += 1;
      try {
        const initialEventCursor = ownsAndroidHandoff
          ? await prepareNotificationCursorForGuardian(deviceId, deviceToken)
          : undefined;
        if (cancelled) return;
        const guardianOwnsEvents = await syncAndroidGuardian({
          deviceId,
          token: deviceToken,
          readIds,
          radius: PROXIMITY_RADIUS_METERS,
          appInForeground: inForeground,
          initialEventCursor,
        });
        if (cancelled) return;
        if (guardianOwnsEvents) {
          androidGuardianOwnedEventsRef.current = true;
        } else {
          if (initialEventCursor !== undefined) {
            // prepareNotificationCursorForGuardian already established the
            // exact JS baseline when the server was reachable.
            await adoptNotificationCursorFromGuardian(deviceId, initialEventCursor);
            if (cancelled) return;
          }
          // Even if no baseline was available, do not add another explicit
          // suppression pass. pollLikeEvents still initializes a truly new
          // cursor silently, while an existing cursor can deliver new likes.
          suppressNextPollRef.current = false;
        }
      } finally {
        if (ownsAndroidHandoff) {
          androidGuardianHandoffCountRef.current = Math.max(
            0,
            androidGuardianHandoffCountRef.current - 1
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    onboarded,
    deviceId,
    deviceToken,
    readIds,
    appState,
    permissionRevision,
    backgroundLocationGranted,
  ]);

  // Respect a revoked/declined background permission even if a previous app
  // session had already started native monitoring.
  useEffect(() => {
    if (backgroundLocationGranted) return;
    void stopAndroidGuardian();
    void stopIosBackgroundLocation();
    void stopIosGeofences();
  }, [backgroundLocationGranted]);

  // AppContext normally persists on markRead; this second writer closes the
  // startup race so the headless iOS task sees the restored set as well.  Wait
  // for hydration to avoid overwriting saved ids with the initial empty set.
  useEffect(() => {
    if (!deviceId || !readIdsReady) return;
    AsyncStorage.setItem(READ_IDS_STORAGE_KEY, JSON.stringify([...readIds])).catch(() => undefined);
  }, [deviceId, readIds, readIdsReady]);

  // Start iOS continuous updates and keep its 20-region nearest-message fallback fresh.
  useEffect(() => {
    if (
      !onboarded || !deviceId || permissionRevision === 0 ||
      !backgroundLocationGranted || Platform.OS !== 'ios'
    ) return;
    let cancelled = false;
    void (async () => {
      const started = await startIosBackgroundLocation({
        deviceId,
        deviceToken,
        radius: PROXIMITY_RADIUS_METERS,
      });
      if (!cancelled && started) await syncIosGeofences(location, aliveMessages, readIds);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    onboarded,
    deviceId,
    deviceToken,
    location,
    aliveMessages,
    readIds,
    permissionRevision,
    backgroundLocationGranted,
  ]);

  // Poll likes only while the JS app is active. First activation/resume advances
  // the cursor silently; new foreground events after that get the like sound.
  useEffect(() => {
    if (!onboarded || !deviceId || appState !== 'active') return;
    let cancelled = false;
    const poll = async () => {
      // The Android native guardian owns both foreground sounds and background
      // banners while it is alive. Keeping JS silent avoids two independent
      // cursors playing the same like twice. If it later stops, the first JS
      // fallback poll advances silently past events the native service handled.
      if (Platform.OS === 'android' && androidGuardianHandoffCountRef.current > 0) return;
      if (Platform.OS === 'android') {
        const guardianRunning = await isAndroidGuardianRunning();
        if (cancelled || androidGuardianHandoffCountRef.current > 0) return;
        if (guardianRunning) {
          androidGuardianOwnedEventsRef.current = true;
          return;
        }
        if (androidGuardianOwnedEventsRef.current) {
          const nativeCursor = await getAndroidGuardianEventCursor();
          if (cancelled || androidGuardianHandoffCountRef.current > 0) return;
          if (nativeCursor !== undefined) {
            await adoptNotificationCursorFromGuardian(deviceId, nativeCursor);
            if (cancelled || androidGuardianHandoffCountRef.current > 0) return;
          }
          // Prefer a possible duplicate over silently dropping a new like in
          // the exceptional case where the native cursor cannot be read.
          suppressNextPollRef.current = false;
          androidGuardianOwnedEventsRef.current = false;
        }
        const guardianRestarted = await isAndroidGuardianRunning();
        if (cancelled || androidGuardianHandoffCountRef.current > 0) return;
        if (guardianRestarted) {
          androidGuardianOwnedEventsRef.current = true;
          return;
        }
      }
      if (cancelled || (Platform.OS === 'android' && androidGuardianHandoffCountRef.current > 0)) return;
      const suppressSound = suppressNextPollRef.current;
      suppressNextPollRef.current = false;
      await pollLikeEvents(deviceId, deviceToken, {
        suppressSound,
        onEvents: async (events) => {
          const identityIsCurrent = () => (
            identityGenerationRef.current === identityGeneration
            && renderedIdentityRef.current === deviceId
          );
          if (!identityIsCurrent()) return false;
          const likeEvents = events.filter((event) => event.type === 'message_like');
          if (likeEvents.length === 0) return true;
          if (appStateRef.current === 'active') {
            // A single cue represents this poll batch instead of stacking
            // several copies of the same sound on top of each other.
            if (!(await playLike(identityIsCurrent))) return false;
          } else {
            const scheduled = await showLocalNotification({
              type: 'message_like',
              messageId: likeEvents.length === 1 ? likeEvents[0].message_id : undefined,
              playSound: true,
              likeCount: likeEvents.length,
              shouldDeliver: identityIsCurrent,
            });
            if (!scheduled) return false;
          }
          return true;
        },
      });
      if (cancelled) return;
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [onboarded, deviceId, deviceToken, appState, identityGeneration]);

  return openedMessageId ? (
    <LetterOverlay messageId={openedMessageId} onClose={() => setOpenedMessageId(null)} />
  ) : null;
}
