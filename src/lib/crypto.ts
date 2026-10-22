import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAppSecret } from './env';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(value: string, secret = getAppSecret()): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Signed, expiring token: base64url(payload).signature. Used for voice-stream authentication
 * and unsubscribe links. Payload is JSON so it can carry ids.
 */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number, secret = getAppSecret()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    'base64url',
  );
  return `${body}.${hmac(body, secret)}`;
}

export function verifyToken<T extends Record<string, unknown>>(
  token: string | undefined | null,
  secret = getAppSecret(),
): (T & { exp: number }) | null {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(sig, hmac(body, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
