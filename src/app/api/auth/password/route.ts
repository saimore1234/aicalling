import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { route } from '@/lib/api';
import { destroyUserSessions } from '@/lib/auth';
import { badRequest, unauthorized } from '@/lib/errors';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/passwords';
import { passwordSchema } from '@/lib/schemas';

const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

export const POST = route(
  { body, allowPasswordChange: true, rateLimit: { name: 'password-change', limit: 10, windowSec: 900, by: 'user' } },
  async ({ body, user, session, audit }) => {
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row || !(await verifyPassword(row.passwordHash, body.currentPassword))) throw unauthorized('Current password is incorrect');
    const problem = validatePasswordStrength(body.newPassword);
    if (problem) throw badRequest(problem);
    if (body.newPassword === body.currentPassword) throw badRequest('New password must be different from the current one.');
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false }).where(eq(users.id, user.id));
    await destroyUserSessions(user.id, session?.id); // sign out every other device
    await audit('auth.password_changed', 'user', user.id);
    return { ok: true };
  },
);
