import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, messageTemplates, messages } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { signToken } from '@/lib/crypto';
import { rateLimit } from '@/lib/ratelimit';
import { getAppSettings } from '@/lib/settings';
import { logger, sanitizeError } from '@/lib/logger';
import { getEmailProvider, getSmsProvider, getWhatsAppProvider, ProviderError, ProviderNotConfiguredError } from '@/providers';
import { getMessageEligibility } from './compliance';
import { enqueue } from './queues';
import { escapeHtml, renderTemplate } from './templates';

export type MessageRow = typeof messages.$inferSelect;

/** Thrown when a send must wait (outside permitted hours, rate limited). Callers reschedule instead of failing. */
export class DeferredError extends Error {
  constructor(
    public until: Date | null,
    public reasonCode: string,
  ) {
    super(`Deferred (${reasonCode})${until ? ` until ${until.toISOString()}` : ''}`);
    this.name = 'DeferredError';
  }
}

export type SendResult = { message: MessageRow; sent: boolean; retryable: boolean };

export function unsubscribeUrl(customerId: string, channel: 'EMAIL' | 'SMS' | 'WHATSAPP'): string | null {
  const base = getEnv().APP_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/unsubscribe/${signToken({ cid: customerId, ch: channel }, 365 * 24 * 3600)}`;
}

export function buildVariables(
  c: { id: string; name: string; company: string | null; productInterest: string | null },
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    name: c.name,
    first_name: c.name.split(/\s+/)[0] ?? c.name,
    company: c.company ?? '',
    product: c.productInterest ?? '',
    ...extra,
  };
}

export async function sendTemplateMessage(opts: {
  customerId: string;
  templateId: string;
  callId?: string | null;
  followUpTaskId?: string | null;
  idempotencyKey?: string;
  existingMessageId?: string;
  userId?: string | null;
  variables?: Record<string, string>;
}): Promise<SendResult> {
  const [customer] = await db.select().from(customers).where(eq(customers.id, opts.customerId)).limit(1);
  if (!customer) throw new Error('Customer not found');
  const [template] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, opts.templateId)).limit(1);
  if (!template || template.deletedAt || !template.active) throw new Error('Template not found or inactive');
  if (template.channel === 'VOICE') throw new Error('Voice is not a messaging channel');
  const channel = template.channel as 'SMS' | 'EMAIL' | 'WHATSAPP';

  // Idempotency: a repeated trigger returns the already-created message instead of sending twice.
  if (opts.idempotencyKey && !opts.existingMessageId) {
    const [existing] = await db.select().from(messages).where(eq(messages.idempotencyKey, opts.idempotencyKey)).limit(1);
    if (existing) return { message: existing, sent: existing.status !== 'FAILED' && existing.status !== 'BLOCKED', retryable: false };
  }

  const settings = await getAppSettings();
  const mode = settings.mode;
  const toAddress = (channel === 'EMAIL' ? customer.email : customer.phone) ?? '';

  const elig = await getMessageEligibility({
    customerId: customer.id,
    channel,
    mode,
    template: {
      isMarketing: template.isMarketing,
      approved: template.approved,
      providerTemplateId: template.providerTemplateId,
      dltTemplateId: template.dltTemplateId,
    },
  });

  const vars = buildVariables(customer, opts.variables);
  const unsub = unsubscribeUrl(customer.id, channel);
  if (unsub) vars.unsubscribe_url = unsub;

  const baseRow = {
    customerId: customer.id,
    channel,
    direction: 'OUTBOUND' as const,
    templateId: template.id,
    callId: opts.callId ?? null,
    followUpTaskId: opts.followUpTaskId ?? null,
    toAddress,
    isMarketing: template.isMarketing,
    idempotencyKey: opts.idempotencyKey ?? null,
    isDemo: mode === 'demo',
  };

  const subject = template.subject ? renderTemplate(template.subject, vars) : null;
  let bodyText = renderTemplate(template.bodyText, vars);

  const saveOutcome = async (patch: Partial<typeof messages.$inferInsert>): Promise<MessageRow> => {
    if (opts.existingMessageId) {
      const [row] = await db.update(messages).set(patch).where(eq(messages.id, opts.existingMessageId)).returning();
      return row!;
    }
    const [row] = await db
      .insert(messages)
      .values({ ...baseRow, subject, body: bodyText, ...patch })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [existing] = await db.select().from(messages).where(eq(messages.idempotencyKey, opts.idempotencyKey!)).limit(1);
    return existing!;
  };

  // Compliance gate: fails closed. Deferral is not a failure.
  if (!elig.eligible) {
    if (elig.deferUntil !== undefined && elig.blocked.length === 0) throw new DeferredError(elig.deferUntil ?? null, 'outside_permitted_hours');
    const first = elig.blocked[0]!;
    const row = await saveOutcome({
      status: 'BLOCKED',
      errorCode: first.code,
      errorMessage: elig.blocked.map((b) => b.message).join(' '),
      failedAt: new Date(),
    });
    return { message: row, sent: false, retryable: false };
  }

  // Marketing email must carry a working unsubscribe link; without APP_URL we cannot provide one.
  if (channel === 'EMAIL' && template.isMarketing && !unsub && mode === 'live') {
    const row = await saveOutcome({
      status: 'BLOCKED',
      errorCode: 'unsubscribe_unavailable',
      errorMessage: 'APP_URL is not configured, so a required unsubscribe link cannot be generated.',
      failedAt: new Date(),
    });
    return { message: row, sent: false, retryable: false };
  }

  const rl = await rateLimit({ key: 'messages:global', limit: settings.rateLimits.messagesPerMinute, windowSec: 60 });
  if (!rl.allowed) throw new DeferredError(new Date(Date.now() + rl.retryAfter * 1000), 'rate_limited');

  // Persist QUEUED first so the attempt is auditable even if the process dies mid-send.
  const queued = await saveOutcome({ status: 'QUEUED', provider: mode === 'demo' ? 'demo' : undefined });
  if (queued.status !== 'QUEUED' && !opts.existingMessageId) {
    return { message: queued, sent: queued.status !== 'FAILED' && queued.status !== 'BLOCKED', retryable: false };
  }
  const messageId = queued.id;
  const update = async (patch: Partial<typeof messages.$inferInsert>) => {
    const [row] = await db.update(messages).set(patch).where(eq(messages.id, messageId)).returning();
    return row!;
  };

  // DEMO mode: nothing leaves the system. The record is flagged isDemo and shown with a DEMO label.
  if (mode === 'demo') {
    const row = await update({ provider: 'demo', status: 'SENT', sentAt: new Date(), providerMessageId: `demo-${messageId}`, errorCode: null, errorMessage: null });
    await enqueue('messages:demo-deliver', { messageId }, { jobId: `demo-deliver-${messageId}`, delayMs: 3000 });
    return { message: row, sent: true, retryable: false };
  }

  try {
    let providerName: string;
    let providerMessageId: string | null;
    let from: string | undefined;
    const env = getEnv();

    if (channel === 'EMAIL') {
      const provider = getEmailProvider();
      providerName = provider.name;
      const footerText = template.isMarketing && unsub ? `\n\n—\nTo stop receiving these emails: ${unsub}` : '';
      const html = template.bodyHtml
        ? renderTemplate(template.bodyHtml, vars, { escapeHtml: true }) +
          (template.isMarketing && unsub ? `<p style="font-size:12px;color:#666">To stop receiving these emails, <a href="${escapeHtml(unsub)}">unsubscribe</a>.</p>` : '')
        : undefined;
      bodyText += footerText;
      const res = await provider.send({
        to: customer.email!,
        subject: subject ?? '(no subject)',
        text: bodyText,
        html,
        headers:
          template.isMarketing && unsub
            ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
            : undefined,
        attachments: template.attachmentUrls.map((a) => ({ filename: a.name, url: a.url })),
      });
      providerMessageId = res.providerMessageId;
      from = env.EMAIL_FROM;
    } else if (channel === 'SMS') {
      const provider = getSmsProvider();
      providerName = provider.name;
      const res = await provider.send({
        to: customer.phone!,
        body: bodyText,
        contentSid: template.providerTemplateId ?? undefined,
        statusCallbackUrl: env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/api/webhooks/twilio/sms-status` : undefined,
      });
      providerMessageId = res.providerMessageId;
      from = env.TWILIO_SMS_FROM;
    } else {
      const provider = getWhatsAppProvider();
      providerName = provider.name;
      const names = template.variables.length ? template.variables : [];
      const res = await provider.sendTemplate({
        to: customer.phone!,
        templateName: template.providerTemplateId!,
        language: template.language,
        variables: names.map((n) => vars[n] ?? ''),
      });
      providerMessageId = res.providerMessageId;
    }

    const row = await update({
      provider: providerName,
      providerMessageId,
      fromAddress: from ?? null,
      body: bodyText,
      status: 'SENT', // "SENT" == accepted by the provider. DELIVERED only ever comes from a provider webhook.
      sentAt: new Date(),
      errorCode: null,
      errorMessage: null,
    });
    return { message: row, sent: true, retryable: false };
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      const row = await update({
        status: 'FAILED',
        errorCode: 'NOT_CONFIGURED',
        errorMessage: `Not configured: ${err.provider} is missing ${err.missing.join(', ')}. See Integrations for setup instructions.`,
        failedAt: new Date(),
      });
      return { message: row, sent: false, retryable: false };
    }
    const retryable = err instanceof ProviderError ? err.retryable : false;
    logger.warn({ messageId, channel, err: sanitizeError(err) }, 'message send failed');
    const row = await update({
      status: 'FAILED',
      errorCode: err instanceof ProviderError ? (err.opts.code ?? 'PROVIDER_ERROR') : 'SEND_ERROR',
      errorMessage: sanitizeError(err),
      failedAt: new Date(),
    });
    // Live-mode failures are reported, never silently replaced by a simulated success.
    return { message: row, sent: false, retryable };
  }
}
