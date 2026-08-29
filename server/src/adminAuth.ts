import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const configuredSecret = (): string => process.env.ADMIN_SECRET?.trim() ?? '';

const suppliedSecret = (req: Request): string => {
  const authorization = req.get('authorization') ?? '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return req.get('x-admin-secret')?.trim() ?? '';
};

const constantTimeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'no-store');
  const hostname = req.hostname.toLowerCase();
  const localRequest = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const trustedProxyHttps = process.env.ADMIN_TRUST_PROXY === 'true'
    && req.get('x-forwarded-proto')?.split(',', 1)[0]?.trim().toLowerCase() === 'https';
  const insecureAllowed = process.env.ADMIN_ALLOW_INSECURE_HTTP === 'true';
  if (!localRequest && !req.secure && !trustedProxyHttps && !insecureAllowed) {
    res.status(426).json({ error: 'admin_https_required' });
    return;
  }
  const expected = configuredSecret();
  if (!expected) {
    res.status(503).json({ error: 'admin_not_configured' });
    return;
  }
  const supplied = suppliedSecret(req);
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Here moderation"');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};
