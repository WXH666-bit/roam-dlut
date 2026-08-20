import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import type { Message, MediaType, User } from '../types';
import { buildSeedMessages } from '../seeds';
import { randomFlowerName } from '../flowerNames';
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
  created_at: number;
}

/** MySQL 实现（设 DATABASE_URL 时启用），表结构见 server/migrate.sql */
export class MysqlStore implements DataStore {
  private pool: mysql.Pool;

  constructor(databaseUrl: string) {
    this.pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 5 });
  }

  async init(): Promise<void> {
    // 自动确保表结构存在；migrate.sql 供手动一键执行，二者等价
    await this.pool.query(`CREATE TABLE IF NOT EXISTS users (
      device_id VARCHAR(64) PRIMARY KEY,
      flower_name VARCHAR(32) NOT NULL,
      renamed TINYINT(1) NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(32) PRIMARY KEY,
      device_id VARCHAR(64) NOT NULL,
      flower_name VARCHAR(32) NOT NULL,
      text VARCHAR(600) NOT NULL,
      media_type ENUM('none','image','video') NOT NULL DEFAULT 'none',
      media_key VARCHAR(512) NULL,
      lat DOUBLE NOT NULL,
      lng DOUBLE NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_messages_device (device_id),
      INDEX idx_messages_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
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
      'INSERT INTO messages (id, device_id, flower_name, text, media_type, media_key, lat, lng, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [m.id, m.deviceId, m.flowerName, m.text, m.mediaType, m.mediaKey, m.lat, m.lng, m.createdAt]
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
    return rows.map((r) => ({
      id: r.id,
      deviceId: r.device_id,
      flowerName: r.flower_name,
      text: r.text,
      mediaType: r.media_type,
      mediaKey: r.media_key,
      lat: Number(r.lat),
      lng: Number(r.lng),
      createdAt: Number(r.created_at),
      readers: readersOf.get(r.id) ?? [],
      likes: likesOf.get(r.id) ?? [],
    }));
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

  async findUser(deviceId: string): Promise<User | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM users WHERE device_id = ?', [deviceId]
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      deviceId: r.device_id,
      flowerName: r.flower_name,
      renamed: Boolean(r.renamed),
      createdAt: Number(r.created_at),
    };
  }

  async ensureUser(deviceId: string): Promise<User> {
    const existing = await this.findUser(deviceId);
    if (existing) return existing;
    const u: User = { deviceId, flowerName: randomFlowerName(), renamed: false, createdAt: Date.now() };
    await this.pool.query(
      'INSERT IGNORE INTO users (device_id, flower_name, renamed, created_at) VALUES (?,?,?,?)',
      [u.deviceId, u.flowerName, 0, u.createdAt]
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

  async addLike(messageId: string, deviceId: string): Promise<void> {
    await this.pool.query(
      'INSERT IGNORE INTO message_likes (message_id, device_id) VALUES (?,?)',
      [messageId, deviceId]
    );
  }
}
