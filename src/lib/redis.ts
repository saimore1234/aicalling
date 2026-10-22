import { Redis } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { getEnv } from './env';

const g = globalThis as unknown as { __vmsRedis?: Redis };

export function getRedis(): Redis {
  if (!g.__vmsRedis) {
    const r = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
    r.on('error', () => {
      /* status is surfaced by health checks; avoid unhandled 'error' events */
    });
    g.__vmsRedis = r;
  }
  return g.__vmsRedis;
}

export async function closeRedis() {
  if (g.__vmsRedis) {
    await g.__vmsRedis.quit().catch(() => undefined);
    g.__vmsRedis = undefined;
  }
}

/** BullMQ connection options parsed from REDIS_URL (BullMQ manages its own connections). */
export function bullConnection(): ConnectionOptions {
  const u = new URL(getEnv().REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
