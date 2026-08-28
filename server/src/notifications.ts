import type { NotificationEvent } from './types';
import { unregisterPushToken } from './store';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;
const EXPO_REQUEST_TIMEOUT_MS = 10_000;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data: {
    type: NotificationEvent['type'];
    message_id: string;
    event_id: number;
  };
}

interface ExpoPushTicket {
  status?: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Best-effort delivery through Expo Push Service.
 *
 * This deliberately catches every transport/provider error: a push outage,
 * revoked token, or missing optional access token must never turn a successful
 * like into a failed API request. The durable event remains available to the
 * background polling client.
 */
export async function sendLikeNotification(
  tokens: string[],
  event: NotificationEvent
): Promise<void> {
  const accessToken = (process.env.EXPO_ACCESS_TOKEN || '').trim();
  if (tokens.length === 0) return;

  const uniqueTokens = [...new Set(tokens.filter((token) => token.trim()))];
  if (uniqueTokens.length === 0) return;

  for (let start = 0; start < uniqueTokens.length; start += EXPO_BATCH_SIZE) {
    const batch = uniqueTokens.slice(start, start + EXPO_BATCH_SIZE);
    const messages: ExpoPushMessage[] = batch.map((to) => ({
      to,
      title: '有人喜欢了你的留言',
      body: '有人给你的留言点了赞',
      sound: 'default',
      priority: 'high',
      channelId: 'cidi_like',
      data: {
        type: event.type,
        message_id: event.messageId,
        event_id: event.id,
      },
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPO_REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(`[notifications] Expo push failed (${response.status})`);
        continue;
      }

      const payload = await response.json() as { data?: ExpoPushTicket | ExpoPushTicket[] };
      const tickets = Array.isArray(payload.data)
        ? payload.data
        : payload.data ? [payload.data] : [];
      for (let index = 0; index < tickets.length; index += 1) {
        const ticket = tickets[index];
        if (ticket?.status !== 'error') continue;
        const failedToken = batch[index];
        console.error(
          `[notifications] Expo ticket failed (${ticket.details?.error ?? 'unknown'}): ${ticket.message ?? ''}`
        );
        if (failedToken && ticket.details?.error === 'DeviceNotRegistered') {
          // Stop retrying a token that APNs/Expo has permanently invalidated.
          try {
            await unregisterPushToken(event.recipientDeviceId, failedToken);
          } catch (error) {
            console.error('[notifications] stale push token cleanup failed:', error);
          }
        }
      }
    } catch (error) {
      console.error('[notifications] Expo push request failed:', error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
