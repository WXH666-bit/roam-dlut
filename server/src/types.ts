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
