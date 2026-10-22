import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers, suppressionRecords } from '@/db/schema';
import { route } from '@/lib/api';
import { normalizePhone } from '@/lib/phone';
import { badRequest } from '@/lib/errors';
import { emptyToUndefined, paginationQuery } from '@/lib/schemas';
import { applyOptOut } from '@/server/compliance';
import { suppressionCreate } from '@/server/compliance-admin';

const query = paginationQuery.extend({ active: emptyToUndefined(z.enum(['true', 'false']).optional()) });
export const GET = route({ roles: ['ADMIN'], query }, async ({ query }) => {
  const conds: (SQL | undefined)[] = [];
  if (query.active === 'true') conds.push(isNull(suppressionRecords.liftedAt));
  if (query.active === 'false') conds.push(sql`${suppressionRecords.liftedAt} is not null`);
  const where = and(...conds.filter((c): c is SQL => !!c));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(suppressionRecords).where(where);
  const rows = await db.select().from(suppressionRecords).where(where).orderBy(desc(suppressionRecords.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return { records: rows, total: n, page: query.page, pageSize: query.pageSize };
});

export const POST = route({ roles: ['ADMIN'], body: suppressionCreate }, async ({ user, body, audit }) => {
  let phone: string | null = null;
  if (body.phone) {
    const p = normalizePhone(body.phone, null);
    if (!p.ok) throw badRequest(p.reason);
    phone = p.e164;
  }
  const [match] = phone ? await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone)).limit(1)
    : await db.select({ id: customers.id }).from(customers).where(eq(customers.email, body.email!)).limit(1);
  if (match && (body.channel === undefined || body.channel === null)) {
    await applyOptOut({ customerId: match.id, channels: 'ALL', reason: body.reason, source: 'admin_suppression', note: body.note, userId: user.id });
  }
  const [row] = await db.insert(suppressionRecords).values({ phone, email: body.email ?? null, channel: body.channel ?? null, customerId: match?.id ?? null, reason: body.reason, source: 'admin', note: body.note ?? null, createdById: user.id }).returning();
  await audit('compliance.suppression_added', 'suppression', row!.id, { channel: body.channel ?? 'ALL', reason: body.reason });
  return Response.json({ record: row }, { status: 201 });
});
