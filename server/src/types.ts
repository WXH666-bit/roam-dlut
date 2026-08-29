import type { StoredLocationMetadata } from './location';

export type { CoordinateSystem, StoredLocationMetadata } from './location';

export type MediaType = 'none' | 'image' | 'video' | 'audio';
/** Media types that can be uploaded and temporarily registered before a message claims them. */
export type UploadMediaType = Exclude<MediaType, 'none'>;

export type ModerationStatus = 'published' | 'pending';
export type ModerationVerdict = 'safe' | 'review' | 'error';
export type ModerationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ModerationDecision = 'approve' | 'reject';
export type BanMode = 'auto' | 'none' | '1d' | '7d' | '30d' | 'permanent';

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
  /** Ordinary user-facing APIs may only return published rows. */
  moderationStatus: ModerationStatus;
  moderationModel?: string;
  moderationVerdict?: ModerationVerdict;
  moderationSeverity?: ModerationSeverity;
  moderationReason?: string;
  moderationCategories?: string[];
  moderationRequestedAt?: number;
  moderationDecidedAt?: number;
  readers: string[];
  likes: string[];
}

export interface ModerationOutcome {
  verdict: ModerationVerdict;
  severity: ModerationSeverity;
  reason: string;
  categories: string[];
  model: string;
  decidedAt: number;
}

export interface DeviceModeration {
  deviceId: string;
  violationCount: number;
  bannedUntil: number | null;
  permanent: boolean;
  reason: string | null;
  updatedAt: number;
}

export interface ModerationReviewRecord {
  messageId: string;
  deviceId: string;
  decision: ModerationDecision;
  reviewerId: string;
  reason: string | null;
  createdAt: number;
}

export interface ModerationReviewResult {
  message: Message;
  deviceModeration: DeviceModeration | null;
}

/**
 * A durable retry record for media belonging to a rejected message.
 *
 * The message row is deleted as part of the moderation transaction, so the
 * cleanup record is the last durable reference to the object-store key.  A
 * successful deletion clears mediaKey; failed attempts retain it together
 * with the attempt count and most recent error for a later retry.
 */
export interface MediaCleanupTask {
  /** Stable task id; currently the rejected message id. */
  id: string;
  messageId: string;
  mediaKey: string | null;
  attempt: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A short-lived object-store upload waiting to be claimed by exactly one
 * message.  The upload record is intentionally separate from Message so an
 * uploaded object cannot be published (or reused by another device) without
 * an atomic ownership check.
 */
export interface MediaUploadRecord {
  key: string;
  deviceId: string;
  mediaType: UploadMediaType;
  expiresAt: number;
  createdAt: number;
  /** Number of failed expiry-cleanup attempts; absent in legacy snapshots. */
  attempts?: number;
  /** Most recent expiry-cleanup error; absent in legacy snapshots. */
  error?: string | null;
  /** Last registration or cleanup update; absent in legacy snapshots. */
  updatedAt?: number;
  /**
   * Lease held by the expiry-cleanup worker.  While this timestamp is in the
   * future the upload cannot be claimed by a message or another worker.
   */
  cleanupLeaseUntil?: number | null;
}

export interface ReviewPendingMessageInput {
  decision: ModerationDecision;
  reviewerId: string;
  reason?: string;
  banMode?: BanMode;
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
  deviceModeration?: DeviceModeration[];
  moderationReviews?: ModerationReviewRecord[];
  mediaCleanupTasks?: MediaCleanupTask[];
  mediaUploads?: MediaUploadRecord[];
}

export const isAlive = (
  m: Message,
  now: number,
  ttlMs: number,
  readLimit: number
): boolean => now - m.createdAt < ttlMs && m.readers.length < readLimit;

export const isPublished = (m: Message): boolean => m.moderationStatus === 'published';
