import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { followUpRules, messageTemplates } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest, notFound } from '@/lib/errors';
import { templatePatch } from '@/server/template-input';
import { extractVariables } from '@/server/templates';

async function load(id: string) {
  const [t] = await db.select().from(messageTemplates).where(and(eq(messageTemplates.id, id), isNull(messageTemplates.deletedAt))).limit(1);
  if (!t) throw notFound('Template not found');
  return t;
}
export const GET = route<{ id: string }>({}, async ({ params }) => ({ template: await load(params.id) }));

export const PATCH = route<{ id: string }, typeof templatePatch>({ roles: ['ADMIN'], body: templatePatch }, async ({ user, params, body, audit }) => {
  const t = await load(params.id);
  const content = ['subject', 'bodyText', 'bodyHtml', 'providerTemplateId', 'dltTemplateId', 'dltEntityId', 'isMarketing', 'channel'] as const;
  const contentChanged = content.some((k) => k in body && (body as Record<string, unknown>)[k] !== (t as Record<string, unknown>)[k]);
  const next = { ...t, ...body };
  const patch: Record<string, unknown> = { ...body };
  if (contentChanged) patch.variables = extractVariables(next.subject, next.bodyText, next.bodyHtml);
  // Editing wording invalidates a prior approval attestation; the admin must re-attest explicitly in the same request.
  if (contentChanged && body.approved !== true) patch.approved = false;
  if (body.approved === true) {
    if (next.channel === 'WHATSAPP' && !next.providerTemplateId) throw badRequest('A WhatsApp template can only be marked approved once its Meta-approved template name is set.');
  }
  const [row] = await db.update(messageTemplates).set(patch).where(eq(messageTemplates.id, t.id)).returning();
  await audit('template.updated', 'template', t.id, { fields: Object.keys(body), approvalAttestedBy: body.approved === true ? user.email : undefined });
  return { template: row };
});

export const DELETE = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const t = await load(params.id);
  await db.update(messageTemplates).set({ deletedAt: new Date(), active: false }).where(eq(messageTemplates.id, t.id));
  await db.update(followUpRules).set({ active: false }).where(eq(followUpRules.templateId, t.id));
  await audit('template.deleted', 'template', t.id);
  return { ok: true };
});
