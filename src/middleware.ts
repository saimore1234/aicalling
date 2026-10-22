import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/setup', '/forgot-password', '/reset-password', '/unsubscribe'];

/**
 * Cheap gate: bounce visitors with no session cookie to the login page.
 * This is a convenience only — every API route and server action validates the session itself.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get('vsc_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|templates/).*)'] };
