export const TARGET_FIELDS = [
  { key: 'name', label: 'Customer name', required: true, synonyms: ['name', 'customer name', 'full name', 'contact', 'contact name', 'customer'] },
  { key: 'company', label: 'Company name', synonyms: ['company', 'company name', 'organisation', 'organization', 'business', 'firm'] },
  { key: 'phone', label: 'Phone number', synonyms: ['phone', 'phone number', 'mobile', 'mobile number', 'contact number', 'tel', 'telephone', 'whatsapp'] },
  { key: 'email', label: 'Email address', synonyms: ['email', 'e-mail', 'email address', 'mail'] },
  { key: 'country', label: 'Country (ISO code)', synonyms: ['country', 'country code', 'nation'] },
  { key: 'timezone', label: 'Timezone (IANA)', synonyms: ['timezone', 'time zone', 'tz'] },
  { key: 'language', label: 'Preferred language', synonyms: ['language', 'preferred language', 'lang'] },
  { key: 'product_interest', label: 'Product / service of interest', synonyms: ['product', 'product interest', 'service', 'interest', 'product of interest'] },
  { key: 'category', label: 'Customer category', synonyms: ['category', 'segment', 'type', 'customer type', 'industry'] },
  { key: 'lead_source', label: 'Lead source', synonyms: ['source', 'lead source', 'channel', 'origin'] },
  { key: 'sales_owner', label: 'Sales owner (user email)', synonyms: ['owner', 'sales owner', 'assigned to', 'sales executive', 'account manager'] },
  { key: 'consent_status', label: 'Consent status', synonyms: ['consent', 'consent status', 'opt in', 'opt-in', 'permission'] },
  { key: 'consent_source', label: 'Consent source', synonyms: ['consent source', 'consent via', 'opt in source'] },
  { key: 'consent_timestamp', label: 'Consent date/time', synonyms: ['consent date', 'consent timestamp', 'consent time', 'consented at', 'opt in date'] },
  { key: 'do_not_call', label: 'Do-not-call status', synonyms: ['dnc', 'do not call', 'do-not-call', 'dnd', 'ndnc'] },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'comments', 'remarks'] },
] as const;

export type TargetKey = (typeof TARGET_FIELDS)[number]['key'];
export const TARGET_KEYS: string[] = TARGET_FIELDS.map((f) => f.key);

/** Mapping is { [file header]: targetKey | "custom:<field name>" | "" (ignore) } */
export type ColumnMapping = Record<string, string>;

export function isValidMappingValue(v: string): boolean {
  return v === '' || TARGET_KEYS.includes(v) || /^custom:[\w .-]{1,60}$/.test(v);
}

/** Suggest a mapping from header names so most files need no manual work. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const used = new Set<string>();
  const out: ColumnMapping = {};
  for (const h of headers) {
    const norm = h.toLowerCase().replace(/[_]+/g, ' ').trim();
    const field = TARGET_FIELDS.find((f) => !used.has(f.key) && (f.key.replace(/_/g, ' ') === norm || (f.synonyms as readonly string[]).includes(norm)));
    if (field) {
      out[h] = field.key;
      used.add(field.key);
    } else {
      out[h] = '';
    }
  }
  return out;
}
