import { S3Storage } from 'coze-coding-dev-sdk';
import type { StorageDriver } from './index';

export function createCozeDriver(): StorageDriver {
  const storage = new S3Storage({
    endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
    accessKey: '',
    secretKey: '',
    bucketName: process.env.COZE_BUCKET_NAME,
    region: 'cn-beijing',
  });
  return {
    async uploadBuffer(buf, key, contentType) {
      return storage.uploadFile({ fileContent: buf, fileName: key, contentType });
    },
    async getPublicUrl(key) {
      return storage.generatePresignedUrl({ key, expireTime: 7 * 86400 });
    },
    async delete(key) {
      await storage.deleteFile({ fileKey: key });
    },
  };
}
