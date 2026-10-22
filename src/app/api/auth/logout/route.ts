import { route } from '@/lib/api';
import { clearSessionCookie, destroySession, parseCookies, SESSION_COOKIE } from '@/lib/auth';

export const POST = route({ allowPasswordChange: true }, async ({ req, audit }) => {
  await destroySession(parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]);
  await audit('auth.logout');
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
});
