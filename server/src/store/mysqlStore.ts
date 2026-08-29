import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import type {
  BanMode,
  DeviceModeration,
  LikeResult,
  MediaCleanupTask,
  MediaUploadRecord,
  Message,
  MediaType,
  ModerationOutcome,
  ModerationReviewResult,
  ModerationSeverity,
  ModerationStatus,
  ModerationVerdict,
  NotificationEvent,
  PushToken,
  ReviewPendingMessageInput,
  User,
  UploadMediaType,
} from '../types';
import { BUILT_IN_SEED_MESSAGE_IDS, buildSeedMessages } from '../seeds';
import { randomFlowerName } from '../flowerNames';
import { randomRecoveryCode } from '../recoveryWords';
import { isExpoPushToken, MAX_PUSH_TOKENS_PER_DEVICE } from '../pushTokens';
import {
  gcj02ToWgs84,
  WGS84_COORDINATE_SYSTEM,
} from '../location';
import type { DataStore } from './index';
import {
  restrictionAfterConfirmedViolation,
  restrictionAfterManualBan,
  unbannedRestriction,
} from '../moderationPolicy';

interface MessageRow {
  id: string;
  device_id: string;
  flower_name: string;
  text: string;
  media_type: MediaType;
  media_key: string | null;
  lat: number;
  lng: number;
  coordinate_system?: string | null;
  accuracy?: number | null;
  captured_at?: number | null;
  created_at: number;
  moderation_status?: ModerationStatus | null;
  moderation_model?: string | null;
  moderation_verdict?: ModerationVerdict | null;
  moderation_severity?: ModerationSeverity | null;
  moderation_reason?: string | null;
  moderation_categories?: string | null;
  moderation_requested_at?: number | null;
  moderation_decided_at?: number | null;
}

interface DeviceModerationRow {
  device_id: string;
  violation_count: number;
  banned_until: number | null;
  permanent: number | boolean;
  reason: string | null;
  updated_at: number;
}

interface MediaCleanupTaskRow {
  id: string;
  message_id: string;
  media_key: string | null;
  attempt: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface MediaUploadRow {
  media_key: string;
  device_id: string;
  media_type: UploadMediaType;
  expires_at: number;
  created_at: number;
  attempts?: number | null;
  error?: string | null;
  updated_at?: number | null;
  cleanup_lease_until?: number | null;
}

const isUploadMediaType = (value: unknown): value is UploadMediaType =>
  value === 'image' || value === 'video' || value === 'audio';

/** MySQL 实现（设 DATABASE_URL 时启用），表结构见 server/migrate.sql */
export class MysqlStore implements DataStore {
  private pool: mysql.Pool;

  constructor(databaseUrl: string) {
    this.pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 5 });
  }

  async init(): Promise<void> {
    // 自动确保表结构存在；migrate.sql 适合新库手动一键建表。
    await this.pool.query(`CREATE TABLE IF NOT EXISTS users (
      device_id VARCHAR(64) PRIMARY KEY,
      flower_name VARCHAR(32) NOT NULL,
      renamed TINYINT(1) NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      recovery_code VARCHAR(64) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // 存量表补列（CREATE TABLE IF NOT EXISTS 不会变更已有表）
    const [col] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'recovery_code'`
    );
    if (Number(col[0]?.n ?? 0) === 0) {
      await this.pool.query('ALTER TABLE users ADD COLUMN recovery_code VARCHAR(64) NULL');
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(32) PRIMARY KEY,
      device_id VARCHAR(64) NOT NULL,
      flower_name VARCHAR(32) NOT NULL,
      text VARCHAR(600) NOT NULL,
      media_type ENUM('none','image','video','audio') NOT NULL DEFAULT 'none',
      media_key VARCHAR(512) NULL,
      lat DOUBLE NOT NULL,
      lng DOUBLE NOT NULL,
      coordinate_system VARCHAR(16) NULL,
      accuracy DOUBLE NULL,
      captured_at BIGINT NULL,
      created_at BIGINT NOT NULL,
      moderation_status ENUM('published','pending') NOT NULL DEFAULT 'published',
      moderation_model VARCHAR(64) NULL,
      moderation_verdict ENUM('safe','review','error') NULL,
      moderation_severity ENUM('low','medium','high','critical') NULL,
      moderation_reason VARCHAR(500) NULL,
      moderation_categories TEXT NULL,
      moderation_requested_at BIGINT NULL,
      moderation_decided_at BIGINT NULL,
      INDEX idx_messages_device (device_id),
      INDEX idx_messages_created (created_at),
      INDEX idx_messages_moderation (moderation_status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Keep existing deployments readable without rewriting their coordinates.
    // NULL means the pre-metadata (implicitly WGS-84) API shape.
    const [messageColumns] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages'`
    );
    const messageColumnNames = new Set(
      messageColumns.map((row) => String(row.column_name).toLowerCase())
    );
    if (!messageColumnNames.has('coordinate_system')) {
      await this.pool.query(
        'ALTER TABLE messages ADD COLUMN coordinate_system VARCHAR(16) NULL'
      );
    }
    if (!messageColumnNames.has('accuracy')) {
      await this.pool.query(
        'ALTER TABLE messages ADD COLUMN accuracy DOUBLE NULL'
      );
    }
    if (!messageColumnNames.has('captured_at')) {
      await this.pool.query(
        'ALTER TABLE messages ADD COLUMN captured_at BIGINT NULL'
      );
    }
    if (!messageColumnNames.has('moderation_status')) {
      await this.pool.query(
        "ALTER TABLE messages ADD COLUMN moderation_status ENUM('published','pending') NOT NULL DEFAULT 'published'"
      );
      await this.pool.query(
        'ALTER TABLE messages ADD INDEX idx_messages_moderation (moderation_status, created_at)'
      );
    }
    if (!messageColumnNames.has('moderation_model')) {
      await this.pool.query('ALTER TABLE messages ADD COLUMN moderation_model VARCHAR(64) NULL');
    }
    if (!messageColumnNames.has('moderation_verdict')) {
      await this.pool.query(
        "ALTER TABLE messages ADD COLUMN moderation_verdict ENUM('safe','review','error') NULL"
      );
    }
    if (!messageColumnNames.has('moderation_severity')) {
      await this.pool.query(
        "ALTER TABLE messages ADD COLUMN moderation_severity ENUM('low','medium','high','critical') NULL"
      );
    }
    if (!messageColumnNames.has('moderation_reason')) {
      await this.pool.query('ALTER TABLE messages ADD COLUMN moderation_reason VARCHAR(500) NULL');
    }
    if (!messageColumnNames.has('moderation_categories')) {
      await this.pool.query('ALTER TABLE messages ADD COLUMN moderation_categories TEXT NULL');
    }
    if (!messageColumnNames.has('moderation_requested_at')) {
      await this.pool.query('ALTER TABLE messages ADD COLUMN moderation_requested_at BIGINT NULL');
    }
    if (!messageColumnNames.has('moderation_decided_at')) {
      await this.pool.query('ALTER TABLE messages ADD COLUMN moderation_decided_at BIGINT NULL');
    }
    const mediaTypeColumn = messageColumns.find(
      (row) => String(row.column_name).toLowerCase() === 'media_type'
    );
    if (!String(mediaTypeColumn?.column_type ?? '').toLowerCase().includes("'audio'")) {
      await this.pool.query(
        "ALTER TABLE messages MODIFY COLUMN media_type ENUM('none','image','video','audio') NOT NULL DEFAULT 'none'"
      );
    }
    // One-time, narrowly scoped migration for the reserved built-in demo
    // messages. Their original constants are GCJ-02; user-authored legacy
    // rows came from native location APIs and must not be transformed.
    const seedIdPlaceholders = BUILT_IN_SEED_MESSAGE_IDS.map(() => '?').join(',');
    const [legacySeedRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT id, lat, lng FROM messages
       WHERE BINARY device_id = ? AND id IN (${seedIdPlaceholders})
         AND coordinate_system IS NULL`,
      ['seed-device', ...BUILT_IN_SEED_MESSAGE_IDS]
    );
    for (const row of legacySeedRows) {
      const wgs84 = gcj02ToWgs84(Number(row.lat), Number(row.lng));
      await this.pool.query(
        `UPDATE messages SET lat = ?, lng = ?, coordinate_system = ?
         WHERE id = ? AND BINARY device_id = ? AND coordinate_system IS NULL`,
        [
          wgs84.lat,
          wgs84.lng,
          WGS84_COORDINATE_SYSTEM,
          String(row.id),
          'seed-device',
        ]
      );
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS message_readers (
      message_id VARCHAR(32) NOT NULL,
      device_id VARCHAR(64) NOT NULL,
      read_at BIGINT NOT NULL,
      PRIMARY KEY (message_id, device_id),
      INDEX idx_readers_device (device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS message_likes (
      message_id VARCHAR(32) NOT NULL,
      device_id VARCHAR(64) NOT NULL,
      PRIMARY KEY (message_id, device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS moderation_reviews (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      message_id VARCHAR(32) NOT NULL,
      device_id VARCHAR(64) NOT NULL,
      decision ENUM('approve','reject') NOT NULL,
      reviewer_id VARCHAR(64) NOT NULL,
      reason VARCHAR(500) NULL,
      created_at BIGINT NOT NULL,
      UNIQUE KEY uq_moderation_review_message (message_id),
      INDEX idx_moderation_reviews_device (device_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS media_cleanup_tasks (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      message_id VARCHAR(32) NOT NULL,
      media_key VARCHAR(512) NULL,
      attempt INT UNSIGNED NOT NULL DEFAULT 0,
      error VARCHAR(500) NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE KEY uq_media_cleanup_message (message_id),
      INDEX idx_media_cleanup_pending (media_key, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS media_uploads (
      media_key VARCHAR(512) NOT NULL PRIMARY KEY,
      device_id VARCHAR(64) NOT NULL,
      media_type ENUM('image','video','audio') NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      error VARCHAR(500) NULL,
      updated_at BIGINT NOT NULL,
      cleanup_lease_until BIGINT NULL,
      INDEX idx_media_uploads_expiry (expires_at, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [mediaUploadColumns] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_uploads'`
    );
    if (!mediaUploadColumns.some(
      (row) => String(row.column_name).toLowerCase() === 'cleanup_lease_until'
    )) {
      await this.pool.query(
        'ALTER TABLE media_uploads ADD COLUMN cleanup_lease_until BIGINT NULL'
      );
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS device_moderation (
      device_id VARCHAR(64) NOT NULL PRIMARY KEY,
      violation_count INT UNSIGNED NOT NULL DEFAULT 0,
      banned_until BIGINT NULL,
      permanent TINYINT(1) NOT NULL DEFAULT 0,
      reason VARCHAR(500) NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_device_moderation_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS notification_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      type VARCHAR(64) NOT NULL,
      recipient_device_id VARCHAR(64) NOT NULL,
      message_id VARCHAR(32) NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_notification_events_recipient_id (recipient_device_id, id),
      INDEX idx_notification_events_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS notification_event_sequence (
      singleton TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      next_id BIGINT UNSIGNED NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`INSERT INTO notification_event_sequence (singleton, next_id)
      SELECT 1, COALESCE(MAX(id), 0) + 1 FROM notification_events
      ON DUPLICATE KEY UPDATE next_id = GREATEST(next_id, VALUES(next_id))`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS push_tokens (
      device_id VARCHAR(64) NOT NULL,
      token VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (token),
      INDEX idx_push_tokens_device (device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Remove malformed legacy values before converting an older utf8 column
    // to ASCII; otherwise one bad row can make the whole schema upgrade fail.
    await this.pool.query('DELETE FROM push_tokens WHERE token IS NULL');
    const [legacyPushTokens] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT token FROM push_tokens'
    );
    const malformedTokens = legacyPushTokens
      .map((row) => String(row.token))
      .filter((token) => !isExpoPushToken(token));
    for (let start = 0; start < malformedTokens.length; start += 100) {
      const batch = malformedTokens.slice(start, start + 100);
      const placeholders = batch.map(() => '?').join(',');
      await this.pool.query(
        `DELETE FROM push_tokens WHERE BINARY token IN (${placeholders})`,
        batch
      );
    }
    // CREATE TABLE IF NOT EXISTS does not update an existing deployment. Expo
    // tokens are case-sensitive, so normalize the legacy column once.
    const [pushTokenColumns] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLLATION_NAME AS collation_name FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'push_tokens' AND COLUMN_NAME = 'token'`
    );
    if (String(pushTokenColumns[0]?.collation_name ?? '').toLowerCase() !== 'ascii_bin') {
      await this.pool.query(`ALTER TABLE push_tokens
        MODIFY token VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`);
    }
    const [pushTokenPrimaryKey] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'push_tokens'
         AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`
    );
    const primaryColumns = pushTokenPrimaryKey.map((row) => String(row.column_name));
    if (primaryColumns.length !== 1 || primaryColumns[0] !== 'token') {
      // Older experiments used (device_id, token), which lets one physical
      // installation remain attached to two identities. Keep the newest exact
      // token binding, then make token itself globally unique.
      await this.pool.query(`DELETE older FROM push_tokens AS older
        INNER JOIN push_tokens AS newer ON older.token = newer.token
          AND (
            older.updated_at < newer.updated_at OR
            (older.updated_at = newer.updated_at AND older.device_id < newer.device_id)
          )`);
      await this.pool.query(primaryColumns.length === 0
        ? 'ALTER TABLE push_tokens ADD PRIMARY KEY (token)'
        : 'ALTER TABLE push_tokens DROP PRIMARY KEY, ADD PRIMARY KEY (token)');
    }
    // Apply the current validation and per-identity cap to rows created by an
    // older release as well, instead of waiting for every device to register
    // again. Token is now globally unique, so deletions are unambiguous.
    const [storedPushTokens] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT device_id, token FROM push_tokens
       ORDER BY device_id ASC, updated_at DESC, token DESC`
    );
    const tokenCountByDevice = new Map<string, number>();
    const staleStoredTokens: string[] = [];
    for (const row of storedPushTokens) {
      const deviceId = String(row.device_id);
      const token = String(row.token);
      const count = tokenCountByDevice.get(deviceId) ?? 0;
      if (!isExpoPushToken(token) || count >= MAX_PUSH_TOKENS_PER_DEVICE) {
        staleStoredTokens.push(token);
        continue;
      }
      tokenCountByDevice.set(deviceId, count + 1);
    }
    for (let start = 0; start < staleStoredTokens.length; start += 100) {
      const batch = staleStoredTokens.slice(start, start + 100);
      const placeholders = batch.map(() => '?').join(',');
      await this.pool.query(
        `DELETE FROM push_tokens WHERE token IN (${placeholders})`,
        batch
      );
    }

    // 空库播种（与内存模式行为一致）
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM messages');
    if (Number(rows[0]?.n ?? 0) === 0) {
      const seeds = buildSeedMessages(Date.now());
      for (const m of seeds) {
        await this.insertMessage(m);
        for (const r of m.readers) await this.addReader(m.id, r);
        for (const l of m.likes) await this.addLike(m.id, l);
      }
      console.log(`[store] seeded ${seeds.length} messages (mysql)`);
    } else {
      console.log('[store] connected to mysql');
    }
  }

  private async insertMessage(
    m: Message,
    executor: mysql.Pool | mysql.PoolConnection = this.pool
  ): Promise<void> {
    await executor.query(
      `INSERT INTO messages
        (id, device_id, flower_name, text, media_type, media_key, lat, lng,
         coordinate_system, accuracy, captured_at, created_at,
         moderation_status, moderation_model, moderation_verdict,
         moderation_severity, moderation_reason, moderation_categories,
         moderation_requested_at, moderation_decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        m.id,
        m.deviceId,
        m.flowerName,
        m.text,
        m.mediaType,
        m.mediaKey,
        m.lat,
        m.lng,
        m.coordinateSystem ?? null,
        m.accuracy ?? null,
        m.capturedAt ?? null,
        m.createdAt,
        m.moderationStatus,
        m.moderationModel ?? null,
        m.moderationVerdict ?? null,
        m.moderationSeverity ?? null,
        m.moderationReason ?? null,
        m.moderationCategories ? JSON.stringify(m.moderationCategories) : null,
        m.moderationRequestedAt ?? null,
        m.moderationDecidedAt ?? null,
      ]
    );
  }

  private async assemble(rows: MessageRow[]): Promise<Message[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const [readers] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT message_id, device_id FROM message_readers WHERE message_id IN (${ph})`, ids
    );
    const [likes] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT message_id, device_id FROM message_likes WHERE message_id IN (${ph})`, ids
    );
    const readersOf = new Map<string, string[]>();
    const likesOf = new Map<string, string[]>();
    for (const r of readers) {
      const arr = readersOf.get(r.message_id) ?? [];
      arr.push(r.device_id);
      readersOf.set(r.message_id, arr);
    }
    for (const l of likes) {
      const arr = likesOf.get(l.message_id) ?? [];
      arr.push(l.device_id);
      likesOf.set(l.message_id, arr);
    }
    return rows.map((r) => {
      const coordinateSystem = r.coordinate_system === WGS84_COORDINATE_SYSTEM
        ? WGS84_COORDINATE_SYSTEM
        : undefined;
      const parsedAccuracy = r.accuracy == null ? undefined : Number(r.accuracy);
      const parsedCapturedAt = r.captured_at == null ? undefined : Number(r.captured_at);
      let moderationCategories: string[] | undefined;
      try {
        const parsed = r.moderation_categories
          ? JSON.parse(String(r.moderation_categories))
          : undefined;
        if (Array.isArray(parsed)) {
          moderationCategories = parsed
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 20);
        }
      } catch {
        moderationCategories = [];
      }
      return {
        id: r.id,
        deviceId: r.device_id,
        flowerName: r.flower_name,
        text: r.text,
        mediaType: r.media_type,
        mediaKey: r.media_key,
        lat: Number(r.lat),
        lng: Number(r.lng),
        ...(coordinateSystem ? { coordinateSystem } : {}),
        ...(parsedAccuracy !== undefined && Number.isFinite(parsedAccuracy)
          ? { accuracy: parsedAccuracy }
          : {}),
        ...(parsedCapturedAt !== undefined && Number.isFinite(parsedCapturedAt)
          ? { capturedAt: parsedCapturedAt }
          : {}),
        createdAt: Number(r.created_at),
        moderationStatus: r.moderation_status === 'pending' ? 'pending' : 'published',
        ...(r.moderation_model ? { moderationModel: String(r.moderation_model) } : {}),
        ...(r.moderation_verdict
          ? { moderationVerdict: r.moderation_verdict }
          : {}),
        ...(r.moderation_severity
          ? { moderationSeverity: r.moderation_severity }
          : {}),
        ...(r.moderation_reason ? { moderationReason: String(r.moderation_reason) } : {}),
        ...(moderationCategories ? { moderationCategories } : {}),
        ...(r.moderation_requested_at != null
          ? { moderationRequestedAt: Number(r.moderation_requested_at) }
          : {}),
        ...(r.moderation_decided_at != null
          ? { moderationDecidedAt: Number(r.moderation_decided_at) }
          : {}),
        readers: readersOf.get(r.id) ?? [],
        likes: likesOf.get(r.id) ?? [],
      };
    });
  }

  async listMessages(): Promise<Message[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>('SELECT * FROM messages');
    return this.assemble(rows as MessageRow[]);
  }

  async findMessage(id: string): Promise<Message | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM messages WHERE id = ?', [id]
    );
    const list = await this.assemble(rows as MessageRow[]);
    return list[0];
  }

  private mapUser(r: mysql.RowDataPacket): User {
    return {
      deviceId: r.device_id,
      flowerName: r.flower_name,
      renamed: Boolean(r.renamed),
      createdAt: Number(r.created_at),
      recoveryCode: r.recovery_code ?? undefined,
    };
  }

  async findUser(deviceId: string): Promise<User | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM users WHERE device_id = ?', [deviceId]
    );
    return rows[0] ? this.mapUser(rows[0]) : undefined;
  }

  async findUserByRecoveryCode(code: string): Promise<User | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM users WHERE recovery_code = ? LIMIT 1', [code]
    );
    return rows[0] ? this.mapUser(rows[0]) : undefined;
  }

  // 生成不与存量用户冲突的暗号
  private async freshRecoveryCode(): Promise<string> {
    let code = randomRecoveryCode();
    while (await this.findUserByRecoveryCode(code)) {
      code = randomRecoveryCode();
    }
    return code;
  }

  async ensureUser(deviceId: string): Promise<User> {
    const existing = await this.findUser(deviceId);
    if (existing) {
      if (!existing.recoveryCode) {
        // 老用户惰性补发暗号
        existing.recoveryCode = await this.freshRecoveryCode();
        await this.pool.query(
          'UPDATE users SET recovery_code = ? WHERE device_id = ?',
          [existing.recoveryCode, deviceId]
        );
      }
      return existing;
    }
    const u: User = {
      deviceId,
      flowerName: randomFlowerName(),
      renamed: false,
      createdAt: Date.now(),
      recoveryCode: await this.freshRecoveryCode(),
    };
    await this.pool.query(
      'INSERT IGNORE INTO users (device_id, flower_name, renamed, created_at, recovery_code) VALUES (?,?,?,?,?)',
      [u.deviceId, u.flowerName, 0, u.createdAt, u.recoveryCode]
    );
    return (await this.findUser(deviceId)) ?? u;
  }

  async renameUser(deviceId: string, flowerName: string): Promise<User | null> {
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      'UPDATE users SET flower_name = ?, renamed = 1 WHERE device_id = ? AND renamed = 0',
      [flowerName, deviceId]
    );
    if (result.affectedRows === 0) return null;
    return (await this.findUser(deviceId)) ?? null;
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
    await this.insertMessage(m);
    return m;
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
    const createdAt = Math.trunc(record.createdAt);
    const expiresAt = Math.trunc(record.expiresAt);
    const attempts = Number.isSafeInteger(record.attempts) && record.attempts! >= 0
      ? record.attempts!
      : 0;
    const error = typeof record.error === 'string' && record.error.length > 0
      ? record.error.slice(0, 500)
      : null;
    const updatedAt = Number.isFinite(record.updatedAt)
      ? Math.trunc(record.updatedAt!)
      : createdAt;
    await this.pool.query(
      `INSERT INTO media_uploads
        (media_key, device_id, media_type, expires_at, created_at, attempts, error,
         updated_at, cleanup_lease_until)
       VALUES (?,?,?,?,?,?,?,?,NULL)
       ON DUPLICATE KEY UPDATE
         device_id = VALUES(device_id), media_type = VALUES(media_type),
         expires_at = VALUES(expires_at), created_at = VALUES(created_at),
         attempts = VALUES(attempts), error = VALUES(error), updated_at = VALUES(updated_at),
         cleanup_lease_until = NULL`,
      [key, deviceId, record.mediaType, expiresAt, createdAt, attempts, error, updatedAt]
    );
  }

  async createMessageClaimingMedia(
    data: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'>,
    deviceId: string,
    key: string,
    mediaType: UploadMediaType,
    now: number
  ): Promise<Message | null> {
    if (
      !isUploadMediaType(mediaType)
      || typeof deviceId !== 'string' || !deviceId
      || typeof key !== 'string' || !key
      || !Number.isFinite(now)
      || data.deviceId !== deviceId
      || data.mediaKey !== key
      || data.mediaType !== mediaType
    ) return null;
    const createdAt = Math.trunc(now);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT media_key, device_id, media_type, expires_at, cleanup_lease_until
         FROM media_uploads WHERE media_key = ? FOR UPDATE`,
        [key]
      );
      const record = rows[0] as MediaUploadRow | undefined;
      if (
        !record
        || String(record.device_id) !== deviceId
        || !isUploadMediaType(record.media_type)
        || record.media_type !== mediaType
        || Number(record.expires_at) <= createdAt
        || (Number(record.cleanup_lease_until) > createdAt)
      ) {
        await connection.rollback();
        return null;
      }
      const m: Message = {
        ...data,
        id: `msg-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
        createdAt,
        readers: [],
        likes: [],
      };
      await connection.query('DELETE FROM media_uploads WHERE media_key = ?', [key]);
      await this.insertMessage(m, connection);
      await connection.commit();
      return m;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[store] media claim rollback failed:', rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  private mapMediaUpload(row: MediaUploadRow): MediaUploadRecord {
    const attempts = Number(row.attempts);
    const createdAt = Number(row.created_at);
    const updatedAt = Number(row.updated_at);
    return {
      key: String(row.media_key),
      deviceId: String(row.device_id),
      mediaType: row.media_type,
      expiresAt: Number(row.expires_at),
      createdAt,
      attempts: Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0,
      error: row.error == null ? null : String(row.error).slice(0, 500),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : createdAt,
      cleanupLeaseUntil: Number.isFinite(Number(row.cleanup_lease_until))
        && Number(row.cleanup_lease_until) > 0
        ? Number(row.cleanup_lease_until)
        : null,
    };
  }

  async listExpiredMediaUploads(now: number, limit = 100): Promise<MediaUploadRecord[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(1000, Math.trunc(limit)))
      : 100;
    if (!Number.isFinite(now)) return [];
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT media_key, device_id, media_type, expires_at, created_at,
              attempts, error, updated_at, cleanup_lease_until
       FROM media_uploads
       WHERE expires_at <= ?
       ORDER BY expires_at ASC, created_at ASC, media_key ASC
       LIMIT ?`,
      [Math.trunc(now), safeLimit]
    );
    return rows
      .filter((row) => isUploadMediaType(row.media_type))
      .map((row) => this.mapMediaUpload(row as MediaUploadRow));
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
    const currentNow = Math.trunc(now);
    const leaseUntil = Math.min(Number.MAX_SAFE_INTEGER, currentNow + leaseMs);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT media_key, device_id, media_type, expires_at, created_at,
                attempts, error, updated_at, cleanup_lease_until
         FROM media_uploads WHERE media_key = ? FOR UPDATE`,
        [key]
      );
      const record = rows[0] as MediaUploadRow | undefined;
      const activeLease = record?.cleanup_lease_until == null
        ? 0
        : Number(record.cleanup_lease_until);
      if (
        !record
        || !isUploadMediaType(record.media_type)
        || Number(record.expires_at) > currentNow
        || (Number.isFinite(activeLease) && activeLease > currentNow)
      ) {
        await connection.rollback();
        return null;
      }
      await connection.query(
        `UPDATE media_uploads
         SET cleanup_lease_until = ?, updated_at = ?
         WHERE media_key = ?`,
        [leaseUntil, currentNow, key]
      );
      await connection.commit();
      return this.mapMediaUpload({
        ...record,
        cleanup_lease_until: leaseUntil,
        updated_at: currentNow,
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[store] media upload lease rollback failed:', rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async markMediaUploadCleanupSuccess(key: string): Promise<MediaUploadRecord | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT media_key, device_id, media_type, expires_at, created_at,
                attempts, error, updated_at, cleanup_lease_until
         FROM media_uploads WHERE media_key = ? FOR UPDATE`,
        [key]
      );
      const record = rows[0] as MediaUploadRow | undefined;
      if (!record) {
        await connection.rollback();
        return null;
      }
      await connection.query('DELETE FROM media_uploads WHERE media_key = ?', [key]);
      await connection.commit();
      return this.mapMediaUpload(record);
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[store] media upload cleanup rollback failed:', rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async markMediaUploadCleanupFailure(
    key: string,
    error: string
  ): Promise<MediaUploadRecord | null> {
    const safeError = String(error || 'unknown media upload cleanup error').slice(0, 500);
    await this.pool.query(
      `UPDATE media_uploads
       SET attempts = LEAST(attempts, 4294967294) + 1,
           error = ?, updated_at = ?, cleanup_lease_until = NULL
       WHERE media_key = ?`,
      [safeError, Date.now(), key]
    );
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT media_key, device_id, media_type, expires_at, created_at,
              attempts, error, updated_at, cleanup_lease_until
       FROM media_uploads WHERE media_key = ?`,
      [key]
    );
    return rows[0] && isUploadMediaType(rows[0].media_type)
      ? this.mapMediaUpload(rows[0] as MediaUploadRow)
      : null;
  }

  async listPendingMessages(): Promise<Message[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM messages WHERE moderation_status = 'pending' ORDER BY created_at ASC"
    );
    return this.assemble(rows as MessageRow[]);
  }

  async applyModerationOutcome(
    messageId: string,
    outcome: ModerationOutcome,
    publish: boolean
  ): Promise<Message | null> {
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE messages SET
         moderation_status = ?, moderation_model = ?, moderation_verdict = ?,
         moderation_severity = ?, moderation_reason = ?, moderation_categories = ?,
         moderation_decided_at = ?
       WHERE id = ? AND moderation_status = 'pending'`,
      [
        publish ? 'published' : 'pending',
        outcome.model.slice(0, 64),
        outcome.verdict,
        outcome.severity,
        outcome.reason.slice(0, 500),
        JSON.stringify(outcome.categories.slice(0, 20)),
        outcome.decidedAt,
        messageId,
      ]
    );
    if (result.affectedRows === 0) return null;
    return (await this.findMessage(messageId)) ?? null;
  }

  private mapDeviceModeration(row: DeviceModerationRow): DeviceModeration {
    return {
      deviceId: String(row.device_id),
      violationCount: Number(row.violation_count),
      bannedUntil: row.banned_until == null ? null : Number(row.banned_until),
      permanent: Boolean(row.permanent),
      reason: row.reason == null ? null : String(row.reason),
      updatedAt: Number(row.updated_at),
    };
  }

  private async upsertDeviceModeration(
    connection: mysql.PoolConnection,
    value: DeviceModeration
  ): Promise<void> {
    await connection.query(
      `INSERT INTO device_moderation
        (device_id, violation_count, banned_until, permanent, reason, updated_at)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         violation_count = VALUES(violation_count),
         banned_until = VALUES(banned_until),
         permanent = VALUES(permanent),
         reason = VALUES(reason),
         updated_at = VALUES(updated_at)`,
      [
        value.deviceId,
        value.violationCount,
        value.bannedUntil,
        value.permanent ? 1 : 0,
        value.reason,
        value.updatedAt,
      ]
    );
  }

  async reviewPendingMessage(
    messageId: string,
    input: ReviewPendingMessageInput
  ): Promise<ModerationReviewResult | null> {
    const snapshot = await this.findMessage(messageId);
    if (!snapshot || snapshot.moderationStatus !== 'pending') return null;
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [lockedRows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT device_id, media_key, moderation_status FROM messages WHERE id = ? FOR UPDATE",
        [messageId]
      );
      const locked = lockedRows[0];
      if (!locked || locked.moderation_status !== 'pending') {
        await connection.rollback();
        return null;
      }
      const deviceId = String(locked.device_id);
      const now = Date.now();
      const reviewerId = input.reviewerId.trim().slice(0, 64) || 'admin';
      const reason = input.reason?.trim().slice(0, 500) || null;
      let deviceModeration: DeviceModeration | null = null;

      if (input.decision === 'approve') {
        await connection.query(
          `UPDATE messages SET moderation_status = 'published',
             moderation_verdict = 'safe', moderation_reason = ?, moderation_decided_at = ?
           WHERE id = ? AND moderation_status = 'pending'`,
          [reason || '管理员复核通过', now, messageId]
        );
      } else {
        const mediaKey = typeof locked.media_key === 'string' && locked.media_key.trim()
          ? String(locked.media_key)
          : null;
        if (mediaKey) {
          const taskNow = Date.now();
          // The moderation review is unique per message. Keep the insert
          // deterministic so a recovered/legacy record cannot be duplicated.
          await connection.query(
            `INSERT INTO media_cleanup_tasks
              (id, message_id, media_key, attempt, error, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?)`,
            [messageId, messageId, mediaKey, 0, null, taskNow, taskNow]
          );
        }
        // Serialize confirmed strikes for the same identity, even when two
        // different pending messages are reviewed at the same time.
        await connection.query(
          'SELECT device_id FROM users WHERE device_id = ? FOR UPDATE',
          [deviceId]
        );
        const [restrictionRows] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT * FROM device_moderation WHERE device_id = ? FOR UPDATE',
          [deviceId]
        );
        const current = restrictionRows[0]
          ? this.mapDeviceModeration(restrictionRows[0] as DeviceModerationRow)
          : undefined;
        deviceModeration = restrictionAfterConfirmedViolation(
          current,
          deviceId,
          input.banMode ?? 'auto',
          reason ?? undefined,
          now
        );
        await this.upsertDeviceModeration(connection, deviceModeration);
        await connection.query('DELETE FROM message_readers WHERE message_id = ?', [messageId]);
        await connection.query('DELETE FROM message_likes WHERE message_id = ?', [messageId]);
        await connection.query('DELETE FROM notification_events WHERE message_id = ?', [messageId]);
        await connection.query(
          "DELETE FROM messages WHERE id = ? AND moderation_status = 'pending'",
          [messageId]
        );
      }

      await connection.query(
        `INSERT INTO moderation_reviews
          (message_id, device_id, decision, reviewer_id, reason, created_at)
         VALUES (?,?,?,?,?,?)`,
        [messageId, deviceId, input.decision, reviewerId, reason, now]
      );
      await connection.commit();
      return {
        message: input.decision === 'approve'
          ? {
            ...snapshot,
            moderationStatus: 'published',
            moderationVerdict: 'safe',
            moderationReason: reason || '管理员复核通过',
            moderationDecidedAt: now,
          }
          : snapshot,
        deviceModeration,
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[store] moderation review rollback failed:', rollbackError);
      }
      // A duplicate review means another reviewer completed the same item.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return null;
      throw error;
    } finally {
      connection.release();
    }
  }

  private mapMediaCleanupTask(row: MediaCleanupTaskRow): MediaCleanupTask {
    return {
      id: String(row.id),
      messageId: String(row.message_id),
      mediaKey: row.media_key == null ? null : String(row.media_key),
      attempt: Number(row.attempt),
      error: row.error == null ? null : String(row.error),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async listMediaCleanupTasks(limit = 100): Promise<MediaCleanupTask[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(1000, Math.trunc(limit)))
      : 100;
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, media_key, attempt, error, created_at, updated_at
       FROM media_cleanup_tasks
       WHERE media_key IS NOT NULL AND CHAR_LENGTH(media_key) > 0
       ORDER BY updated_at ASC, created_at ASC, id ASC
       LIMIT ?`,
      [safeLimit]
    );
    return rows.map((row) => this.mapMediaCleanupTask(row as MediaCleanupTaskRow));
  }

  async markMediaCleanupSuccess(taskId: string): Promise<MediaCleanupTask | null> {
    await this.pool.query(
      `UPDATE media_cleanup_tasks
       SET media_key = NULL, error = NULL, updated_at = ?
       WHERE id = ?`,
      [Date.now(), taskId]
    );
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, media_key, attempt, error, created_at, updated_at
       FROM media_cleanup_tasks WHERE id = ?`,
      [taskId]
    );
    return rows[0]
      ? this.mapMediaCleanupTask(rows[0] as MediaCleanupTaskRow)
      : null;
  }

  async markMediaCleanupFailure(
    taskId: string,
    error: string
  ): Promise<MediaCleanupTask | null> {
    const safeError = String(error || 'unknown media cleanup error').slice(0, 500);
    await this.pool.query(
      `UPDATE media_cleanup_tasks
       SET attempt = LEAST(attempt, 4294967294) + 1, error = ?, updated_at = ?
       WHERE id = ? AND media_key IS NOT NULL AND CHAR_LENGTH(media_key) > 0`,
      [safeError, Date.now(), taskId]
    );
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, media_key, attempt, error, created_at, updated_at
       FROM media_cleanup_tasks WHERE id = ?`,
      [taskId]
    );
    return rows[0]
      ? this.mapMediaCleanupTask(rows[0] as MediaCleanupTaskRow)
      : null;
  }

  async getDeviceModeration(deviceId: string): Promise<DeviceModeration | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM device_moderation WHERE device_id = ?',
      [deviceId]
    );
    return rows[0]
      ? this.mapDeviceModeration(rows[0] as DeviceModerationRow)
      : undefined;
  }

  async listDeviceModeration(): Promise<DeviceModeration[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM device_moderation ORDER BY updated_at DESC'
    );
    return rows.map((row) => this.mapDeviceModeration(row as DeviceModerationRow));
  }

  async setDeviceBan(
    deviceId: string,
    mode: Exclude<BanMode, 'auto' | 'none'>,
    reason?: string
  ): Promise<DeviceModeration> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'SELECT device_id FROM users WHERE device_id = ? FOR UPDATE',
        [deviceId]
      );
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT * FROM device_moderation WHERE device_id = ? FOR UPDATE',
        [deviceId]
      );
      const current = rows[0]
        ? this.mapDeviceModeration(rows[0] as DeviceModerationRow)
        : undefined;
      const next = restrictionAfterManualBan(current, deviceId, mode, reason, Date.now());
      await this.upsertDeviceModeration(connection, next);
      await connection.commit();
      return next;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async clearDeviceBan(deviceId: string): Promise<DeviceModeration> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT * FROM device_moderation WHERE device_id = ? FOR UPDATE',
        [deviceId]
      );
      const current = rows[0]
        ? this.mapDeviceModeration(rows[0] as DeviceModerationRow)
        : undefined;
      const next = unbannedRestriction(current, deviceId, Date.now());
      await this.upsertDeviceModeration(connection, next);
      await connection.commit();
      return next;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async addReader(messageId: string, deviceId: string): Promise<void> {
    await this.pool.query(
      'INSERT IGNORE INTO message_readers (message_id, device_id, read_at) VALUES (?,?,?)',
      [messageId, deviceId, Date.now()]
    );
  }

  async addLike(messageId: string, deviceId: string): Promise<boolean> {
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      'INSERT IGNORE INTO message_likes (message_id, device_id) VALUES (?,?)',
      [messageId, deviceId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Allocate an event id while holding the singleton row lock until commit.
   * MySQL AUTO_INCREMENT values follow insert order, not commit order; without
   * this gate a later id could become visible first and make a polling cursor
   * permanently skip the earlier transaction.
   */
  private async allocateNotificationEventId(
    connection: mysql.PoolConnection
  ): Promise<number> {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT next_id FROM notification_event_sequence WHERE singleton = 1 FOR UPDATE'
    );
    const id = Number(rows[0]?.next_id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('notification event sequence is unavailable');
    }
    await connection.query(
      'UPDATE notification_event_sequence SET next_id = next_id + 1 WHERE singleton = 1'
    );
    return id;
  }

  async addLikeAndCreateNotificationEvent(
    messageId: string,
    deviceId: string
  ): Promise<LikeResult> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [messages] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT device_id FROM messages WHERE id = ? FOR UPDATE',
        [messageId]
      );
      const recipientDeviceId = messages[0]?.device_id as string | undefined;
      if (!recipientDeviceId) {
        await connection.rollback();
        return { added: false, notificationEvent: null };
      }

      const [likeResult] = await connection.query<mysql.ResultSetHeader>(
        'INSERT IGNORE INTO message_likes (message_id, device_id) VALUES (?,?)',
        [messageId, deviceId]
      );
      if (likeResult.affectedRows === 0) {
        await connection.rollback();
        return { added: false, notificationEvent: null };
      }

      let notificationEvent: NotificationEvent | null = null;
      if (recipientDeviceId !== deviceId) {
        const createdAt = Date.now();
        const id = await this.allocateNotificationEventId(connection);
        await connection.query(
          `INSERT INTO notification_events
            (id, type, recipient_device_id, message_id, created_at)
           VALUES (?,?,?,?,?)`,
          [id, 'message_like', recipientDeviceId, messageId, createdAt]
        );
        notificationEvent = {
          id,
          type: 'message_like',
          recipientDeviceId,
          messageId,
          createdAt,
        };
      }

      await connection.commit();
      return { added: true, notificationEvent };
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[store] like transaction rollback failed:', rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async createNotificationEvent(
    data: Omit<NotificationEvent, 'id'>
  ): Promise<NotificationEvent> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const id = await this.allocateNotificationEventId(connection);
      await connection.query(
        `INSERT INTO notification_events
          (id, type, recipient_device_id, message_id, created_at)
         VALUES (?,?,?,?,?)`,
        [id, data.type, data.recipientDeviceId, data.messageId, data.createdAt]
      );
      await connection.commit();
      return { ...data, id };
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[store] notification transaction rollback failed:', rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async listNotificationEvents(
    recipientDeviceId: string,
    afterId: number,
    limit = 100,
    maxId?: number
  ): Promise<NotificationEvent[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const maxClause = maxId === undefined ? '' : ' AND id <= ?';
    const params: Array<string | number> = [recipientDeviceId, afterId];
    if (maxId !== undefined) params.push(maxId);
    params.push(safeLimit);
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT id, type, recipient_device_id, message_id, created_at
       FROM notification_events
       WHERE recipient_device_id = ? AND id > ?${maxClause}
       ORDER BY id ASC
       LIMIT ?`,
      params
    );
    return rows.map((row) => ({
      id: Number(row.id),
      type: row.type as NotificationEvent['type'],
      recipientDeviceId: String(row.recipient_device_id),
      messageId: String(row.message_id),
      createdAt: Number(row.created_at),
    }));
  }

  async getLatestNotificationEventId(recipientDeviceId: string): Promise<number> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT MAX(id) AS latest_id FROM notification_events WHERE recipient_device_id = ?',
      [recipientDeviceId]
    );
    return Number(rows[0]?.latest_id ?? 0);
  }

  async registerPushToken(deviceId: string, token: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Serialize registrations for one identity so the per-device cap remains
      // deterministic even when several installations register together.
      await connection.query(
        'SELECT device_id FROM users WHERE device_id = ? FOR UPDATE',
        [deviceId]
      );
      await connection.query(
        `INSERT INTO push_tokens (device_id, token, updated_at)
         VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE
           device_id = VALUES(device_id),
           updated_at = VALUES(updated_at)`,
        [deviceId, token, Date.now()]
      );
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT token FROM push_tokens WHERE device_id = ?
         ORDER BY (BINARY token = BINARY ?) DESC, updated_at DESC, token DESC FOR UPDATE`,
        [deviceId, token]
      );
      const staleTokens = rows
        .slice(MAX_PUSH_TOKENS_PER_DEVICE)
        .map((row) => String(row.token));
      if (staleTokens.length > 0) {
        const placeholders = staleTokens.map(() => '?').join(',');
        await connection.query(
          `DELETE FROM push_tokens WHERE device_id = ? AND token IN (${placeholders})`,
          [deviceId, ...staleTokens]
        );
      }
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[store] push token transaction rollback failed:', rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async unregisterPushToken(deviceId: string, token: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM push_tokens WHERE device_id = ? AND token = ?',
      [deviceId, token]
    );
  }

  async listPushTokens(deviceId: string): Promise<PushToken[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT device_id, token, updated_at FROM push_tokens WHERE device_id = ?',
      [deviceId]
    );
    return rows.map((row) => ({
      deviceId: String(row.device_id),
      token: String(row.token),
      updatedAt: Number(row.updated_at),
    }));
  }
}
