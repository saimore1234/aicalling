import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers, pipelineStages, users } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/errors';
import { emptyToUndefined, paginationQuery } from '@/lib/schemas';

export const customerFilterQuery = paginationQuery.extend({
  q: emptyToUndefined(z.string().trim().max(100).optional()),
  country: emptyToUndefined(z.string().trim().length(2).toUpperCase().optional()),
  stageId: emptyToUndefined(z.string().uuid().optional()),
  ownerId: emptyToUndefined(z.string().uuid().or(z.literal('none')).optional()),
  category: emptyToUndefined(z.string().trim().max(100).optional()),
  leadSource: emptyToUndefined(z.string().trim().max(100).optional()),
  product: emptyToUndefined(z.string().trim().max(200).optional()),
  consent: emptyToUndefined(z.enum(['GRANTED', 'DENIED', 'WITHDRAWN', 'UNKNOWN']).optional()),
  doNotCall: emptyToUndefined(z.enum(['true', 'false']).optional()),
  archived: emptyToUndefined(z.enum(['include', 'only']).optional()),
  demo: emptyToUndefined(z.enum(['true', 'false']).optional()),
  sort: z.enum(['createdAt', 'name', 'company', 'leadScore', 'lastContactedAt']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type CustomerFilter = z.infer<typeof customerFilterQuery>;

/** Sales executives only ever see customers assigned to them. Admins see everything. */
export function scopeCondition(user: AuthUser): SQL | undefined {
  return user.role === 'ADMIN' ? undefined : eq(customers.ownerId, user.id);
}

export function customerWhere(user: AuthUser, f: Partial<CustomerFilter>): SQL {
  const conds: (SQL | undefined)[] = [isNull(customers.deletedAt), scopeCondition(user)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(or(ilike(customers.name, like), ilike(customers.company, like), ilike(customers.phone, like), ilike(customers.email, like)));
  }
  if (f.country) conds.push(eq(customers.country, f.country));
  if (f.stageId) conds.push(eq(customers.stageId, f.stageId));
  if (f.ownerId && user.role === 'ADMIN') conds.push(f.ownerId === 'none' ? isNull(customers.ownerId) : eq(customers.ownerId, f.ownerId));
  if (f.category) conds.push(eq(customers.category, f.category));
  if (f.leadSource) conds.push(eq(customers.leadSource, f.leadSource));
  if (f.product) conds.push(ilike(customers.productInterest, `%${f.product.replace(/[%_\\]/g, '\\$&')}%`));
  if (f.doNotCall) conds.push(eq(customers.doNotCall, f.doNotCall === 'true'));
  if (f.demo) conds.push(eq(customers.isDemo, f.demo === 'true'));
  if (f.archived === 'only') conds.push(isNotNull(customers.archivedAt));
  else if (f.archived !== 'include') conds.push(isNull(customers.archivedAt));
  if (f.consent) {
    const latest = sql`coalesce((select cr.status::text from consent_records cr where cr.customer_id = ${customers.id} and cr.channel = 'VOICE' order by cr.captured_at desc, cr.created_at desc limit 1), 'UNKNOWN')`;
    conds.push(sql`${latest} = ${f.consent}`);
  }
  return and(...conds.filter((c): c is SQL => !!c))!;
}

const SORTS = {
  createdAt: customers.createdAt,
  name: customers.name,
  company: customers.company,
  leadScore: customers.leadScore,
  lastContactedAt: customers.lastContactedAt,
} as const;

export async function listCustomers(user: AuthUser, f: CustomerFilter) {
  const where = customerWhere(user, f);
  const sortCol = SORTS[f.sort];
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where);
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      company: customers.company,
      phone: customers.phone,
      email: customers.email,
      country: customers.country,
      productInterest: customers.productInterest,
      category: customers.category,
      leadSource: customers.leadSource,
      leadScore: customers.leadScore,
      lastOutcome: customers.lastOutcome,
      lastContactedAt: customers.lastContactedAt,
      doNotCall: customers.doNotCall,
      isDemo: customers.isDemo,
      archivedAt: customers.archivedAt,
      createdAt: customers.createdAt,
      stageId: customers.stageId,
      stageName: pipelineStages.name,
      ownerId: customers.ownerId,
      ownerName: users.name,
    })
    .from(customers)
    .leftJoin(pipelineStages, eq(pipelineStages.id, customers.stageId))
    .leftJoin(users, eq(users.id, customers.ownerId))
    .where(where)
    .orderBy(f.dir === 'asc' ? asc(sortCol) : desc(sortCol), asc(customers.id))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);

  // Latest voice-consent status for the visible page (one query, not N).
  const ids = rows.map((r) => r.id);
  const consentMap = new Map<string, string>();
  if (ids.length) {
    const res = await db.execute(sql`
      select distinct on (customer_id) customer_id, status::text as status
      from consent_records
      where channel = 'VOICE' and customer_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
      order by customer_id, captured_at desc, created_at desc`);
    for (const r of res.rows as { customer_id: string; status: string }[]) consentMap.set(r.customer_id, r.status);
  }
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    customers: rows.map((r) => ({ ...r, voiceConsent: consentMap.get(r.id) ?? 'UNKNOWN' })),
  };
}

/** Loads a customer the user is allowed to see, or throws 404 (never reveals existence of out-of-scope rows). */
export async function getScopedCustomer(user: AuthUser, id: string) {
  const [c] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt), scopeCondition(user)))
    .limit(1);
  if (!c) throw notFound('Customer not found');
  return c;
}

export function requireAdmin(user: AuthUser) {
  if (user.role !== 'ADMIN') throw forbidden('Only administrators can do this');
}

export async function latestConsentByChannel(customerId: string) {
  const res = await db.execute(sql`
    select distinct on (channel) channel::text as channel, status::text as status, source, captured_at
    from consent_records where customer_id = ${customerId}::uuid
    order by channel, captured_at desc, created_at desc`);
  return res.rows as { channel: string; status: string; source: string | null; captured_at: Date }[];
}

