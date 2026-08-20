import { Router } from 'express';
import { createMessage, ensureUser, findMessage, getMessages, touchMessage } from '../store';
import { isAlive, type Message } from '../types';
import { config, TTL_MS } from '../config';
import { hitSensitiveWord } from '../sensitiveWords';
import { mediaUrlOf } from '../storage';

const router = Router();

const aliveNow = (m: Message) => isAlive(m, Date.now(), TTL_MS, config.readLimit);

const remaining = (m: Message) => Math.max(0, config.readLimit - m.readers.length);

// 存活留言列表：仅 id / 坐标 / 创建时间，不含内容
router.get('/', (req, res) => {
  const list = getMessages()
    .filter(aliveNow)
    .map((m) => ({ id: m.id, lat: m.lat, lng: m.lng, created_at: m.createdAt }));
  res.json({ list, total: list.length, read_limit: config.readLimit });
});

// 开信：读全文；按 device_id 去重计数，读满阈值即消散
router.get('/:id', async (req, res) => {
  const m = findMessage(req.params.id);
  if (!m) return res.status(404).json({ error: 'not_found' });
  const deviceId = String(req.query.device_id || '');

  if (!aliveNow(m)) {
    // 已消散：仅作者本人可回看
    if (deviceId && deviceId === m.deviceId) {
      return res.json({
        id: m.id, text: m.text, media_type: m.mediaType,
        media_url: m.mediaKey ? await mediaUrlOf(m.mediaKey) : null,
        flower_name: m.flowerName, created_at: m.createdAt,
        likes: m.likes.length, liked: m.likes.includes(deviceId),
        remaining: 0, dissolved: true,
      });
    }
    return res.status(410).json({ error: 'dissolved' });
  }

  // 计数阅读（去重）；作者阅读不占名额
  if (deviceId && deviceId !== m.deviceId && !m.readers.includes(deviceId)) {
    m.readers.push(deviceId);
    touchMessage();
  }

  return res.json({
    id: m.id, text: m.text, media_type: m.mediaType,
    media_url: m.mediaKey ? await mediaUrlOf(m.mediaKey) : null,
    flower_name: m.flowerName, created_at: m.createdAt,
    likes: m.likes.length, liked: deviceId ? m.likes.includes(deviceId) : false,
    remaining: remaining(m), dissolved: false,
  });
});

// 发布留言：敏感词校验 + 每日限额
router.post('/', (req, res) => {
  const { device_id, text, media_type, media_key, lat, lng } = req.body ?? {};
  if (typeof device_id !== 'string' || !device_id.trim()) {
    return res.status(400).json({ error: 'device_id required' });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '说点什么吧，哪怕一句也好' });
  }
  if (text.length > 140) {
    return res.status(400).json({ error: '留言最多 140 字' });
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: '坐标不合法' });
  }
  const mt = media_type === 'image' || media_type === 'video' ? media_type : 'none';
  if (mt !== 'none' && (typeof media_key !== 'string' || !media_key)) {
    return res.status(400).json({ error: 'media_key required for media message' });
  }

  const hit = hitSensitiveWord(text);
  if (hit) {
    return res.status(400).json({ error: `这句话里有不太合适的词（${hit}），换种说法吧` });
  }

  const deviceId = device_id.trim().slice(0, 64);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayCount = getMessages().filter(
    (m) => m.deviceId === deviceId && m.createdAt >= startOfDay.getTime()
  ).length;
  if (todayCount >= config.dailyLimit) {
    return res.status(429).json({ error: `今天已经藏了 ${config.dailyLimit} 条了，明天再来吧` });
  }

  const user = ensureUser(deviceId);
  const m = createMessage({
    deviceId,
    flowerName: user.flowerName,
    text: text.trim(),
    mediaType: mt,
    mediaKey: mt === 'none' ? null : String(media_key),
    lat, lng,
  });
  return res.status(201).json({ id: m.id, created_at: m.createdAt });
});

// 点赞：去重、幂等；需已解锁（读过）
router.post('/:id/like', (req, res) => {
  const m = findMessage(req.params.id);
  if (!m) return res.status(404).json({ error: 'not_found' });
  const { device_id } = req.body ?? {};
  if (typeof device_id !== 'string' || !device_id.trim()) {
    return res.status(400).json({ error: 'device_id required' });
  }
  const deviceId = device_id.trim();
  if (!aliveNow(m)) return res.status(410).json({ error: 'dissolved' });
  if (deviceId !== m.deviceId && !m.readers.includes(deviceId)) {
    return res.status(403).json({ error: 'unlock_first' });
  }
  if (!m.likes.includes(deviceId)) {
    m.likes.push(deviceId);
    touchMessage();
  }
  return res.json({ likes: m.likes.length, liked: true });
});

export default router;
