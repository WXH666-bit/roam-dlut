import { Router, type Request, type Response } from 'express';
import {
  getLatestNotificationEventId,
  listNotificationEvents,
  registerPushToken,
  unregisterPushToken,
} from '../store';
import { tokenValid } from '../auth';
import { isExpoPushToken } from '../pushTokens';

const router = Router();

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readDeviceId = (req: Request): string => {
  const query = req.query.device_id;
  return readString(query).slice(0, 64);
};

const readToken = (req: Request): string => {
  const body = req.body ?? {};
  const bodyToken = body.token ?? body.expo_push_token ?? body.push_token;
  return readString(bodyToken);
};

// Background clients use this durable cursor when the app is not in the foreground.
// The response intentionally contains no message text, coordinates, or author data.
router.get('/', async (req, res) => {
  const deviceId = readDeviceId(req);
  if (!deviceId) return res.status(400).json({ error: 'device_id required' });
  if (!tokenValid(deviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const rawAfterId = readString(req.query.after_id);
  const afterId = rawAfterId === '' ? 0 : Number(rawAfterId);
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    return res.status(400).json({ error: 'after_id must be a non-negative integer' });
  }

  try {
    const latestId = await getLatestNotificationEventId(deviceId);
    const events = await listNotificationEvents(deviceId, afterId, 100, latestId);
    return res.json({
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        message_id: event.messageId,
        created_at: event.createdAt,
      })),
      latest_id: latestId,
    });
  } catch (error) {
    console.error('[notifications] event listing failed:', error);
    return res.status(503).json({ error: 'temporary_unavailable' });
  }
});

const pushTokenHandler = async (req: Request, res: Response) => {
  const deviceId = readString(req.body?.device_id ?? req.query.device_id).slice(0, 64);
  if (!deviceId) return res.status(400).json({ error: 'device_id required' });
  if (!tokenValid(deviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const token = readToken(req);
  if (!isExpoPushToken(token)) {
    return res.status(400).json({ error: 'valid Expo push token required' });
  }
  try {
    await registerPushToken(deviceId, token);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[notifications] push token registration failed:', error);
    return res.status(503).json({ error: 'temporary_unavailable' });
  }
};

router.put('/push-token', pushTokenHandler);

router.delete('/push-token', async (req, res) => {
  const deviceId = readString(req.body?.device_id ?? req.query.device_id).slice(0, 64);
  if (!deviceId) return res.status(400).json({ error: 'device_id required' });
  if (!tokenValid(deviceId, req.get('x-device-token'))) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const token = readToken(req);
  if (!isExpoPushToken(token)) {
    return res.status(400).json({ error: 'valid Expo push token required' });
  }
  try {
    await unregisterPushToken(deviceId, token);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[notifications] push token removal failed:', error);
    return res.status(503).json({ error: 'temporary_unavailable' });
  }
});

export default router;
