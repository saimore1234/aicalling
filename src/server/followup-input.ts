import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { messageTemplates } from '@/db/schema';
import { badRequest } from '@/lib/errors';
import { outcomeSchema } from '@/lib/schemas';

export const ruleBody = z.object({
  name: z.string().trim().min(1).max(160),
  campaignId: z.string().uuid().nullable().optional(),
  outcome: outcomeSchema,
  action: z.enum(['SEND_EMAIL', 'SEND_SMS', 'SEND_WHATSAPP', 'CREATE_APPOINTMENT', 'SCHEDULE_CALLBACK', 'ASSIGN_HUMAN', 'TASK']),
  templateId: z.string().uuid().nullable().optional(),
  delayMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).default(0),
  active: z.boolean().default(true),
});

export async function validateRule(b: z.infer<typeof ruleBody>) {
  const channelFor = { SEND_EMAIL: 'EMAIL', SEND_SMS: 'SMS', SEND_WHATSAPP: 'WHATSAPP' } as const;
  const ch = channelFor[b.action as keyof typeof channelFor];
  if (ch) {
    if (!b.templateId) throw badRequest('Choose a template for this message action.');
    const [t] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, b.templateId)).limit(1);
    if (!t || t.deletedAt) throw badRequest('Template not found.');
    if (t.channel !== ch) throw badRequest(`The selected template is a ${t.channel} template, but the action sends ${ch}.`);
  }
}


export const ruleDraftPatch = ruleBody.partial();
export const taskCreateBody = z.object({
  customerId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  scheduledFor: z.coerce.date().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});
export const taskPatchBody = z.object({
  status: z.enum(['COMPLETED', 'CANCELED', 'PENDING']).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).optional(),
});
