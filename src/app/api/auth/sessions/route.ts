import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { sessions } from '@/db/schema';
import { route } from '@/lib/api';

export const GET = route({}, async ({ user, session }) => {
  const rows = await db
    .select({ id: sessions.id, ipAddress: sessions.ipAddress, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.userId, user.id))
    .orderBy(desc(sessions.lastUsedAt));
  return { sessions: rows.map((r) => ({ ...r, current: r.id === session?.id })) };
});
