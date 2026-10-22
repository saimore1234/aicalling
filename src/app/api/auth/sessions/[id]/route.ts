import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { sessions } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';

export const DELETE = route<{ id: string }>({}, async ({ params, user, audit }) => {
  const res = await db.delete(sessions).where(and(eq(sessions.id, params.id), eq(sessions.userId, user.id))).returning({ id: sessions.id });
  if (!res.length) throw notFound('Session not found');
  await audit('auth.session_revoked', 'session', params.id);
  return { ok: true };
});
