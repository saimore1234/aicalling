import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { backgroundJobs, calls } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { getRedis } from '@/lib/redis';
import { getAppSettings } from '@/lib/settings';
import { ACTIVE } from './calls';
import { getQueue, QUEUES } from './queues';

type Check = { ok: boolean; detail?: string; latencyMs?: number };

async function timed(fn: () => Promise<string | void>): Promise<Check> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { ok: true, detail: detail || undefined, latencyMs: Date.now() - t };
  } catch (err) {
    return { ok: false, detail: (err as Error).message.slice(0, 200), latencyMs: Date.now() - t };
  }
}

export async function systemHealth() {
  const env = getEnv();
  const settings = await getAppSettings();
  const database = await timed(async () => { await db.execute(sql`select 1`); });
  const redis = await timed(async () => { const r = await getRedis().ping(); if (r !== 'PONG') throw new Error('unexpected reply'); });

  let worker: Check = { ok: false, detail: 'No heartbeat. Is the worker process running?' };
  try {
    const raw = await getRedis().get('vms:worker:heartbeat');
    if (raw) { const { at } = JSON.parse(raw) as { at: number }; worker = { ok: Date.now() - at < 45_000, detail: `Last heartbeat ${Math.round((Date.now() - at) / 1000)}s ago` }; }
  } catch { /* redis down already reported */ }

  const gwBase = (env.VOICE_GATEWAY_PUBLIC_URL ?? `ws://localhost:${env.VOICE_GATEWAY_PORT}/media-stream`).replace(/^ws/, 'http').replace(/\/media-stream$/, '');
  const gateway = await timed(async () => {
    const res = await fetch(`http://localhost:${env.VOICE_GATEWAY_PORT}/healthz`, { signal: AbortSignal.timeout(3000) }).catch(() => fetch(`${gwBase}/healthz`, { signal: AbortSignal.timeout(3000) }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { activeCalls: number };
    return `${j.activeCalls} active call(s)`;
  });

  const queues: Record<string, Record<string, number>> = {};
  if (redis.ok) {
    for (const q of Object.values(QUEUES)) {
      try { queues[q] = await getQueue(q).getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'); } catch { queues[q] = {}; }
    }
  }
  const [{ n: activeCalls } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).where(sql`${calls.status} in ${ACTIVE}`);
  const recentFailures = await db.select().from(backgroundJobs).where(eq(backgroundJobs.status, 'FAILED')).orderBy(desc(backgroundJobs.updatedAt)).limit(25);
  return {
    checkedAt: new Date().toISOString(),
    mode: settings.mode,
    killSwitch: settings.killSwitch,
    killSwitchReason: settings.killSwitchReason ?? null,
    checks: { database, redis, worker, voiceGateway: gateway },
    queues,
    activeCalls,
    recentFailures,
    healthy: database.ok && redis.ok && worker.ok,
  };
}
