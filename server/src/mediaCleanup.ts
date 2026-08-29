import { getStorage } from './storage';
import {
  listMediaCleanupTasks,
  listMessages,
  markMediaCleanupFailure,
  markMediaCleanupSuccess,
} from './store';

export interface MediaCleanupSummary {
  attempted: number;
  deleted: number;
  retainedBecauseReferenced: number;
  failed: number;
  remaining: number;
}

/**
 * Retry durable deletion jobs created in the same transaction as an admin
 * rejection. A shared object is retained while another message references it;
 * the task key is then cleared because that object no longer belongs solely to
 * the rejected row.
 */
const runMediaCleanup = async (limit: number): Promise<MediaCleanupSummary> => {
  const tasks = await listMediaCleanupTasks(limit);
  const referencedKeys = new Set(
    (await listMessages())
      .map((message) => message.mediaKey)
      .filter((key): key is string => typeof key === 'string' && key.length > 0)
  );
  const storage = await getStorage();
  let deleted = 0;
  let retainedBecauseReferenced = 0;
  let failed = 0;

  for (const task of tasks) {
    if (!task.mediaKey) continue;
    if (referencedKeys.has(task.mediaKey)) {
      await markMediaCleanupSuccess(task.id);
      retainedBecauseReferenced += 1;
      continue;
    }
    try {
      await storage.delete(task.mediaKey);
      await markMediaCleanupSuccess(task.id);
      deleted += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown storage error';
      await markMediaCleanupFailure(task.id, reason);
      failed += 1;
    }
  }

  return {
    attempted: tasks.length,
    deleted,
    retainedBecauseReferenced,
    failed,
    remaining: (await listMediaCleanupTasks(1000)).length,
  };
};

let activeRun: Promise<MediaCleanupSummary> | null = null;

/** Coalesce startup, timer, and administrator retries into one storage pass. */
export const retryMediaCleanupTasks = (limit = 100): Promise<MediaCleanupSummary> => {
  if (activeRun) return activeRun;
  activeRun = runMediaCleanup(limit).finally(() => {
    activeRun = null;
  });
  return activeRun;
};
