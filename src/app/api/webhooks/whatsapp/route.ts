import { publicRoute } from '@/lib/api';
import { getEnv } from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { normalizePhone } from '@/lib/phone';
import { applyMessageStatus, handleInboundMessage, type ProviderMessageStatus } from '@/server/message-status';
import { claimWebhookEvent } from '@/server/webhooks';
import { safeEqual } from '@/lib/crypto';
import { verifyMetaSignature } from '@/server/webhook-verify';

/** Meta's one-time endpoint verification handshake. */
export const GET = publicRoute({ csrf: false }, async ({ req }) => {
  const q = new URL(req.url).searchParams;
  const expected = getEnv().WHATSAPP_VERIFY_TOKEN;
  if (!expected) throw new ApiError(503, 'WHATSAPP_VERIFY_TOKEN is not configured.', 'webhook_not_configured');
  const token = q.get('hub.verify_token') ?? '';
  if (q.get('hub.mode') === 'subscribe' && safeEqual(token, expected)) return new Response(q.get('hub.challenge') ?? '', { status: 200 });
  throw new ApiError(403, 'Verification failed', 'bad_signature');
});

const MAP: Record<string, ProviderMessageStatus | undefined> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

type Change = { value?: { statuses?: { id: string; status: string; timestamp?: string; errors?: { code?: number; title?: string }[] }[]; messages?: { id: string; from: string; type: string; text?: { body?: string }; button?: { text?: string } }[] } };

export const POST = publicRoute({ csrf: false }, async ({ req }) => {
  const secret = getEnv().WHATSAPP_APP_SECRET;
  if (!secret) throw new ApiError(503, 'WHATSAPP_APP_SECRET is not configured; webhook rejected.', 'webhook_not_configured');
  const raw = await req.text();
  if (!verifyMetaSignature(secret, req.headers.get('x-hub-signature-256'), raw)) throw new ApiError(403, 'Invalid signature', 'bad_signature');
  let body: { entry?: { changes?: Change[] }[] };
  try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'Invalid JSON', 'invalid_json'); }

  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      for (const s of ch.value?.statuses ?? []) {
        const status = MAP[s.status];
        if (!status || !(await claimWebhookEvent('whatsapp', `${s.id}:${s.status}`))) continue;
        await applyMessageStatus({ provider: 'meta-cloud', providerMessageId: s.id, status, errorCode: s.errors?.[0]?.code ? String(s.errors[0].code) : null, errorMessage: s.errors?.[0]?.title ?? null });
      }
      for (const m of ch.value?.messages ?? []) {
        if (!(await claimWebhookEvent('whatsapp-in', m.id))) continue;
        const phone = normalizePhone(`+${m.from.replace(/^\+/, '')}`, null);
        if (phone.ok) await handleInboundMessage({ channel: 'WHATSAPP', fromPhone: phone.e164, text: m.text?.body ?? m.button?.text ?? '', provider: 'meta-cloud', providerMessageId: m.id });
      }
    }
  }
  return { ok: true };
});
