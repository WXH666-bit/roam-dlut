/**
 * 后端 API 客户端
 * baseURL 来自系统注入的 EXPO_PUBLIC_BACKEND_BASE_URL（对应 server/ Express 服务，端口 9091）
 */
import type { MessageMediaType } from './messageTypes';
import { createFormDataFile } from './index';

// 生产构建把 EXPO_PUBLIC_BACKEND_BASE_URL 指向公网后端；本地开发默认指向 mock 后端
const BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:9091';

export interface ApiUser {
  device_id: string;
  flower_name: string;
  renamed: boolean;
  /** 服务端设置 SERVER_SECRET 时签发；开信/点赞需通过 x-device-token 回传 */
  token?: string;
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
 * Body：device_id: string, text: string(≤140), media_type: 'none'|'image'|'video',
 *       media_key?: string, lat: number, lng: number
 */
export const publishMessage = async (payload: {
  deviceId: string;
  text: string;
  mediaType: MessageMediaType;
  mediaKey?: string;
  lat: number;
  lng: number;
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
 * Body：multipart FormData，字段 file（图片或视频，≤100MB）
 */
export const uploadMedia = async (
  fileUri: string,
  fileName: string,
  mimeType: string
): Promise<{ key: string; url: string }> => {
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
export const fetchUsersMe = async (deviceId: string): Promise<UsersMeResponse> => {
  const res = await fetch(
    `${BASE}/api/v1/users/me?device_id=${encodeURIComponent(deviceId)}`
  );
  if (!res.ok) throw await parseError(res);
  return res.json();
};
