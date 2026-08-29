import { getStorage } from './storage';
import {
  claimExpiredMediaUploadForCleanup,
  listExpiredMediaUploads,
  markMediaUploadCleanupFailure,
  markMediaUploadCleanupSuccess,
} from './store';

export interface MediaUploadCleanupSummary {
  attempted: number;
  deleted: number;
  failed: number;
  remainingExpired: number;
}

const CLEANUP_LEASE_MS = 5 * 60 * 1000;

const run = async (limit: number): Promise<MediaUploadCleanupSummary> => {
  const now = Date.now();
  const records = await listExpiredMediaUploads(now, limit);
  const storage = await getStorage();
  let deleted = 0;
  let failed = 0;
  for (const record of records) {
    const leased = await claimExpiredMediaUploadForCleanup(
      record.key,
      Date.now(),
      CLEANUP_LEASE_MS
    );
    if (!leased) continue;
    try {
      await storage.delete(leased.key);
      await markMediaUploadCleanupSuccess(leased.key);
      deleted += 1;
    } catch (error) {
      await markMediaUploadCleanupFailure(
        leased.key,
        error instanceof Error ? error.message : 'unknown storage error'
      );
      failed += 1;
    }
  }
  return {
    attempted: records.length,
    deleted,
    failed,
    remainingExpired: (await listExpiredMediaUploads(Date.now(), 1000)).length,
  };
};

let activeRun: Promise<MediaUploadCleanupSummary> | null = null;

/** Delete uploads that were never atomically claimed by a message. */
export const retryExpiredMediaUploads = (limit = 100): Promise<MediaUploadCleanupSummary> => {
  if (activeRun) return activeRun;
  activeRun = run(limit).finally(() => {
    activeRun = null;
  });
  return activeRun;
};
