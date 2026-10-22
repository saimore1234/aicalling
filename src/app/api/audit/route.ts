import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { auditLogs } from '@/db/schema';
import { route } from '@/lib/api';
import { emptyToUndefined, paginationQuery } from '@/lib/schemas';

const query = paginationQuery.extend({
  action: emptyToUndefined(z.string().max(100).optional()),
  userId: emptyToUndefined(z.string().uuid().optional()),
  entityType: emptyToUndefined(z.string().max(60).optional()),
  entityId: emptyToUndefined(z.string().max(100).optional()),
  from: emptyToUndefined(z.coerce.date().optional()),
  to: emptyToUndefined(z.coerce.date().optional()),
});
export const GET = route({ roles: ['ADMIN'], query }, async ({ query }) => {
  const conds: (SQL | undefined)[] = [];
  if (query.action) conds.push(ilike(auditLogs.action, `${query.action.replace(/[%_\\]/g, '\\$&')}%`));
  if (query.userId) conds.push(eq(auditLogs.userId, query.userId));
  if (query.entityType) conds.push(eq(auditLogs.entityType, query.entityType));
  if (query.entityId) conds.push(eq(auditLogs.entityId, query.entityId));
  if (query.from) conds.push(gte(auditLogs.createdAt, query.from));
  if (query.to) conds.push(lte(auditLogs.createdAt, query.to));
  const where = and(...conds.filter((c): c is SQL => !!c));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  const rows = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return { logs: rows, total: n, page: query.page, pageSize: query.pageSize };
});
