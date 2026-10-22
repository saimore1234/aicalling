import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents, campaigns } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { getAppSettings } from '@/lib/settings';
import { campaignBody } from '@/server/campaign-input';
import { populateLeads } from '@/server/campaigns';

export const GET = route({ roles: ['ADMIN'] }, async () => {
  const rows = await db
    .select({
      campaign: campaigns,
      agentName: aiAgents.name,
      leads: sql<number>`(select count(*)::int from campaign_leads l where l.campaign_id = ${campaigns.id})`,
      done: sql<number>`(select count(*)::int from campaign_leads l where l.campaign_id = ${campaigns.id} and l.status in ('COMPLETED','FAILED','SKIPPED','CANCELED'))`,
    })
    .from(campaigns)
    .leftJoin(aiAgents, eq(aiAgents.id, campaigns.agentId))
    .where(isNull(campaigns.deletedAt))
    .orderBy(desc(campaigns.createdAt));
  return { campaigns: rows.map((r) => ({ ...r.campaign, agentName: r.agentName, leadCount: r.leads, doneCount: r.done })) };
});

export const POST = route({ roles: ['ADMIN'], body: campaignBody }, async ({ user, body, audit }) => {
  const [agent] = await db.select({ id: aiAgents.id }).from(aiAgents).where(and(eq(aiAgents.id, body.agentId), isNull(aiAgents.deletedAt))).limit(1);
  if (!agent) throw badRequest('Selected AI agent does not exist');
  const mode = (await getAppSettings()).mode;
  const [row] = await db
    .insert(campaigns)
    .values({ ...body, product: body.product ?? null, startAt: body.startAt ?? null, endAt: body.endAt ?? null, fallbackTimezone: body.fallbackTimezone ?? null, testPhone: body.testPhone ?? null, ownerId: user.id, isDemo: mode === 'demo' })
    .returning();
  const { added } = await populateLeads(row!);
  await audit('campaign.created', 'campaign', row!.id, { name: row!.name, demo: row!.isDemo, leads: added });
  return Response.json({ campaign: row, leadsAdded: added }, { status: 201 });
});
