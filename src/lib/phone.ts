import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export type PhoneResult = { ok: true; e164: string; country: string | null } | { ok: false; reason: string };

/** Spreadsheet cells often arrive as numbers or in scientific notation (e.g. 9.876543210E9). */
function coerce(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw.toLocaleString('fullwide', { useGrouping: false }) : '';
  let s = String(raw).trim();
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = n.toLocaleString('fullwide', { useGrouping: false });
  }
  return s;
}

export function normalizePhone(raw: unknown, defaultCountry?: string | null): PhoneResult {
  const input = coerce(raw);
  if (!input) return { ok: false, reason: 'Phone number is empty' };
  const cleaned = input.replace(/[\s().-]/g, '');
  const parsed = parsePhoneNumberFromString(cleaned, (defaultCountry?.toUpperCase() as CountryCode | undefined) || undefined);
  if (!parsed) {
    return {
      ok: false,
      reason: defaultCountry
        ? `"${input}" is not a recognisable phone number`
        : `"${input}" has no country code and no default country was set`,
    };
  }
  if (!parsed.isValid()) return { ok: false, reason: `"${input}" is not a valid phone number` };
  return { ok: true, e164: parsed.number, country: parsed.country ?? null };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: unknown): { ok: true; email: string } | { ok: false; reason: string } {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return { ok: false, reason: 'Email is empty' };
  if (s.length > 254 || !EMAIL_RE.test(s)) return { ok: false, reason: `"${s}" is not a valid email address` };
  return { ok: true, email: s };
}

export function normalizeCountry(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase();
  const alias: Record<string, string> = {
    india: 'IN',
    'united states': 'US',
    usa: 'US',
    'united kingdom': 'GB',
    uk: 'GB',
    'united arab emirates': 'AE',
    uae: 'AE',
    singapore: 'SG',
    australia: 'AU',
    canada: 'CA',
    germany: 'DE',
    france: 'FR',
  };
  return alias[s.toLowerCase()] ?? null;
}

export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
