/**
 * 数据层：环境变量 DATABASE_URL 切换实现
 * - 未设置：内存 + JSON 文件持久化（开发态默认，行为与此前完全一致）
 * - 已设置：MySQL（mysql2 连接池），表结构见 server/migrate.sql
 *
 * 注意：实现按需动态加载，未设 DATABASE_URL 时不会加载 mysql2 连接逻辑。
 */
import type { Message, User } from '../types';

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
  addReader(messageId: string, deviceId: string): Promise<void>;
  addLike(messageId: string, deviceId: string): Promise<void>;
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
export const addReader = (messageId: string, deviceId: string) =>
  need().addReader(messageId, deviceId);
export const addLike = (messageId: string, deviceId: string) =>
  need().addLike(messageId, deviceId);
