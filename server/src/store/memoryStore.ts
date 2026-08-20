import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Message, StoreShape, User } from '../types';
import { buildSeedMessages } from '../seeds';
import { randomFlowerName } from '../flowerNames';
import type { DataStore } from './index';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

/** 默认实现：内存 + JSON 文件持久化（mock 后端，行为与初版一致） */
export class MemoryStore implements DataStore {
  private state: StoreShape = { users: [], messages: [] };
  private saveTimer: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as StoreShape;
        if (Array.isArray(parsed.users) && Array.isArray(parsed.messages)) {
          this.state = parsed;
          console.log(`[store] loaded ${parsed.messages.length} messages, ${parsed.users.length} users (memory)`);
          return;
        }
      }
    } catch (e) {
      console.error('[store] load failed, reseeding:', e);
    }
    this.state = { users: [], messages: buildSeedMessages(Date.now()) };
    this.persist();
    console.log(`[store] seeded ${this.state.messages.length} messages (memory)`);
  }

  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
      } catch (e) {
        console.error('[store] persist failed:', e);
      }
    }, 200);
  }

  // 返回脱壳副本：调用方可自由改本地副本，再通过 addReader/addLike 落库
  private copyMessage(m: Message): Message {
    return { ...m, readers: [...m.readers], likes: [...m.likes] };
  }

  async listMessages(): Promise<Message[]> {
    return this.state.messages.map((m) => this.copyMessage(m));
  }

  async findMessage(id: string): Promise<Message | undefined> {
    const m = this.state.messages.find((x) => x.id === id);
    return m ? this.copyMessage(m) : undefined;
  }

  async findUser(deviceId: string): Promise<User | undefined> {
    return this.state.users.find((u) => u.deviceId === deviceId);
  }

  async ensureUser(deviceId: string): Promise<User> {
    let u = this.state.users.find((x) => x.deviceId === deviceId);
    if (!u) {
      u = { deviceId, flowerName: randomFlowerName(), renamed: false, createdAt: Date.now() };
      this.state.users.push(u);
      this.persist();
    }
    return u;
  }

  async renameUser(deviceId: string, flowerName: string): Promise<User | null> {
    const u = this.state.users.find((x) => x.deviceId === deviceId);
    if (!u || u.renamed) return null;
    u.flowerName = flowerName;
    u.renamed = true;
    this.persist();
    return u;
  }

  async createMessage(
    data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>
  ): Promise<Message> {
    const m: Message = {
      ...data,
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: Date.now(),
      readers: [],
      likes: [],
    };
    this.state.messages.push(m);
    this.persist();
    return this.copyMessage(m);
  }

  async addReader(messageId: string, deviceId: string): Promise<void> {
    const m = this.state.messages.find((x) => x.id === messageId);
    if (m && !m.readers.includes(deviceId)) {
      m.readers.push(deviceId);
      this.persist();
    }
  }

  async addLike(messageId: string, deviceId: string): Promise<void> {
    const m = this.state.messages.find((x) => x.id === messageId);
    if (m && !m.likes.includes(deviceId)) {
      m.likes.push(deviceId);
      this.persist();
    }
  }
}
