import { getRedis } from './redis';
import { logger } from './logger';

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfter: number; count: number };

type MemEntry = { count: number; resetAt: number };
const memory = new Map<string, MemEntry>();
let warned = false;

function memoryHit(key: string, windowSec: number): { count: number; ttl: number } {
  const now = Date.now();
  const e = memory.get(key);
  if (!e || e.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    if (memory.size > 50_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    return { count: 1, ttl: windowSec };
  }
  e.count += 1;
  return { count: e.count, ttl: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
}

/**
 * Fixed-window rate limiter. Uses Redis so limits hold across processes; if Redis is unavailable
 * it degrades to a per-process in-memory limiter (and logs once) rather than disabling limiting.
 */
export async function rateLimit(opts: { key: string; limit: number; windowSec: number }): Promise<RateLimitResult> {
  const key = `vsc:rl:${opts.key}`;
  let count: number;
  let ttl: number;
  try {
    const redis = getRedis();
    const res = await redis.multi().incr(key).ttl(key).exec();
    count = Number(res?.[0]?.[1] ?? 1);
    ttl = Number(res?.[1]?.[1] ?? -1);
    if (ttl < 0) {
      await redis.expire(key, opts.windowSec);
      ttl = opts.windowSec;
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      logger.warn({ err: (err as Error).message }, 'rate limiter: Redis unavailable, using in-memory fallback');
    }
    ({ count, ttl } = memoryHit(key, opts.windowSec));
  }
  return {
    allowed: count <= opts.limit,
    remaining: Math.max(0, opts.limit - count),
    retryAfter: ttl,
    count,
  };
}

export async function resetRateLimit(key: string) {
  memory.delete(`vsc:rl:${key}`);
  try {
    await getRedis().del(`vsc:rl:${key}`);
  } catch {
    /* ignore */
  }
}
