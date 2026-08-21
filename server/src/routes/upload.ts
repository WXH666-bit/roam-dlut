import { Router } from 'express';
import multer from 'multer';
import { getStorage, mediaUrlOf } from '../storage';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 }, // 120MB 上限（60s 1080p 实拍视频约 70-90MB），防止大视频撑爆内存
});

const sanitizeName = (name: string): string =>
  name.replace(/[^\w.\-/]/g, '_').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/') || 'file.bin';

// 上传图片/视频：multipart 字段名 file，返回存储 key 与可访问 URL
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
      const kind = req.file.mimetype.startsWith('video/') ? 'videos' : 'images';
      const key = sanitizeName(`cidi-youhua/${kind}/${Date.now()}_${req.file.originalname}`);
      const storage = await getStorage();
      const savedKey = await storage.uploadBuffer(req.file.buffer, key, req.file.mimetype);
      const url = await mediaUrlOf(savedKey);
      return res.status(201).json({ key: savedKey, url });
    } catch (e) {
      console.error('[upload] failed:', e);
      return res.status(500).json({ error: 'upload_failed' });
    }
  });
});

export default router;
