import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import type {
  LikeResult,
  Message,
  MediaType,
  NotificationEvent,
  PushToken,
  User,
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
}

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
      media_type ENUM('none','image','video') NOT NULL DEFAULT 'none',
      media_key VARCHAR(512) NULL,
      lat DOUBLE NOT NULL,
      lng DOUBLE NOT NULL,
      coordinate_system VARCHAR(16) NULL,
      accuracy DOUBLE NULL,
      captured_at BIGINT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_messages_device (device_id),
      INDEX idx_messages_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Keep existing deployments readable without rewriting their coordinates.
    // NULL means the pre-metadata (implicitly WGS-84) API shape.
    const [messageColumns] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name FROM information_schema.COLUMNS
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

  private async insertMessage(m: Message): Promise<void> {
    await this.pool.query(
      `INSERT INTO messages
        (id, device_id, flower_name, text, media_type, media_key, lat, lng,
         coordinate_system, accuracy, captured_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: Date.now(),
      readers: [],
      likes: [],
    };
    await this.insertMessage(m);
    return m;
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
