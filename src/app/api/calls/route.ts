import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { aiAgents, calls, campaigns, customers } from '@/db/schema';
import { route } from '@/lib/api';
import { maskPhone } from '@/lib/logger';
import { emptyToUndefined, paginationQuery } from '@/lib/schemas';
import { scopeCondition } from '@/server/customers';

const query = paginationQuery.extend({
  q: emptyToUndefined(z.string().trim().max(100).optional()),
  status: emptyToUndefined(z.enum(['QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED']).optional()),
  outcome: emptyToUndefined(z.string().max(40).optional()),
  campaignId: emptyToUndefined(z.string().uuid().optional()),
  from: emptyToUndefined(z.coerce.date().optional()),
  to: emptyToUndefined(z.coerce.date().optional()),
  demo: emptyToUndefined(z.enum(['true', 'false']).optional()),
});

export const GET = route({ query }, async ({ user, query }) => {
  const conds: (SQL | undefined)[] = [scopeCondition(user)];
  if (query.q) {
    const like = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(or(ilike(customers.name, like), ilike(customers.company, like), ilike(calls.toNumber, like)));
  }
  if (query.status) conds.push(eq(calls.status, query.status));
  if (query.outcome) conds.push(sql`${calls.outcome}::text = ${query.outcome}`);
  if (query.campaignId) conds.push(eq(calls.campaignId, query.campaignId));
  if (query.from) conds.push(gte(calls.createdAt, query.from));
  if (query.to) conds.push(lte(calls.createdAt, query.to));
  if (query.demo) conds.push(eq(calls.isDemo, query.demo === 'true'));
  const where = and(...conds.filter((c): c is SQL => !!c));
  const offset = (query.page - 1) * query.pageSize;

  const [{ n: total } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).innerJoin(customers, eq(customers.id, calls.customerId)).where(where);
  const rows = await db
    .select({
      id: calls.id, status: calls.status, outcome: calls.outcome, createdAt: calls.createdAt, startedAt: calls.startedAt, durationSeconds: calls.durationSeconds,
      attempt: calls.attemptNumber, isDemo: calls.isDemo, isTest: calls.isTest, summary: calls.summary, toNumber: calls.toNumber, errorCode: calls.errorCode,
      costAmount: calls.costAmount, costCurrency: calls.costCurrency,
      customerId: customers.id, customerName: customers.name, company: customers.company, campaignId: campaigns.id, campaignName: campaigns.name, agentName: aiAgents.name,
    })
    .from(calls)
    .innerJoin(customers, eq(customers.id, calls.customerId))
    .leftJoin(campaigns, eq(campaigns.id, calls.campaignId))
    .leftJoin(aiAgents, eq(aiAgents.id, calls.agentId))
    .where(where)
    .orderBy(desc(calls.createdAt))
    .limit(query.pageSize)
    .offset(offset);
  return { calls: rows.map((r) => ({ ...r, toNumber: user.role === 'ADMIN' ? r.toNumber : maskPhone(r.toNumber) })), total, page: query.page, pageSize: query.pageSize };
});
