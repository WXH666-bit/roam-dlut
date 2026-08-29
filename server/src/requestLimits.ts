type LimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; reason: 'ip_limit' | 'global_budget' };

interface Bucket {
  count: number;
  startedAt: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const registrationByIp = new Map<string, Bucket>();
const moderationByIp = new Map<string, Bucket>();
const uploadByIp = new Map<string, Bucket>();
const uploadByDevice = new Map<string, Bucket>();
let globalModeration: Bucket | undefined;
let callsSinceCleanup = 0;

const configuredLimit = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

const normalizedKey = (value: string): string => value.trim().slice(0, 128) || 'unknown';

const currentBucket = (
  buckets: Map<string, Bucket>,
  key: string,
  windowMs: number,
  now: number
): Bucket => {
  const normalized = normalizedKey(key);
  const existing = buckets.get(normalized);
  if (existing && now - existing.startedAt < windowMs) return existing;
  const fresh = { count: 0, startedAt: now };
  buckets.set(normalized, fresh);
  return fresh;
};

const retryAfterSeconds = (bucket: Bucket, windowMs: number, now: number): number => (
  Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000))
);

const cleanupExpired = (now: number): void => {
  callsSinceCleanup += 1;
  if (callsSinceCleanup < 200) return;
  callsSinceCleanup = 0;
  for (const buckets of [registrationByIp, moderationByIp, uploadByIp, uploadByDevice]) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= DAY_MS) buckets.delete(key);
    }
  }
};

const consumeSingle = (
  buckets: Map<string, Bucket>,
  key: string,
  limit: number,
  windowMs: number,
  now: number
): LimitDecision => {
  cleanupExpired(now);
  const bucket = currentBucket(buckets, key, windowMs, now);
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: retryAfterSeconds(bucket, windowMs, now), reason: 'ip_limit' };
  }
  bucket.count += 1;
  return { allowed: true };
};

/** Limits creation of new anonymous identities; existing registrations remain idempotent. */
export const consumeRegistration = (ip: string, now = Date.now()): LimitDecision => (
  consumeSingle(
    registrationByIp,
    ip,
    configuredLimit('REGISTRATION_IP_HOURLY_LIMIT', 20),
    HOUR_MS,
    now
  )
);

/**
 * Applies both a per-IP throttle and a hard process-wide daily model budget.
 * Counters are intentionally in-memory for this small single-instance server;
 * production multi-instance deployments should replace this with Redis/API-gateway limits.
 */
export const consumeModerationBudget = (ip: string, now = Date.now()): LimitDecision => {
  cleanupExpired(now);
  const ipBucket = currentBucket(moderationByIp, ip, HOUR_MS, now);
  const ipLimit = configuredLimit('MODERATION_IP_HOURLY_LIMIT', 30);
  if (ipBucket.count >= ipLimit) {
    return { allowed: false, retryAfterSeconds: retryAfterSeconds(ipBucket, HOUR_MS, now), reason: 'ip_limit' };
  }

  if (!globalModeration || now - globalModeration.startedAt >= DAY_MS) {
    globalModeration = { count: 0, startedAt: now };
  }
  const globalLimit = configuredLimit('MODERATION_GLOBAL_DAILY_LIMIT', 500);
  if (globalModeration.count >= globalLimit) {
    return {
      allowed: false,
      retryAfterSeconds: retryAfterSeconds(globalModeration, DAY_MS, now),
      reason: 'global_budget',
    };
  }

  ipBucket.count += 1;
  globalModeration.count += 1;
  return { allowed: true };
};

/** Rejects repeated large uploads before multer allocates their buffers. */
export const consumeUploadBudget = (
  ip: string,
  deviceId: string,
  now = Date.now()
): LimitDecision => {
  cleanupExpired(now);
  const ipBucket = currentBucket(uploadByIp, ip, HOUR_MS, now);
  const deviceBucket = currentBucket(uploadByDevice, deviceId, HOUR_MS, now);
  const limit = configuredLimit('UPLOAD_IP_HOURLY_LIMIT', 30);
  const deviceLimit = configuredLimit('UPLOAD_DEVICE_HOURLY_LIMIT', 20);
  if (ipBucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: retryAfterSeconds(ipBucket, HOUR_MS, now), reason: 'ip_limit' };
  }
  if (deviceBucket.count >= deviceLimit) {
    return { allowed: false, retryAfterSeconds: retryAfterSeconds(deviceBucket, HOUR_MS, now), reason: 'ip_limit' };
  }
  ipBucket.count += 1;
  deviceBucket.count += 1;
  return { allowed: true };
};

/** Test-only reset; it is not used by request handlers. */
export const resetRequestLimitsForTests = (): void => {
  registrationByIp.clear();
  moderationByIp.clear();
  uploadByIp.clear();
  uploadByDevice.clear();
  globalModeration = undefined;
  callsSinceCleanup = 0;
};
