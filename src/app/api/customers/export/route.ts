import { eq } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import { db } from '@/db/client';
import { customers, pipelineStages, users } from '@/db/schema';
import { route } from '@/lib/api';
import { customerFilterQuery, customerWhere } from '@/server/customers';
import { csvSafe } from '@/server/imports/run';

const MAX_EXPORT = 50_000;

export const GET = route({ query: customerFilterQuery, rateLimit: { name: 'customers-export', limit: 10, windowSec: 3600, by: 'user' } }, async ({ user, query, audit }) => {
  const rows = await db
    .select({
      name: customers.name,
      company: customers.company,
      phone: customers.phone,
      email: customers.email,
      country: customers.country,
      language: customers.language,
      product: customers.productInterest,
      category: customers.category,
      source: customers.leadSource,
      stage: pipelineStages.name,
      owner: users.name,
      score: customers.leadScore,
      lastOutcome: customers.lastOutcome,
      doNotCall: customers.doNotCall,
      created: customers.createdAt,
    })
    .from(customers)
    .leftJoin(pipelineStages, eq(pipelineStages.id, customers.stageId))
    .leftJoin(users, eq(users.id, customers.ownerId))
    .where(customerWhere(user, query))
    .limit(MAX_EXPORT);
  const header = ['name', 'company', 'phone', 'email', 'country', 'language', 'product', 'category', 'source', 'stage', 'owner', 'score', 'last_outcome', 'do_not_call', 'created'];
  const data = rows.map((r) => [r.name, r.company, r.phone, r.email, r.country, r.language, r.product, r.category, r.source, r.stage, r.owner, r.score, r.lastOutcome, r.doNotCall ? 'yes' : 'no', r.created.toISOString()].map((v) => csvSafe(String(v ?? ''))));
  await audit('customer.exported', 'customer', null, { rows: rows.length });
  return new Response(stringify([header, ...data]), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' },
  });
});
