import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import {
  campaignLeads,
  consentRecords,
  countryPolicies,
  customers,
  followUpTasks,
  suppressionRecords,
  type CallWindow,
} from '@/db/schema';
import { intersectWindows, isWithinWindows, nextWindowOpen, resolveTimezone } from '@/lib/tz';
import { audit } from '@/lib/audit';

export type Channel = 'VOICE' | 'SMS' | 'EMAIL' | 'WHATSAPP';
export type ConsentState = 'UNKNOWN' | 'GRANTED' | 'DENIED' | 'WITHDRAWN';
export type Mode = 'demo' | 'live';
export type Reason = { code: string; message: string };

export type EligibilityResult = {
  eligible: boolean;
  /** Permanent blockers — the record must not be contacted until the cause is fixed. */
  blocked: Reason[];
  /** Set when the ONLY problem is the time of day; retry at this instant. */
  deferUntil?: Date | null;
  timezone?: string | null;
};

export type PolicyRow = typeof countryPolicies.$inferSelect;

export type CustomerFacts = {
  id: string;
  phone: string | null;
  email: string | null;
  country: string | null;
  timezone: string | null;
  doNotCall: boolean;
  archivedAt: Date | null;
  deletedAt: Date | null;
  isDemo: boolean;
};

const CONSENT_FLAG: Record<Channel, keyof Pick<PolicyRow, 'requireConsentVoice' | 'requireConsentSms' | 'requireConsentWhatsapp' | 'requireConsentEmail'>> = {
  VOICE: 'requireConsentVoice',
  SMS: 'requireConsentSms',
  WHATSAPP: 'requireConsentWhatsapp',
  EMAIL: 'requireConsentEmail',
};

function baseChecks(c: CustomerFacts, policy: PolicyRow | null, mode: Mode, blocked: Reason[]) {
  if (c.deletedAt || c.archivedAt) blocked.push({ code: 'customer_inactive', message: 'Customer is archived or deleted.' });
  if (mode === 'live' && c.isDemo) blocked.push({ code: 'demo_record', message: 'Demo records cannot be contacted in live mode.' });
  if (!c.country) {
    blocked.push({ code: 'country_unknown', message: 'Customer country is unknown, so no compliance policy can be applied.' });
  } else if (!policy) {
    blocked.push({ code: 'no_country_policy', message: `No compliance policy is configured for ${c.country}. Add and review one under Compliance.` });
  } else {
    if (!policy.enabled) blocked.push({ code: 'country_disabled', message: `Contact is disabled for ${c.country}.` });
    if (mode === 'live' && !policy.reviewed) {
      blocked.push({ code: 'policy_unreviewed', message: `The ${c.country} compliance policy has not been reviewed and approved by an administrator.` });
    }
  }
}

/** Pure decision function for outbound calls — all inputs are passed in so it can be tested exhaustively. */
export function evaluateCallEligibility(input: {
  customer: CustomerFacts;
  policy: PolicyRow | null;
  consent: ConsentState;
  suppressed: boolean;
  callWindows: CallWindow[];
  fallbackTimezone?: string | null;
  mode: Mode;
  now: Date;
}): EligibilityResult {
  const { customer: c, policy, consent, suppressed, mode, now } = input;
  const blocked: Reason[] = [];

  baseChecks(c, policy, mode, blocked);
  if (!c.phone) blocked.push({ code: 'no_phone', message: 'Customer has no valid phone number.' });
  if (c.doNotCall) blocked.push({ code: 'do_not_call', message: 'Customer is flagged Do Not Call.' });
  if (suppressed) blocked.push({ code: 'suppressed', message: 'Customer is on the suppression list for calls.' });

  if (consent === 'DENIED' || consent === 'WITHDRAWN') {
    blocked.push({ code: 'consent_withdrawn', message: `Customer consent is ${consent.toLowerCase()}.` });
  } else if (policy?.requireConsentVoice && consent !== 'GRANTED') {
    blocked.push({ code: 'consent_missing', message: 'No recorded consent for voice calls, which this country requires.' });
  }

  if (policy?.requireDndScrub && mode === 'live' && !policy.dndScrubConfirmedAt) {
    blocked.push({ code: 'dnd_scrub_not_confirmed', message: 'An administrator must confirm numbers were scrubbed against the national Do-Not-Call registry.' });
  }

  const tz = resolveTimezone({ customerTimezone: c.timezone, country: c.country, campaignFallback: input.fallbackTimezone });
  if (!tz) blocked.push({ code: 'timezone_unknown', message: 'Customer timezone cannot be determined; set one on the customer or a campaign fallback timezone.' });

  if (blocked.length) return { eligible: false, blocked, timezone: tz };

  const windows = intersectWindows(
    input.callWindows,
    policy ? { start: policy.callWindowStart, end: policy.callWindowEnd, weekdays: policy.allowedWeekdays } : null,
  );
  if (!windows.length) {
    return {
      eligible: false,
      blocked: [{ code: 'no_valid_window', message: 'The campaign calling windows do not overlap the legally permitted hours for this country.' }],
      timezone: tz,
    };
  }
  if (!isWithinWindows(now, tz!, windows)) {
    return {
      eligible: false,
      blocked: [],
      deferUntil: nextWindowOpen(now, tz!, windows),
      timezone: tz,
    };
  }
  return { eligible: true, blocked: [], timezone: tz };
}

export type TemplateFacts = {
  isMarketing: boolean;
  approved: boolean;
  providerTemplateId: string | null;
  dltTemplateId: string | null;
};

/** Pure decision function for SMS / WhatsApp / email. */
export function evaluateMessageEligibility(input: {
  channel: Exclude<Channel, 'VOICE'>;
  customer: CustomerFacts;
  policy: PolicyRow | null;
  consent: ConsentState;
  suppressed: boolean;
  template: TemplateFacts;
  mode: Mode;
  now: Date;
}): EligibilityResult {
  const { channel, customer: c, policy, consent, suppressed, template, mode, now } = input;
  const blocked: Reason[] = [];

  baseChecks(c, policy, mode, blocked);
  const address = channel === 'EMAIL' ? c.email : c.phone;
  if (!address) blocked.push({ code: 'no_address', message: channel === 'EMAIL' ? 'Customer has no email address.' : 'Customer has no valid phone number.' });
  if (suppressed) blocked.push({ code: 'suppressed', message: `Customer has opted out of ${channel.toLowerCase()} messages.` });
  if (channel !== 'EMAIL' && c.doNotCall && template.isMarketing) {
    blocked.push({ code: 'do_not_contact', message: 'Customer is flagged Do Not Contact for marketing.' });
  }

  if (consent === 'DENIED' || consent === 'WITHDRAWN') {
    blocked.push({ code: 'consent_withdrawn', message: `Customer consent for ${channel.toLowerCase()} is ${consent.toLowerCase()}.` });
  } else if (template.isMarketing && policy?.[CONSENT_FLAG[channel]] && consent !== 'GRANTED') {
    blocked.push({ code: 'consent_missing', message: `No recorded consent for ${channel.toLowerCase()} marketing messages, which this country requires.` });
  }

  if (channel === 'SMS' && template.isMarketing && policy?.requireDltTemplate && !(template.dltTemplateId && template.approved)) {
    blocked.push({ code: 'dlt_template_missing', message: 'This country requires a registered (DLT) approved template for promotional SMS.' });
  }
  if (channel === 'WHATSAPP' && !(template.approved && template.providerTemplateId)) {
    blocked.push({ code: 'whatsapp_template_unapproved', message: 'WhatsApp business-initiated messages require a provider-approved template.' });
  }

  if (blocked.length) return { eligible: false, blocked };

  // Promotional SMS / WhatsApp follow the same permitted-hours envelope as calls.
  if (channel !== 'EMAIL' && template.isMarketing && policy) {
    const tz = resolveTimezone({ customerTimezone: c.timezone, country: c.country });
    if (!tz) return { eligible: false, blocked: [{ code: 'timezone_unknown', message: 'Customer timezone cannot be determined.' }] };
    const windows = intersectWindows(
      [{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' }],
      { start: policy.callWindowStart, end: policy.callWindowEnd, weekdays: policy.allowedWeekdays },
    );
    if (!isWithinWindows(now, tz, windows)) {
      return { eligible: false, blocked: [], deferUntil: nextWindowOpen(now, tz, windows), timezone: tz };
    }
  }
  return { eligible: true, blocked: [] };
}

/* -------------------------------------------------------------------------- */
/* DB loaders                                                                 */
/* -------------------------------------------------------------------------- */

export async function getPolicy(country: string | null | undefined): Promise<PolicyRow | null> {
  if (!country) return null;
  const [row] = await db.select().from(countryPolicies).where(eq(countryPolicies.countryCode, country.toUpperCase())).limit(1);
  return row ?? null;
}

export async function getConsentState(customerId: string, channel: Channel): Promise<ConsentState> {
  const [row] = await db
    .select({ status: consentRecords.status })
    .from(consentRecords)
    .where(and(eq(consentRecords.customerId, customerId), eq(consentRecords.channel, channel)))
    .orderBy(desc(consentRecords.capturedAt), desc(consentRecords.createdAt))
    .limit(1);
  return (row?.status ?? 'UNKNOWN') as ConsentState;
}

export async function isSuppressed(c: { id: string; phone: string | null; email: string | null }, channel: Channel): Promise<boolean> {
  const targets = [eq(suppressionRecords.customerId, c.id)];
  if (channel === 'EMAIL') {
    if (c.email) targets.push(eq(suppressionRecords.email, c.email));
  } else if (c.phone) {
    targets.push(eq(suppressionRecords.phone, c.phone));
  }
  const rows = await db
    .select({ id: suppressionRecords.id })
    .from(suppressionRecords)
    .where(
      and(
        isNull(suppressionRecords.liftedAt),
        or(...targets),
        or(isNull(suppressionRecords.channel), eq(suppressionRecords.channel, channel)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function loadCustomerFacts(customerId: string): Promise<CustomerFacts | null> {
  const [c] = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      email: customers.email,
      country: customers.country,
      timezone: customers.timezone,
      doNotCall: customers.doNotCall,
      archivedAt: customers.archivedAt,
      deletedAt: customers.deletedAt,
      isDemo: customers.isDemo,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return c ?? null;
}

export async function getCallEligibility(opts: {
  customerId: string;
  callWindows: CallWindow[];
  fallbackTimezone?: string | null;
  mode: Mode;
  now?: Date;
}): Promise<EligibilityResult> {
  const customer = await loadCustomerFacts(opts.customerId);
  if (!customer) return { eligible: false, blocked: [{ code: 'customer_missing', message: 'Customer not found.' }] };
  const [policy, consent, suppressed] = await Promise.all([
    getPolicy(customer.country),
    getConsentState(customer.id, 'VOICE'),
    isSuppressed(customer, 'VOICE'),
  ]);
  return evaluateCallEligibility({
    customer,
    policy,
    consent,
    suppressed,
    callWindows: opts.callWindows,
    fallbackTimezone: opts.fallbackTimezone,
    mode: opts.mode,
    now: opts.now ?? new Date(),
  });
}

export async function getMessageEligibility(opts: {
  customerId: string;
  channel: Exclude<Channel, 'VOICE'>;
  template: TemplateFacts;
  mode: Mode;
  now?: Date;
}): Promise<EligibilityResult> {
  const customer = await loadCustomerFacts(opts.customerId);
  if (!customer) return { eligible: false, blocked: [{ code: 'customer_missing', message: 'Customer not found.' }] };
  const [policy, consent, suppressed] = await Promise.all([
    getPolicy(customer.country),
    getConsentState(customer.id, opts.channel),
    isSuppressed(customer, opts.channel),
  ]);
  return evaluateMessageEligibility({
    channel: opts.channel,
    customer,
    policy,
    consent,
    suppressed,
    template: opts.template,
    mode: opts.mode,
    now: opts.now ?? new Date(),
  });
}

/* -------------------------------------------------------------------------- */
/* Opt-out handling                                                           */
/* -------------------------------------------------------------------------- */

const OPT_OUT_PATTERNS: RegExp[] = [
  /\bdo not call\b/i,
  /\bdon'?t call\b/i,
  /\bstop (calling|call)\b/i,
  /\bnever call\b/i,
  /\bno more calls?\b/i,
  /\bremove (me|my number|my name)\b/i,
  /\btake me off\b/i,
  /\bunsubscribe\b/i,
  /\bdo not contact\b/i,
  /\bdon'?t contact\b/i,
  /\bdo ?not disturb\b/i,
  /\bmat call (karo|karna)\b/i,
  /\bcall mat (karo|karna)\b/i,
  /\bphone mat (karo|karna)\b/i,
];

const MESSAGE_STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt-out', 'unsub']);

/** Safety net independent of the model: detect an explicit "stop calling me" in customer speech. */
export function detectOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  return OPT_OUT_PATTERNS.some((re) => re.test(text));
}

/** Inbound SMS / WhatsApp keyword check (exact-word, case-insensitive). */
export function isStopKeyword(text: string | null | undefined): boolean {
  return MESSAGE_STOP_KEYWORDS.has(String(text ?? '').trim().toLowerCase());
}

export type OptOutInput = {
  customerId: string;
  channels?: Channel[] | 'ALL';
  reason?: typeof suppressionRecords.$inferInsert.reason;
  source: string;
  note?: string;
  userId?: string | null;
};

/**
 * Apply an opt-out immediately and atomically: suppression records, withdrawn consent, DNC flag,
 * cancellation of queued campaign attempts and pending promotional follow-ups.
 */
export async function applyOptOut(input: OptOutInput, outer?: Tx) {
  const run = async (tx: Tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
    if (!c) return { applied: false };
    const all = input.channels === undefined || input.channels === 'ALL';
    const channels: Channel[] = Array.isArray(input.channels) ? input.channels : ['VOICE', 'SMS', 'EMAIL', 'WHATSAPP'];
    const reason = input.reason ?? 'CUSTOMER_OPT_OUT';

    // One suppression row covering the requested scope. channel = null means every channel.
    await tx.insert(suppressionRecords).values(
      all
        ? [{ channel: null, phone: c.phone, email: c.email, customerId: c.id, reason, source: input.source, note: input.note ?? null, createdById: input.userId ?? null }]
        : channels.map((ch) => ({
            channel: ch,
            phone: ch === 'EMAIL' ? null : c.phone,
            email: ch === 'EMAIL' ? c.email : null,
            customerId: c.id,
            reason,
            source: input.source,
            note: input.note ?? null,
            createdById: input.userId ?? null,
          })),
    );

    await tx.insert(consentRecords).values(
      channels.map((ch) => ({
        customerId: c.id,
        channel: ch,
        status: 'WITHDRAWN' as const,
        source: input.source,
        evidence: input.note ?? 'Opt-out recorded',
        recordedById: input.userId ?? null,
      })),
    );

    if (all || channels.includes('VOICE')) {
      await tx
        .update(customers)
        .set({ doNotCall: true, lastOutcome: 'DO_NOT_CONTACT', updatedAt: new Date() })
        .where(eq(customers.id, c.id));
      await tx
        .update(campaignLeads)
        .set({ status: 'CANCELED', skipReason: 'Customer opted out', updatedAt: new Date() })
        .where(
          and(
            eq(campaignLeads.customerId, c.id),
            inArray(campaignLeads.status, ['PENDING', 'QUEUED', 'RETRY_WAIT']),
          ),
        );
    }

    // Cancel promotional follow-ups that are still pending on affected channels.
    const typeByChannel = { SMS: 'SEND_SMS', EMAIL: 'SEND_EMAIL', WHATSAPP: 'SEND_WHATSAPP' } as const;
    const types = channels
      .filter((ch): ch is 'SMS' | 'EMAIL' | 'WHATSAPP' => ch !== 'VOICE')
      .map((ch) => typeByChannel[ch]);
    if (types.length) {
      await tx
        .update(followUpTasks)
        .set({ status: 'CANCELED', lastError: 'Customer opted out', updatedAt: new Date() })
        .where(
          and(eq(followUpTasks.customerId, c.id), eq(followUpTasks.status, 'PENDING'), inArray(followUpTasks.type, types)),
        );
    }
    return { applied: true, customerId: c.id };
  };

  const result = outer ? await run(outer) : await db.transaction(run);
  if (result.applied) {
    await audit(
      {
        userId: input.userId ?? null,
        action: 'compliance.opt_out',
        entityType: 'customer',
        entityId: input.customerId,
        metadata: { source: input.source, channels: input.channels ?? 'ALL' },
      },
      outer,
    );
  }
  return result;
}
