import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { auditLogs, sessions, users } from '@/db/schema';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as changePassword } from '@/app/api/auth/password/route';
import { GET as setupStatus, POST as setup } from '@/app/api/setup/route';
import { GET as listUsers, POST as createUserRoute } from '@/app/api/users/route';
import { PATCH as patchUser } from '@/app/api/users/[id]/route';
import { POST as resetLink } from '@/app/api/users/[id]/reset-link/route';
import { POST as resetPassword } from '@/app/api/auth/reset/route';
import { adminSession, createUser, login as doLogin, params, PASSWORD, req, resetDb, salesSession, shutdown } from '../helpers';

beforeEach(async () => {
  await resetDb();
});
afterAll(shutdown);

describe('first administrator setup', () => {
  it('reports setup is needed on an empty database and requires the setup token', async () => {
    const status = await (await setupStatus(req('/api/setup'))).json();
    expect(status).toEqual({ needsSetup: true, webSetupEnabled: true });

    const bad = await setup(req('/api/setup', { body: { setupToken: 'wrong', name: 'A', email: 'a@example.com', password: PASSWORD } }));
    expect(bad.status).toBe(403);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('creates exactly one admin, then permanently disables setup', async () => {
    const ok = await setup(req('/api/setup', { body: { setupToken: 'test-setup-token', name: 'Root', email: 'Root@Example.com', password: PASSWORD } }));
    expect(ok.status).toBe(201);
    const [u] = await db.select().from(users);
    expect(u!.role).toBe('ADMIN');
    expect(u!.email).toBe('root@example.com'); // normalised
    expect(u!.passwordHash).toMatch(/^\$argon2id\$/); // modern hash, not plaintext

    const again = await setup(req('/api/setup', { body: { setupToken: 'test-setup-token', name: 'X', email: 'x@example.com', password: PASSWORD } }));
    expect(again.status).toBe(403);
    expect((await (await setupStatus(req('/api/setup'))).json()).needsSetup).toBe(false);
  });

  it('rejects weak passwords', async () => {
    const res = await setup(req('/api/setup', { body: { setupToken: 'test-setup-token', name: 'Root', email: 'r@example.com', password: 'shortpass' } }));
    expect(res.status).toBe(400);
  });
});

describe('login / logout / sessions', () => {
  it('signs in with correct credentials and sets a hardened session cookie', async () => {
    const u = await createUser();
    const res = await login(req('/api/auth/login', { body: { email: u.email, password: PASSWORD } }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(await db.select().from(sessions)).toHaveLength(1);
    const body = await res.json();
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('stores only a hash of the session token', async () => {
    const u = await createUser();
    const cookie = await doLogin(u.email);
    const token = decodeURIComponent(cookie.split('=')[1]!);
    const [s] = await db.select().from(sessions);
    expect(s!.tokenHash).not.toBe(token);
    expect(s!.tokenHash).toHaveLength(64);
  });

  it('rejects wrong password and unknown email with the same message', async () => {
    const u = await createUser();
    const a = await login(req('/api/auth/login', { body: { email: u.email, password: 'Wrong-Password-1' } }));
    const b = await login(req('/api/auth/login', { body: { email: 'nobody@example.com', password: 'Wrong-Password-1' } }));
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect((await a.json()).error).toBe((await b.json()).error);
    const failures = await db.select().from(auditLogs).where(eq(auditLogs.action, 'auth.login_failed'));
    expect(failures).toHaveLength(2);
  });

  it('rejects deactivated users', async () => {
    const u = await createUser({ active: false });
    const res = await login(req('/api/auth/login', { body: { email: u.email, password: PASSWORD } }));
    expect(res.status).toBe(401);
  });

  it('rate-limits repeated failed attempts against one account', async () => {
    const u = await createUser();
    let last = 0;
    for (let i = 0; i < 10; i++) {
      last = (await login(req('/api/auth/login', { body: { email: u.email, password: 'Wrong-Password-1' } }))).status;
    }
    expect(last).toBe(429);
    // even the right password is refused while throttled
    const right = await login(req('/api/auth/login', { body: { email: u.email, password: PASSWORD } }));
    expect(right.status).toBe(429);
    expect(right.headers.get('retry-after')).toBeTruthy();
  });

  it('logout destroys the session server-side', async () => {
    const u = await createUser();
    const cookie = await doLogin(u.email);
    expect((await me(req('/api/auth/me', { cookie }))).status).toBe(200);
    expect((await logout(req('/api/auth/logout', { method: 'POST', cookie }))).status).toBe(200);
    expect((await me(req('/api/auth/me', { cookie }))).status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('expires sessions', async () => {
    const u = await createUser();
    const cookie = await doLogin(u.email);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await me(req('/api/auth/me', { cookie }))).status).toBe(401);
  });

  it('requires authentication for protected endpoints', async () => {
    expect((await me(req('/api/auth/me'))).status).toBe(401);
    expect((await listUsers(req('/api/users'))).status).toBe(401);
  });
});

describe('CSRF origin protection', () => {
  it('blocks cross-origin state-changing requests even with a valid cookie', async () => {
    const { cookie } = await adminSession();
    const res = await createUserRoute(
      req('/api/users', { cookie, origin: 'https://evil.example', body: { name: 'X', email: 'x@example.com', role: 'ADMIN', password: PASSWORD } }),
    );
    expect(res.status).toBe(403);
  });
  it('blocks requests with no Origin and no Sec-Fetch-Site', async () => {
    const { cookie } = await adminSession();
    const res = await createUserRoute(req('/api/users', { cookie, origin: null, body: { name: 'X', email: 'x@example.com', role: 'ADMIN', password: PASSWORD } }));
    expect(res.status).toBe(403);
  });
});

describe('role-based access control', () => {
  it('lets admins list and create users', async () => {
    const { cookie } = await adminSession();
    const created = await createUserRoute(req('/api/users', { cookie, body: { name: 'New Rep', email: 'rep@example.com', role: 'SALES_EXECUTIVE', password: PASSWORD } }));
    expect(created.status).toBe(201);
    const list = await (await listUsers(req('/api/users', { cookie }))).json();
    expect(list.users.length).toBe(2);
    const [row] = await db.select().from(users).where(eq(users.email, 'rep@example.com'));
    expect(row!.mustChangePassword).toBe(true);
  });

  it('forbids sales executives from creating users or generating reset links', async () => {
    const { cookie } = await salesSession();
    const created = await createUserRoute(req('/api/users', { cookie, body: { name: 'X', email: 'x@example.com', role: 'ADMIN', password: PASSWORD } }));
    expect(created.status).toBe(403);
    const other = await createUser();
    const link = await resetLink(req(`/api/users/${other.id}/reset-link`, { cookie, method: 'POST' }), params({ id: other.id }));
    expect(link.status).toBe(403);
  });

  it('only exposes minimal fields of the user list to sales executives', async () => {
    const { cookie } = await salesSession();
    const list = await (await listUsers(req('/api/users', { cookie }))).json();
    for (const u of list.users) expect(Object.keys(u).sort()).toEqual(['id', 'name', 'role']);
  });

  it('refuses to remove or demote the last active administrator, and self-deactivation', async () => {
    const { user, cookie } = await adminSession();
    const demote = await patchUser(req(`/api/users/${user.id}`, { method: 'PATCH', cookie, body: { role: 'SALES_EXECUTIVE' } }), params({ id: user.id }));
    expect(demote.status).toBe(400);
    const deactivate = await patchUser(req(`/api/users/${user.id}`, { method: 'PATCH', cookie, body: { active: false } }), params({ id: user.id }));
    expect(deactivate.status).toBe(400);
  });

  it('deactivating a user ends their sessions immediately', async () => {
    const admin = await adminSession();
    const rep = await salesSession();
    expect((await me(req('/api/auth/me', { cookie: rep.cookie }))).status).toBe(200);
    await patchUser(req(`/api/users/${rep.user.id}`, { method: 'PATCH', cookie: admin.cookie, body: { active: false } }), params({ id: rep.user.id }));
    expect((await me(req('/api/auth/me', { cookie: rep.cookie }))).status).toBe(401);
  });

  it('blocks users flagged mustChangePassword from everything except changing it', async () => {
    const u = await createUser({ mustChangePassword: true });
    const cookie = await doLogin(u.email);
    expect((await listUsers(req('/api/users', { cookie }))).status).toBe(403);
    expect((await me(req('/api/auth/me', { cookie }))).status).toBe(200);
    const changed = await changePassword(req('/api/auth/password', { cookie, body: { currentPassword: PASSWORD, newPassword: 'Another-Strong-Pass-7' } }));
    expect(changed.status).toBe(200);
    expect((await listUsers(req('/api/users', { cookie }))).status).toBe(200);
  });
});

describe('password change and reset', () => {
  it('changes password, invalidates other sessions, and audits it', async () => {
    const u = await createUser();
    const c1 = await doLogin(u.email);
    const c2 = await doLogin(u.email);
    const res = await changePassword(req('/api/auth/password', { cookie: c1, body: { currentPassword: PASSWORD, newPassword: 'Another-Strong-Pass-7' } }));
    expect(res.status).toBe(200);
    expect((await me(req('/api/auth/me', { cookie: c1 }))).status).toBe(200);
    expect((await me(req('/api/auth/me', { cookie: c2 }))).status).toBe(401);
    expect((await login(req('/api/auth/login', { body: { email: u.email, password: PASSWORD } }))).status).toBe(401);
    expect((await login(req('/api/auth/login', { body: { email: u.email, password: 'Another-Strong-Pass-7' } }))).status).toBe(200);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, 'auth.password_changed'));
    expect(logs).toHaveLength(1);
  });

  it('rejects a wrong current password', async () => {
    const u = await createUser();
    const cookie = await doLogin(u.email);
    const res = await changePassword(req('/api/auth/password', { cookie, body: { currentPassword: 'nope-nope-nope-1A', newPassword: 'Another-Strong-Pass-7' } }));
    expect(res.status).toBe(401);
  });

  it('admin reset link works once, then is spent', async () => {
    const admin = await adminSession();
    const target = await createUser();
    const lr = await resetLink(req(`/api/users/${target.id}/reset-link`, { cookie: admin.cookie, method: 'POST' }), params({ id: target.id }));
    const { link } = await lr.json();
    const token = new URL(link).searchParams.get('token')!;
    const ok = await resetPassword(req('/api/auth/reset', { body: { token, password: 'Brand-New-Passw0rd' } }));
    expect(ok.status).toBe(200);
    const reuse = await resetPassword(req('/api/auth/reset', { body: { token, password: 'Another-New-Passw0rd' } }));
    expect(reuse.status).toBe(400);
    expect((await login(req('/api/auth/login', { body: { email: target.email, password: 'Brand-New-Passw0rd' } }))).status).toBe(200);
  });
});

describe('input validation', () => {
  it('returns field-level errors for invalid bodies without leaking internals', async () => {
    const res = await login(req('/api/auth/login', { body: { email: 'not-an-email', password: '' } }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.code).toBe('validation_error');
    expect(j.fieldErrors.email).toBeTruthy();
    expect(JSON.stringify(j)).not.toMatch(/stack|at .*\.ts/);
  });
  it('rejects malformed JSON', async () => {
    const r = new Request('http://localhost:3000/api/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json' }, body: '{bad' });
    expect((await login(r)).status).toBe(400);
  });
});
