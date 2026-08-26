/**
 * 统一存储接口：uploadBuffer / getPublicUrl / delete
 *
 * STORAGE_PROVIDER 环境变量切换实现：
 * - 未设置或 "coze"：扣子 S3Storage（开发态默认）
 * - "qiniu"：AWS S3 兼容 SDK 直连七牛 Kodo（Kodo 原生兼容 S3 协议）
 *   所需环境变量：QINIU_S3_ENDPOINT / QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET
 * - "local"：本地磁盘 data/uploads/（普通服务器过渡方案，无对象存储时用）
 *   所需环境变量：PUBLIC_BASE_URL（媒体 URL 前缀，如 http://<公网IP>:9091）
 *
 * 注意：provider 按需动态加载，qiniu/local 模式下不会 import 扣子 SDK（非扣子环境会挂）。
 */
export interface StorageDriver {
  uploadBuffer(buf: Buffer, key: string, contentType: string): Promise<string>;
  getPublicUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

let driverPromise: Promise<StorageDriver> | null = null;

export function getStorage(): Promise<StorageDriver> {
  if (!driverPromise) {
    const provider = (process.env.STORAGE_PROVIDER || 'coze').toLowerCase();
    driverPromise =
      provider === 'qiniu'
        ? import('./qiniuProvider').then((m) => m.createQiniuDriver())
        : provider === 'local'
          ? import('./localProvider').then((m) => m.createLocalDriver())
          : import('./cozeProvider').then((m) => m.createCozeDriver());
  }
  return driverPromise;
}

/** 开信/读取时动态生成可公网直接访问的 URL（有效期 7 天，不持久化） */
export const mediaUrlOf = async (key: string): Promise<string> =>
  (await getStorage()).getPublicUrl(key);
