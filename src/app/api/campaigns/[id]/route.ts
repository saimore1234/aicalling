import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict } from '@/lib/errors';
import { campaignPatch } from '@/server/campaign-input';
import { loadCampaign, populateLeads } from '@/server/campaigns';

export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => ({ campaign: await loadCampaign(params.id) }));

export const PATCH = route<{ id: string }, typeof campaignPatch>({ roles: ['ADMIN'], body: campaignPatch }, async ({ params, body, audit }) => {
  const c = await loadCampaign(params.id);
  if (c.status === 'RUNNING') throw conflict('Pause the campaign before editing it.');
  if (['STOPPED', 'COMPLETED'].includes(c.status)) throw conflict('A finished campaign cannot be edited. Duplicate it instead.');
  // Any change to what/when/how we call invalidates a previous launch confirmation.
  const [row] = await db.update(campaigns).set({ ...body, launchConfirmedAt: null, launchConfirmedById: null }).where(eq(campaigns.id, c.id)).returning();
  let added = 0;
  if (body.segmentFilter) added = (await populateLeads(row!)).added;
  await audit('campaign.updated', 'campaign', c.id, { fields: Object.keys(body) });
  return { campaign: row, leadsAdded: added };
});

export const DELETE = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const c = await loadCampaign(params.id);
  if (c.status === 'RUNNING') throw conflict('Stop the campaign before deleting it.');
  await db.update(campaigns).set({ deletedAt: new Date() }).where(eq(campaigns.id, c.id));
  await audit('campaign.deleted', 'campaign', c.id);
  return { ok: true };
});
