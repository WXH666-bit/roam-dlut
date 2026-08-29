import { Router } from 'express';
import { requireAdmin } from '../adminAuth';
import {
  clearDeviceBan,
  getDeviceModeration,
  listExpiredMediaUploads,
  listDeviceModeration,
  listMediaCleanupTasks,
  listPendingMessages,
  reviewPendingMessage,
  setDeviceBan,
} from '../store';
import { activeRestriction } from '../moderationPolicy';
import { mediaUrlOf } from '../storage';
import type { BanMode, Message } from '../types';
import { retryMediaCleanupTasks } from '../mediaCleanup';
import { retryExpiredMediaUploads } from '../mediaUploadCleanup';

const router = Router();
router.use(requireAdmin);

const REVIEW_BAN_MODES = new Set<BanMode>([
  'auto', 'none', '1d', '7d', '30d', 'permanent',
]);
const MANUAL_BAN_MODES = new Set<Exclude<BanMode, 'auto' | 'none'>>([
  '1d', '7d', '30d', 'permanent',
]);

const reviewerIdOf = (value: unknown): string => (
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 64)
    : 'admin'
);

const reasonOf = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : undefined
);

const adminMessage = async (message: Message) => {
  let mediaUrl: string | null = null;
  let mediaError = false;
  if (message.mediaKey) {
    try {
      mediaUrl = await mediaUrlOf(message.mediaKey);
    } catch {
      // One missing/broken object must not make the entire review queue fail.
      mediaError = true;
    }
  }
  return {
    id: message.id,
    device_id: message.deviceId,
    flower_name: message.flowerName,
    text: message.text,
    media_type: message.mediaType,
    media_url: mediaUrl,
    media_error: mediaError,
    lat: message.lat,
    lng: message.lng,
    created_at: message.createdAt,
    moderation: {
      model: message.moderationModel ?? null,
      verdict: message.moderationVerdict ?? null,
      severity: message.moderationSeverity ?? null,
      reason: message.moderationReason ?? null,
      categories: message.moderationCategories ?? [],
      requested_at: message.moderationRequestedAt ?? null,
      decided_at: message.moderationDecidedAt ?? null,
    },
    device: await getDeviceModeration(message.deviceId) ?? null,
  };
};

router.get('/moderation/pending', async (_req, res) => {
  const pending = await listPendingMessages();
  return res.json({
    list: await Promise.all(pending.map((message) => adminMessage(message))),
    total: pending.length,
  });
});

router.post('/moderation/:id/approve', async (req, res) => {
  const result = await reviewPendingMessage(req.params.id, {
    decision: 'approve',
    reviewerId: reviewerIdOf(req.body?.reviewer_id),
    reason: reasonOf(req.body?.reason),
  });
  if (!result) return res.status(409).json({ error: 'already_reviewed_or_missing' });
  return res.json({ ok: true, id: result.message.id, status: 'published' });
});

router.post('/moderation/:id/reject', async (req, res) => {
  const requestedMode = req.body?.ban_mode;
  if (requestedMode != null && !REVIEW_BAN_MODES.has(requestedMode)) {
    return res.status(400).json({ error: 'invalid_ban_mode' });
  }
  const result = await reviewPendingMessage(req.params.id, {
    decision: 'reject',
    reviewerId: reviewerIdOf(req.body?.reviewer_id),
    reason: reasonOf(req.body?.reason),
    banMode: (requestedMode as BanMode | undefined) ?? 'auto',
  });
  if (!result) return res.status(409).json({ error: 'already_reviewed_or_missing' });

  // The rejection transaction already persisted a deletion task. Attempt it
  // immediately, while retaining a durable retry record on storage failure.
  if (result.message.mediaKey) void retryMediaCleanupTasks(20).catch((error) => {
    console.error('[moderation] media cleanup worker failed:', {
      messageId: result.message.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
  return res.json({
    ok: true,
    id: result.message.id,
    status: 'deleted',
    device: result.deviceModeration,
  });
});

router.get('/moderation/cleanup', async (_req, res) => {
  const [tasks, expiredUploads] = await Promise.all([
    listMediaCleanupTasks(1000),
    listExpiredMediaUploads(Date.now(), 1000),
  ]);
  return res.json({
    total: tasks.length,
    abandoned_uploads_total: expiredUploads.length,
    list: tasks.map((task) => ({
      id: task.id,
      message_id: task.messageId,
      attempts: task.attempt,
      last_error: task.error,
      updated_at: task.updatedAt,
    })),
  });
});

router.post('/moderation/cleanup/retry', async (_req, res) => {
  const [rejected, abandonedUploads] = await Promise.all([
    retryMediaCleanupTasks(100),
    retryExpiredMediaUploads(100),
  ]);
  return res.json({ rejected, abandoned_uploads: abandonedUploads });
});

router.get('/bans', async (_req, res) => {
  const list = await listDeviceModeration();
  const now = Date.now();
  return res.json({
    list: list.map((item) => ({
      device_id: item.deviceId,
      violation_count: item.violationCount,
      banned_until: item.bannedUntil,
      permanent: item.permanent,
      reason: item.reason,
      updated_at: item.updatedAt,
      active: Boolean(activeRestriction(item, now)),
    })),
  });
});

router.post('/bans/:deviceId', async (req, res) => {
  const mode = req.body?.ban_mode;
  if (!MANUAL_BAN_MODES.has(mode)) {
    return res.status(400).json({ error: 'invalid_ban_mode' });
  }
  const result = await setDeviceBan(
    req.params.deviceId.slice(0, 64),
    mode as Exclude<BanMode, 'auto' | 'none'>,
    reasonOf(req.body?.reason)
  );
  return res.json({ ok: true, device: result });
});

router.delete('/bans/:deviceId', async (req, res) => {
  const result = await clearDeviceBan(req.params.deviceId.slice(0, 64));
  return res.json({ ok: true, device: result });
});

export default router;
