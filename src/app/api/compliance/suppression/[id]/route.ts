import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { suppressionRecords } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';

const body = z.object({ reason: z.string().trim().min(10, 'Explain why this suppression is being lifted (at least 10 characters)').max(500) });

/** Lifting a suppression is rare and sensitive: it needs a written reason and is audited. The row is kept, not deleted. */
export const DELETE = route<{ id: string }, typeof body>({ roles: ['ADMIN'], body }, async ({ user, params, body, audit }) => {
  const [row] = await db.update(suppressionRecords).set({ liftedAt: new Date(), liftedById: user.id }).where(and(eq(suppressionRecords.id, params.id), isNull(suppressionRecords.liftedAt))).returning();
  if (!row) throw notFound('Active suppression record not found');
  await audit('compliance.suppression_lifted', 'suppression', row.id, { reason: body.reason });
  return { ok: true };
});
