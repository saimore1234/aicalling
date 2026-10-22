import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { passwordResetTokens, users } from '@/db/schema';
import { route } from '@/lib/api';
import { randomToken, sha256 } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { notFound } from '@/lib/errors';

/** Admin-generated, single-use reset link (valid 30 min), shown once. Works without any email provider. */
export const POST = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, req, audit }) => {
  const [target] = await db.select().from(users).where(and(eq(users.id, params.id), isNull(users.deletedAt))).limit(1);
  if (!target) throw notFound('User not found');
  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({ userId: target.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
  await audit('user.reset_link_generated', 'user', target.id);
  const base = getEnv().APP_URL ?? new URL(req.url).origin;
  return { link: `${base.replace(/\/$/, '')}/reset-password?token=${token}`, expiresInMinutes: 30 };
});
