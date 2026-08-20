import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver } from './index';

/** 七牛 Kodo（兼容 S3 协议），凭证全部来自环境变量 */
export function createQiniuDriver(): StorageDriver {
  const endpoint = process.env.QINIU_S3_ENDPOINT;
  const accessKey = process.env.QINIU_ACCESS_KEY;
  const secretKey = process.env.QINIU_SECRET_KEY;
  const bucket = process.env.QINIU_BUCKET;
  if (!endpoint || !accessKey || !secretKey || !bucket) {
    throw new Error(
      'STORAGE_PROVIDER=qiniu 需要环境变量 QINIU_S3_ENDPOINT / QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET'
    );
  }

  const client = new S3Client({
    endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
    region: 'cn-east-1', // Kodo 不校验 region，S3 SDK 要求必填
    forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  return {
    async uploadBuffer(buf, key, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: contentType })
      );
      return key;
    },
    async getPublicUrl(key) {
      // SigV4 签名 URL 最长 7 天；开信时实时生成，足够使用
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: 7 * 86400,
      });
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
