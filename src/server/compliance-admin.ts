import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const policyPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  requireConsentVoice: z.boolean().optional(),
  requireConsentSms: z.boolean().optional(),
  requireConsentWhatsapp: z.boolean().optional(),
  requireConsentEmail: z.boolean().optional(),
  requireDndScrub: z.boolean().optional(),
  requireDltTemplate: z.boolean().optional(),
  callWindowStart: hhmm.optional(),
  callWindowEnd: hhmm.optional(),
  allowedWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  defaultTimezone: z.string().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  /** Admin attests that they reviewed this policy against current local law. Required for live contact. */
  reviewed: z.boolean().optional(),
}).refine((p) => !p.callWindowStart || !p.callWindowEnd || p.callWindowStart < p.callWindowEnd, { message: 'Window end must be after start', path: ['callWindowEnd'] });
export const policyCreate = z.object({ countryCode: z.string().length(2).toUpperCase(), name: z.string().trim().min(1).max(100) }).and(policyPatch.innerType().omit({ reviewed: true }).partial());

export const suppressionCreate = z.object({
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  channel: z.enum(['VOICE', 'SMS', 'EMAIL', 'WHATSAPP']).nullable().optional(),
  reason: z.enum(['CUSTOMER_OPT_OUT', 'DNC_REGISTRY', 'WRONG_NUMBER', 'ADMIN']).default('ADMIN'),
  note: z.string().max(500).optional(),
}).refine((s) => s.phone || s.email, { message: 'Provide a phone number or an email address' });
