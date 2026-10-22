import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { campaignLeads, campaigns } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';
import { loadCampaign, hangupActiveCalls } from '@/server/campaigns';

const body = z.object({ hangUpActiveCalls: z.boolean().default(false) }).default({ hangUpActiveCalls: false });

/** Permanent stop: remaining leads are cancelled. Optionally ends calls that are in progress right now. */
export const POST = route<{ id: string }, typeof body>({ roles: ['ADMIN'], body }, async ({ params, body, audit }) => {
  const c = await loadCampaign(params.id);
  if (['STOPPED', 'COMPLETED'].includes(c.status)) throw conflict('The campaign has already finished.');
  const now = new Date();
  const [row] = await db.update(campaigns).set({ status: 'STOPPED', stoppedAt: now, stopReason: 'Stopped by an administrator' }).where(eq(campaigns.id, c.id)).returning();
  await db.update(campaignLeads).set({ status: 'CANCELED', skipReason: 'Campaign stopped', updatedAt: now }).where(and(eq(campaignLeads.campaignId, c.id), inArray(campaignLeads.status, ['PENDING', 'QUEUED', 'RETRY_WAIT'])));
  const hungUp = body.hangUpActiveCalls ? await hangupActiveCalls({ campaignId: c.id }) : 0;
  await audit('campaign.stopped', 'campaign', c.id, { hungUp });
  return { campaign: row, hungUp };
});
