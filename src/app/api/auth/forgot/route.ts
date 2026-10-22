import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { passwordResetTokens, users } from '@/db/schema';
import { publicRoute } from '@/lib/api';
import { audit } from '@/lib/audit';
import { randomToken, sha256 } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { logger, sanitizeError } from '@/lib/logger';
import { emailSchema } from '@/lib/schemas';
import { getAppSettings } from '@/lib/settings';
import { emailConfigured, sendSystemEmail } from '@/server/system-email';

const body = z.object({ email: emailSchema });

// The response is identical whether or not the account exists (no account enumeration).
export const POST = publicRoute(
  { body, rateLimit: { name: 'forgot-ip', limit: 5, windowSec: 900 } },
  async ({ body, req, ip }) => {
    const generic = { ok: true, message: 'If an account exists for that email and email delivery is configured, a reset link has been sent.' };
    const settings = await getAppSettings();
    if (settings.mode === 'demo' || !emailConfigured()) {
      // No real email can be sent: administrators can generate a reset link from User Management.
      return { ...generic, emailConfigured: false, message: 'Email delivery is not configured. Ask an administrator to generate a reset link for you.' };
    }
    const [user] = await db.select().from(users).where(and(eq(users.email, body.email), isNull(users.deletedAt), eq(users.active, true))).limit(1);
    if (user) {
      const token = randomToken(32);
      await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
      const base = getEnv().APP_URL ?? new URL(req.url).origin;
      const link = `${base.replace(/\/$/, '')}/reset-password?token=${token}`;
      try {
        await sendSystemEmail(user.email, 'Reset your password', `Use this link within 30 minutes to reset your password:\n\n${link}\n\nIf you did not request this, ignore this email.`);
      } catch (err) {
        logger.error({ err: sanitizeError(err) }, 'password reset email failed');
      }
      await audit({ userId: user.id, userEmail: user.email, action: 'auth.password_reset_requested', ip });
    }
    return { ...generic, emailConfigured: true };
  },
);
