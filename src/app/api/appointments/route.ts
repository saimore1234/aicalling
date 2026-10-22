import { and, asc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { appointments, customers, users } from '@/db/schema';
import { route } from '@/lib/api';
import { emptyToUndefined } from '@/lib/schemas';
import { getScopedCustomer, scopeCondition } from '@/server/customers';

const query = z.object({
  status: emptyToUndefined(z.enum(['REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELED', 'NO_SHOW']).optional()),
  from: emptyToUndefined(z.coerce.date().optional()),
  to: emptyToUndefined(z.coerce.date().optional()),
});
export const GET = route({ query }, async ({ user, query }) => {
  const conds: (SQL | undefined)[] = [scopeCondition(user)];
  if (query.status) conds.push(eq(appointments.status, query.status));
  if (query.from) conds.push(gte(appointments.startsAt, query.from));
  if (query.to) conds.push(lte(appointments.startsAt, query.to));
  const rows = await db
    .select({ a: appointments, customerName: customers.name, company: customers.company, ownerName: users.name })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .leftJoin(users, eq(users.id, appointments.ownerId))
    .where(and(...conds.filter((c): c is SQL => !!c)))
    .orderBy(asc(appointments.startsAt), asc(appointments.createdAt))
    .limit(500);
  return { appointments: rows.map((r) => ({ ...r.a, customerName: r.customerName, company: r.company, ownerName: r.ownerName })) };
});

const create = z.object({
  customerId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  requestedWindow: z.string().trim().max(300).nullable().optional(),
}).refine((a) => !a.startsAt || !a.endsAt || a.endsAt > a.startsAt, { message: 'End must be after start', path: ['endsAt'] });

export const POST = route({ body: create }, async ({ user, body, audit }) => {
  const c = await getScopedCustomer(user, body.customerId);
  const [row] = await db.insert(appointments).values({
    ...body, customerId: c.id, startsAt: body.startsAt ?? null, endsAt: body.endsAt ?? null,
    ownerId: c.ownerId ?? user.id, status: body.startsAt ? 'SCHEDULED' : 'REQUESTED', isDemo: c.isDemo,
  }).returning();
  await audit('appointment.created', 'appointment', row!.id, { customerId: c.id });
  return Response.json({ appointment: row }, { status: 201 });
});
