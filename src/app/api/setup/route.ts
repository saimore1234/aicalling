import { count, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { publicRoute } from '@/lib/api';
import { createSession, sessionCookie } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { safeEqual } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { badRequest, forbidden } from '@/lib/errors';
import { hashPassword, validatePasswordStrength } from '@/lib/passwords';
import { emailSchema, passwordSchema } from '@/lib/schemas';

async function userCount() {
  const [r] = await db.select({ n: count() }).from(users);
  return Number(r?.n ?? 0);
}

/** Tells the UI whether first-administrator setup is available. Reveals nothing once an admin exists. */
export const GET = publicRoute({}, async () => {
  const needsSetup = (await userCount()) === 0;
  return { needsSetup, webSetupEnabled: needsSetup && !!getEnv().SETUP_TOKEN };
});

const body = z.object({
  setupToken: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Creates the FIRST administrator only. Requires the operator-supplied SETUP_TOKEN so that nobody who merely
 * finds a fresh deployment can claim it. Disabled permanently once any user exists.
 */
export const POST = publicRoute({ body, rateLimit: { name: 'setup', limit: 10, windowSec: 900 } }, async ({ body, ip, req }) => {
  const expected = getEnv().SETUP_TOKEN;
  if (!expected) throw forbidden('Web setup is disabled. Set SETUP_TOKEN or use `npm run admin:create`.');
  if (!safeEqual(body.setupToken, expected)) throw forbidden('Invalid setup token');
  const problem = validatePasswordStrength(body.password);
  if (problem) throw badRequest(problem);

  const passwordHash = await hashPassword(body.password);
  const created = await db.transaction(async (tx) => {
    // Serialise concurrent setup attempts; only one can ever win.
    await tx.execute(sql`select pg_advisory_xact_lock(727001)`);
    const [r] = await tx.select({ n: count() }).from(users);
    if (Number(r?.n ?? 0) > 0) return null;
    const [u] = await tx.insert(users).values({ email: body.email, name: body.name, role: 'ADMIN', passwordHash }).returning();
    return u!;
  });
  if (!created) throw forbidden('Setup has already been completed');

  await audit({ userId: created.id, userEmail: created.email, action: 'setup.first_admin_created', entityType: 'user', entityId: created.id, ip });
  const { token, expiresAt } = await createSession(created.id, { ip, userAgent: req.headers.get('user-agent') });
  return Response.json(
    { user: { id: created.id, email: created.email, name: created.name, role: created.role } },
    { status: 201, headers: { 'Set-Cookie': sessionCookie(token, expiresAt) } },
  );
});
