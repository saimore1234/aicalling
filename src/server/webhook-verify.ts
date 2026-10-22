import { createHmac, timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';
import { getEnv } from '@/lib/env';
import { ApiError } from '@/lib/errors';

function eq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The URL Twilio signed: the public base URL plus the path and query it called. */
export function publicUrlFor(req: Request): string {
  const base = getEnv().APP_URL;
  const u = new URL(req.url);
  if (!base) throw new ApiError(503, 'APP_URL must be configured to verify provider webhooks.', 'webhook_not_configured');
  return `${base.replace(/\/$/, '')}${u.pathname}${u.search}`;
}

/** Verifies X-Twilio-Signature and returns the form parameters. Fails closed when the auth token is missing. */
export async function verifyTwilio(req: Request): Promise<Record<string, string>> {
  const token = getEnv().TWILIO_AUTH_TOKEN;
  if (!token) throw new ApiError(503, 'TWILIO_AUTH_TOKEN is not configured; webhook rejected.', 'webhook_not_configured');
  const sig = req.headers.get('x-twilio-signature');
  if (!sig) throw new ApiError(403, 'Missing signature', 'bad_signature');
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;
  if (!twilio.validateRequest(token, sig, publicUrlFor(req), params)) throw new ApiError(403, 'Invalid signature', 'bad_signature');
  return params;
}

/** Svix signature check (Resend webhooks). */
export function verifySvix(opts: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; toleranceSec?: number }): boolean {
  const { secret, id, timestamp, signature, body } = opts;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > (opts.toleranceSec ?? 300)) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return signature.split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    return ver === 'v1' && !!sig && eq(sig, expected);
  });
}

/** Meta WhatsApp Cloud API: X-Hub-Signature-256 = sha256=HMAC(appSecret, rawBody). */
export function verifyMetaSignature(appSecret: string, header: string | null, rawBody: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  return eq(header.slice(7), createHmac('sha256', appSecret).update(rawBody).digest('hex'));
}
