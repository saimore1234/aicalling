import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { getEnv } from './env';
import { randomToken, sha256 } from './crypto';

export const SESSION_COOKIE = 'vsc_session';
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000; // 8h idle timeout
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // 7d hard cap
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type Role = 'ADMIN' | 'SALES_EXECUTIVE';
export type AuthUser = { id: string; email: string; name: string; role: Role; mustChangePassword: boolean };
export type AuthSession = { id: string; expiresAt: Date };

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_IDLE_MS);
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt,
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined | null): Promise<{ user: AuthUser; session: AuthSession } | null> {
  if (!token) return null;
  const now = new Date();
  const rows = await db
    .select({
      sid: sessions.id,
      expiresAt: sessions.expiresAt,
      lastUsedAt: sessions.lastUsedAt,
      createdAt: sessions.createdAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now), isNull(users.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;
  if (now.getTime() - row.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    await db.delete(sessions).where(eq(sessions.id, row.sid));
    return null;
  }
  let expiresAt = row.expiresAt;
  if (now.getTime() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    expiresAt = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, row.createdAt.getTime() + SESSION_ABSOLUTE_MS));
    await db.update(sessions).set({ lastUsedAt: now, expiresAt }).where(eq(sessions.id, row.sid));
  }
  return {
    user: { id: row.id, email: row.email, name: row.name, role: row.role, mustChangePassword: row.mustChangePassword },
    session: { id: row.sid, expiresAt },
  };
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function destroyUserSessions(userId: string, exceptSessionId?: string) {
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  for (const r of rows) if (r.id !== exceptSessionId) await db.delete(sessions).where(eq(sessions.id, r.id));
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function secureFlag(): boolean {
  const env = getEnv();
  return env.NODE_ENV === 'production' || env.COOKIE_SECURE;
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secureFlag()) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0'];
  if (secureFlag()) parts.push('Secure');
  return parts.join('; ');
}

/** Server-component helper: resolve the user from a raw Cookie header. */
export async function userFromCookieHeader(cookieHeader: string | null | undefined) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  return getSessionUser(token);
}
