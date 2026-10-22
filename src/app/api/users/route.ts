import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest, conflict } from '@/lib/errors';
import { hashPassword, validatePasswordStrength } from '@/lib/passwords';
import { emailSchema, passwordSchema } from '@/lib/schemas';

const publicCols = { id: users.id, email: users.email, name: users.name, role: users.role, active: users.active, mustChangePassword: users.mustChangePassword, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt };

export const GET = route({}, async ({ user }) => {
  // Sales executives can see names (to assign owners) but nothing sensitive.
  const rows = await db.select(publicCols).from(users).where(isNull(users.deletedAt)).orderBy(asc(users.name));
  return { users: user.role === 'ADMIN' ? rows : rows.filter((r) => r.active).map(({ id, name, role }) => ({ id, name, role })) };
});

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  role: z.enum(['ADMIN', 'SALES_EXECUTIVE']),
  password: passwordSchema,
});

export const POST = route({ roles: ['ADMIN'], body: createBody }, async ({ body, audit }) => {
  const problem = validatePasswordStrength(body.password);
  if (problem) throw badRequest(problem);
  const [dupe] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, body.email), isNull(users.deletedAt))).limit(1);
  if (dupe) throw conflict('A user with that email already exists');
  const [u] = await db
    .insert(users)
    .values({ name: body.name, email: body.email, role: body.role, passwordHash: await hashPassword(body.password), mustChangePassword: true })
    .returning(publicCols);
  await audit('user.created', 'user', u!.id, { role: body.role });
  return Response.json({ user: u }, { status: 201 });
});
