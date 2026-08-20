/**
 * 统一存储接口：uploadBuffer / getPublicUrl / delete
 *
 * STORAGE_PROVIDER 环境变量切换实现：
 * - 未设置或 "coze"：扣子 S3Storage（开发态默认）
 * - "qiniu"：AWS S3 兼容 SDK 直连七牛 Kodo（Kodo 原生兼容 S3 协议）
 *   所需环境变量：QINIU_S3_ENDPOINT / QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET
 *
 * 注意：provider 按需动态加载，qiniu 模式下不会 import 扣子 SDK（非扣子环境会挂）。
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
        : import('./cozeProvider').then((m) => m.createCozeDriver());
  }
  return driverPromise;
}

/** 开信/读取时动态生成可公网直接访问的 URL（有效期 7 天，不持久化） */
export const mediaUrlOf = async (key: string): Promise<string> =>
  (await getStorage()).getPublicUrl(key);
