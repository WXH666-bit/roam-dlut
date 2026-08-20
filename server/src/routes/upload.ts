import { Router } from 'express';
import multer from 'multer';
import { storage, mediaUrlOf } from '../storage';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 60 秒视频约几十 MB
});

const sanitizeName = (name: string): string =>
  name.replace(/[^\w.\-/]/g, '_').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/') || 'file.bin';

// 上传图片/视频：multipart 字段名 file，返回存储 key 与可访问 URL
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const kind = req.file.mimetype.startsWith('video/') ? 'videos' : 'images';
    const key = await storage.uploadFile({
      fileContent: req.file.buffer,
      fileName: sanitizeName(`cidi-youhua/${kind}/${Date.now()}_${req.file.originalname}`),
      contentType: req.file.mimetype,
    });
    const url = await mediaUrlOf(key);
    return res.status(201).json({ key, url });
  } catch (e) {
    console.error('[upload] failed:', e);
    return res.status(500).json({ error: 'upload_failed' });
  }
});

export default router;
