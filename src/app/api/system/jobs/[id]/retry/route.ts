import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { backgroundJobs } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict, notFound } from '@/lib/errors';
import { getQueue, type QueueName } from '@/server/queues';

export const POST = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, params.id)).limit(1);
  if (!row) throw notFound('Job not found');
  if (row.status !== 'FAILED') throw conflict('Only failed jobs can be retried.');
  const job = await getQueue(row.queue as QueueName).getJob(row.jobId);
  if (!job) throw conflict('The job has expired from the queue (failed jobs are kept for 7 days). Trigger the action again from its page.');
  await job.retry();
  await db.update(backgroundJobs).set({ status: 'PENDING', error: null }).where(eq(backgroundJobs.id, row.id));
  await audit('system.job_retried', 'job', row.id, { queue: row.queue, name: row.name });
  return { ok: true };
});
