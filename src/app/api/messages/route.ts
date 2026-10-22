import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers, messages } from '@/db/schema';
import { route } from '@/lib/api';
import { emptyToUndefined, paginationQuery } from '@/lib/schemas';
import { scopeCondition } from '@/server/customers';

const query = paginationQuery.extend({
  channel: emptyToUndefined(z.enum(['SMS', 'EMAIL', 'WHATSAPP']).optional()),
  status: emptyToUndefined(z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED']).optional()),
  customerId: emptyToUndefined(z.string().uuid().optional()),
});
export const GET = route({ query }, async ({ user, query }) => {
  const conds: (SQL | undefined)[] = [scopeCondition(user)];
  if (query.channel) conds.push(eq(messages.channel, query.channel));
  if (query.status) conds.push(eq(messages.status, query.status));
  if (query.customerId) conds.push(eq(messages.customerId, query.customerId));
  const where = and(...conds.filter((c): c is SQL => !!c));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).innerJoin(customers, eq(customers.id, messages.customerId)).where(where);
  const rows = await db.select({ m: messages, customerName: customers.name }).from(messages).innerJoin(customers, eq(customers.id, messages.customerId)).where(where)
    .orderBy(desc(messages.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return { messages: rows.map((r) => ({ ...r.m, customerName: r.customerName })), total: n, page: query.page, pageSize: query.pageSize };
});
