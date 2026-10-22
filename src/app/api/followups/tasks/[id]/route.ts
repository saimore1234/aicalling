import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, followUpTasks } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { scopeCondition } from '@/server/customers';
import { taskPatchBody } from '@/server/followup-input';

/** Humans complete or cancel their to-dos here. Automated tasks (messages, callbacks) are managed by the worker. */
export const PATCH = route<{ id: string }, typeof taskPatchBody>({ body: taskPatchBody }, async ({ user, params, body, audit }) => {
  const [row] = await db.select({ t: followUpTasks }).from(followUpTasks).innerJoin(customers, eq(customers.id, followUpTasks.customerId))
    .where(and(eq(followUpTasks.id, params.id), scopeCondition(user))).limit(1);
  if (!row) throw notFound('Task not found');
  const patch: Partial<typeof followUpTasks.$inferInsert> = {};
  if (body.status) {
    patch.status = body.status;
    patch.completedAt = body.status === 'COMPLETED' ? new Date() : null;
  }
  if (body.assignedToId !== undefined && user.role === 'ADMIN') patch.assignedToId = body.assignedToId;
  if (body.note) patch.payload = { ...row.t.payload, notes: [...(((row.t.payload as { notes?: string[] }).notes) ?? []), `${user.name}: ${body.note}`] };
  const [updated] = await db.update(followUpTasks).set(patch).where(eq(followUpTasks.id, row.t.id)).returning();
  await audit('followup_task.updated', 'followup_task', row.t.id, { status: body.status });
  return { task: updated };
});
