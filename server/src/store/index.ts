/**
 * 数据层：环境变量 DATABASE_URL 切换实现
 * - 未设置：内存 + JSON 文件持久化（开发态默认，行为与此前完全一致）
 * - 已设置：MySQL（mysql2 连接池），表结构见 server/migrate.sql
 *
 * 注意：实现按需动态加载，未设 DATABASE_URL 时不会加载 mysql2 连接逻辑。
 */
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
  User,
  UploadMediaType,
} from '../types';

export interface DataStore {
  init(): Promise<void>;
  listMessages(): Promise<Message[]>;
  findMessage(id: string): Promise<Message | undefined>;
  findUser(deviceId: string): Promise<User | undefined>;
  findUserByRecoveryCode(code: string): Promise<User | undefined>;
  ensureUser(deviceId: string): Promise<User>;
  renameUser(deviceId: string, flowerName: string): Promise<User | null>;
  createMessage(
    data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>
  ): Promise<Message>;
  /** Register an uploaded object until a message claims it or it expires. */
  registerMediaUpload(record: MediaUploadRecord): Promise<void>;
  /**
   * Atomically validate and consume an upload record while inserting its
   * message. Returns null when ownership/type/expiry validation fails.
   */
  createMessageClaimingMedia(
    data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>,
    deviceId: string,
    key: string,
    mediaType: UploadMediaType,
    now: number
  ): Promise<Message | null>;
  /** List expired upload records for object-store cleanup. */
  listExpiredMediaUploads(now: number, limit?: number): Promise<MediaUploadRecord[]>;
  /** Atomically acquire a short lease for cleaning one expired upload. */
  claimExpiredMediaUploadForCleanup(
    key: string,
    now: number,
    leaseMs: number
  ): Promise<MediaUploadRecord | null>;
  /** Delete an expired upload record after its object has been cleaned up. */
  markMediaUploadCleanupSuccess(key: string): Promise<MediaUploadRecord | null>;
  /** Retain an expired upload record and record a failed cleanup attempt. */
  markMediaUploadCleanupFailure(
    key: string,
    error: string
  ): Promise<MediaUploadRecord | null>;
  listPendingMessages(): Promise<Message[]>;
  applyModerationOutcome(
    messageId: string,
    outcome: ModerationOutcome,
    publish: boolean
  ): Promise<Message | null>;
  reviewPendingMessage(
    messageId: string,
    input: ReviewPendingMessageInput
  ): Promise<ModerationReviewResult | null>;
  getDeviceModeration(deviceId: string): Promise<DeviceModeration | undefined>;
  listDeviceModeration(): Promise<DeviceModeration[]>;
  setDeviceBan(
    deviceId: string,
    mode: Exclude<BanMode, 'auto' | 'none'>,
    reason?: string
  ): Promise<DeviceModeration>;
  clearDeviceBan(deviceId: string): Promise<DeviceModeration>;
  /** List rejected-media objects that still need deletion. */
  listMediaCleanupTasks(limit?: number): Promise<MediaCleanupTask[]>;
  /** Mark a cleanup task complete; this clears its durable media key. */
  markMediaCleanupSuccess(taskId: string): Promise<MediaCleanupTask | null>;
  /** Record a failed deletion while retaining the key for retry. */
  markMediaCleanupFailure(
    taskId: string,
    error: string
  ): Promise<MediaCleanupTask | null>;
  addReader(messageId: string, deviceId: string): Promise<void>;
  /** Returns true only when this call inserted a new like. */
  addLike(messageId: string, deviceId: string): Promise<boolean>;
  /** Atomically inserts a like and, for a non-author like, its notification event. */
  addLikeAndCreateNotificationEvent(messageId: string, deviceId: string): Promise<LikeResult>;
  createNotificationEvent(data: Omit<NotificationEvent, 'id'>): Promise<NotificationEvent>;
  listNotificationEvents(
    recipientDeviceId: string,
    afterId: number,
    limit?: number,
    maxId?: number
  ): Promise<NotificationEvent[]>;
  getLatestNotificationEventId(recipientDeviceId: string): Promise<number>;
  registerPushToken(deviceId: string, token: string): Promise<void>;
  unregisterPushToken(deviceId: string, token: string): Promise<void>;
  listPushTokens(deviceId: string): Promise<PushToken[]>;
}

let impl: DataStore | null = null;

/** 启动时调用一次；未设 DATABASE_URL 走内存实现，绝不强依赖 MySQL */
export async function initDataStore(): Promise<void> {
  impl = process.env.DATABASE_URL
    ? new (await import('./mysqlStore')).MysqlStore(process.env.DATABASE_URL)
    : new (await import('./memoryStore')).MemoryStore();
  await impl.init();
}

const need = (): DataStore => {
  if (!impl) throw new Error('data store not initialized');
  return impl;
};

export const listMessages = () => need().listMessages();
export const findMessage = (id: string) => need().findMessage(id);
export const findUser = (deviceId: string) => need().findUser(deviceId);
export const findUserByRecoveryCode = (code: string) => need().findUserByRecoveryCode(code);
export const ensureUser = (deviceId: string) => need().ensureUser(deviceId);
export const renameUser = (deviceId: string, flowerName: string) =>
  need().renameUser(deviceId, flowerName);
export const createMessage = (
  data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>
) => need().createMessage(data);
export const registerMediaUpload = (record: MediaUploadRecord) =>
  need().registerMediaUpload(record);
export const createMessageClaimingMedia = (
  data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>,
  deviceId: string,
  key: string,
  mediaType: UploadMediaType,
  now: number
) => need().createMessageClaimingMedia(data, deviceId, key, mediaType, now);
export const listExpiredMediaUploads = (now: number, limit?: number) =>
  need().listExpiredMediaUploads(now, limit);
export const claimExpiredMediaUploadForCleanup = (
  key: string,
  now: number,
  leaseMs: number
) => need().claimExpiredMediaUploadForCleanup(key, now, leaseMs);
export const markMediaUploadCleanupSuccess = (key: string) =>
  need().markMediaUploadCleanupSuccess(key);
export const markMediaUploadCleanupFailure = (key: string, error: string) =>
  need().markMediaUploadCleanupFailure(key, error);
export const listPendingMessages = () => need().listPendingMessages();
export const applyModerationOutcome = (
  messageId: string,
  outcome: ModerationOutcome,
  publish: boolean
) => need().applyModerationOutcome(messageId, outcome, publish);
export const reviewPendingMessage = (
  messageId: string,
  input: ReviewPendingMessageInput
) => need().reviewPendingMessage(messageId, input);
export const getDeviceModeration = (deviceId: string) =>
  need().getDeviceModeration(deviceId);
export const listDeviceModeration = () => need().listDeviceModeration();
export const setDeviceBan = (
  deviceId: string,
  mode: Exclude<BanMode, 'auto' | 'none'>,
  reason?: string
) => need().setDeviceBan(deviceId, mode, reason);
export const clearDeviceBan = (deviceId: string) => need().clearDeviceBan(deviceId);
export const listMediaCleanupTasks = (limit?: number) =>
  need().listMediaCleanupTasks(limit);
export const markMediaCleanupSuccess = (taskId: string) =>
  need().markMediaCleanupSuccess(taskId);
export const markMediaCleanupFailure = (taskId: string, error: string) =>
  need().markMediaCleanupFailure(taskId, error);
export const addReader = (messageId: string, deviceId: string) =>
  need().addReader(messageId, deviceId);
export const addLike = (messageId: string, deviceId: string) =>
  need().addLike(messageId, deviceId);
export const addLikeAndCreateNotificationEvent = (messageId: string, deviceId: string) =>
  need().addLikeAndCreateNotificationEvent(messageId, deviceId);
export const createNotificationEvent = (data: Omit<NotificationEvent, 'id'>) =>
  need().createNotificationEvent(data);
export const listNotificationEvents = (
  recipientDeviceId: string,
  afterId: number,
  limit?: number,
  maxId?: number
) => need().listNotificationEvents(recipientDeviceId, afterId, limit, maxId);
export const getLatestNotificationEventId = (recipientDeviceId: string) =>
  need().getLatestNotificationEventId(recipientDeviceId);
export const registerPushToken = (deviceId: string, token: string) =>
  need().registerPushToken(deviceId, token);
export const unregisterPushToken = (deviceId: string, token: string) =>
  need().unregisterPushToken(deviceId, token);
export const listPushTokens = (deviceId: string) => need().listPushTokens(deviceId);
