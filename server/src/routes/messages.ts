import { Router } from 'express';
import {
  addLikeAndCreateNotificationEvent,
  addReader,
  applyModerationOutcome,
  createMessage,
  createMessageClaimingMedia,
  ensureUser,
  findMessage,
  getDeviceModeration,
  listMessages,
  listPushTokens,
} from '../store';
import { isAlive, isPublished, type Message } from '../types';
import { config, TTL_MS } from '../config';
import { mediaUrlOf } from '../storage';
import { tokenValid } from '../auth';
import { sendLikeNotification } from '../notifications';
import { validatePublishLocation } from '../location';
import { isMessageMediaType } from '../media';
import { activeRestriction } from '../moderationPolicy';
import { mediaUploadTokenValid } from '../mediaUploadToken';
import { consumeModerationBudget } from '../requestLimits';
import { enqueueMessageModeration } from '../moderationWorkflow';

const router = Router();

const aliveNow = (m: Message) => isAlive(m, Date.now(), TTL_MS, config.readLimit);

const remaining = (m: Message) => Math.max(0, config.readLimit - m.readers.length);

// 存活留言列表：仅 id / 坐标 / 创建时间，不含内容
router.get('/', async (req, res) => {
  const all = await listMessages();
  const list = all
    .filter((message) => isPublished(message) && aliveNow(message))
    .map((m) => ({ id: m.id, lat: m.lat, lng: m.lng, created_at: m.createdAt }));
  res.json({ list, total: list.length, read_limit: config.readLimit });
});

// 开信：读全文；按 device_id 去重计数，读满阈值即消散；SERVER_SECRET 开启时需带 x-device-token
router.get('/:id', async (req, res) => {
  const deviceId = String(req.query.device_id || '');
  if (!tokenValid(deviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const m = await findMessage(req.params.id);
  if (!m || !isPublished(m)) return res.status(404).json({ error: 'not_found' });

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
    await addReader(m.id, deviceId);
  }

  return res.json({
    id: m.id, text: m.text, media_type: m.mediaType,
    media_url: m.mediaKey ? await mediaUrlOf(m.mediaKey) : null,
    flower_name: m.flowerName, created_at: m.createdAt,
    likes: m.likes.length, liked: deviceId ? m.likes.includes(deviceId) : false,
    remaining: remaining(m), dissolved: false,
  });
});

// 发布留言：先隐藏落库，再由模型明确判定安全后公开。
router.post('/', async (req, res) => {
  // Capture this before any asynchronous work so upload/network time counts
  // against freshness, while still allowing the server's bounded clock slack.
  const requestReceivedAt = Date.now();
  const body = req.body ?? {};
  const { device_id, text, media_type, media_key, media_token } = body;
  if (typeof device_id !== 'string' || !device_id.trim()) {
    return res.status(400).json({ error: 'device_id required' });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '说点什么吧，哪怕一句也好' });
  }
  if (text.length > 140) {
    return res.status(400).json({ error: '留言最多 140 字' });
  }
  const deviceId = device_id.trim().slice(0, 64);
  if (!tokenValid(deviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const restriction = activeRestriction(await getDeviceModeration(deviceId));
  if (restriction) {
    const error = restriction.permanent
      ? '此设备已被永久禁止发布内容'
      : `此设备暂时不能发布内容，解禁时间：${new Date(restriction.bannedUntil!).toLocaleString('zh-CN')}`;
    return res.status(403).json({
      error,
      code: 'device_banned',
      permanent: restriction.permanent,
      banned_until: restriction.bannedUntil,
    });
  }
  const location = validatePublishLocation(body, requestReceivedAt);
  if (!location.ok) {
    return res.status(400).json({ error: location.message, code: location.code });
  }
  if (media_type != null && !isMessageMediaType(media_type)) {
    return res.status(400).json({ error: 'invalid_media_type' });
  }
  const mt = media_type ?? 'none';
  if (mt !== 'none' && (typeof media_key !== 'string' || !media_key)) {
    return res.status(400).json({ error: 'media_key required for media message' });
  }
  if (
    mt !== 'none'
    && !mediaUploadTokenValid(media_token, deviceId, String(media_key), mt)
  ) {
    return res.status(400).json({ error: 'invalid_or_expired_media_token' });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const all = await listMessages();
  const todayCount = all.filter(
    (m) => m.deviceId === deviceId && m.createdAt >= startOfDay.getTime()
  ).length;
  if (todayCount >= config.dailyLimit) {
    return res.status(429).json({ error: `今天已经藏了 ${config.dailyLimit} 条了，明天再来吧` });
  }
  const user = await ensureUser(deviceId);
  const locationData = location.value.legacy
    ? {}
    : {
      coordinateSystem: location.value.coordinateSystem,
      accuracy: location.value.accuracy,
      capturedAt: location.value.capturedAt,
    };
  const messageData: Omit<Message, 'id' | 'createdAt' | 'readers' | 'likes'> = {
    deviceId,
    flowerName: user.flowerName,
    text: text.trim(),
    mediaType: mt,
    mediaKey: mt === 'none' ? null : String(media_key),
    lat: location.value.lat,
    lng: location.value.lng,
    moderationStatus: 'pending',
    moderationRequestedAt: Date.now(),
    ...locationData,
  };
  const m = mt === 'none'
    ? await createMessage(messageData)
    : await createMessageClaimingMedia(
      messageData,
      deviceId,
      String(media_key),
      mt,
      Date.now()
    );
  if (!m) {
    return res.status(409).json({
      error: '这个附件已过期或已经提交过，请重新选择',
      code: 'media_already_used_or_expired',
    });
  }

  const modelBudget = consumeModerationBudget(req.ip || 'unknown');
  if (modelBudget.allowed) {
    enqueueMessageModeration(m.id);
  } else {
    // Budget exhaustion never fails open and should not encourage a mobile
    // retry that creates duplicates. Keep the accepted row hidden for humans.
    await applyModerationOutcome(m.id, {
      verdict: 'error',
      severity: 'high',
      reason: modelBudget.reason === 'global_budget'
        ? '今日模型审核预算已用完，需管理员复核。'
        : '提交来源触发模型调用限流，需管理员复核。',
      categories: ['moderation_budget'],
      model: process.env.STEPFUN_MODEL?.trim() || 'step-3.7-flash',
      decidedAt: Date.now(),
    }, false);
  }

  // Return immediately so a slow visual/ASR request cannot make the mobile
  // client retry and create duplicate paid jobs. The durable pending row is
  // resumed after a process restart if no model decision was saved.
  return res.status(202).json({
    id: m.id,
    created_at: m.createdAt,
    status: 'pending',
  });
});

// 作者可短轮询是否已自动公开；不返回模型理由、分类或待审内容。
router.get('/:id/moderation-status', async (req, res) => {
  const deviceId = String(req.query.device_id || '').trim().slice(0, 64);
  if (!deviceId) return res.status(400).json({ error: 'device_id required' });
  if (!tokenValid(deviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const message = await findMessage(req.params.id);
  if (!message || message.deviceId !== deviceId) {
    return res.status(404).json({ error: 'not_found' });
  }
  return res.json({
    id: message.id,
    status: isPublished(message) ? 'published' : 'pending',
  });
});

// 点赞：去重、幂等；需已解锁（读过）；SERVER_SECRET 开启时需带 x-device-token
router.post('/:id/like', async (req, res) => {
  const { device_id } = req.body ?? {};
  if (typeof device_id !== 'string' || !device_id.trim()) {
    return res.status(400).json({ error: 'device_id required' });
  }
  const deviceId = device_id.trim();
  if (!tokenValid(deviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const m = await findMessage(req.params.id);
  if (!m || !isPublished(m)) return res.status(404).json({ error: 'not_found' });
  if (!aliveNow(m)) return res.status(410).json({ error: 'dissolved' });
  if (deviceId !== m.deviceId && !m.readers.includes(deviceId)) {
    return res.status(403).json({ error: 'unlock_first' });
  }
  let likeResult: Awaited<ReturnType<typeof addLikeAndCreateNotificationEvent>>;
  try {
    likeResult = await addLikeAndCreateNotificationEvent(m.id, deviceId);
  } catch (error) {
    console.error('[store] like transaction failed:', error);
    return res.status(503).json({ error: 'temporary_unavailable' });
  }

  if (likeResult.notificationEvent) {
    try {
      const tokens = await listPushTokens(m.deviceId);
      // Delivery is deliberately best effort; durable event polling is the fallback.
      void sendLikeNotification(tokens.map((entry) => entry.token), likeResult.notificationEvent);
    } catch (error) {
      // A push-token/provider outage must not undo a successful like or event.
      console.error('[notifications] push preparation failed:', error);
    }
  }
  const latest = await findMessage(m.id);
  return res.json({
    likes: latest?.likes.length ?? m.likes.length + (likeResult.added ? 1 : 0),
    liked: true,
  });
});

export default router;
