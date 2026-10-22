import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '@/db/client';
import { backgroundJobs, calls, messages } from '@/db/schema';
import { bullConnection, closeRedis, getRedis } from '@/lib/redis';
import { logger, sanitizeError } from '@/lib/logger';
import { getAppSettings } from '@/lib/settings';
import { getTelephonyProvider } from '@/providers';
import { runCommit, runValidate } from '@/server/imports/run';
import { closeQueues, getQueue, QUEUES, type QueueName } from '@/server/queues';
import { placeCallForLead, tickAllCampaigns } from '@/server/campaigns';
import { simulateDemoCall } from '@/server/demo-sim';
import { analyzeCall, markAnalysisFailed } from '@/server/qualification';
import { enqueueDueFollowUps, processFollowUp } from '@/server/followups';
import { applyMessageStatus } from '@/server/message-status';
import { runReaper, runRetention } from '@/server/maintenance';

const HEARTBEAT_KEY = 'vms:worker:heartbeat';

function related(name: string, data: Record<string, unknown>): { type: string; id: string } | null {
  const id = (data.importId ?? data.callId ?? data.taskId ?? data.messageId ?? data.campaignLeadId) as string | undefined;
  if (!id) return null;
  return { type: name.split('-')[0] ?? name, id };
}

/** Mirrors job lifecycle into Postgres so the System Health page can show history independent of Redis retention. */
async function track(queue: string, job: Job, status: 'PROCESSING' | 'COMPLETED' | 'FAILED', error?: string) {
  if (!job.id || job.name.endsWith('-tick') || job.name === 'campaign-tick') return; // high-frequency housekeeping is not tracked
  const rel = related(job.name, job.data as Record<string, unknown>);
  const now = new Date();
  try {
    await db
      .insert(backgroundJobs)
      .values({ queue, jobId: String(job.id), name: job.name, status, attempts: job.attemptsMade, relatedType: rel?.type ?? null, relatedId: rel?.id ?? null, error: error?.slice(0, 1000) ?? null, startedAt: status === 'PROCESSING' ? now : undefined, finishedAt: status === 'PROCESSING' ? undefined : now })
      .onConflictDoUpdate({
        target: [backgroundJobs.queue, backgroundJobs.jobId],
        set: { status, attempts: job.attemptsMade, error: error?.slice(0, 1000) ?? null, finishedAt: status === 'PROCESSING' ? null : now, updatedAt: now },
      });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'could not record background job');
  }
}

type Handler = (job: Job) => Promise<unknown>;

const handlers: Record<QueueName, Handler> = {
  imports: async (job) => {
    const { importId } = job.data as { importId: string };
    if (job.name === 'validate') return runValidate(importId);
    if (job.name === 'commit') return runCommit(importId);
    throw new Error(`unknown job ${job.name}`);
  },
  calls: async (job) => {
    if (job.name === 'place-call') {
      const { campaignLeadId, attempt } = job.data as { campaignLeadId: string; attempt: number };
      return placeCallForLead(campaignLeadId, attempt);
    }
    if (job.name === 'demo-simulate') return simulateDemoCall((job.data as { callId: string }).callId);
    throw new Error(`unknown job ${job.name}`);
  },
  postcall: async (job) => {
    const { callId } = job.data as { callId: string };
    if (job.name === 'analyze-call') {
      try {
        return await analyzeCall(callId);
      } catch (err) {
        const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (last) await markAnalysisFailed(callId, sanitizeError(err));
        throw err;
      }
    }
    if (job.name === 'fetch-cost') {
      const [c] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
      if (!c || c.isDemo || !c.providerCallSid) return;
      const info = await getTelephonyProvider((await getAppSettings()).mode).fetchCall(c.providerCallSid);
      if (info?.price === undefined) throw new Error('Cost not available yet'); // retried with backoff
      await db.update(calls).set({ costAmount: String(info.price), costCurrency: info.priceUnit ?? null }).where(eq(calls.id, callId));
      return;
    }
    throw new Error(`unknown job ${job.name}`);
  },
  followups: async (job) => processFollowUp((job.data as { taskId: string }).taskId),
  messages: async (job) => {
    // DEMO only: simulate the provider's delivery receipt so the UI shows a delivered (DEMO) message.
    const { messageId } = job.data as { messageId: string };
    const [m] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!m || !m.isDemo || !m.providerMessageId) return;
    await applyMessageStatus({ provider: 'demo', providerMessageId: m.providerMessageId, status: 'DELIVERED' });
  },
  maintenance: async (job) => {
    switch (job.name) {
      case 'campaign-tick': return tickAllCampaigns();
      case 'followup-tick': return enqueueDueFollowUps();
      case 'reaper': return runReaper();
      case 'retention': return runRetention();
      default: throw new Error(`unknown job ${job.name}`);
    }
  },
};

const CONCURRENCY: Record<QueueName, number> = { imports: 1, calls: 5, postcall: 5, followups: 5, messages: 10, maintenance: 1 };

export async function startWorkers() {
  const workers: Worker[] = [];
  for (const name of Object.values(QUEUES)) {
    const w = new Worker(
      name,
      async (job) => {
        await track(name, job, 'PROCESSING');
        try {
          const res = await handlers[name](job);
          await track(name, job, 'COMPLETED');
          return res as never;
        } catch (err) {
          const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          await track(name, job, final ? 'FAILED' : 'PROCESSING', sanitizeError(err));
          logger.warn({ queue: name, job: job.name, id: job.id, attempt: job.attemptsMade + 1, err: sanitizeError(err) }, 'job failed');
          throw err;
        }
      },
      { connection: bullConnection(), concurrency: CONCURRENCY[name] },
    );
    w.on('error', (err) => logger.error({ queue: name, err: err.message }, 'worker error'));
    workers.push(w);
  }

  const maint = getQueue('maintenance');
  const repeat = async (name: string, every: number) =>
    maint.upsertJobScheduler(`sched-${name}`, { every }, { name, data: {}, opts: { removeOnComplete: 20, removeOnFail: 50, attempts: 1 } });
  await repeat('campaign-tick', 10_000);
  await repeat('followup-tick', 60_000);
  await repeat('reaper', 60_000);
  await repeat('retention', 6 * 3600_000);

  const beat = async () => {
    try {
      await getRedis().set(HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), pid: process.pid }), 'EX', 60);
    } catch {
      /* redis down: health page will show it */
    }
  };
  await beat();
  const timer = setInterval(beat, 15_000);

  logger.info({ queues: Object.values(QUEUES) }, 'worker started');
  return {
    async stop() {
      clearInterval(timer);
      await Promise.all(workers.map((w) => w.close()));
      await closeQueues();
      await closeRedis();
      await closeDb();
    },
  };
}

export { HEARTBEAT_KEY };

if (process.argv[1] && /worker[\\/]index\.(ts|js)$/.test(process.argv[1])) {
  startWorkers()
    .then((w) => {
      const shutdown = async (sig: string) => {
        logger.info({ sig }, 'worker shutting down');
        await w.stop().catch(() => undefined);
        process.exit(0);
      };
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
      process.on('SIGINT', () => void shutdown('SIGINT'));
    })
    .catch((err) => {
      logger.fatal({ err: sanitizeError(err) }, 'worker failed to start');
      process.exit(1);
    });
}
