import { normalizeCountry, normalizeEmail, normalizePhone } from '@/lib/phone';
import { isValidTimezone } from '@/lib/tz';
import { isValidMappingValue, type ColumnMapping } from './fields';

export type ImportOptions = { defaultCountry?: string; consentChannels?: string[]; defaultConsentSource?: string };

export type ValidRecord = {
  name: string;
  company: string | null;
  phone: string | null;
  phoneRaw: string | null;
  email: string | null;
  country: string | null;
  timezone: string | null;
  language: string | null;
  productInterest: string | null;
  category: string | null;
  leadSource: string | null;
  salesOwnerRef: string | null;
  consentStatus: 'UNKNOWN' | 'GRANTED' | 'DENIED' | 'WITHDRAWN';
  consentSource: string | null;
  consentAt: Date | null;
  doNotCall: boolean;
  notes: string | null;
  customFields: Record<string, string>;
};

export type RowResult = { ok: true; record: ValidRecord } | { ok: false; errors: string[] };

const TRUE = new Set(['yes', 'y', 'true', '1', 'dnc', 'ndnc', 'dnd', 'do not call', 'registered', 'x']);
const FALSE = new Set(['no', 'n', 'false', '0', '', 'none', 'not registered']);

export function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  return null;
}

const GRANTED = new Set(['granted', 'yes', 'y', 'true', '1', 'opt-in', 'opt in', 'opted in', 'consented', 'given']);
const DENIED = new Set(['denied', 'no', 'n', 'false', '0', 'refused', 'declined', 'opt-out', 'opt out', 'opted out']);
const WITHDRAWN = new Set(['withdrawn', 'revoked', 'unsubscribed']);

export function parseConsent(v: string): 'UNKNOWN' | 'GRANTED' | 'DENIED' | 'WITHDRAWN' | null {
  const s = v.trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'n/a' || s === 'na' || s === 'pending') return 'UNKNOWN';
  if (GRANTED.has(s)) return 'GRANTED';
  if (DENIED.has(s)) return 'DENIED';
  if (WITHDRAWN.has(s)) return 'WITHDRAWN';
  return null;
}

/**
 * Parses ISO/RFC dates and Excel serial numbers (days since 1899-12-30), which appear when a date cell
 * is exported without its format. Plain small numbers such as "2026" are NOT treated as serials.
 */
export function parseDateLoose(v: string): Date | null {
  const s = v.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial <= 80000) return new Date(Math.round((serial - 25569) * 86400 * 1000));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clean(v: string | undefined, max = 500): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/** Group a raw row (keyed by file header) into target fields according to the mapping. */
export function applyMapping(raw: Record<string, string>, mapping: ColumnMapping) {
  const fields: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [header, value] of Object.entries(raw)) {
    const target = mapping[header];
    if (!target) continue;
    if (target.startsWith('custom:')) {
      const v = (value ?? '').trim();
      if (v) custom[target.slice(7)] = v.slice(0, 1000);
    } else if (!(target in fields) || !fields[target]) {
      fields[target] = value ?? '';
    }
  }
  return { fields, custom };
}

export function validateMapping(mapping: ColumnMapping): string[] {
  const errors: string[] = [];
  const targets = Object.values(mapping).filter(Boolean);
  for (const [h, t] of Object.entries(mapping)) if (!isValidMappingValue(t)) errors.push(`Column "${h}" has an invalid mapping "${t}".`);
  if (!targets.includes('name')) errors.push('A column must be mapped to "Customer name".');
  if (!targets.includes('phone') && !targets.includes('email')) errors.push('A column must be mapped to "Phone number" or "Email address".');
  const seen = new Set<string>();
  for (const t of targets) {
    if (t.startsWith('custom:')) continue;
    if (seen.has(t)) errors.push(`More than one column is mapped to "${t}".`);
    seen.add(t);
  }
  return errors;
}

export function validateRow(raw: Record<string, string>, mapping: ColumnMapping, opts: ImportOptions): RowResult {
  const { fields, custom } = applyMapping(raw, mapping);
  const errors: string[] = [];

  const name = clean(fields.name, 200);
  if (!name) errors.push('Customer name is required.');

  // Country first: it is the default region for parsing local-format phone numbers.
  let country: string | null = null;
  if (clean(fields.country)) {
    country = normalizeCountry(fields.country);
    if (!country) errors.push(`Country "${fields.country}" is not a recognised 2-letter ISO code.`);
  }
  const defaultCountry = opts.defaultCountry ? opts.defaultCountry.toUpperCase() : undefined;

  let phone: string | null = null;
  const phoneRaw = clean(fields.phone, 50);
  if (phoneRaw) {
    const p = normalizePhone(phoneRaw, country ?? defaultCountry);
    if (p.ok) {
      phone = p.e164;
      country ??= p.country ?? null;
    } else errors.push(p.reason);
  }
  country ??= defaultCountry ?? null;

  let email: string | null = null;
  if (clean(fields.email)) {
    const e = normalizeEmail(fields.email);
    if (e.ok) email = e.email;
    else errors.push(e.reason);
  }
  if (!phone && !email && !errors.some((e) => /phone|email/i.test(e))) errors.push('Either a phone number or an email address is required.');

  const timezone = clean(fields.timezone, 60);
  if (timezone && !isValidTimezone(timezone)) errors.push(`Timezone "${timezone}" is not a valid IANA timezone (e.g. Asia/Kolkata).`);

  let doNotCall = false;
  if (clean(fields.do_not_call)) {
    const b = parseBool(fields.do_not_call!);
    if (b === null) errors.push(`Do-not-call value "${fields.do_not_call}" is not recognised (use yes/no).`);
    else doNotCall = b;
  }

  let consentStatus: ValidRecord['consentStatus'] = 'UNKNOWN';
  if (clean(fields.consent_status)) {
    const c = parseConsent(fields.consent_status!);
    if (c === null) errors.push(`Consent status "${fields.consent_status}" is not recognised (use granted / denied / withdrawn / unknown).`);
    else consentStatus = c;
  }
  const consentSource = clean(fields.consent_source, 200) ?? clean(opts.defaultConsentSource, 200);
  let consentAt: Date | null = null;
  if (clean(fields.consent_timestamp)) {
    const d = parseDateLoose(fields.consent_timestamp!);
    if (!d) errors.push(`Consent date "${fields.consent_timestamp}" is not a valid date.`);
    else if (d.getTime() > Date.now() + 5 * 60_000) errors.push('Consent date is in the future.');
    else consentAt = d;
  }
  // A claim of consent without provenance cannot be audited, so it is rejected rather than trusted.
  if (consentStatus === 'GRANTED' && !consentSource) {
    errors.push('Consent is marked "granted" but no consent source was provided (add a consent source column or a default source).');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    record: {
      name: name!,
      company: clean(fields.company, 200),
      phone,
      phoneRaw,
      email,
      country,
      timezone,
      language: clean(fields.language, 20)?.toLowerCase() ?? null,
      productInterest: clean(fields.product_interest, 200),
      category: clean(fields.category, 100),
      leadSource: clean(fields.lead_source, 100),
      salesOwnerRef: clean(fields.sales_owner, 200)?.toLowerCase() ?? null,
      consentStatus,
      consentSource,
      consentAt,
      doNotCall,
      notes: clean(fields.notes, 2000),
      customFields: custom,
    },
  };
}

/** Stable key used for duplicate detection: phone wins, falls back to email. */
export function dedupeKeys(r: Pick<ValidRecord, 'phone' | 'email'>): { phone?: string; email?: string } {
  return { phone: r.phone ?? undefined, email: r.email ?? undefined };
}
