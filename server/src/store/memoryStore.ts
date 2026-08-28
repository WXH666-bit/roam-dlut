import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  LikeResult,
  Message,
  NotificationEvent,
  PushToken,
  StoreShape,
  User,
} from '../types';
import { buildSeedMessages } from '../seeds';
import { randomFlowerName } from '../flowerNames';
import { randomRecoveryCode } from '../recoveryWords';
import { isExpoPushToken, MAX_PUSH_TOKENS_PER_DEVICE } from '../pushTokens';
import type { DataStore } from './index';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
/** 默认实现：内存 + JSON 文件持久化（mock 后端，行为与初版一致） */
export class MemoryStore implements DataStore {
  private state: StoreShape = { users: [], messages: [] };
  private saveTimer: NodeJS.Timeout | null = null;
  private nextNotificationEventId = 1;

  async init(): Promise<void> {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as StoreShape;
        if (Array.isArray(parsed.users) && Array.isArray(parsed.messages)) {
          this.state = parsed;
          this.state.notificationEvents ??= [];
          this.state.pushTokens ??= [];
          const originalPushTokens = this.state.pushTokens;
          const newestByToken = new Map<string, PushToken>();
          for (const entry of originalPushTokens) {
            if (
              !entry || typeof entry.deviceId !== 'string'
              || !Number.isFinite(entry.updatedAt) || !isExpoPushToken(entry.token)
            ) continue;
            const previous = newestByToken.get(entry.token);
            if (!previous || entry.updatedAt > previous.updatedAt) {
              newestByToken.set(entry.token, entry);
            }
          }
          const countByDevice = new Map<string, number>();
          this.state.pushTokens = [...newestByToken.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt || b.token.localeCompare(a.token))
            .filter((entry) => {
              const count = countByDevice.get(entry.deviceId) ?? 0;
              if (count >= MAX_PUSH_TOKENS_PER_DEVICE) return false;
              countByDevice.set(entry.deviceId, count + 1);
              return true;
            });
          this.nextNotificationEventId = this.nextEventIdAfter(
            this.state.notificationEvents
          );
          if (this.state.pushTokens.length !== originalPushTokens.length) {
            this.persistImmediately();
          }
          console.log(`[store] loaded ${parsed.messages.length} messages, ${parsed.users.length} users (memory)`);
          return;
        }
      }
    } catch (e) {
      console.error('[store] load failed, reseeding:', e);
    }
    this.state = {
      users: [],
      messages: buildSeedMessages(Date.now()),
      notificationEvents: [],
      pushTokens: [],
    };
    this.nextNotificationEventId = 1;
    this.persist();
    console.log(`[store] seeded ${this.state.messages.length} messages (memory)`);
  }

  private writeStateToDisk() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (e) {
      console.error('[store] persist failed:', e);
    }
  }

  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeStateToDisk();
    }, 200);
  }

  private persistImmediately() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.writeStateToDisk();
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

  async findUserByRecoveryCode(code: string): Promise<User | undefined> {
    return this.state.users.find((u) => u.recoveryCode === code);
  }

  // 生成不与存量用户冲突的暗号
  private freshRecoveryCode(): string {
    let code = randomRecoveryCode();
    while (this.state.users.some((u) => u.recoveryCode === code)) {
      code = randomRecoveryCode();
    }
    return code;
  }

  async ensureUser(deviceId: string): Promise<User> {
    let u = this.state.users.find((x) => x.deviceId === deviceId);
    if (!u) {
      u = {
        deviceId,
        flowerName: randomFlowerName(),
        renamed: false,
        createdAt: Date.now(),
        recoveryCode: this.freshRecoveryCode(),
      };
      this.state.users.push(u);
      this.persist();
    } else if (!u.recoveryCode) {
      // 老用户惰性补发暗号
      u.recoveryCode = this.freshRecoveryCode();
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

  async addLike(messageId: string, deviceId: string): Promise<boolean> {
    const m = this.state.messages.find((x) => x.id === messageId);
    if (!m || m.likes.includes(deviceId)) return false;
    m.likes.push(deviceId);
    this.persist();
    return true;
  }

  async addLikeAndCreateNotificationEvent(
    messageId: string,
    deviceId: string
  ): Promise<LikeResult> {
    const m = this.state.messages.find((x) => x.id === messageId);
    if (!m || m.likes.includes(deviceId)) {
      return { added: false, notificationEvent: null };
    }

    m.likes.push(deviceId);
    let notificationEvent: NotificationEvent | null = null;
    if (m.deviceId !== deviceId) {
      this.state.notificationEvents ??= [];
      notificationEvent = {
        id: this.nextNotificationEventId++,
        type: 'message_like',
        recipientDeviceId: m.deviceId,
        messageId: m.id,
        createdAt: Date.now(),
      };
      this.state.notificationEvents.push(notificationEvent);
    }

    // Keep the like and its event in one state transition and one immediate
    // disk write: a process exit in the old 200ms debounce window could leave
    // the successful like without its durable notification event.
    this.persistImmediately();
    return { added: true, notificationEvent: notificationEvent ? { ...notificationEvent } : null };
  }

  private nextEventIdAfter(events: NotificationEvent[]): number {
    let max = 0;
    for (const event of events) {
      if (Number.isSafeInteger(event.id) && event.id > max) max = event.id;
    }
    return max + 1;
  }

  async createNotificationEvent(
    data: Omit<NotificationEvent, 'id'>
  ): Promise<NotificationEvent> {
    this.state.notificationEvents ??= [];
    const event: NotificationEvent = {
      ...data,
      id: this.nextNotificationEventId++,
    };
    this.state.notificationEvents.push(event);
    this.persistImmediately();
    return { ...event };
  }

  async listNotificationEvents(
    recipientDeviceId: string,
    afterId: number,
    limit = 100,
    maxId?: number
  ): Promise<NotificationEvent[]> {
    const events = this.state.notificationEvents ?? [];
    return events
      .filter(
        (event) =>
          event.recipientDeviceId === recipientDeviceId &&
          event.id > afterId &&
          (maxId === undefined || event.id <= maxId)
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((event) => ({ ...event }));
  }

  async getLatestNotificationEventId(recipientDeviceId: string): Promise<number> {
    let latest = 0;
    for (const event of this.state.notificationEvents ?? []) {
      if (event.recipientDeviceId === recipientDeviceId && event.id > latest) {
        latest = event.id;
      }
    }
    return latest;
  }

  async registerPushToken(deviceId: string, token: string): Promise<void> {
    this.state.pushTokens ??= [];
    // A token identifies one installation. Rebinding it also handles identity
    // reclaim: an old device id must not continue receiving this installation's
    // notifications.
    this.state.pushTokens = this.state.pushTokens.filter((entry) => entry.token !== token);
    this.state.pushTokens.push({ deviceId, token, updatedAt: Date.now() });
    const newestForDevice = this.state.pushTokens
      .filter((entry) => entry.deviceId === deviceId)
      .sort((a, b) => {
        if (a.token === token) return -1;
        if (b.token === token) return 1;
        return b.updatedAt - a.updatedAt || b.token.localeCompare(a.token);
      })
      .slice(0, MAX_PUSH_TOKENS_PER_DEVICE);
    const keep = new Set(newestForDevice.map((entry) => entry.token));
    this.state.pushTokens = this.state.pushTokens.filter(
      (entry) => entry.deviceId !== deviceId || keep.has(entry.token)
    );
    this.persistImmediately();
  }

  async unregisterPushToken(deviceId: string, token: string): Promise<void> {
    const tokens = this.state.pushTokens ?? [];
    const next = tokens.filter(
      (entry) => !(entry.deviceId === deviceId && entry.token === token)
    );
    if (next.length !== tokens.length) {
      this.state.pushTokens = next;
      this.persistImmediately();
    }
  }

  async listPushTokens(deviceId: string): Promise<PushToken[]> {
    return (this.state.pushTokens ?? [])
      .filter((entry) => entry.deviceId === deviceId)
      .map((entry) => ({ ...entry }));
  }
}
