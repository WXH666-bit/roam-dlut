export const MAX_PUSH_TOKENS_PER_DEVICE = 8;

/**
 * Match Expo's bracketed token families plus its legacy UUID form, while
 * keeping storage ASCII-only and bounded. Bracket payloads are intentionally
 * opaque; Expo's own server SDK does not prescribe a narrower alphabet.
 */
export const isExpoPushToken = (token: unknown): token is string => (
  typeof token === 'string'
  && token.length <= 512
  && /^(?:(?:ExponentPushToken|ExpoPushToken)\[[\x21-\x7E]{1,480}\]|[A-Za-z0-9]{8}(?:-[A-Za-z0-9]{4}){3}-[A-Za-z0-9]{12})$/.test(token)
);
