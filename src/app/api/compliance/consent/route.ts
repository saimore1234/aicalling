import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { consentRecords, customers } from '@/db/schema';
import { route } from '@/lib/api';
import { channelSchema, emptyToUndefined, paginationQuery } from '@/lib/schemas';

const query = paginationQuery.extend({
  channel: emptyToUndefined(channelSchema.optional()),
  status: emptyToUndefined(z.enum(['GRANTED', 'DENIED', 'WITHDRAWN', 'UNKNOWN']).optional()),
  customerId: emptyToUndefined(z.string().uuid().optional()),
});
/** Consent ledger (append-only). The newest row per customer+channel is the current state. */
export const GET = route({ roles: ['ADMIN'], query }, async ({ query }) => {
  const conds: (SQL | undefined)[] = [];
  if (query.channel) conds.push(eq(consentRecords.channel, query.channel));
  if (query.status) conds.push(eq(consentRecords.status, query.status));
  if (query.customerId) conds.push(eq(consentRecords.customerId, query.customerId));
  const where = and(...conds.filter((c): c is SQL => !!c));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(consentRecords).where(where);
  const rows = await db.select({ r: consentRecords, customerName: customers.name }).from(consentRecords).innerJoin(customers, eq(customers.id, consentRecords.customerId)).where(where)
    .orderBy(desc(consentRecords.capturedAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return { records: rows.map((x) => ({ ...x.r, customerName: x.customerName })), total: n, page: query.page, pageSize: query.pageSize };
});
