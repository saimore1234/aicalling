import { publicRoute } from '@/lib/api';
import { getEnv } from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { applyMessageStatus, suppressEmail, type ProviderMessageStatus } from '@/server/message-status';
import { claimWebhookEvent } from '@/server/webhooks';
import { verifySvix } from '@/server/webhook-verify';

const MAP: Record<string, ProviderMessageStatus | undefined> = {
  'email.sent': 'SENT', 'email.delivered': 'DELIVERED', 'email.bounced': 'FAILED', 'email.failed': 'FAILED', 'email.complained': 'FAILED',
};

export const POST = publicRoute({ csrf: false }, async ({ req }) => {
  const secret = getEnv().RESEND_WEBHOOK_SECRET;
  if (!secret) throw new ApiError(503, 'RESEND_WEBHOOK_SECRET is not configured; webhook rejected.', 'webhook_not_configured');
  const raw = await req.text();
  const ok = verifySvix({ secret, id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature'), body: raw });
  if (!ok) throw new ApiError(403, 'Invalid signature', 'bad_signature');

  const id = req.headers.get('svix-id')!;
  if (!(await claimWebhookEvent('resend', id))) return { ok: true, duplicate: true };

  let evt: { type?: string; data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string; message?: string } } };
  try { evt = JSON.parse(raw); } catch { throw new ApiError(400, 'Invalid JSON', 'invalid_json'); }
  const status = evt.type ? MAP[evt.type] : undefined;
  if (status && evt.data?.email_id) {
    await applyMessageStatus({ provider: 'resend', providerMessageId: evt.data.email_id, status, errorCode: evt.type, errorMessage: evt.data.bounce?.message ?? null });
  }
  // Hard bounces and spam complaints permanently suppress the address.
  const hard = evt.type === 'email.complained' || (evt.type === 'email.bounced' && (evt.data?.bounce?.type ?? '').toLowerCase() !== 'transient');
  if (hard) {
    const to = Array.isArray(evt.data?.to) ? evt.data!.to : evt.data?.to ? [evt.data.to] : [];
    for (const addr of to) await suppressEmail(addr, 'BOUNCE', `resend:${evt.type}`);
  }
  return { ok: true };
});
