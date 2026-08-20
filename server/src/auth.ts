import crypto from 'node:crypto';

/**
 * 轻量防刷：注册时签发 token = HMAC-SHA256(device_id, SERVER_SECRET)
 * 开信、点赞需携带 x-device-token，服务端校验与 device_id 匹配。
 * SERVER_SECRET 未设置时跳过全部校验（开发态默认，行为不变）。
 */
const secret = (): string => process.env.SERVER_SECRET || '';

export const issueToken = (deviceId: string): string | null =>
  secret() ? crypto.createHmac('sha256', secret()).update(deviceId).digest('hex') : null;

export const tokenValid = (deviceId: string, token: string | undefined): boolean => {
  if (!secret()) return true;
  if (!deviceId || !token) return false;
  const expected = issueToken(deviceId)!;
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
};
