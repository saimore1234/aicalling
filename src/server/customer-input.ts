import { z } from 'zod';
import { validateRow, type ValidRecord } from './imports/validate';
import { TARGET_KEYS } from './imports/fields';
import { badRequest } from '@/lib/errors';

const opt = (max: number) => z.string().trim().max(max).optional().nullable();

export const customerInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  company: opt(200),
  phone: opt(50),
  email: opt(254),
  country: opt(2),
  timezone: opt(60),
  language: opt(20),
  productInterest: opt(200),
  category: opt(100),
  leadSource: opt(100),
  ownerId: z.string().uuid().optional().nullable(),
  notes: opt(2000),
  customFields: z.record(z.string().max(1000)).optional(),
});
export type CustomerInput = z.infer<typeof customerInput>;

const IDENTITY = Object.fromEntries(TARGET_KEYS.map((k) => [k, k]));

/** Reuses the import validator so single-record entry and bulk import normalise identically. */
export function normalizeCustomerInput(input: Partial<CustomerInput>, defaultCountry?: string | null): ValidRecord {
  const raw: Record<string, string> = {
    name: input.name ?? '',
    company: input.company ?? '',
    phone: input.phone ?? '',
    email: input.email ?? '',
    country: input.country ?? '',
    timezone: input.timezone ?? '',
    language: input.language ?? '',
    product_interest: input.productInterest ?? '',
    category: input.category ?? '',
    lead_source: input.leadSource ?? '',
    notes: input.notes ?? '',
  };
  const res = validateRow(raw, IDENTITY, { defaultCountry: defaultCountry ?? undefined });
  if (!res.ok) throw badRequest(res.errors.join(' '), { errors: res.errors });
  res.record.customFields = input.customFields ?? {};
  return res.record;
}
