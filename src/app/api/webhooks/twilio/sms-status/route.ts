import { publicRoute } from '@/lib/api';
import { applyMessageStatus, type ProviderMessageStatus } from '@/server/message-status';
import { claimWebhookEvent } from '@/server/webhooks';
import { verifyTwilio } from '@/server/webhook-verify';

const MAP: Record<string, ProviderMessageStatus | undefined> = {
  sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED', undelivered: 'FAILED',
};

export const POST = publicRoute({ csrf: false }, async ({ req }) => {
  const p = await verifyTwilio(req);
  const status = MAP[(p.MessageStatus ?? '').toLowerCase()];
  if (!p.MessageSid || !status) return { ok: true, ignored: true };
  if (!(await claimWebhookEvent('twilio-sms', `${p.MessageSid}:${p.MessageStatus}`))) return { ok: true, duplicate: true };
  await applyMessageStatus({ provider: 'twilio', providerMessageId: p.MessageSid, status, errorCode: p.ErrorCode ?? null });
  return { ok: true };
});
