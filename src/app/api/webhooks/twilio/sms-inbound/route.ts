import { publicRoute } from '@/lib/api';
import { normalizePhone } from '@/lib/phone';
import { handleInboundMessage } from '@/server/message-status';
import { claimWebhookEvent } from '@/server/webhooks';
import { verifyTwilio } from '@/server/webhook-verify';

/** Inbound SMS (configure as the number's "A message comes in" webhook). STOP/UNSUBSCRIBE etc. opt the sender out immediately. */
export const POST = publicRoute({ csrf: false }, async ({ req }) => {
  const p = await verifyTwilio(req);
  if (!p.MessageSid || !p.From) return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
  if (await claimWebhookEvent('twilio-sms-in', p.MessageSid)) {
    const phone = normalizePhone(p.From, null);
    if (phone.ok) await handleInboundMessage({ channel: 'SMS', fromPhone: phone.e164, text: p.Body ?? '', provider: 'twilio', providerMessageId: p.MessageSid });
  }
  return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
});
