import { asc } from 'drizzle-orm';
import { db } from '@/db/client';
import { followUpRules } from '@/db/schema';
import { route } from '@/lib/api';
import { ruleBody, validateRule } from '@/server/followup-input';

export const GET = route({ roles: ['ADMIN'] }, async () => ({ rules: await db.select().from(followUpRules).orderBy(asc(followUpRules.outcome), asc(followUpRules.delayMinutes)) }));

export const POST = route({ roles: ['ADMIN'], body: ruleBody }, async ({ body, audit }) => {
  await validateRule(body);
  const [row] = await db.insert(followUpRules).values({ ...body, campaignId: body.campaignId ?? null, templateId: body.templateId ?? null }).returning();
  await audit('followup_rule.created', 'followup_rule', row!.id, { name: row!.name });
  return Response.json({ rule: row }, { status: 201 });
});
