import { ZodError, type ZodTypeAny, type z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ApiError, forbidden, tooMany, unauthorized } from './errors';
import { getSessionUser, parseCookies, SESSION_COOKIE, type AuthSession, type AuthUser, type Role } from './auth';
import { rateLimit } from './ratelimit';
import { audit } from './audit';
import { getEnv } from './env';
import { logger, sanitizeError } from './logger';

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** Same-origin check for cookie-authenticated, state-changing requests (CSRF defence in depth on top of SameSite=Lax). */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin) {
    try {
      const oh = new URL(origin).host;
      if (host && oh === host) return true;
      const appUrl = getEnv().APP_URL;
      if (appUrl && new URL(appUrl).host === oh) return true;
      return false;
    } catch {
      return false;
    }
  }
  const sfs = req.headers.get('sec-fetch-site');
  return sfs === 'same-origin' || sfs === 'none';
}

type Options<B extends ZodTypeAny | undefined, Q extends ZodTypeAny | undefined> = {
  /** Roles allowed (default: any authenticated user). */
  roles?: Role[];
  body?: B;
  query?: Q;
  /** Skip CSRF origin check — only for signature-verified provider webhooks. */
  csrf?: boolean;
  rateLimit?: { name: string; limit: number; windowSec: number; by?: 'ip' | 'user' };
  /** Allow users flagged mustChangePassword to call this endpoint. */
  allowPasswordChange?: boolean;
};

type Infer<T> = T extends ZodTypeAny ? z.infer<T> : undefined;

function errorResponse(status: number, error: string, code: string, extra?: Record<string, unknown>, headers?: HeadersInit) {
  return Response.json({ error, code, ...extra }, { status, headers });
}

export function handleError(err: unknown, requestId: string): Response {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return errorResponse(400, 'Validation failed', 'validation_error', { fieldErrors });
  }
  if (err instanceof ApiError) {
    const headers: Record<string, string> = {};
    const d = err.details as { retryAfter?: number } | undefined;
    if (err.status === 429 && d?.retryAfter) headers['Retry-After'] = String(d.retryAfter);
    return errorResponse(err.status, err.message, err.code, err.details && err.status !== 429 ? { details: err.details } : undefined, headers);
  }
  logger.error(
    { requestId, err: sanitizeError(err), stack: getEnv().NODE_ENV === 'production' ? undefined : (err as Error)?.stack },
    'unhandled API error',
  );
  return errorResponse(500, 'Internal server error', 'internal_error', { requestId });
}

function buildRoute(
  opts: Options<any, any>,
  requireAuth: boolean,
  handler: (ctx: any) => Promise<unknown>,
): (req: Request, routeCtx?: { params: Promise<any> }) => Promise<Response> {
  return async (req, routeCtx) => {
    const requestId = randomUUID();
    try {
      const ip = clientIp(req);
      const method = req.method.toUpperCase();
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);

      if (mutating && opts.csrf !== false && !isSameOrigin(req)) {
        throw forbidden('Cross-origin request blocked');
      }

      let user: AuthUser | null = null;
      let session: AuthSession | null = null;
      const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
      if (token) {
        const found = await getSessionUser(token);
        if (found) {
          user = found.user;
          session = found.session;
        }
      }
      if (requireAuth) {
        if (!user) throw unauthorized();
        if (opts.roles && !opts.roles.includes(user.role)) throw forbidden();
        if (user.mustChangePassword && !opts.allowPasswordChange) {
          throw new ApiError(403, 'Password change required', 'password_change_required');
        }
      }

      if (opts.rateLimit) {
        const who = opts.rateLimit.by === 'user' && user ? user.id : ip;
        const rl = await rateLimit({
          key: `${opts.rateLimit.name}:${who}`,
          limit: opts.rateLimit.limit,
          windowSec: opts.rateLimit.windowSec,
        });
        if (!rl.allowed) throw tooMany('Too many requests. Please try again later.', rl.retryAfter);
      }

      const params = routeCtx?.params ? await routeCtx.params : {};

      let query: unknown = undefined;
      if (opts.query) {
        const url = new URL(req.url);
        const raw: Record<string, string | string[]> = {};
        for (const key of new Set(url.searchParams.keys())) {
          const all = url.searchParams.getAll(key);
          raw[key] = all.length > 1 ? all : all[0]!;
        }
        query = opts.query.parse(raw);
      }

      let body: unknown = undefined;
      if (opts.body) {
        let json: unknown;
        try {
          json = await req.json();
        } catch {
          throw new ApiError(400, 'Request body must be valid JSON', 'invalid_json');
        }
        body = opts.body.parse(json);
      }

      const ctx = {
        req,
        user,
        session,
        params,
        body,
        query,
        ip,
        audit: (action: string, entityType?: string, entityId?: string | null, metadata?: Record<string, unknown>) =>
          audit({
            userId: user?.id ?? null,
            userEmail: user?.email ?? null,
            action,
            entityType,
            entityId,
            metadata,
            ip,
            userAgent: req.headers.get('user-agent'),
          }),
      };

      const result = await handler(ctx);
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (err) {
      return handleError(err, requestId);
    }
  };
}

type Ctx<P, B, Q, U> = {
  req: Request;
  user: U;
  session: AuthSession | null;
  params: P;
  body: B;
  query: Q;
  ip: string;
  audit: (action: string, entityType?: string, entityId?: string | null, metadata?: Record<string, unknown>) => Promise<void>;
};

/** Authenticated route: session required, optional role restriction, CSRF origin check, validation. */
export function route<P = Record<string, string>, B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined>(
  opts: Options<B, Q>,
  handler: (ctx: Ctx<P, Infer<B>, Infer<Q>, AuthUser>) => Promise<unknown>,
) {
  return buildRoute(opts, true, handler) as (req: Request, ctx?: { params: Promise<P> }) => Promise<Response>;
}

/** Public route (login, setup, provider webhooks). user is populated when a valid session cookie happens to be present. */
export function publicRoute<P = Record<string, string>, B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined>(
  opts: Options<B, Q>,
  handler: (ctx: Ctx<P, Infer<B>, Infer<Q>, AuthUser | null>) => Promise<unknown>,
) {
  return buildRoute(opts, false, handler) as (req: Request, ctx?: { params: Promise<P> }) => Promise<Response>;
}

/** Pagination helper shared by list endpoints. */
export function pageParams(q: { page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(q.pageSize ?? 25, 1), 200);
  const page = Math.max(q.page ?? 1, 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}
