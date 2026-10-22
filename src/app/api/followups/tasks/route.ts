import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers, followUpTasks, users } from '@/db/schema';
import { route } from '@/lib/api';
import { emptyToUndefined, paginationQuery } from '@/lib/schemas';
import { getScopedCustomer, scopeCondition } from '@/server/customers';
import { taskCreateBody } from '@/server/followup-input';

const query = paginationQuery.extend({
  status: emptyToUndefined(z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED', 'SKIPPED']).optional()),
  type: emptyToUndefined(z.enum(['SEND_EMAIL', 'SEND_SMS', 'SEND_WHATSAPP', 'CREATE_APPOINTMENT', 'SCHEDULE_CALLBACK', 'ASSIGN_HUMAN', 'TASK']).optional()),
  assignedToMe: emptyToUndefined(z.enum(['true']).optional()),
});

export const GET = route({ query }, async ({ user, query }) => {
  const conds: (SQL | undefined)[] = [scopeCondition(user)];
  if (query.status) conds.push(eq(followUpTasks.status, query.status));
  if (query.type) conds.push(eq(followUpTasks.type, query.type));
  if (query.assignedToMe) conds.push(eq(followUpTasks.assignedToId, user.id));
  const where = and(...conds.filter((c): c is SQL => !!c));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(followUpTasks).innerJoin(customers, eq(customers.id, followUpTasks.customerId)).where(where);
  const rows = await db
    .select({ task: followUpTasks, customerName: customers.name, assignee: users.name })
    .from(followUpTasks)
    .innerJoin(customers, eq(customers.id, followUpTasks.customerId))
    .leftJoin(users, eq(users.id, followUpTasks.assignedToId))
    .where(where)
    .orderBy(desc(followUpTasks.scheduledFor))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { tasks: rows.map((r) => ({ ...r.task, customerName: r.customerName, assigneeName: r.assignee })), total: n, page: query.page, pageSize: query.pageSize };
});

export const POST = route({ body: taskCreateBody }, async ({ user, body, audit }) => {
  const c = await getScopedCustomer(user, body.customerId);
  const [row] = await db.insert(followUpTasks).values({
    customerId: c.id, type: 'TASK', title: body.title, scheduledFor: body.scheduledFor ?? new Date(),
    assignedToId: user.role === 'ADMIN' ? body.assignedToId ?? user.id : user.id,
    idempotencyKey: `manual-${crypto.randomUUID()}`, isDemo: c.isDemo,
  }).returning();
  await audit('followup_task.created', 'followup_task', row!.id, { customerId: c.id });
  return Response.json({ task: row }, { status: 201 });
});
