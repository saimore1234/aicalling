import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers, pipelineStages, users } from '@/db/schema';
import { route } from '@/lib/api';
import { emptyToUndefined } from '@/lib/schemas';
import { customerWhere } from '@/server/customers';

const query = z.object({
  q: emptyToUndefined(z.string().trim().max(100).optional()),
  ownerId: emptyToUndefined(z.string().uuid().or(z.literal('none')).optional()),
  country: emptyToUndefined(z.string().trim().length(2).toUpperCase().optional()),
  perStage: z.coerce.number().int().min(1).max(100).default(30),
});

/** Kanban data: active stages in order, each with its total count and the top cards (highest score first). */
export const GET = route({ query }, async ({ user, query }) => {
  const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.active, true)).orderBy(asc(pipelineStages.position));
  const where = customerWhere(user, { q: query.q, ownerId: query.ownerId, country: query.country });
  const counts = await db
    .select({ stageId: customers.stageId, n: sql<number>`count(*)::int` })
    .from(customers)
    .where(where)
    .groupBy(customers.stageId);
  const countMap = new Map(counts.map((c) => [c.stageId, c.n]));

  const out = [];
  for (const s of stages) {
    const cards = await db
      .select({
        id: customers.id,
        name: customers.name,
        company: customers.company,
        leadScore: customers.leadScore,
        lastOutcome: customers.lastOutcome,
        productInterest: customers.productInterest,
        ownerName: users.name,
        isDemo: customers.isDemo,
        doNotCall: customers.doNotCall,
      })
      .from(customers)
      .leftJoin(users, eq(users.id, customers.ownerId))
      .where(and(where, eq(customers.stageId, s.id)))
      .orderBy(sql`${customers.leadScore} desc nulls last`, desc(customers.updatedAt))
      .limit(query.perStage);
    out.push({ stage: s, total: countMap.get(s.id) ?? 0, cards });
  }
  return { columns: out };
});
