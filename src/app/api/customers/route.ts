import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, pipelineStages } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';
import { listCustomers, customerFilterQuery, requireAdmin } from '@/server/customers';
import { customerInput, normalizeCustomerInput } from '@/server/customer-input';

export const GET = route({ query: customerFilterQuery }, async ({ user, query }) => listCustomers(user, query));

export const POST = route({ body: customerInput }, async ({ user, body, audit }) => {
  requireAdmin(user);
  const r = normalizeCustomerInput(body);
  if (r.phone) {
    const [dupe] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.phone, r.phone), isNull(customers.deletedAt))).limit(1);
    if (dupe) throw conflict('A customer with this phone number already exists', { existingId: dupe.id });
  }
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.key, 'new')).limit(1);
  const [c] = await db
    .insert(customers)
    .values({
      name: r.name,
      company: r.company,
      phone: r.phone,
      phoneRaw: r.phoneRaw,
      email: r.email,
      country: r.country,
      timezone: r.timezone,
      language: r.language,
      productInterest: r.productInterest,
      category: r.category,
      leadSource: r.leadSource,
      ownerId: body.ownerId ?? null,
      stageId: stage?.id ?? null,
      notes: r.notes,
      customFields: r.customFields,
    })
    .returning();
  await audit('customer.created', 'customer', c!.id);
  return Response.json({ customer: c }, { status: 201 });
});
