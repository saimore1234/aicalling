import { z } from 'zod';
import { publicRoute } from '@/lib/api';
import { verifyToken } from '@/lib/crypto';
import { badRequest } from '@/lib/errors';
import { applyOptOut } from '@/server/compliance';

const body = z.object({ token: z.string().min(10).max(2000) });

/** Public one-click unsubscribe (also used for RFC 8058 List-Unsubscribe-Post). Token is HMAC-signed; no login required. */
export const POST = publicRoute({ csrf: false, body, rateLimit: { name: 'unsubscribe', limit: 30, windowSec: 60 } }, async ({ body, audit }) => {
  const t = verifyToken<{ cid: string; ch: 'EMAIL' | 'SMS' | 'WHATSAPP' }>(body.token);
  if (!t || !t.cid || !['EMAIL', 'SMS', 'WHATSAPP'].includes(t.ch)) throw badRequest('This unsubscribe link is invalid or has expired.');
  await applyOptOut({ customerId: t.cid, channels: [t.ch], reason: 'UNSUBSCRIBE', source: `unsubscribe_link_${t.ch.toLowerCase()}` });
  await audit('compliance.unsubscribed', 'customer', t.cid, { channel: t.ch });
  return { ok: true, channel: t.ch };
});
