import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { getStorage, mediaUrlOf } from '../storage';
import { describeUploadMime, MEDIA_MAX_BYTES } from '../media';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  // 独立保留 120MB 上限：该路由使用内存缓冲，不能让单次上传无限占用进程内存。
  limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 4, parts: 5 },
});

// 上传图片/视频/音频：multipart 字段名 file，返回存储 key 与可访问 URL
router.post('/', (req, res) => {
  upload.single('file')(req, res, async (err?: unknown) => {
    if (err) {
      // multer 超限等错误：413 Payload Too Large
      const code = (err as { code?: string })?.code;
      const status = code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'bad_file' });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const descriptor = describeUploadMime(req.file.mimetype);
      if (!descriptor) {
        return res.status(415).json({ error: 'unsupported_media_type' });
      }
      // Never use the caller-provided filename in an object key. It may contain
      // traversal characters or an extension inconsistent with the MIME type.
      const key = [
        'cidi-youhua',
        descriptor.directory,
        `${Date.now()}_${crypto.randomUUID()}.${descriptor.extension}`,
      ].join('/');
      const storage = await getStorage();
      const savedKey = await storage.uploadBuffer(
        req.file.buffer,
        key,
        descriptor.contentType
      );
      const url = await mediaUrlOf(savedKey);
      return res.status(201).json({ key: savedKey, url, media_type: descriptor.mediaType });
    } catch (e) {
      console.error('[upload] failed:', e);
      return res.status(500).json({ error: 'upload_failed' });
    }
  });
});

export default router;
