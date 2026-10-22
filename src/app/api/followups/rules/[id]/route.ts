import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { followUpRules } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { ruleBody, ruleDraftPatch, validateRule } from '@/server/followup-input';

export const PATCH = route<{ id: string }, typeof ruleDraftPatch>({ roles: ['ADMIN'], body: ruleDraftPatch }, async ({ params, body, audit }) => {
  const [r] = await db.select().from(followUpRules).where(eq(followUpRules.id, params.id)).limit(1);
  if (!r) throw notFound('Rule not found');
  await validateRule(ruleBody.parse({ ...r, ...body }));
  const [row] = await db.update(followUpRules).set(body).where(eq(followUpRules.id, r.id)).returning();
  await audit('followup_rule.updated', 'followup_rule', r.id, { fields: Object.keys(body) });
  return { rule: row };
});

export const DELETE = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const [r] = await db.delete(followUpRules).where(eq(followUpRules.id, params.id)).returning();
  if (!r) throw notFound('Rule not found');
  await audit('followup_rule.deleted', 'followup_rule', r.id);
  return { ok: true };
});
