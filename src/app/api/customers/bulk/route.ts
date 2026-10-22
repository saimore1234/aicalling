import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers, pipelineStages, users } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { requireAdmin, scopeCondition } from '@/server/customers';

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), ids: z.array(z.string().uuid()).min(1).max(1000), ownerId: z.string().uuid().nullable() }),
  z.object({ action: z.literal('archive'), ids: z.array(z.string().uuid()).min(1).max(1000) }),
  z.object({ action: z.literal('unarchive'), ids: z.array(z.string().uuid()).min(1).max(1000) }),
  z.object({ action: z.literal('stage'), ids: z.array(z.string().uuid()).min(1).max(1000), stageId: z.string().uuid() }),
]);

export const POST = route({ body, rateLimit: { name: 'customers-bulk', limit: 60, windowSec: 3600, by: 'user' } }, async ({ user, body, audit }) => {
  const scoped = and(inArray(customers.id, body.ids), isNull(customers.deletedAt), scopeCondition(user));
  let affected = 0;
  if (body.action === 'assign') {
    requireAdmin(user);
    if (body.ownerId) {
      const [o] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, body.ownerId), eq(users.active, true), isNull(users.deletedAt))).limit(1);
      if (!o) throw badRequest('Owner must be an active user');
    }
    affected = (await db.update(customers).set({ ownerId: body.ownerId }).where(scoped).returning({ id: customers.id })).length;
  } else if (body.action === 'archive' || body.action === 'unarchive') {
    requireAdmin(user);
    affected = (await db.update(customers).set({ archivedAt: body.action === 'archive' ? new Date() : null }).where(scoped).returning({ id: customers.id })).length;
  } else {
    const [s] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.id, body.stageId), eq(pipelineStages.active, true))).limit(1);
    if (!s) throw badRequest('Unknown or inactive pipeline stage');
    affected = (await db.update(customers).set({ stageId: s.id }).where(scoped).returning({ id: customers.id })).length;
  }
  await audit(`customer.bulk_${body.action}`, 'customer', null, { requested: body.ids.length, affected });
  return { affected };
});
