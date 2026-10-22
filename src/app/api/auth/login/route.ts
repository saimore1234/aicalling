import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { publicRoute } from '@/lib/api';
import { createSession, sessionCookie } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { unauthorized, tooMany } from '@/lib/errors';
import { dummyVerify, verifyPassword } from '@/lib/passwords';
import { rateLimit, resetRateLimit } from '@/lib/ratelimit';
import { emailSchema } from '@/lib/schemas';

const body = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

export const POST = publicRoute(
  { body, rateLimit: { name: 'login-ip', limit: 30, windowSec: 900 } },
  async ({ body, ip, req }) => {
    // Per-account throttle: slows credential stuffing against one mailbox from many IPs.
    const acct = `login-acct:${body.email}`;
    const rl = await rateLimit({ key: acct, limit: 8, windowSec: 900 });
    if (!rl.allowed) throw tooMany('Too many sign-in attempts for this account. Try again in a few minutes.', rl.retryAfter);

    const [user] = await db.select().from(users).where(and(eq(users.email, body.email), isNull(users.deletedAt))).limit(1);
    const ok = user && user.active ? await verifyPassword(user.passwordHash, body.password) : (await dummyVerify(body.password), false);
    if (!ok || !user) {
      await audit({ userId: user?.id ?? null, userEmail: body.email, action: 'auth.login_failed', ip, userAgent: req.headers.get('user-agent') });
      throw unauthorized('Invalid email or password');
    }

    await resetRateLimit(acct);
    const { token, expiresAt } = await createSession(user.id, { ip, userAgent: req.headers.get('user-agent') });
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit({ userId: user.id, userEmail: user.email, action: 'auth.login', ip, userAgent: req.headers.get('user-agent') });
    return Response.json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword } },
      { headers: { 'Set-Cookie': sessionCookie(token, expiresAt) } },
    );
  },
);
