import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { StorageDriver } from './index';

/** 本地磁盘存储目录（相对 server 工作目录，与 data/store.json 同级） */
export const LOCAL_UPLOADS_DIR = path.resolve('data/uploads');

const KEY_PATTERN = /^[A-Za-z0-9\-_./]+$/;
const LOCAL_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const localMediaSecret = (
  process.env.LOCAL_MEDIA_SIGNING_SECRET
  || process.env.SERVER_SECRET
  || crypto.randomBytes(32).toString('hex')
);

/** 路径穿越防御：白名单字符 + 拒绝 .. 段，返回落盘绝对路径 */
const safePathOf = (key: string): string => {
  if (!KEY_PATTERN.test(key) || key.split('/').includes('..')) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return path.join(LOCAL_UPLOADS_DIR, key);
};

const signatureOf = (key: string, expires: number): string => crypto
  .createHmac('sha256', localMediaSecret)
  .update(`${key}\n${expires}`)
  .digest('base64url');

export const localMediaRequestValid = (
  key: string,
  expiresValue: unknown,
  signatureValue: unknown,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean => {
  try {
    safePathOf(key);
  } catch {
    return false;
  }
  const expires = Number(expiresValue);
  const supplied = typeof signatureValue === 'string' ? signatureValue : '';
  if (!Number.isSafeInteger(expires) || expires <= nowSeconds || !supplied) return false;
  // Do not accept arbitrarily long-lived caller-created URLs.
  if (expires > nowSeconds + LOCAL_URL_TTL_SECONDS + 60) return false;
  const expected = signatureOf(key, expires);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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
      const expires = Math.floor(Date.now() / 1000) + LOCAL_URL_TTL_SECONDS;
      const signature = signatureOf(key, expires);
      return `${baseUrl}/media/${key}?expires=${expires}&signature=${encodeURIComponent(signature)}`;
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
