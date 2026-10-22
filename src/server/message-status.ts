import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, messages, suppressionRecords } from '@/db/schema';
import { applyOptOut, isStopKeyword } from './compliance';
import { audit } from '@/lib/audit';

const RANK = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 } as const;
type Rankable = keyof typeof RANK;
export type ProviderMessageStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

/** Pure transition rule: statuses only move forward; FAILED may follow SENT/QUEUED but never overrides DELIVERED/READ. */
export function nextMessageStatus(current: string, incoming: ProviderMessageStatus): string {
  if (incoming === 'FAILED') return current === 'DELIVERED' || current === 'READ' ? current : 'FAILED';
  if (current === 'FAILED' && incoming === 'SENT') return current;
  const cur = RANK[current as Rankable];
  const inc = RANK[incoming as Rankable];
  if (cur === undefined) return incoming; // e.g. BLOCKED stays untouched below via explicit check
  return inc > cur ? incoming : current;
}

export async function applyMessageStatus(input: {
  provider: string;
  providerMessageId: string;
  status: ProviderMessageStatus;
  at?: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<{ updated: boolean; messageId?: string }> {
  const [msg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.provider, input.provider), eq(messages.providerMessageId, input.providerMessageId)))
    .limit(1);
  if (!msg) return { updated: false };
  if (msg.status === 'BLOCKED') return { updated: false, messageId: msg.id };

  const next = nextMessageStatus(msg.status, input.status);
  if (next === msg.status) return { updated: false, messageId: msg.id };

  const at = input.at ?? new Date();
  const patch: Partial<typeof messages.$inferInsert> = { status: next as never };
  if (next === 'SENT') patch.sentAt = msg.sentAt ?? at;
  if (next === 'DELIVERED') {
    patch.deliveredAt = at;
    patch.sentAt = msg.sentAt ?? at;
  }
  if (next === 'READ') {
    patch.readAt = at;
    patch.deliveredAt = msg.deliveredAt ?? at;
  }
  if (next === 'FAILED') {
    patch.failedAt = at;
    patch.errorCode = input.errorCode ?? 'DELIVERY_FAILED';
    patch.errorMessage = input.errorMessage ?? 'The provider reported that delivery failed.';
  }
  await db.update(messages).set(patch).where(eq(messages.id, msg.id));
  return { updated: true, messageId: msg.id };
}

/** Email hard bounce / spam complaint → suppress the address so we never mail it again. */
export async function suppressEmail(email: string, reason: 'BOUNCE' | 'UNSUBSCRIBE', source: string) {
  const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.email, email.toLowerCase())).limit(1);
  await db.insert(suppressionRecords).values({ channel: 'EMAIL', email: email.toLowerCase(), customerId: c?.id ?? null, reason, source });
  await audit({ action: `compliance.email_${reason.toLowerCase()}`, entityType: 'customer', entityId: c?.id ?? null, metadata: { source } });
}

/**
 * Record an inbound SMS/WhatsApp message and honour STOP keywords immediately.
 */
export async function handleInboundMessage(input: {
  channel: 'SMS' | 'WHATSAPP';
  fromPhone: string; // E.164
  text: string;
  provider: string;
  providerMessageId?: string | null;
}): Promise<{ matchedCustomer: boolean; optedOut: boolean }> {
  const phone = input.fromPhone.startsWith('+') ? input.fromPhone : `+${input.fromPhone}`;
  const matches = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone));
  if (!matches.length) return { matchedCustomer: false, optedOut: false };

  let optedOut = false;
  for (const m of matches) {
    await db.insert(messages).values({
      customerId: m.id,
      channel: input.channel,
      direction: 'INBOUND',
      status: 'DELIVERED',
      toAddress: 'platform',
      fromAddress: phone,
      body: input.text.slice(0, 4000),
      provider: input.provider,
      providerMessageId: input.providerMessageId ?? null,
      isMarketing: false,
      deliveredAt: new Date(),
    });
    if (isStopKeyword(input.text)) {
      await applyOptOut({ customerId: m.id, channels: [input.channel], source: `inbound_${input.channel.toLowerCase()}_stop`, note: `Customer replied "${input.text.trim().slice(0, 20)}"` });
      optedOut = true;
    }
  }
  return { matchedCustomer: true, optedOut };
}

