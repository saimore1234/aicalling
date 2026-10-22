import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers } from '@/db/schema';
import { route } from '@/lib/api';
import { getScopedCustomer, requireAdmin } from '@/server/customers';

const body = z.object({ archived: z.boolean() });

export const POST = route<{ id: string }, typeof body>({ body }, async ({ user, params, body, audit }) => {
  requireAdmin(user);
  const c = await getScopedCustomer(user, params.id);
  await db.update(customers).set({ archivedAt: body.archived ? new Date() : null }).where(eq(customers.id, c.id));
  await audit(body.archived ? 'customer.archived' : 'customer.unarchived', 'customer', c.id);
  return { ok: true };
});
