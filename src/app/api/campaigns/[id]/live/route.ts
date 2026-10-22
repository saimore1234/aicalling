import { loadCampaign } from '@/server/campaigns';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { calls, campaignLeads, customers } from '@/db/schema';
import { route } from '@/lib/api';
import { maskPhone } from '@/lib/logger';
import { ACTIVE } from '@/server/calls';

export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => {
  const c = await loadCampaign(params.id);
  const leadCounts = await db.select({ status: campaignLeads.status, n: sql<number>`count(*)::int` }).from(campaignLeads).where(eq(campaignLeads.campaignId, c.id)).groupBy(campaignLeads.status);
  const outcomeCounts = await db.select({ outcome: calls.outcome, n: sql<number>`count(*)::int` }).from(calls).where(eq(calls.campaignId, c.id)).groupBy(calls.outcome);
  const base = { id: calls.id, status: calls.status, outcome: calls.outcome, startedAt: calls.startedAt, answeredAt: calls.answeredAt, durationSeconds: calls.durationSeconds, to: calls.toNumber, name: customers.name, isDemo: calls.isDemo, attempt: calls.attemptNumber };
  const active = await db.select(base).from(calls).innerJoin(customers, eq(customers.id, calls.customerId)).where(inArray(calls.status, ACTIVE)).orderBy(desc(calls.createdAt)).limit(50);
  const recent = await db.select(base).from(calls).innerJoin(customers, eq(customers.id, calls.customerId)).where(eq(calls.campaignId, c.id)).orderBy(desc(calls.createdAt)).limit(25);
  const mask = (r: typeof active[number]) => ({ ...r, to: maskPhone(r.to) });
  return {
    campaign: c,
    leads: Object.fromEntries(leadCounts.map((r) => [r.status, r.n])),
    outcomes: Object.fromEntries(outcomeCounts.map((r) => [r.outcome ?? 'PENDING', r.n])),
    activeCalls: active.map(mask),
    recentCalls: recent.map(mask),
  };
});
