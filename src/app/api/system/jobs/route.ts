import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { backgroundJobs } from '@/db/schema';
import { route } from '@/lib/api';
import { emptyToUndefined, paginationQuery } from '@/lib/schemas';

const query = paginationQuery.extend({
  status: emptyToUndefined(z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED']).optional()),
  queue: emptyToUndefined(z.string().max(40).optional()),
});
export const GET = route({ roles: ['ADMIN'], query }, async ({ query }) => {
  const conds: (SQL | undefined)[] = [];
  if (query.status) conds.push(eq(backgroundJobs.status, query.status));
  if (query.queue) conds.push(eq(backgroundJobs.queue, query.queue));
  const where = and(...conds.filter((c): c is SQL => !!c));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(backgroundJobs).where(where);
  const rows = await db.select().from(backgroundJobs).where(where).orderBy(desc(backgroundJobs.updatedAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return { jobs: rows, total: n, page: query.page, pageSize: query.pageSize };
});
