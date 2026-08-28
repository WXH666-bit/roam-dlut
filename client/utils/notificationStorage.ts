/**
 * Notification/background-location state shared by the foreground React tree
 * and the iOS background task.  Keep these keys stable: changing them makes a
 * fresh install-like state on the next launch and can replay old events.
 */
export const READ_IDS_STORAGE_KEY = 'cidi:read_ids';
export const NOTIFICATION_CURSOR_STORAGE_KEY = 'cidi:notification_cursor';
export const NOTIFICATION_PUSH_EVENT_IDS_STORAGE_KEY = 'cidi:notification_push_event_ids';
export const PROXIMITY_NOTIFICATION_IDS_STORAGE_KEY = 'cidi:proximity_notification_ids';
export const APP_IN_FOREGROUND_STORAGE_KEY = 'cidi:app_in_foreground';
export const IOS_BACKGROUND_CONFIG_STORAGE_KEY = 'cidi:ios_background_config';

export const MAX_STORED_PROXIMITY_IDS = 500;
export const MAX_STORED_PUSH_EVENT_IDS = 500;

/** Identity-scoped keys prevent an identity reclaim from inheriting old events. */
export const notificationCursorStorageKey = (deviceId: string): string => (
  `${NOTIFICATION_CURSOR_STORAGE_KEY}:${deviceId}`
);

export const proximityNotificationIdsStorageKey = (deviceId: string): string => (
  `${PROXIMITY_NOTIFICATION_IDS_STORAGE_KEY}:${deviceId}`
);

export const notificationPushEventIdsStorageKey = (deviceId: string): string => (
  `${NOTIFICATION_PUSH_EVENT_IDS_STORAGE_KEY}:${deviceId}`
);
