import { sql } from 'drizzle-orm';
import { db, closeDb } from '@/db/client';
import { users } from '@/db/schema';
import { hashPassword } from '@/lib/passwords';
import { closeRedis, getRedis } from '@/lib/redis';
import { closeQueues } from '@/server/queues';
import { seedBaseline } from '@/server/seed';
import { setProviderOverrides } from '@/providers';
import { updateAppSettings } from '@/lib/settings';
import { POST as loginRoute } from '@/app/api/auth/login/route';

export const PASSWORD = 'Correct-Horse-9-Battery';
const ORIGIN = 'http://localhost:3000';

/** Wipes every table, flushes the test Redis DB, restores baseline data and demo mode. */
export async function resetDb(opts: { seed?: boolean } = {}) {
  const res = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  const tables = (res.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
  try {
    await getRedis().flushdb();
  } catch {
    /* tests that need Redis will fail loudly on their own */
  }
  setProviderOverrides({});
  if (opts.seed !== false) await seedBaseline();
  await updateAppSettings({ mode: 'demo', killSwitch: false });
}

export async function shutdown() {
  await closeQueues();
  await closeRedis();
  await closeDb();
}

export async function createUser(over: Partial<{ email: string; name: string; role: 'ADMIN' | 'SALES_EXECUTIVE'; password: string; active: boolean; mustChangePassword: boolean }> = {}) {
  const email = over.email ?? `user${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [u] = await db
    .insert(users)
    .values({
      email,
      name: over.name ?? 'Test User',
      role: over.role ?? 'SALES_EXECUTIVE',
      active: over.active ?? true,
      mustChangePassword: over.mustChangePassword ?? false,
      passwordHash: await hashPassword(over.password ?? PASSWORD),
    })
    .returning();
  return u!;
}

export function req(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; origin?: string | null } = {},
) {
  const headers: Record<string, string> = { host: 'localhost:3000', ...(opts.headers ?? {}) };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${ORIGIN}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });

export async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await loginRoute(req('/api/auth/login', { body: { email, password } }));
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie')!;
  return setCookie.split(';')[0]!;
}

export async function adminSession() {
  const user = await createUser({ role: 'ADMIN', name: 'Admin User' });
  return { user, cookie: await login(user.email) };
}

export async function salesSession(name = 'Sales Exec') {
  const user = await createUser({ role: 'SALES_EXECUTIVE', name });
  return { user, cookie: await login(user.email) };
}
