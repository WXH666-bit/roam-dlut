import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { getStorage } from '../storage';
import { describeUploadMime, MEDIA_MAX_BYTES, uploadSignatureMatches } from '../media';
import { tokenValid } from '../auth';
import {
  getDeviceModeration,
  markMediaUploadCleanupFailure,
  markMediaUploadCleanupSuccess,
  registerMediaUpload,
} from '../store';
import { activeRestriction } from '../moderationPolicy';
import { issueMediaUploadTicket } from '../mediaUploadToken';
import { consumeUploadBudget } from '../requestLimits';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  // 独立保留 120MB 上限：该路由使用内存缓冲，不能让单次上传无限占用进程内存。
  limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 4, parts: 5 },
});
let activeUploads = 0;

const maxConcurrentUploads = (): number => {
  const configured = Number(process.env.UPLOAD_MAX_CONCURRENCY);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 8)
    : 2;
};

// 上传图片/视频/音频：multipart 字段名 file；审核前只返回存储 key。
router.post('/', async (req, res) => {
  // Authentication is deliberately header-only at preflight: accepting a form
  // fallback would force multer to buffer up to 120 MB before the server could
  // reject a banned or forged request.
  const headerDeviceId = req.get('x-device-id')?.trim().slice(0, 64) || '';
  if (!headerDeviceId) return res.status(400).json({ error: 'x-device-id required' });
  if (!tokenValid(headerDeviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  try {
    const restriction = activeRestriction(await getDeviceModeration(headerDeviceId));
    if (restriction) {
      const error = restriction.permanent
        ? '此设备已被永久禁止发布内容'
        : `此设备暂时不能发布内容，解禁时间：${new Date(restriction.bannedUntil!).toLocaleString('zh-CN')}`;
      return res.status(403).json({ error, code: 'device_banned' });
    }
  } catch (error) {
    console.error('[upload] ban preflight failed:', error);
    return res.status(503).json({ error: 'temporary_unavailable' });
  }

  const limit = consumeUploadBudget(req.ip || 'unknown', headerDeviceId);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return res.status(429).json({ error: '上传过于频繁，请稍后再试', code: 'rate_limited' });
  }
  const declaredLength = Number(req.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MEDIA_MAX_BYTES + 1024 * 1024) {
    return res.status(413).json({ error: 'file_too_large' });
  }
  if (activeUploads >= maxConcurrentUploads()) {
    res.setHeader('Retry-After', '2');
    return res.status(503).json({ error: 'upload_busy' });
  }
  activeUploads += 1;

  try {
    upload.single('file')(req, res, async (err?: unknown) => {
      try {
        if (err) {
          // multer 超限等错误：413 Payload Too Large
          const code = (err as { code?: string })?.code;
          const status = code === 'LIMIT_FILE_SIZE' ? 413 : 400;
          return res.status(status).json({ error: code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'bad_file' });
        }
        const formDeviceId = typeof req.body?.device_id === 'string'
          ? req.body.device_id.trim().slice(0, 64)
          : '';
        if (formDeviceId && formDeviceId !== headerDeviceId) {
          return res.status(400).json({ error: 'device_id mismatch' });
        }
        if (!req.file) return res.status(400).json({ error: 'file required' });
        const descriptor = describeUploadMime(req.file.mimetype);
        if (!descriptor) {
          return res.status(415).json({ error: 'unsupported_media_type' });
        }
        if (!uploadSignatureMatches(descriptor, req.file.buffer)) {
          return res.status(415).json({ error: 'media_signature_mismatch' });
        }
        // Never use the caller-provided filename in an object key. It may contain
        // traversal characters or an extension inconsistent with the MIME type.
        const key = [
          'cidi-youhua',
          descriptor.directory,
          `${Date.now()}_${crypto.randomUUID()}.${descriptor.extension}`,
        ].join('/');
        const storage = await getStorage();
        const ticket = issueMediaUploadTicket(
          headerDeviceId,
          key,
          descriptor.mediaType
        );
        // Register before writing the object. This closes the crash window:
        // whether a crash happens before or after storage completes, the
        // expiry worker has a durable key it can safely delete.
        await registerMediaUpload({
          key,
          deviceId: headerDeviceId,
          mediaType: descriptor.mediaType,
          expiresAt: ticket.expiresAt,
          createdAt: Date.now(),
          attempts: 0,
          error: null,
          updatedAt: Date.now(),
        });
        let savedKey: string;
        try {
          savedKey = await storage.uploadBuffer(
            req.file.buffer,
            key,
            descriptor.contentType
          );
          if (savedKey !== key) {
            await storage.delete(savedKey).catch(() => null);
            throw new Error('storage returned an unexpected key');
          }
        } catch (error) {
          try {
            await storage.delete(key);
            await markMediaUploadCleanupSuccess(key);
          } catch (cleanupError) {
            // The provider may have stored the object before timing out. Keep
            // the durable registration so the scheduled worker can retry.
            await markMediaUploadCleanupFailure(
              key,
              cleanupError instanceof Error ? cleanupError.message : 'upload rollback failed'
            ).catch(() => null);
          }
          throw error;
        }
        // Do not expose a public/signed URL before the message passes moderation.
        return res.status(201).json({
          key: savedKey,
          media_type: descriptor.mediaType,
          upload_token: ticket.token,
        });
      } catch (e) {
        console.error('[upload] failed:', e);
        return res.status(500).json({ error: 'upload_failed' });
      } finally {
        activeUploads = Math.max(0, activeUploads - 1);
      }
    });
  } catch (error) {
    activeUploads = Math.max(0, activeUploads - 1);
    console.error('[upload] middleware failed:', error);
    return res.status(500).json({ error: 'upload_failed' });
  }
});

export default router;
