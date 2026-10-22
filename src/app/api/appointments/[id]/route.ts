import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { appointments, customers } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { scopeCondition } from '@/server/customers';

const patch = z.object({
  status: z.enum(['REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELED', 'NO_SHOW']).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
});

export const PATCH = route<{ id: string }, typeof patch>({ body: patch }, async ({ user, params, body, audit }) => {
  const [row] = await db.select({ a: appointments }).from(appointments).innerJoin(customers, eq(customers.id, appointments.customerId)).where(and(eq(appointments.id, params.id), scopeCondition(user))).limit(1);
  if (!row) throw notFound('Appointment not found');
  const set: Partial<typeof appointments.$inferInsert> = { ...body };
  if (user.role !== 'ADMIN') delete set.ownerId;
  if (body.startsAt && !body.status && row.a.status === 'REQUESTED') set.status = 'SCHEDULED';
  const [updated] = await db.update(appointments).set(set).where(eq(appointments.id, row.a.id)).returning();
  await audit('appointment.updated', 'appointment', row.a.id, { fields: Object.keys(body) });
  return { appointment: updated };
});
