import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns } from '@/db/schema';
import { route } from '@/lib/api';
import { ApiError, conflict } from '@/lib/errors';
import { loadCampaign, launchReadiness } from '@/server/campaigns';
import { enqueue } from '@/server/queues';

export const POST = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const c = await loadCampaign(params.id);
  if (!['DRAFT', 'PAUSED'].includes(c.status)) throw conflict(`A ${c.status.toLowerCase()} campaign cannot be started.`);
  const r = await launchReadiness(c);
  if (!r.ready) throw new ApiError(422, 'The campaign is not ready to start.', 'not_ready', { problems: r.problems.filter((p) => p.severity === 'error') });
  const [row] = await db.update(campaigns).set({ status: 'RUNNING', launchedAt: c.launchedAt ?? new Date(), stopReason: null }).where(eq(campaigns.id, c.id)).returning();
  await enqueue('maintenance:campaign-tick', {}, { jobId: `tick-now-${c.id}-${Date.now()}`, attempts: 1 });
  await audit('campaign.started', 'campaign', c.id, { demo: c.isDemo });
  return { campaign: row };
});
