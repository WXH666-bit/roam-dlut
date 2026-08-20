import { Router } from 'express';
import { ensureUser, listMessages, renameUser } from '../store';
import { isAlive } from '../types';
import { config, TTL_MS } from '../config';
import { issueToken } from '../auth';

const router = Router();

const publicUser = (u: { deviceId: string; flowerName: string; renamed: boolean }) => ({
  device_id: u.deviceId,
  flower_name: u.flowerName,
  renamed: u.renamed,
});

// 设备注册：首次分配花名，幂等；SERVER_SECRET 开启时签发防刷 token
router.post('/', async (req, res) => {
  const { device_id } = req.body ?? {};
  if (typeof device_id !== 'string' || !device_id.trim()) {
    return res.status(400).json({ error: 'device_id required' });
  }
  const deviceId = device_id.trim().slice(0, 64);
  const u = await ensureUser(deviceId);
  const token = issueToken(deviceId);
  return res.json({ ...publicUser(u), ...(token ? { token } : {}) });
});

// 修改花名（仅一次）
router.patch('/me', async (req, res) => {
  const { device_id, flower_name } = req.body ?? {};
  if (typeof device_id !== 'string' || typeof flower_name !== 'string') {
    return res.status(400).json({ error: 'device_id and flower_name required' });
  }
  const name = flower_name.trim();
  if (!name || name.length > 12) {
    return res.status(400).json({ error: '花名需为 1-12 个字符' });
  }
  const u = await renameUser(device_id, name);
  if (!u) {
    return res.status(409).json({ error: '花名只能修改一次' });
  }
  return res.json(publicUser(u));
});

// 我的发布（含已消散全文）+ 我的足迹（已消散仅留记录）
router.get('/me', async (req, res) => {
  const deviceId = String(req.query.device_id || '');
  if (!deviceId) return res.status(400).json({ error: 'device_id required' });
  const u = await ensureUser(deviceId);
  const now = Date.now();
  const alive = (m: Parameters<typeof isAlive>[0]) => isAlive(m, now, TTL_MS, config.readLimit);
  const all = await listMessages();

  const mine = all
    .filter((m) => m.deviceId === deviceId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({
      id: m.id,
      text: m.text,
      media_type: m.mediaType,
      media_key: m.mediaKey,
      lat: m.lat,
      lng: m.lng,
      created_at: m.createdAt,
      read_count: m.readers.length,
      likes: m.likes.length,
      alive: alive(m),
    }));

  const footprints = all
    .filter((m) => m.readers.includes(deviceId) && m.deviceId !== deviceId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => {
      const a_ = alive(m);
      return {
        id: m.id,
        alive: a_,
        // 已消散：内容不可再读
        text: a_ ? m.text : null,
        media_type: a_ ? m.mediaType : 'none',
        media_key: a_ ? m.mediaKey : null,
        flower_name: m.flowerName,
        created_at: m.createdAt,
      };
    });

  return res.json({ user: publicUser(u), my_messages: mine, footprints });
});

export default router;
