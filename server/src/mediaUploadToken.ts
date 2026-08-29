import crypto from 'node:crypto';
import type { MediaType } from './types';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const tokenSecret = (
  process.env.MEDIA_UPLOAD_TOKEN_SECRET
  || process.env.SERVER_SECRET
  || crypto.randomBytes(32).toString('hex')
);

const signatureOf = (
  deviceId: string,
  key: string,
  mediaType: Exclude<MediaType, 'none'>,
  expiresAt: number
): string => crypto
  .createHmac('sha256', tokenSecret)
  .update(`${deviceId}\n${key}\n${mediaType}\n${expiresAt}`)
  .digest('base64url');

export const issueMediaUploadTicket = (
  deviceId: string,
  key: string,
  mediaType: Exclude<MediaType, 'none'>,
  now = Date.now()
): { token: string; expiresAt: number } => {
  const expiresAt = now + TOKEN_TTL_MS;
  return {
    token: `${expiresAt}.${signatureOf(deviceId, key, mediaType, expiresAt)}`,
    expiresAt,
  };
};

export const issueMediaUploadToken = (
  deviceId: string,
  key: string,
  mediaType: Exclude<MediaType, 'none'>,
  now = Date.now()
): string => issueMediaUploadTicket(deviceId, key, mediaType, now).token;

export const mediaUploadTokenValid = (
  token: unknown,
  deviceId: string,
  key: string,
  mediaType: Exclude<MediaType, 'none'>,
  now = Date.now()
): boolean => {
  if (typeof token !== 'string') return false;
  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  const supplied = token.slice(separator + 1);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + TOKEN_TTL_MS + 60_000) {
    return false;
  }
  const expected = signatureOf(deviceId, key, mediaType, expiresAt);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
