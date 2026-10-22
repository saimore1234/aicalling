import { z } from 'zod';

export const templateBody = z.object({
  name: z.string().trim().min(1).max(160),
  channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP']),
  subject: z.string().trim().max(300).nullable().optional(),
  bodyText: z.string().trim().min(1).max(4000),
  bodyHtml: z.string().max(100_000).nullable().optional(),
  language: z.string().trim().min(2).max(20).default('en'),
  isMarketing: z.boolean().default(true),
  providerTemplateId: z.string().trim().max(200).nullable().optional(),
  dltTemplateId: z.string().trim().max(100).nullable().optional(),
  dltEntityId: z.string().trim().max(100).nullable().optional(),
  attachmentUrls: z.array(z.object({ name: z.string().max(200), url: z.string().url().max(2000).refine((u) => u.startsWith('https://'), 'Attachments must use https') })).max(5).default([]),
  active: z.boolean().default(true),
}).superRefine((t, ctx) => {
  if (t.channel === 'EMAIL' && !t.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Email templates need a subject' });
  if (t.channel === 'SMS' && t.bodyText.length > 1600) ctx.addIssue({ code: 'custom', path: ['bodyText'], message: 'SMS body is too long' });
});
export const templatePatch = templateBody.innerType().partial().extend({ approved: z.boolean().optional() });
