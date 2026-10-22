import { Queue, type JobsOptions } from 'bullmq';
import { bullConnection } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const QUEUES = {
  imports: 'imports',
  calls: 'calls',
  postcall: 'postcall',
  followups: 'followups',
  messages: 'messages',
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type JobPayloads = {
  'imports:validate': { importId: string };
  'imports:commit': { importId: string };
  'calls:place-call': { campaignLeadId: string; attempt: number };
  'calls:demo-simulate': { callId: string };
  'postcall:analyze-call': { callId: string };
  'postcall:fetch-cost': { callId: string };
  'followups:process': { taskId: string };
  'messages:demo-deliver': { messageId: string };
  'maintenance:campaign-tick': Record<string, never>;
  'maintenance:followup-tick': Record<string, never>;
  'maintenance:reaper': Record<string, never>;
  'maintenance:retention': Record<string, never>;
};

const DEFAULT_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 2000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

const g = globalThis as unknown as { __vmsQueues?: Map<string, Queue> };

export function getQueue(name: QueueName): Queue {
  g.__vmsQueues ??= new Map();
  let q = g.__vmsQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection(), defaultJobOptions: DEFAULT_OPTS });
    q.on('error', (err) => logger.warn({ queue: name, err: err.message }, 'queue error'));
    g.__vmsQueues.set(name, q);
  }
  return q;
}

export async function closeQueues() {
  if (!g.__vmsQueues) return;
  await Promise.all([...g.__vmsQueues.values()].map((q) => q.close().catch(() => undefined)));
  g.__vmsQueues.clear();
}

/**
 * Enqueue a job with a deterministic id so that retries / duplicate triggers collapse into one job.
 * Ids use '-' because BullMQ forbids ':' in custom ids.
 */
export async function enqueue<K extends keyof JobPayloads>(
  key: K,
  payload: JobPayloads[K],
  opts: { jobId: string; delayMs?: number; attempts?: number },
): Promise<{ queued: boolean }> {
  const [queue, name] = key.split(':') as [QueueName, string];
  try {
    await getQueue(queue).add(name, payload, {
      jobId: opts.jobId.replace(/:/g, '-'),
      delay: opts.delayMs,
      attempts: opts.attempts,
    });
    return { queued: true };
  } catch (err) {
    logger.error({ queue, name, err: (err as Error).message }, 'failed to enqueue job');
    return { queued: false };
  }
}

/** Like enqueue(), but surfaces a queue outage to the caller as a 503 instead of silently dropping work. */
export async function enqueueOrThrow<K extends keyof JobPayloads>(
  key: K,
  payload: JobPayloads[K],
  opts: { jobId: string; delayMs?: number; attempts?: number },
) {
  const res = await enqueue(key, payload, opts);
  if (!res.queued) {
    const { ApiError } = await import('@/lib/errors');
    throw new ApiError(503, 'The background job queue is unavailable. Check that Redis and the worker are running.', 'queue_unavailable');
  }
}
