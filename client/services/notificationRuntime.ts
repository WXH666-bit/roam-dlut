import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import {
  fetchNotificationEvents,
  registerRemotePushToken,
  unregisterRemotePushToken,
  type NotificationEvent,
} from '@/utils/api';
import {
  APP_IN_FOREGROUND_STORAGE_KEY,
  MAX_STORED_PUSH_EVENT_IDS,
  notificationCursorStorageKey,
  notificationPushEventIdsStorageKey,
} from '@/utils/notificationStorage';

let handlerConfigured = false;
let iosPushTokenOperationQueue: Promise<void> = Promise.resolve();

const queueIosPushTokenOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = iosPushTokenOperationQueue.catch(() => undefined).then(operation);
  iosPushTokenOperationQueue = result.then(() => undefined, () => undefined);
  return result;
};

/** Configure foreground presentation once. */
export const configureNotificationHandler = (): void => {
  if (handlerConfigured || Platform.OS === 'web') return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // A foreground like is handled by the bridge's playLike() path.  The
        // OS must not add a duplicate banner, while background pushes remain
        // visible because AppState is no longer active.
        shouldShowBanner: AppState.currentState !== 'active',
        shouldShowList: AppState.currentState !== 'active',
        shouldPlaySound: AppState.currentState !== 'active',
        shouldSetBadge: false,
      }),
    });
    handlerConfigured = true;
  } catch {
    // A missing/old native module must never prevent the main UI from loading.
  }
};

const isGranted = (status: unknown): boolean => status === 'granted';

/** Create the low-priority channels used by the persistent guardian and likes. */
export const configureNotificationChannels = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('cidi_guardian', {
      name: '守候定位',
      description: '后台感知附近留言所需的低优先级守候通知',
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      vibrationPattern: [0, 0],
      enableVibrate: false,
      showBadge: false,
    });
    await Notifications.setNotificationChannelAsync('cidi_like', {
      name: '留言动态',
      description: '有人喜欢你的留言时提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
      showBadge: true,
    });
    await Notifications.setNotificationChannelAsync('cidi_nearby', {
      name: '附近留言',
      description: '附近有新的未读留言时提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      showBadge: false,
    });
  } catch {
    // Channel setup is best effort; Android still lets the user manage channels.
  }
};

/** Request notification permission without making it a prerequisite for the app. */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  try {
    // Android 13+ only presents the runtime prompt after at least one channel
    // exists. Create channels before querying/requesting permission.
    await configureNotificationChannels();
    const current = await Notifications.getPermissionsAsync();
    if (isGranted(current.status)) {
      return true;
    }
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    return isGranted(requested.status);
  } catch {
    return false;
  }
};

export const getNotificationPermissionGranted = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  try {
    return isGranted((await Notifications.getPermissionsAsync()).status);
  } catch {
    return false;
  }
};

/**
 * Show a generic local notification.  Payloads deliberately contain only an
 * event type and id; no message text or coordinates are put on the lock screen.
 */
export const showLocalNotification = async (args: {
  type: 'nearby_message' | 'message_like';
  messageId?: string;
  playSound?: boolean;
  likeCount?: number;
  /** Rechecked immediately before handing the notification to native code. */
  shouldDeliver?: () => boolean;
}): Promise<boolean> => {
  if (Platform.OS === 'web' || (args.shouldDeliver && !args.shouldDeliver())) return false;
  try {
    const likeCount = Math.max(1, Math.trunc(args.likeCount ?? 1));
    await Notifications.scheduleNotificationAsync({
      content: {
        title: args.type === 'message_like'
          ? (likeCount > 1 ? `你的留言收到了 ${likeCount} 个新赞` : '有人喜欢了你的留言')
          : '附近有一封留言',
        body: args.type === 'message_like'
          ? '打开「此地有话」看看。'
          : '走近一些，打开「此地有话」看看。',
        sound: args.playSound ? 'default' : undefined,
        data: {
          type: args.type,
          ...(args.messageId ? { message_id: args.messageId } : {}),
        },
      },
      trigger: Platform.OS === 'android'
        ? { channelId: args.type === 'message_like' ? 'cidi_like' : 'cidi_nearby' }
        : null,
    });
    return true;
  } catch {
    // Notification permissions can be revoked between polling and delivery.
    return true;
  }
};

/** Register the Expo/APNs token.  Android intentionally never calls this. */
export const registerIosRemoteToken = async (
  deviceId: string,
  deviceToken?: string | null
): Promise<void> => {
  if (Platform.OS !== 'ios' || !deviceId) return;
  await queueIosPushTokenOperation(async () => {
    if (!(await getNotificationPermissionGranted())) return;
    try {
      const constants = Constants;
      const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
        ?? constants?.expoConfig?.extra?.eas?.projectId
        ?? constants?.easConfig?.projectId;
      const result = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      const pushToken = typeof result?.data === 'string' ? result.data : '';
      if (!pushToken) return;
      const storageKey = `cidi:ios_push_token:${deviceId}`;
      const previousPushToken = await AsyncStorage.getItem(storageKey);
      await registerRemotePushToken(deviceId, pushToken, deviceToken);
      if (previousPushToken && previousPushToken !== pushToken) {
        await unregisterRemotePushToken(deviceId, previousPushToken, deviceToken);
      }
      await AsyncStorage.setItem(storageKey, pushToken);
    } catch (error) {
      console.warn('[notifications] iOS push token registration unavailable:', error);
    }
  });
};

/** Remove this installation's token from a superseded identity after reclaim. */
export const unregisterIosRemoteToken = async (
  deviceId: string,
  deviceToken?: string | null
): Promise<void> => {
  if (Platform.OS !== 'ios' || !deviceId) return;
  await queueIosPushTokenOperation(async () => {
    try {
      const pushToken = await AsyncStorage.getItem(`cidi:ios_push_token:${deviceId}`);
      if (!pushToken) return;
      await unregisterRemotePushToken(deviceId, pushToken, deviceToken);
      await AsyncStorage.removeItem(`cidi:ios_push_token:${deviceId}`);
    } catch (error) {
      console.warn('[notifications] old iOS push token cleanup unavailable:', error);
    }
  });
};

export interface NotificationRuntimePayload {
  type?: string;
  messageId?: string;
  eventId?: number;
}

const parseNotificationPayload = (response: unknown): NotificationRuntimePayload | null => {
  const raw = response as {
    notification?: { request?: { content?: { data?: unknown } } };
    request?: { content?: { data?: unknown } };
  };
  // Response events wrap the notification under `notification`; received
  // events pass the Notification object directly under `request`.
  const data = raw.notification?.request?.content?.data ?? raw.request?.content?.data;
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  const eventId = Number(value.event_id ?? value.eventId);
  return {
    type: typeof value.type === 'string' ? value.type : undefined,
    messageId: typeof value.message_id === 'string'
      ? value.message_id
      : typeof value.messageId === 'string' ? value.messageId : undefined,
    eventId: Number.isSafeInteger(eventId) && eventId > 0 ? eventId : undefined,
  };
};

export const addNotificationResponseListener = (
  listener: (payload: NotificationRuntimePayload) => void
): (() => void) => {
  if (Platform.OS === 'web') return () => undefined;
  try {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const payload = parseNotificationPayload(response);
      if (payload) listener(payload);
    });
    return () => {
      try {
        subscription?.remove?.();
      } catch {
        // Ignore cleanup failures during hot reload.
      }
    };
  } catch {
    return () => undefined;
  }
};

/** Receive remote/local notifications while the JS app is foregrounded. */
export const addNotificationReceivedListener = (
  listener: (payload: NotificationRuntimePayload) => void
): (() => void) => {
  if (Platform.OS === 'web') return () => undefined;
  try {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const payload = parseNotificationPayload(notification);
      if (payload) listener(payload);
    });
    return () => {
      try {
        subscription?.remove?.();
      } catch {
        // Ignore cleanup failures during hot reload.
      }
    };
  } catch {
    return () => undefined;
  }
};

export const getLastNotificationResponse = async (): Promise<NotificationRuntimePayload | null> => {
  if (Platform.OS === 'web') return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    const payload = parseNotificationPayload(response);
    // Avoid reopening the same message if the root bridge remounts after OTA
    // or a navigation reset.
    Notifications.clearLastNotificationResponse?.();
    return payload;
  } catch {
    return null;
  }
};

const cursorFloor = new Map<string, number>();
const consumedEventIds = new Map<string, Set<number>>();
// A count, rather than a Set, gives each concurrent delivery of the same push
// its own barrier lease. A duplicate delivery may release only its lease; it
// must not clear the original delivery while that sound/banner is in flight.
const pendingPushEventIds = new Map<string, Map<number, number>>();
let pushEventPersistQueue: Promise<void> = Promise.resolve();

const readPersistedPushEventIds = async (deviceId: string): Promise<number[]> => {
  try {
    const raw = await AsyncStorage.getItem(notificationPushEventIdsStorageKey(deviceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
      .slice(-MAX_STORED_PUSH_EVENT_IDS);
  } catch {
    return [];
  }
};

const persistPushEventId = async (deviceId: string, eventId: number): Promise<boolean> => {
  let persisted = false;
  const operation = pushEventPersistQueue.then(async () => {
    const ids = await readPersistedPushEventIds(deviceId);
    if (ids.includes(eventId)) return;
    const next = [...ids, eventId].slice(-MAX_STORED_PUSH_EVENT_IDS);
    try {
      await AsyncStorage.setItem(notificationPushEventIdsStorageKey(deviceId), JSON.stringify(next));
    } catch {
      // The in-memory claim still prevents duplicates for this running process.
    }
    persisted = true;
  });
  pushEventPersistQueue = operation.catch(() => undefined);
  await operation;
  return persisted;
};

const readCursor = async (deviceId: string): Promise<number | null> => {
  try {
    const raw = await AsyncStorage.getItem(notificationCursorStorageKey(deviceId));
    const floor = cursorFloor.get(deviceId) ?? 0;
    if (raw === null) return floor > 0 ? floor : null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? Math.max(value, floor) : floor;
  } catch {
    const floor = cursorFloor.get(deviceId);
    return floor ?? null;
  }
};

const writeCursor = async (deviceId: string, value: number): Promise<void> => {
  const durableValue = Math.max(cursorFloor.get(deviceId) ?? 0, Math.trunc(value));
  cursorFloor.set(deviceId, durableValue);
  try {
    await AsyncStorage.setItem(
      notificationCursorStorageKey(deviceId),
      String(Math.max(0, durableValue))
    );
  } catch {
    // Cursor persistence is an optimization; a failed write must not block UI.
  }
};

const claimEvent = (deviceId: string, eventId: number): boolean => {
  let ids = consumedEventIds.get(deviceId);
  if (!ids) {
    ids = new Set<number>();
    consumedEventIds.set(deviceId, ids);
  }
  if (ids.has(eventId)) return false;
  ids.add(eventId);
  // Keep the in-memory race guard bounded; the persisted cursor handles older ids.
  if (ids.size > 2_000) {
    const oldest = ids.values().next().value;
    if (typeof oldest === 'number') ids.delete(oldest);
  }
  return true;
};

const releaseEventClaim = (deviceId: string, eventId: number): void => {
  consumedEventIds.get(deviceId)?.delete(eventId);
};

const markPushPending = (deviceId: string, eventId: number): void => {
  let counts = pendingPushEventIds.get(deviceId);
  if (!counts) {
    counts = new Map<number, number>();
    pendingPushEventIds.set(deviceId, counts);
  }
  counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
};

const clearPushPending = (deviceId: string, eventId: number): void => {
  const counts = pendingPushEventIds.get(deviceId);
  const count = counts?.get(eventId) ?? 0;
  if (count <= 1) counts?.delete(eventId);
  else counts?.set(eventId, count - 1);
  if (counts?.size === 0) pendingPushEventIds.delete(deviceId);
};

const isPushPending = (deviceId: string, eventId: number): boolean => (
  (pendingPushEventIds.get(deviceId)?.get(eventId) ?? 0) > 0
);

const hasPushPending = (deviceId: string): boolean => (
  (pendingPushEventIds.get(deviceId)?.size ?? 0) > 0
);

/**
 * Claim one foreground push without moving the polling high-water mark. Pushes
 * can arrive out of order, so only the ordered server poll is allowed to move
 * the cursor; otherwise event 10 arriving before event 9 would hide event 9.
 */
export const consumeNotificationEvent = async (
  deviceId: string,
  eventId: number
): Promise<boolean> => {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return false;
  // Establish the poll barrier before the first await. A foreground push and
  // the initial/resume suppression poll can start in the same JS turn; without
  // this synchronous marker, the poll could advance past the event while the
  // push was still reading its durable de-duplication state.
  markPushPending(deviceId, eventId);
  let claimed = false;
  // A foreground APNs delivery can arrive after the resume-suppression poll
  // has already advanced the ordered cursor. The callback itself proves that
  // iOS did not present this delivery as a background banner, so the cursor
  // alone must not suppress it. Durable delivered ids plus the in-process
  // claim still prevent actual duplicates.
  try {
    const persistedIds = await readPersistedPushEventIds(deviceId);
    if (persistedIds.includes(eventId) || !claimEvent(deviceId, eventId)) return false;
    claimed = true;
    return true;
  } finally {
    // A successfully claimed push stays pending until the sound/banner is
    // confirmed. Duplicate or stale pushes must release the barrier here.
    if (!claimed) clearPushPending(deviceId, eventId);
  }
};

/** Confirm only after the foreground sound or fallback local banner was triggered. */
export const confirmNotificationEvent = async (
  deviceId: string,
  eventId: number
): Promise<void> => {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return;
  try {
    await persistPushEventId(deviceId, eventId);
  } finally {
    clearPushPending(deviceId, eventId);
  }
};

const pollPromises = new Map<string, Promise<NotificationEvent[]>>();
const activePollOperations = new Map<string, Set<Promise<NotificationEvent[]>>>();

/** Release a foreground push claimed by an identity that changed mid-delivery. */
export const abandonNotificationEvent = async (
  deviceId: string,
  eventId: number
): Promise<void> => {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return;
  // Keep the pending barrier until an already-started silent/resume poll has
  // observed it. Otherwise that poll could jump its cursor past an event that
  // was abandoned before any sound or banner was actually requested.
  // This includes suppression calls queued behind the currently fetching
  // page, not just the one promise published in pollPromises. Loop because a
  // queued suppression call can start its own page as the previous one settles.
  while ((activePollOperations.get(deviceId)?.size ?? 0) > 0) {
    await Promise.allSettled([...(activePollOperations.get(deviceId) ?? [])]);
  }
  releaseEventClaim(deviceId, eventId);
  clearPushPending(deviceId, eventId);
};

// Preserve a fixed resume/first-run high-water mark until the ordered cursor
// reaches it. A numeric target (never an unresolved boolean/null intent)
// prevents a failed resume request from suppressing events created later.
const suppressionTargets = new Map<string, number>();

/**
 * Poll like events while the JS app is foregrounded.  The first poll and the
 * first poll after resuming only advance the cursor, so notifications already
 * shown by the OS are never replayed as an in-app sound.
 */
interface PollLikeEventsOptions {
  suppressSound?: boolean;
  /** Return false when the owning identity changed before delivery. */
  onEvents?: (events: NotificationEvent[]) => Promise<boolean | void>;
}

const runLikeEventPoll = async (
  deviceId: string,
  deviceToken: string | null | undefined,
  options: PollLikeEventsOptions
): Promise<NotificationEvent[]> => {
  const existing = pollPromises.get(deviceId);
  if (existing) {
    if (!options.suppressSound) return existing;
    // Never turn an already-fetched ordinary page into a silent page. Queue
    // the resume boundary behind it, then fetch a fresh fixed high-water mark.
    await existing;
    return runLikeEventPoll(deviceId, deviceToken, options);
  }
  const currentPromise = (async () => {
    try {
      const cursor = await readCursor(deviceId);
      const result = await fetchNotificationEvents(deviceId, cursor ?? 0, deviceToken);
      const orderedEvents = [...result.events].sort((a, b) => a.id - b.id);
      const pushedIds = new Set(await readPersistedPushEventIds(deviceId));
      const requestedSuppression = options.suppressSound === true || cursor === null;
      let suppressionTarget = suppressionTargets.get(deviceId);
      if (requestedSuppression) {
        // Capture only after a successful fetch. max() lets a second resume
        // extend an unfinished boundary without ever including later events
        // from an unrelated timer retry.
        suppressionTarget = Math.max(suppressionTarget ?? 0, result.latest_id);
        suppressionTargets.set(deviceId, suppressionTarget);
      }
      if (
        suppressionTarget !== undefined
        && cursor !== null && cursor >= suppressionTarget
      ) {
        suppressionTargets.delete(deviceId);
        suppressionTarget = undefined;
      }
      const suppressing = requestedSuppression
        || (suppressionTarget !== undefined && (cursor ?? 0) < suppressionTarget);
      const pendingIndex = orderedEvents.findIndex((event) => isPushPending(deviceId, event.id));
      // Do not advance across a push that has been claimed but whose sound or
      // fallback banner has not yet been confirmed by NotificationBridge.
      const eligibleEvents = pendingIndex >= 0
        ? orderedEvents.slice(0, pendingIndex)
        : orderedEvents;
      const processableEvents = suppressing && suppressionTarget !== undefined
        ? eligibleEvents.filter((event) => event.id <= suppressionTarget)
        : eligibleEvents;
      const pageMax = processableEvents.reduce(
        (max, event) => Math.max(max, event.id),
        cursor ?? 0
      );
      // latest_id may be the recipient's global high-water mark. Only jump to
      // it on initial/resume suppression; a normal foreground page must keep
      // its own page max or it would skip a backlog beyond the API limit.
      const latest = !hasPushPending(deviceId) && suppressing
        ? Math.max(cursor ?? 0, suppressionTarget ?? pageMax)
        : pageMax;
      // A suppression pass aligns the ordered cursor with notifications the OS
      // was expected to present while backgrounded. It must not claim those
      // ids: a delayed APNs callback received after resume still needs to make
      // a foreground sound.
      const freshEvents = suppressing
        ? []
        : processableEvents.filter((event) => (
          event.id > (cursor ?? 0) &&
          !pushedIds.has(event.id) &&
          claimEvent(deviceId, event.id)
        ));
      const audibleEvents = freshEvents.filter((event) => event.type === 'message_like');
      // Commit the page cursor only after the caller has actually triggered a
      // sound or a transition-time local banner. This closes the foreground →
      // background race where an effect cleanup used to swallow the event.
      if (!suppressing && audibleEvents.length > 0) {
        if (!options.onEvents) return audibleEvents;
        const delivered = await options.onEvents(audibleEvents);
        if (delivered === false) {
          // The React bridge changed logical identity while this request was
          // in flight. Leave the cursor unadvanced and release the claims so
          // returning to that identity can still deliver the events once.
          for (const event of freshEvents) releaseEventClaim(deviceId, event.id);
          return [];
        }
        // A later/out-of-order APNs copy of an event already sounded by the
        // foreground poll must remain de-duplicated across a process restart.
        for (const event of audibleEvents) {
          await persistPushEventId(deviceId, event.id);
        }
      }
      await writeCursor(deviceId, latest);
      if (
        suppressionTarget !== undefined
        && latest >= suppressionTarget
      ) {
        suppressionTargets.delete(deviceId);
      }
      if (suppressing) return [];
      return audibleEvents;
    } catch (error) {
      console.warn('[notifications] event poll failed:', error);
      return [];
    } finally {
      pollPromises.delete(deviceId);
    }
  })();
  pollPromises.set(deviceId, currentPromise);
  return currentPromise;
};

export const pollLikeEvents = (
  deviceId: string,
  deviceToken: string | null | undefined,
  options: PollLikeEventsOptions = {}
): Promise<NotificationEvent[]> => {
  if (!deviceId) return Promise.resolve([]);
  const operation = runLikeEventPoll(deviceId, deviceToken, options);
  let active = activePollOperations.get(deviceId);
  if (!active) {
    active = new Set<Promise<NotificationEvent[]>>();
    activePollOperations.set(deviceId, active);
  }
  active.add(operation);
  const remove = () => {
    active?.delete(operation);
    if (active?.size === 0) activePollOperations.delete(deviceId);
  };
  operation.then(remove, remove);
  return operation;
};

/**
 * Finish any in-flight JS poll and provide the exact cursor from which Android
 * native polling should take ownership. The first-ever cursor is initialized
 * silently so installing the new native base does not replay account history.
 */
export const prepareNotificationCursorForGuardian = async (
  deviceId: string,
  deviceToken: string | null | undefined
): Promise<number | undefined> => {
  const existing = pollPromises.get(deviceId);
  if (existing) await existing;
  let cursor = await readCursor(deviceId);
  if (cursor === null) {
    await pollLikeEvents(deviceId, deviceToken, { suppressSound: true });
    cursor = await readCursor(deviceId);
  }
  // Undefined lets the native service use its own first-success high-water
  // initialization if the server was unreachable during this handoff.
  return cursor ?? undefined;
};

/** Merge the native Android cursor back before JS resumes event polling. */
export const adoptNotificationCursorFromGuardian = async (
  deviceId: string,
  cursor: number
): Promise<void> => {
  if (!deviceId || !Number.isSafeInteger(cursor) || cursor < 0) return;
  await writeCursor(deviceId, cursor);
};

export const setAppInForeground = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(APP_IN_FOREGROUND_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Background task treats a missing flag as foreground-safe and will simply skip.
  }
};
