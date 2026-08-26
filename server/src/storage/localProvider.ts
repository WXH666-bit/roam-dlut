import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageDriver } from './index';

/** 本地磁盘存储目录（相对 server 工作目录，与 data/store.json 同级） */
export const LOCAL_UPLOADS_DIR = path.resolve('data/uploads');

const KEY_PATTERN = /^[A-Za-z0-9\-_./]+$/;

/** 路径穿越防御：白名单字符 + 拒绝 .. 段，返回落盘绝对路径 */
const safePathOf = (key: string): string => {
  if (!KEY_PATTERN.test(key) || key.split('/').includes('..')) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return path.join(LOCAL_UPLOADS_DIR, key);
};

/** 本地磁盘驱动：普通服务器部署的过渡方案，媒体经 /media 静态服务直接暴露 */
export function createLocalDriver(): StorageDriver {
  const baseUrl = (
    process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 9091}`
  ).replace(/\/+$/, '');

  return {
    async uploadBuffer(buf, key) {
      const filePath = safePathOf(key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, buf);
      return key;
    },
    async getPublicUrl(key) {
      safePathOf(key);
      return `${baseUrl}/media/${key}`;
    },
    async delete(key) {
      try {
        await unlink(safePathOf(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    },
  };
}
