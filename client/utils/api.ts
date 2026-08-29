/**
 * 后端 API 客户端
 * baseURL 来自系统注入的 EXPO_PUBLIC_BACKEND_BASE_URL（对应 server/ Express 服务，端口 9091）
 */
import type { MessageMediaType } from './messageTypes';
import { createFormDataFile } from './index';

// 生产构建把 EXPO_PUBLIC_BACKEND_BASE_URL 指向公网后端；本地开发默认指向 mock 后端
const BASE = (process.env.EXPO_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:9091').replace(/\/+$/, '');

/** Used by the native Android guardian, which cannot read Expo env values at runtime. */
export const getApiBaseUrl = (): string => BASE;

export interface ApiUser {
  device_id: string;
  flower_name: string;
  renamed: boolean;
  /** 服务端设置 SERVER_SECRET 时签发；开信/点赞需通过 x-device-token 回传 */
  token?: string;
  /** 三词暗号（身份找回凭据），注册时生成，老用户惰性补发 */
  recovery_code?: string;
}

export interface AliveMessageBrief {
  id: string;
  lat: number;
  lng: number;
  created_at: number;
}

export interface MessageDetail {
  id: string;
  text: string;
  media_type: MessageMediaType;
  media_url: string | null;
  flower_name: string;
  created_at: number;
  likes: number;
  liked: boolean;
  remaining: number;
  dissolved: boolean;
}

export interface MyMessageItem {
  id: string;
  text: string;
  media_type: MessageMediaType;
  media_key: string | null;
  lat: number;
  lng: number;
  created_at: number;
  read_count: number;
  likes: number;
  alive: boolean;
}

export interface FootprintItem {
  id: string;
  alive: boolean;
  text: string | null;
  media_type: MessageMediaType;
  media_key: string | null;
  flower_name: string;
  created_at: number;
}

export interface UsersMeResponse {
  user: ApiUser;
  my_messages: MyMessageItem[];
  footprints: FootprintItem[];
}

export type NotificationEventType = 'message_like';

export interface NotificationEvent {
  id: number;
  type: NotificationEventType;
  message_id: string;
  created_at: number;
}

export interface NotificationEventsResponse {
  events: NotificationEvent[];
  latest_id: number;
}

const parseError = async (res: Response): Promise<Error> => {
  try {
    const data = await res.json();
    if (data?.error) return new Error(String(data.error));
  } catch {
    // fallthrough
  }
  return new Error(`请求失败（${res.status}）`);
};

/**
 * 服务端文件：server/src/routes/users.ts
 * 接口：POST /api/v1/users
 * Body：device_id: string
 */
export const registerDevice = async (deviceId: string): Promise<ApiUser> => {
  const res = await fetch(`${BASE}/api/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/users.ts
 * 接口：PATCH /api/v1/users/me
 * Body：device_id: string, flower_name: string（1-12 字，仅可修改一次）
 */
export const renameFlowerName = async (deviceId: string, flowerName: string): Promise<ApiUser> => {
  const res = await fetch(`${BASE}/api/v1/users/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, flower_name: flowerName }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/users.ts
 * 接口：POST /api/v1/users/reclaim
 * Body：code: string（三词暗号，精确匹配；404=暗号不对，429=失败次数超限）
 */
export const reclaimIdentity = async (code: string): Promise<ApiUser> => {
  const res = await fetch(`${BASE}/api/v1/users/reclaim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/messages.ts
 * 接口：GET /api/v1/messages
 * Query：无（返回存活留言的 id/lat/lng/created_at，不含内容）
 */
export const fetchAliveMessages = async (): Promise<{
  list: AliveMessageBrief[];
  total: number;
  read_limit: number;
}> => {
  const res = await fetch(`${BASE}/api/v1/messages`);
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/messages.ts
 * 接口：GET /api/v1/messages/:id
 * Query：device_id: string（服务端按此去重计数阅读）
 */
export const openMessage = async (id: string, deviceId: string, token?: string | null): Promise<MessageDetail> => {
  const res = await fetch(
    `${BASE}/api/v1/messages/${encodeURIComponent(id)}?device_id=${encodeURIComponent(deviceId)}`,
    { headers: token ? { 'x-device-token': token } : undefined }
  );
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/messages.ts
 * 接口：POST /api/v1/messages
 * Body：device_id: string, text: string(≤140), media_type: 'none'|'image'|'video'|'audio',
 *       media_key?: string, lat/lng: WGS-84 coordinates,
 *       coordinate_system: 'wgs84', accuracy: number, captured_at: Unix ms
 */
export const publishMessage = async (payload: {
  deviceId: string;
  text: string;
  mediaType: MessageMediaType;
  mediaKey?: string;
  lat: number;
  lng: number;
  coordinateSystem: string;
  accuracy: number;
  capturedAt: number;
}): Promise<{ id: string; created_at: number }> => {
  const res = await fetch(`${BASE}/api/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: payload.deviceId,
      text: payload.text,
      media_type: payload.mediaType,
      media_key: payload.mediaKey,
      lat: payload.lat,
      lng: payload.lng,
      coordinate_system: payload.coordinateSystem,
      accuracy: payload.accuracy,
      captured_at: payload.capturedAt,
    }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/messages.ts
 * 接口：POST /api/v1/messages/:id/like
 * Body：device_id: string（去重幂等，需已解锁）
 */
export const likeMessage = async (
  id: string,
  deviceId: string,
  token?: string | null
): Promise<{ likes: number; liked: boolean }> => {
  const res = await fetch(`${BASE}/api/v1/messages/${encodeURIComponent(id)}/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-device-token': token } : {}) },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/upload.ts
 * 接口：POST /api/v1/upload
 * Body：multipart FormData，字段 file（图片、视频或音频，≤120MB）
 */
export const uploadMedia = async (
  fileUri: string,
  fileName: string,
  mimeType: string
): Promise<{ key: string; url: string; media_type: Exclude<MessageMediaType, 'none'> }> => {
  const form = new FormData();
  const file = await createFormDataFile(fileUri, fileName, mimeType);
  form.append('file', file as any);
  const res = await fetch(`${BASE}/api/v1/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端文件：server/src/routes/users.ts
 * 接口：GET /api/v1/users/me
 * Query：device_id: string
 */
export const fetchUsersMe = async (
  deviceId: string,
  token?: string | null
): Promise<UsersMeResponse> => {
  const res = await fetch(
    `${BASE}/api/v1/users/me?device_id=${encodeURIComponent(deviceId)}`,
    { headers: token ? { 'x-device-token': token } : undefined }
  );
  if (!res.ok) throw await parseError(res);
  return res.json();
};

/**
 * 服务端 API：GET /api/v1/notifications
 * 只返回事件类型和留言 id，不携带正文/坐标；通知正文由客户端使用固定文案生成。
 */
const NOTIFICATION_EVENT_REQUEST_TIMEOUT_MS = 15_000;

const fetchNotificationEventResponse = async (
  url: string,
  token?: string | null
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFICATION_EVENT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: token ? { 'x-device-token': token } : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchNotificationEvents = async (
  deviceId: string,
  afterId: number,
  token?: string | null
): Promise<NotificationEventsResponse> => {
  const res = await fetchNotificationEventResponse(
    `${BASE}/api/v1/notifications?device_id=${encodeURIComponent(deviceId)}&after_id=${encodeURIComponent(String(Math.max(0, Math.trunc(afterId))))}`,
    token
  );
  if (!res.ok) throw await parseError(res);
  const raw = await res.json() as {
    events?: unknown;
    latest_id?: unknown;
  };
  const events = Array.isArray(raw.events)
    ? raw.events.reduce<NotificationEvent[]>((list, item) => {
      if (!item || typeof item !== 'object') return list;
      const value = item as Record<string, unknown>;
      const id = Number(value.id);
      const messageId = String(value.message_id ?? value.messageId ?? '');
      const type = value.type === 'message_like' ? value.type : null;
      if (!Number.isSafeInteger(id) || id <= 0 || !messageId || !type) return list;
      list.push({
        id,
        type,
        message_id: messageId,
        created_at: Number(value.created_at ?? value.createdAt ?? 0),
      });
      return list;
    }, [])
    : [];
  const eventMax = events.reduce((max, event) => Math.max(max, event.id), 0);
  const latestId = Number(raw.latest_id);
  return {
    events,
    latest_id: Number.isSafeInteger(latestId) && latestId >= eventMax ? latestId : eventMax,
  };
};

/**
 * 服务端 API：PUT /api/v1/notifications/push-token
 * 目前仅 iOS 调用；Android 使用本地 guardian 轮询，避免依赖 FCM/厂商推送。
 */
const PUSH_TOKEN_REQUEST_TIMEOUT_MS = 15_000;

const mutateRemotePushToken = async (
  method: 'PUT' | 'DELETE',
  deviceId: string,
  pushToken: string,
  token?: string | null
): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUSH_TOKEN_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/v1/notifications/push-token`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-device-token': token } : {}) },
      body: JSON.stringify({ device_id: deviceId, token: pushToken }),
      signal: controller.signal,
    });
    if (!res.ok) throw await parseError(res);
  } finally {
    clearTimeout(timeout);
  }
};

export const registerRemotePushToken = async (
  deviceId: string,
  pushToken: string,
  token?: string | null
): Promise<void> => {
  await mutateRemotePushToken('PUT', deviceId, pushToken, token);
};

/** Remove an iOS token when the system rotates/revokes it. */
export const unregisterRemotePushToken = async (
  deviceId: string,
  pushToken: string,
  token?: string | null
): Promise<void> => {
  await mutateRemotePushToken('DELETE', deviceId, pushToken, token);
};
