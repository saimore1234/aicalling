import { describe, expect, it } from 'vitest';
import {
  detectOptOut,
  evaluateCallEligibility,
  evaluateMessageEligibility,
  isStopKeyword,
  type CustomerFacts,
  type PolicyRow,
} from '@/server/compliance';

const customer = (over: Partial<CustomerFacts> = {}): CustomerFacts => ({
  id: 'c1',
  phone: '+919876543210',
  email: 'a@example.com',
  country: 'IN',
  timezone: null,
  doNotCall: false,
  archivedAt: null,
  deletedAt: null,
  isDemo: false,
  ...over,
});

const policy = (over: Partial<PolicyRow> = {}): PolicyRow => ({
  id: 'p1',
  countryCode: 'IN',
  name: 'India',
  enabled: true,
  reviewed: true,
  reviewedById: null,
  reviewedAt: new Date(),
  requireConsentVoice: true,
  requireConsentSms: true,
  requireConsentWhatsapp: true,
  requireConsentEmail: true,
  requireDndScrub: false,
  dndScrubConfirmedAt: null,
  requireDltTemplate: false,
  callWindowStart: '09:00',
  callWindowEnd: '20:00',
  allowedWeekdays: [1, 2, 3, 4, 5, 6],
  defaultTimezone: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

// 2026-10-21 is a Wednesday. 06:30Z = 12:00 IST (inside window); 02:00Z = 07:30 IST (before window).
const NOON_IST = new Date('2026-10-21T06:30:00Z');
const EARLY_IST = new Date('2026-10-21T02:00:00Z');
const windows = [{ days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00' }];

const base = (over: Record<string, unknown> = {}) =>
  evaluateCallEligibility({
    customer: customer(),
    policy: policy(),
    consent: 'GRANTED',
    suppressed: false,
    callWindows: windows,
    mode: 'live',
    now: NOON_IST,
    ...over,
  } as Parameters<typeof evaluateCallEligibility>[0]);

describe('evaluateCallEligibility (fails closed)', () => {
  it('allows a consented, in-window, reviewed-policy customer', () => {
    expect(base()).toMatchObject({ eligible: true, blocked: [] });
  });

  it.each([
    ['no consent on record', { consent: 'UNKNOWN' }, 'consent_missing'],
    ['denied consent', { consent: 'DENIED' }, 'consent_withdrawn'],
    ['withdrawn consent', { consent: 'WITHDRAWN' }, 'consent_withdrawn'],
    ['suppression match', { suppressed: true }, 'suppressed'],
    ['no country policy', { policy: null }, 'no_country_policy'],
    ['unreviewed policy in live mode', { policy: policy({ reviewed: false }) }, 'policy_unreviewed'],
    ['disabled country', { policy: policy({ enabled: false }) }, 'country_disabled'],
    ['DNC flag', { customer: customer({ doNotCall: true }) }, 'do_not_call'],
    ['archived customer', { customer: customer({ archivedAt: new Date() }) }, 'customer_inactive'],
    ['missing phone', { customer: customer({ phone: null }) }, 'no_phone'],
    ['unknown country', { customer: customer({ country: null }) }, 'country_unknown'],
    ['demo record in live mode', { customer: customer({ isDemo: true }) }, 'demo_record'],
    ['DND scrub not confirmed', { policy: policy({ requireDndScrub: true }) }, 'dnd_scrub_not_confirmed'],
  ])('blocks: %s', (_label, over, code) => {
    const r = base(over);
    expect(r.eligible).toBe(false);
    expect(r.blocked.map((b) => b.code)).toContain(code);
  });

  it('allows an unreviewed policy in demo mode (nothing real is contacted)', () => {
    expect(base({ policy: policy({ reviewed: false }), mode: 'demo' }).eligible).toBe(true);
  });

  it('still enforces consent in demo mode', () => {
    expect(base({ mode: 'demo', consent: 'UNKNOWN' }).eligible).toBe(false);
  });

  it('does not require consent when the country policy does not', () => {
    expect(base({ policy: policy({ requireConsentVoice: false }), consent: 'UNKNOWN' }).eligible).toBe(true);
  });

  it('still blocks withdrawn consent even when the policy does not require consent', () => {
    expect(base({ policy: policy({ requireConsentVoice: false }), consent: 'WITHDRAWN' }).eligible).toBe(false);
  });

  it('blocks multi-timezone countries with no customer zone and no fallback', () => {
    const r = base({ customer: customer({ country: 'US', phone: '+14155550100' }), policy: policy({ countryCode: 'US' }) });
    expect(r.blocked.map((b) => b.code)).toContain('timezone_unknown');
  });

  it('uses an explicit campaign fallback timezone', () => {
    const r = base({
      customer: customer({ country: 'US', phone: '+14155550100' }),
      policy: policy({ countryCode: 'US', callWindowStart: '08:00', callWindowEnd: '21:00', allowedWeekdays: [1, 2, 3, 4, 5, 6, 7] }),
      fallbackTimezone: 'Asia/Kolkata',
    });
    expect(r.eligible).toBe(true);
  });

  it('defers (does not permanently block) outside the calling window and reports the next opening', () => {
    const r = base({ now: EARLY_IST });
    expect(r.eligible).toBe(false);
    expect(r.blocked).toEqual([]);
    // Campaign window opens 10:00 IST = 04:30Z same day
    expect(r.deferUntil?.toISOString()).toBe('2026-10-21T04:30:00.000Z');
  });

  it('clips the campaign window to the country legal envelope', () => {
    // Campaign wants 07:00-22:00 but policy only allows 09:00-20:00. 07:30 IST must be outside.
    const r = base({ callWindows: [{ days: [1, 2, 3, 4, 5], start: '07:00', end: '22:00' }], now: EARLY_IST });
    expect(r.eligible).toBe(false);
    expect(r.deferUntil?.toISOString()).toBe('2026-10-21T03:30:00.000Z'); // 09:00 IST
  });

  it('blocks when windows never overlap the legal hours', () => {
    const r = base({ callWindows: [{ days: [7], start: '10:00', end: '18:00' }] }); // Sunday not allowed in policy
    expect(r.blocked.map((b) => b.code)).toContain('no_valid_window');
  });
});

describe('evaluateMessageEligibility', () => {
  const tpl = { isMarketing: true, approved: true, providerTemplateId: 'tpl', dltTemplateId: null as string | null };
  const msg = (over: Record<string, unknown> = {}) =>
    evaluateMessageEligibility({
      channel: 'EMAIL',
      customer: customer(),
      policy: policy(),
      consent: 'GRANTED',
      suppressed: false,
      template: tpl,
      mode: 'live',
      now: NOON_IST,
      ...over,
    } as Parameters<typeof evaluateMessageEligibility>[0]);

  it('allows consented email', () => expect(msg().eligible).toBe(true));
  it('blocks marketing email without consent where required', () =>
    expect(msg({ consent: 'UNKNOWN' }).blocked.map((b) => b.code)).toContain('consent_missing'));
  it('allows transactional email without consent', () =>
    expect(msg({ consent: 'UNKNOWN', template: { ...tpl, isMarketing: false } }).eligible).toBe(true));
  it('blocks after unsubscribe/suppression', () => expect(msg({ suppressed: true }).eligible).toBe(false));
  it('requires a DLT-approved template for promotional SMS in DLT countries', () => {
    const r = msg({ channel: 'SMS', policy: policy({ requireDltTemplate: true }) });
    expect(r.blocked.map((b) => b.code)).toContain('dlt_template_missing');
    const ok = msg({ channel: 'SMS', policy: policy({ requireDltTemplate: true }), template: { ...tpl, dltTemplateId: '1107' } });
    expect(ok.eligible).toBe(true);
  });
  it('requires an approved provider template for WhatsApp', () => {
    const r = msg({ channel: 'WHATSAPP', template: { ...tpl, approved: false } });
    expect(r.blocked.map((b) => b.code)).toContain('whatsapp_template_unapproved');
  });
  it('defers promotional SMS outside permitted hours', () => {
    const r = msg({ channel: 'SMS', now: new Date('2026-10-21T17:00:00Z') }); // 22:30 IST
    expect(r.eligible).toBe(false);
    expect(r.deferUntil).toBeInstanceOf(Date);
  });
  it('blocks demo customers in live mode', () => expect(msg({ customer: customer({ isDemo: true }) }).eligible).toBe(false));
});

describe('opt-out detection', () => {
  it.each(['Please do not call me again', "don't call this number", 'stop calling', 'remove my number from your list', 'Take me off your list', 'mat call karo'])(
    'detects "%s"',
    (t) => expect(detectOptOut(t)).toBe(true),
  );
  it.each(['What does your company do?', 'Call me back tomorrow at 5', "I'm not interested right now", ''])('ignores "%s"', (t) =>
    expect(detectOptOut(t)).toBe(false),
  );
  it('recognises SMS/WhatsApp stop keywords exactly', () => {
    expect(isStopKeyword(' STOP ')).toBe(true);
    expect(isStopKeyword('unsubscribe')).toBe(true);
    expect(isStopKeyword('please stop by tomorrow')).toBe(false);
  });
});
