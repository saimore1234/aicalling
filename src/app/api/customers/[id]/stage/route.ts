import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers, pipelineStages } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { getScopedCustomer } from '@/server/customers';

const body = z.object({ stageId: z.string().uuid() });

export const PATCH = route<{ id: string }, typeof body>({ body }, async ({ user, params, body, audit }) => {
  const c = await getScopedCustomer(user, params.id);
  const [s] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, body.stageId)).limit(1);
  if (!s || !s.active) throw badRequest('Unknown or inactive pipeline stage');
  await db.update(customers).set({ stageId: s.id }).where(eq(customers.id, c.id));
  await audit('customer.stage_changed', 'customer', c.id, { from: c.stageId, to: s.id, stage: s.key });
  return { ok: true, stage: s };
});
