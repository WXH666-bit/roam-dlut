import { S3Storage } from 'coze-coding-dev-sdk';

export const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

// 访问 URL 有效期：7 天（每次开信动态生成，不持久化）
export const mediaUrlOf = async (key: string): Promise<string> =>
  storage.generatePresignedUrl({ key, expireTime: 7 * 86400 });
