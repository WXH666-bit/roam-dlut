import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Message, StoreShape, User } from './types';
import { buildSeedMessages } from './seeds';
import { randomFlowerName } from './flowerNames';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

let state: StoreShape = { users: [], messages: [] };
let saveTimer: NodeJS.Timeout | null = null;

const persist = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) {
      console.error('[store] persist failed:', e);
    }
  }, 200);
};

export const initStore = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as StoreShape;
      if (Array.isArray(parsed.users) && Array.isArray(parsed.messages)) {
        state = parsed;
        console.log(`[store] loaded ${state.messages.length} messages, ${state.users.length} users`);
        return;
      }
    }
  } catch (e) {
    console.error('[store] load failed, reseeding:', e);
  }
  state = { users: [], messages: buildSeedMessages(Date.now()) };
  persist();
  console.log(`[store] seeded ${state.messages.length} messages`);
};

export const getMessages = (): Message[] => state.messages;
export const getUsers = (): User[] => state.users;

export const findMessage = (id: string): Message | undefined =>
  state.messages.find((m) => m.id === id);

export const findUser = (deviceId: string): User | undefined =>
  state.users.find((u) => u.deviceId === deviceId);

export const ensureUser = (deviceId: string): User => {
  let u = findUser(deviceId);
  if (!u) {
    u = { deviceId, flowerName: randomFlowerName(), renamed: false, createdAt: Date.now() };
    state.users.push(u);
    persist();
  }
  return u;
};

export const renameUser = (deviceId: string, flowerName: string): User | null => {
  const u = findUser(deviceId);
  if (!u || u.renamed) return null;
  u.flowerName = flowerName;
  u.renamed = true;
  persist();
  return u;
};

export const createMessage = (
  data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>
): Message => {
  const m: Message = {
    ...data,
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    readers: [],
    likes: [],
  };
  state.messages.push(m);
  persist();
  return m;
};

export const touchMessage = () => persist();
export const touchUser = () => persist();
