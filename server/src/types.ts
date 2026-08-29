import type { StoredLocationMetadata } from './location';

export type { CoordinateSystem, StoredLocationMetadata } from './location';

export type MediaType = 'none' | 'image' | 'video';

export interface Message extends StoredLocationMetadata {
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

export type NotificationEventType = 'message_like';

export interface NotificationEvent {
  /** A monotonically increasing server-side cursor. */
  id: number;
  type: NotificationEventType;
  recipientDeviceId: string;
  messageId: string;
  createdAt: number;
}

export interface LikeResult {
  added: boolean;
  notificationEvent: NotificationEvent | null;
}

export interface PushToken {
  deviceId: string;
  token: string;
  updatedAt: number;
}

export interface StoreShape {
  users: User[];
  messages: Message[];
  // Optional on disk so JSON files written by older versions remain readable.
  notificationEvents?: NotificationEvent[];
  pushTokens?: PushToken[];
}

export const isAlive = (
  m: Message,
  now: number,
  ttlMs: number,
  readLimit: number
): boolean => now - m.createdAt < ttlMs && m.readers.length < readLimit;
