import { hitSensitiveWord } from './sensitiveWords';
import { moderateContent } from './moderation';
import { mediaUrlOf } from './storage';
import {
  applyModerationOutcome,
  findMessage,
  listPendingMessages,
} from './store';
import type { ModerationOutcome } from './types';

const queuedIds = new Set<string>();
const queue: string[] = [];
let activeWorkers = 0;
let pumpScheduled = false;

const concurrency = (): number => {
  const configured = Number(process.env.MODERATION_CONCURRENCY);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 8)
    : 2;
};

const errorOutcome = (reason: string): ModerationOutcome => ({
  verdict: 'error',
  severity: 'high',
  reason,
  categories: ['media_unavailable'],
  model: process.env.STEPFUN_MODEL?.trim() || 'step-3.7-flash',
  decidedAt: Date.now(),
});

const processMessage = async (messageId: string): Promise<void> => {
  const message = await findMessage(messageId);
  if (!message || message.moderationStatus !== 'pending' || message.moderationDecidedAt) return;

  let outcome: ModerationOutcome;
  try {
    const mediaUrl = message.mediaKey ? await mediaUrlOf(message.mediaKey) : null;
    const result = await moderateContent({
      text: message.text,
      mediaType: message.mediaType,
      mediaKey: message.mediaKey,
      mediaUrl,
    });
    outcome = { ...result, decidedAt: Date.now() };
  } catch {
    outcome = errorOutcome('媒体暂时无法提交给审核服务。');
  }

  // The explicit local list is a conservative second opinion. It may route a
  // model-safe item to a human, but it never rejects or penalizes a user itself.
  const localSensitiveHit = hitSensitiveWord(message.text);
  if (localSensitiveHit && outcome.verdict === 'safe') {
    outcome = {
      ...outcome,
      verdict: 'review',
      severity: 'high',
      reason: '本地敏感规则命中，需管理员复核。',
      categories: [...new Set([...outcome.categories, 'local_sensitive_word'])],
    };
  }
  await applyModerationOutcome(message.id, outcome, outcome.verdict === 'safe');
};

const pump = (): void => {
  pumpScheduled = false;
  while (activeWorkers < concurrency() && queue.length > 0) {
    const messageId = queue.shift()!;
    activeWorkers += 1;
    void processMessage(messageId)
      .catch((error) => {
        // A wholly unexpected workflow error still leaves the item hidden. It
        // will be visible to an administrator and retried after a restart only
        // if no decision was persisted.
        console.error('[moderation] background job failed:', {
          messageId,
          error: error instanceof Error ? error.message : 'unknown',
        });
      })
      .finally(() => {
        activeWorkers -= 1;
        queuedIds.delete(messageId);
        schedulePump();
      });
  }
};

const schedulePump = (): void => {
  if (pumpScheduled) return;
  pumpScheduled = true;
  queueMicrotask(pump);
};

/** Queue a durable pending row for bounded-concurrency background review. */
export const enqueueMessageModeration = (messageId: string): void => {
  if (queuedIds.has(messageId)) return;
  queuedIds.add(messageId);
  queue.push(messageId);
  schedulePump();
};

/** Resume only jobs that crashed before persisting any model decision. */
export const resumePendingModeration = async (): Promise<number> => {
  const pending = await listPendingMessages();
  const unfinished = pending.filter((message) => !message.moderationDecidedAt);
  for (const message of unfinished) enqueueMessageModeration(message.id);
  return unfinished.length;
};
