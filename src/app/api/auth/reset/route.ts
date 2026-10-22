import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { passwordResetTokens, users } from '@/db/schema';
import { publicRoute } from '@/lib/api';
import { destroyUserSessions } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { sha256 } from '@/lib/crypto';
import { badRequest } from '@/lib/errors';
import { hashPassword, validatePasswordStrength } from '@/lib/passwords';
import { passwordSchema } from '@/lib/schemas';

const body = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

export const POST = publicRoute(
  { body, rateLimit: { name: 'reset-ip', limit: 10, windowSec: 900 } },
  async ({ body, ip }) => {
    const problem = validatePasswordStrength(body.password);
    if (problem) throw badRequest(problem);
    const [t] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, sha256(body.token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .limit(1);
    if (!t) throw badRequest('This reset link is invalid or has expired.');
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await hashPassword(body.password), mustChangePassword: false }).where(eq(users.id, t.userId));
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, t.id));
    });
    await destroyUserSessions(t.userId);
    await audit({ userId: t.userId, action: 'auth.password_reset_completed', ip });
    return { ok: true };
  },
);
