export type MediaType = 'none' | 'image' | 'video';

export interface Message {
  id: string;
  deviceId: string;
  flowerName: string;
  text: string;
  mediaType: MediaType;
  mediaKey: string | null;
  lat: number;
  lng: number;
  createdAt: number;
  readers: string[];
  likes: string[];
}

export interface User {
  deviceId: string;
  flowerName: string;
  renamed: boolean;
  createdAt: number;
  // 三词暗号（身份找回唯一凭据，明文存储）；老用户由 ensureUser 惰性补发
  recoveryCode?: string;
}

export interface StoreShape {
  users: User[];
  messages: Message[];
}

export const isAlive = (
  m: Message,
  now: number,
  ttlMs: number,
  readLimit: number
): boolean => now - m.createdAt < ttlMs && m.readers.length < readLimit;
