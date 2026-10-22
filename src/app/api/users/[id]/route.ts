import { and, count, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { route } from '@/lib/api';
import { destroyUserSessions } from '@/lib/auth';
import { badRequest, notFound } from '@/lib/errors';

async function otherActiveAdmins(excludeId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.active, true), isNull(users.deletedAt), ne(users.id, excludeId)));
  return Number(r?.n ?? 0);
}

const patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['ADMIN', 'SALES_EXECUTIVE']).optional(),
  active: z.boolean().optional(),
});

export const PATCH = route<{ id: string }, typeof patch>({ roles: ['ADMIN'], body: patch }, async ({ params, body, user, audit }) => {
  const [target] = await db.select().from(users).where(and(eq(users.id, params.id), isNull(users.deletedAt))).limit(1);
  if (!target) throw notFound('User not found');
  const losingAdmin = target.role === 'ADMIN' && target.active && (body.role === 'SALES_EXECUTIVE' || body.active === false);
  if (losingAdmin && (await otherActiveAdmins(target.id)) === 0) throw badRequest('At least one active administrator is required.');
  if (target.id === user.id && body.active === false) throw badRequest('You cannot deactivate your own account.');

  await db.update(users).set(body).where(eq(users.id, target.id));
  if (body.active === false || (body.role && body.role !== target.role)) await destroyUserSessions(target.id);
  await audit('user.updated', 'user', target.id, body);
  return { ok: true };
});

export const DELETE = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, user, audit }) => {
  const [target] = await db.select().from(users).where(and(eq(users.id, params.id), isNull(users.deletedAt))).limit(1);
  if (!target) throw notFound('User not found');
  if (target.id === user.id) throw badRequest('You cannot delete your own account.');
  if (target.role === 'ADMIN' && target.active && (await otherActiveAdmins(target.id)) === 0) throw badRequest('At least one active administrator is required.');
  // Soft delete keeps audit trails and customer ownership history intact; the email is freed for reuse.
  await db.update(users).set({ deletedAt: new Date(), active: false, email: `deleted+${target.id}@invalid.local` }).where(eq(users.id, target.id));
  await destroyUserSessions(target.id);
  await audit('user.deleted', 'user', target.id);
  return { ok: true };
});
