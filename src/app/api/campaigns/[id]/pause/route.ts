import { loadCampaign } from '@/server/campaigns';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaignLeads, campaigns } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';

/** Pausing stops new dialling immediately; calls already in progress finish normally. */
export const POST = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const c = await loadCampaign(params.id);
  if (c.status !== 'RUNNING') throw conflict('Only a running campaign can be paused.');
  const [row] = await db.update(campaigns).set({ status: 'PAUSED', stopReason: 'Paused by an administrator' }).where(eq(campaigns.id, c.id)).returning();
  await db.update(campaignLeads).set({ status: 'PENDING', queuedAt: null, updatedAt: new Date() }).where(and(eq(campaignLeads.campaignId, c.id), inArray(campaignLeads.status, ['QUEUED'])));
  await audit('campaign.paused', 'campaign', c.id);
  return { campaign: row };
});
