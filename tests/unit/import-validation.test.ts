import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePhone } from '@/lib/phone';
import { suggestMapping } from '@/server/imports/fields';
import { applyMapping, parseBool, parseConsent, parseDateLoose, validateMapping, validateRow } from '@/server/imports/validate';
import { csvSafe } from '@/server/imports/run';

const MAP = { Name: 'name', Phone: 'phone', Email: 'email', Country: 'country', Consent: 'consent_status', 'Consent Source': 'consent_source', Notes: 'notes', Tier: 'custom:tier' };

describe('phone normalisation', () => {
  it('normalises local Indian numbers using the default country', () => {
    expect(normalizePhone('98765 43210', 'IN')).toMatchObject({ ok: true, e164: '+919876543210', country: 'IN' });
    expect(normalizePhone('(098) 765-43210', 'IN')).toMatchObject({ ok: true, e164: '+919876543210' });
  });
  it('accepts international format without a default country', () => {
    expect(normalizePhone('+44 20 7946 0958')).toMatchObject({ ok: true, e164: '+442079460958', country: 'GB' });
  });
  it('handles spreadsheet numbers and scientific notation', () => {
    expect(normalizePhone(9876543210, 'IN')).toMatchObject({ ok: true, e164: '+919876543210' });
    expect(normalizePhone('9.87654321E9', 'IN')).toMatchObject({ ok: true, e164: '+919876543210' });
  });
  it('rejects invalid, empty and country-less local numbers with a reason', () => {
    expect(normalizePhone('12345', 'IN')).toMatchObject({ ok: false });
    expect(normalizePhone('', 'IN')).toMatchObject({ ok: false });
    const r = normalizePhone('9876543210');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/country/i);
  });
  it('validates email', () => {
    expect(normalizeEmail(' Foo@Bar.COM ')).toEqual({ ok: true, email: 'foo@bar.com' });
    expect(normalizeEmail('foo@bar')).toMatchObject({ ok: false });
    expect(normalizeEmail('not an email')).toMatchObject({ ok: false });
  });
});

describe('column mapping', () => {
  it('suggests a mapping from common header names', () => {
    const m = suggestMapping(['Customer Name', 'Mobile Number', 'E-mail', 'Company', 'Lead Source', 'Random Column', 'DNC']);
    expect(m['Customer Name']).toBe('name');
    expect(m['Mobile Number']).toBe('phone');
    expect(m['E-mail']).toBe('email');
    expect(m['Company']).toBe('company');
    expect(m['Lead Source']).toBe('lead_source');
    expect(m['DNC']).toBe('do_not_call');
    expect(m['Random Column']).toBe('');
  });
  it('requires name and a contact column, and forbids duplicate targets', () => {
    expect(validateMapping({ A: 'phone' })).toEqual(expect.arrayContaining([expect.stringMatching(/Customer name/)]));
    expect(validateMapping({ A: 'name' })).toEqual(expect.arrayContaining([expect.stringMatching(/Phone number/)]));
    expect(validateMapping({ A: 'name', B: 'name', C: 'phone' }).join()).toMatch(/More than one/);
    expect(validateMapping({ A: 'name', B: 'email' })).toEqual([]);
    expect(validateMapping({ A: 'name', B: 'email', C: 'bogus' }).join()).toMatch(/invalid mapping/);
  });
  it('groups custom fields', () => {
    const { fields, custom } = applyMapping({ Name: 'A', Tier: 'Gold', Junk: 'x' }, MAP);
    expect(fields.name).toBe('A');
    expect(custom).toEqual({ tier: 'Gold' });
  });
});

describe('row validation', () => {
  const ok = (raw: Record<string, string>, opts = { defaultCountry: 'IN' }) => validateRow(raw, MAP, opts);

  it('accepts a good row and normalises it', () => {
    const r = ok({ Name: ' Asha Rao ', Phone: '98765 43210', Email: 'ASHA@Example.com', Country: '', Consent: 'yes', 'Consent Source': 'web form', Notes: '', Tier: 'Gold' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record).toMatchObject({ name: 'Asha Rao', phone: '+919876543210', email: 'asha@example.com', country: 'IN', consentStatus: 'GRANTED', customFields: { tier: 'Gold' } });
    }
  });
  it('reports every problem in a row, not just the first', () => {
    const r = ok({ Name: '', Phone: '123', Email: 'bad', Country: '', Consent: '', 'Consent Source': '', Notes: '', Tier: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
  it('requires at least one contact method', () => {
    const r = ok({ Name: 'X', Phone: '', Email: '', Country: '', Consent: '', 'Consent Source': '', Notes: '', Tier: '' });
    expect(r.ok).toBe(false);
  });
  it('rejects consent claimed without provenance (cannot be audited)', () => {
    const r = ok({ Name: 'X', Phone: '9876543210', Email: '', Country: '', Consent: 'granted', 'Consent Source': '', Notes: '', Tier: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/consent source/i);
  });
  it('accepts consent when an import-level default source is provided', () => {
    const r = validateRow({ Name: 'X', Phone: '9876543210', Email: '', Country: '', Consent: 'granted', 'Consent Source': '', Notes: '', Tier: '' }, MAP, { defaultCountry: 'IN', defaultConsentSource: 'Signed trade-show form' });
    expect(r.ok).toBe(true);
  });
  it('rejects unrecognised consent values instead of guessing', () => {
    const r = ok({ Name: 'X', Phone: '9876543210', Email: '', Country: '', Consent: 'maybe', 'Consent Source': 'x', Notes: '', Tier: '' });
    expect(r.ok).toBe(false);
  });
  it('treats a phone without any country context as invalid', () => {
    const r = validateRow({ Name: 'X', Phone: '9876543210', Email: '', Country: '', Consent: '', 'Consent Source': '', Notes: '', Tier: '' }, MAP, {});
    expect(r.ok).toBe(false);
  });
  it('does not mark a number callable just because it was imported (no implied consent)', () => {
    const r = ok({ Name: 'X', Phone: '9876543210', Email: '', Country: '', Consent: '', 'Consent Source': '', Notes: '', Tier: '' });
    expect(r.ok && r.record.consentStatus).toBe('UNKNOWN');
  });
});

describe('parsers', () => {
  it('parseDateLoose handles ISO strings and Excel serial dates, but not bare years', () => {
    expect(parseDateLoose('2026-09-01T10:00:00Z')?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(parseDateLoose('46266.41666666667')?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(parseDateLoose('46266')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(parseDateLoose('2026')?.getUTCFullYear()).toBe(2026); // parsed as a year by Date, not as serial 2026
    expect(parseDateLoose('not a date')).toBeNull();
  });
  it('parseBool', () => {
    expect(parseBool('Yes')).toBe(true);
    expect(parseBool('NDNC')).toBe(true);
    expect(parseBool('no')).toBe(false);
    expect(parseBool('')).toBe(false);
    expect(parseBool('perhaps')).toBeNull();
  });
  it('parseConsent', () => {
    expect(parseConsent('Opted In')).toBe('GRANTED');
    expect(parseConsent('opt-out')).toBe('DENIED');
    expect(parseConsent('revoked')).toBe('WITHDRAWN');
    expect(parseConsent('')).toBe('UNKNOWN');
    expect(parseConsent('???')).toBeNull();
  });
  it('csvSafe neutralises formula injection but keeps phone numbers intact', () => {
    expect(csvSafe('=HYPERLINK("http://evil")')).toBe(`'=HYPERLINK("http://evil")`);
    expect(csvSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvSafe('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvSafe('+91 98765-43210')).toBe('+91 98765-43210');
    expect(csvSafe('Plain text')).toBe('Plain text');
  });
});
