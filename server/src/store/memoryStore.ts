import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  BanMode,
  DeviceModeration,
  LikeResult,
  MediaCleanupTask,
  MediaUploadRecord,
  Message,
  ModerationOutcome,
  ModerationReviewResult,
  NotificationEvent,
  PushToken,
  ReviewPendingMessageInput,
  StoreShape,
  UploadMediaType,
  User,
} from '../types';
import { BUILT_IN_SEED_MESSAGE_IDS, buildSeedMessages } from '../seeds';
import { randomFlowerName } from '../flowerNames';
import { randomRecoveryCode } from '../recoveryWords';
import { isExpoPushToken, MAX_PUSH_TOKENS_PER_DEVICE } from '../pushTokens';
import { gcj02ToWgs84, WGS84_COORDINATE_SYSTEM } from '../location';
import type { DataStore } from './index';
import {
  restrictionAfterConfirmedViolation,
  restrictionAfterManualBan,
  unbannedRestriction,
} from '../moderationPolicy';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const BUILT_IN_SEED_MESSAGE_ID_SET = new Set(BUILT_IN_SEED_MESSAGE_IDS);
const isUploadMediaType = (value: unknown): value is UploadMediaType =>
  value === 'image' || value === 'video' || value === 'audio';

const normalizeUploadAttempts = (value: unknown): number => {
  const attempts = Number(value);
  return Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0;
};

const normalizeUploadError = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, 500) : null;

const normalizeUploadUpdatedAt = (value: unknown, fallback: unknown): number => {
  const updatedAt = Number(value);
  if (Number.isFinite(updatedAt)) return Math.trunc(updatedAt);
  const createdAt = Number(fallback);
  return Number.isFinite(createdAt) ? Math.trunc(createdAt) : Date.now();
};

const normalizeUploadCleanupLease = (value: unknown): number | null => {
  const leaseUntil = Number(value);
  return Number.isFinite(leaseUntil) && leaseUntil > 0 ? Math.trunc(leaseUntil) : null;
};
/** 默认实现：内存 + JSON 文件持久化（mock 后端，行为与初版一致） */
export class MemoryStore implements DataStore {
  private state: StoreShape = { users: [], messages: [] };
  private saveTimer: NodeJS.Timeout | null = null;
  private nextNotificationEventId = 1;
  private readonly dataFile: string;

  constructor(dataFile = DATA_FILE) {
    this.dataFile = dataFile;
  }

  async init(): Promise<void> {
    try {
      if (fs.existsSync(this.dataFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8')) as StoreShape;
        if (Array.isArray(parsed.users) && Array.isArray(parsed.messages)) {
          this.state = parsed;
          this.state.notificationEvents ??= [];
          this.state.pushTokens ??= [];
          this.state.deviceModeration ??= [];
          this.state.moderationReviews ??= [];
          this.state.mediaCleanupTasks = Array.isArray(this.state.mediaCleanupTasks)
            ? this.state.mediaCleanupTasks
            : [];
          const hadMediaUploads = Array.isArray(this.state.mediaUploads);
          this.state.mediaUploads = hadMediaUploads ? this.state.mediaUploads : [];
          // The reserved built-in demo rows predate the coordinate contract
          // and were authored in GCJ-02. Convert only those rows once; legacy
          // user messages remain untouched because native clients used WGS-84.
          let migratedSeedLocations = 0;
          let migratedModerationRows = 0;
          for (const message of this.state.messages) {
            const rawStatus = (message as Message & { moderationStatus?: unknown }).moderationStatus;
            if (rawStatus !== 'published' && rawStatus !== 'pending') {
              message.moderationStatus = rawStatus == null ? 'published' : 'pending';
              migratedModerationRows += 1;
            }
            if (
              message.deviceId !== 'seed-device'
              || !BUILT_IN_SEED_MESSAGE_ID_SET.has(message.id)
              || message.coordinateSystem
            ) continue;
            const wgs84 = gcj02ToWgs84(message.lat, message.lng);
            message.lat = wgs84.lat;
            message.lng = wgs84.lng;
            message.coordinateSystem = WGS84_COORDINATE_SYSTEM;
            migratedSeedLocations += 1;
          }
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
          if (
            this.state.pushTokens.length !== originalPushTokens.length
            || migratedSeedLocations > 0
            || migratedModerationRows > 0
            || !hadMediaUploads
          ) {
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
      deviceModeration: [],
      moderationReviews: [],
      mediaCleanupTasks: [],
      mediaUploads: [],
    };
    this.nextNotificationEventId = 1;
    this.persist();
    console.log(`[store] seeded ${this.state.messages.length} messages (memory)`);
  }

  private writeStateToDisk() {
    try {
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
      fs.writeFileSync(this.dataFile, JSON.stringify(this.state, null, 2), 'utf-8');
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
    return {
      ...m,
      ...(m.moderationCategories
        ? { moderationCategories: [...m.moderationCategories] }
        : {}),
      readers: [...m.readers],
      likes: [...m.likes],
    };
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
      id: `msg-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
      createdAt: Date.now(),
      readers: [],
      likes: [],
    };
    this.state.messages.push(m);
    this.persist();
    return this.copyMessage(m);
  }

  async registerMediaUpload(record: MediaUploadRecord): Promise<void> {
    if (
      !record || typeof record.key !== 'string' || !record.key.trim()
      || typeof record.deviceId !== 'string' || !record.deviceId.trim()
      || !isUploadMediaType(record.mediaType)
      || !Number.isFinite(record.expiresAt)
      || !Number.isFinite(record.createdAt)
    ) {
      throw new Error('invalid media upload record');
    }
    const key = record.key.trim();
    const deviceId = record.deviceId.trim().slice(0, 64);
    const stored: MediaUploadRecord = {
      key,
      deviceId,
      mediaType: record.mediaType,
      expiresAt: Math.trunc(record.expiresAt),
      createdAt: Math.trunc(record.createdAt),
      attempts: normalizeUploadAttempts(record.attempts),
      error: normalizeUploadError(record.error),
      updatedAt: normalizeUploadUpdatedAt(record.updatedAt, record.createdAt),
      cleanupLeaseUntil: null,
    };
    this.state.mediaUploads ??= [];
    const index = this.state.mediaUploads.findIndex((item) => item.key === key);
    if (index >= 0) this.state.mediaUploads[index] = stored;
    else this.state.mediaUploads.push(stored);
    this.persistImmediately();
  }

  async createMessageClaimingMedia(
    data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>,
    deviceId: string,
    key: string,
    mediaType: UploadMediaType,
    now: number
  ): Promise<Message | null> {
    // All checks and mutations are synchronous within this method, so no
    // other MemoryStore operation can observe a half-consumed upload record.
    if (
      !isUploadMediaType(mediaType)
      || typeof deviceId !== 'string' || !deviceId
      || typeof key !== 'string' || !key
      || !Number.isFinite(now)
      || data.deviceId !== deviceId
      || data.mediaKey !== key
      || data.mediaType !== mediaType
    ) return null;
    const uploads = this.state.mediaUploads ?? [];
    const index = uploads.findIndex((item) => item.key === key);
    if (index < 0) return null;
    const record = uploads[index];
    if (
      !record
      || record.deviceId !== deviceId
      || record.mediaType !== mediaType
      || !Number.isFinite(record.expiresAt)
      || record.expiresAt <= now
      || (normalizeUploadCleanupLease(record.cleanupLeaseUntil) ?? 0) > now
    ) return null;
    const m: Message = {
      ...data,
      id: `msg-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
      createdAt: Math.trunc(now),
      readers: [],
      likes: [],
    };
    uploads.splice(index, 1);
    this.state.messages.push(m);
    this.persistImmediately();
    return this.copyMessage(m);
  }

  private copyMediaUploadRecord(record: MediaUploadRecord): MediaUploadRecord {
    return {
      key: record.key,
      deviceId: record.deviceId,
      mediaType: record.mediaType,
      expiresAt: Number(record.expiresAt),
      createdAt: Number(record.createdAt),
      attempts: normalizeUploadAttempts(record.attempts),
      error: normalizeUploadError(record.error),
      updatedAt: normalizeUploadUpdatedAt(record.updatedAt, record.createdAt),
      cleanupLeaseUntil: normalizeUploadCleanupLease(record.cleanupLeaseUntil),
    };
  }

  async listExpiredMediaUploads(now: number, limit = 100): Promise<MediaUploadRecord[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(1000, Math.trunc(limit)))
      : 100;
    if (!Number.isFinite(now)) return [];
    return (this.state.mediaUploads ?? [])
      .filter((record) =>
        typeof record?.key === 'string'
        && record.key.length > 0
        && isUploadMediaType(record.mediaType)
        && Number.isFinite(record.expiresAt)
        && record.expiresAt <= now)
      .sort((a, b) =>
        a.expiresAt - b.expiresAt
        || a.createdAt - b.createdAt
        || a.key.localeCompare(b.key))
      .slice(0, safeLimit)
      .map((record) => this.copyMediaUploadRecord(record));
  }

  async claimExpiredMediaUploadForCleanup(
    key: string,
    now: number,
    leaseMs: number
  ): Promise<MediaUploadRecord | null> {
    if (
      typeof key !== 'string' || !key
      || !Number.isFinite(now)
      || !Number.isSafeInteger(leaseMs) || leaseMs <= 0
    ) return null;
    const record = (this.state.mediaUploads ?? []).find((item) => item.key === key);
    if (
      !record
      || !isUploadMediaType(record.mediaType)
      || !Number.isFinite(record.expiresAt)
      || record.expiresAt > now
      || (normalizeUploadCleanupLease(record.cleanupLeaseUntil) ?? 0) > now
    ) return null;
    record.cleanupLeaseUntil = Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(now) + leaseMs);
    record.updatedAt = Math.trunc(now);
    this.persistImmediately();
    return this.copyMediaUploadRecord(record);
  }

  async markMediaUploadCleanupSuccess(key: string): Promise<MediaUploadRecord | null> {
    const uploads = this.state.mediaUploads ?? [];
    const index = uploads.findIndex((record) => record.key === key);
    if (index < 0) return null;
    const [removed] = uploads.splice(index, 1);
    this.persistImmediately();
    return removed ? this.copyMediaUploadRecord(removed) : null;
  }

  async markMediaUploadCleanupFailure(
    key: string,
    error: string
  ): Promise<MediaUploadRecord | null> {
    const record = (this.state.mediaUploads ?? []).find((item) => item.key === key);
    if (!record) return null;
    const currentAttempts = normalizeUploadAttempts(record.attempts) ?? 0;
    record.attempts = Math.min(Number.MAX_SAFE_INTEGER, currentAttempts + 1);
    record.error = String(error || 'unknown media upload cleanup error').slice(0, 500);
    record.cleanupLeaseUntil = null;
    record.updatedAt = Date.now();
    this.persistImmediately();
    return this.copyMediaUploadRecord(record);
  }

  async listPendingMessages(): Promise<Message[]> {
    return this.state.messages
      .filter((message) => message.moderationStatus === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((message) => this.copyMessage(message));
  }

  async applyModerationOutcome(
    messageId: string,
    outcome: ModerationOutcome,
    publish: boolean
  ): Promise<Message | null> {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message || message.moderationStatus !== 'pending') return null;
    message.moderationModel = outcome.model;
    message.moderationVerdict = outcome.verdict;
    message.moderationSeverity = outcome.severity;
    message.moderationReason = outcome.reason.slice(0, 500);
    message.moderationCategories = outcome.categories.slice(0, 20);
    message.moderationDecidedAt = outcome.decidedAt;
    if (publish) message.moderationStatus = 'published';
    this.persistImmediately();
    return this.copyMessage(message);
  }

  async reviewPendingMessage(
    messageId: string,
    input: ReviewPendingMessageInput
  ): Promise<ModerationReviewResult | null> {
    const index = this.state.messages.findIndex((item) => item.id === messageId);
    const stored = index >= 0 ? this.state.messages[index] : undefined;
    if (!stored || stored.moderationStatus !== 'pending') return null;
    const message = this.copyMessage(stored);
    this.state.moderationReviews ??= [];
    this.state.moderationReviews.push({
      messageId: stored.id,
      deviceId: stored.deviceId,
      decision: input.decision,
      reviewerId: input.reviewerId.slice(0, 64),
      reason: input.reason?.trim().slice(0, 500) || null,
      createdAt: Date.now(),
    });

    let deviceModeration: DeviceModeration | null = null;
    if (input.decision === 'approve') {
      stored.moderationStatus = 'published';
      stored.moderationVerdict = 'safe';
      stored.moderationReason = input.reason?.trim().slice(0, 500) || '管理员复核通过';
      stored.moderationDecidedAt = Date.now();
    } else {
      const mediaKey = stored.mediaKey && stored.mediaKey.trim()
        ? stored.mediaKey
        : null;
      if (mediaKey) {
        this.state.mediaCleanupTasks ??= [];
        // The message review is unique, but keeping this idempotent also makes
        // recovery safe if an old JSON snapshot is replayed.
        if (!this.state.mediaCleanupTasks.some((task) => task.id === stored.id)) {
          const now = Date.now();
          this.state.mediaCleanupTasks.push({
            id: stored.id,
            messageId: stored.id,
            mediaKey,
            attempt: 0,
            error: null,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      this.state.messages.splice(index, 1);
      this.state.notificationEvents = (this.state.notificationEvents ?? [])
        .filter((event) => event.messageId !== stored.id);
      this.state.deviceModeration ??= [];
      const restrictionIndex = this.state.deviceModeration
        .findIndex((item) => item.deviceId === stored.deviceId);
      const current = restrictionIndex >= 0
        ? this.state.deviceModeration[restrictionIndex]
        : undefined;
      deviceModeration = restrictionAfterConfirmedViolation(
        current,
        stored.deviceId,
        input.banMode ?? 'auto',
        input.reason,
        Date.now()
      );
      if (restrictionIndex >= 0) this.state.deviceModeration[restrictionIndex] = deviceModeration;
      else this.state.deviceModeration.push(deviceModeration);
    }
    this.persistImmediately();
    return { message, deviceModeration };
  }

  private copyMediaCleanupTask(task: MediaCleanupTask): MediaCleanupTask {
    return { ...task };
  }

  async listMediaCleanupTasks(limit = 100): Promise<MediaCleanupTask[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(1000, Math.trunc(limit)))
      : 100;
    return (this.state.mediaCleanupTasks ?? [])
      .filter((task) => typeof task.mediaKey === 'string' && task.mediaKey.length > 0)
      .sort((a, b) =>
        a.updatedAt - b.updatedAt
        || a.createdAt - b.createdAt
        || a.id.localeCompare(b.id))
      .slice(0, safeLimit)
      .map((task) => this.copyMediaCleanupTask(task));
  }

  async markMediaCleanupSuccess(taskId: string): Promise<MediaCleanupTask | null> {
    const task = (this.state.mediaCleanupTasks ?? []).find((item) => item.id === taskId);
    if (!task) return null;
    task.mediaKey = null;
    task.error = null;
    task.updatedAt = Date.now();
    this.persistImmediately();
    return this.copyMediaCleanupTask(task);
  }

  async markMediaCleanupFailure(
    taskId: string,
    error: string
  ): Promise<MediaCleanupTask | null> {
    const task = (this.state.mediaCleanupTasks ?? []).find((item) => item.id === taskId);
    if (!task) return null;
    // A completed task must never be resurrected by a late worker response.
    if (task.mediaKey !== null && task.mediaKey.length > 0) {
      task.attempt = Number.isSafeInteger(task.attempt) && task.attempt >= 0
        ? Math.min(Number.MAX_SAFE_INTEGER, task.attempt + 1)
        : 1;
      task.error = String(error || 'unknown media cleanup error').slice(0, 500);
      task.updatedAt = Date.now();
      this.persistImmediately();
    }
    return this.copyMediaCleanupTask(task);
  }

  async getDeviceModeration(deviceId: string): Promise<DeviceModeration | undefined> {
    const value = (this.state.deviceModeration ?? [])
      .find((item) => item.deviceId === deviceId);
    return value ? { ...value } : undefined;
  }

  async listDeviceModeration(): Promise<DeviceModeration[]> {
    return (this.state.deviceModeration ?? [])
      .map((item) => ({ ...item }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async setDeviceBan(
    deviceId: string,
    mode: Exclude<BanMode, 'auto' | 'none'>,
    reason?: string
  ): Promise<DeviceModeration> {
    this.state.deviceModeration ??= [];
    const index = this.state.deviceModeration.findIndex((item) => item.deviceId === deviceId);
    const next = restrictionAfterManualBan(
      index >= 0 ? this.state.deviceModeration[index] : undefined,
      deviceId,
      mode,
      reason,
      Date.now()
    );
    if (index >= 0) this.state.deviceModeration[index] = next;
    else this.state.deviceModeration.push(next);
    this.persistImmediately();
    return { ...next };
  }

  async clearDeviceBan(deviceId: string): Promise<DeviceModeration> {
    this.state.deviceModeration ??= [];
    const index = this.state.deviceModeration.findIndex((item) => item.deviceId === deviceId);
    const next = unbannedRestriction(
      index >= 0 ? this.state.deviceModeration[index] : undefined,
      deviceId,
      Date.now()
    );
    if (index >= 0) this.state.deviceModeration[index] = next;
    else this.state.deviceModeration.push(next);
    this.persistImmediately();
    return { ...next };
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
