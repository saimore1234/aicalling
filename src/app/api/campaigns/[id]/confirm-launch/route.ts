import { loadCampaign } from '@/server/campaigns';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { campaigns } from '@/db/schema';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';

const body = z.object({ confirm: z.literal('LAUNCH LIVE CALLS') });

/** Explicit, typed confirmation that real people will be called. Required before any live campaign may start. */
export const POST = route<{ id: string }, typeof body>({ roles: ['ADMIN'], body }, async ({ user, params, audit }) => {
  const c = await loadCampaign(params.id);
  if (c.isDemo) throw badRequest('Demo campaigns do not need live confirmation.');
  await db.update(campaigns).set({ launchConfirmedAt: new Date(), launchConfirmedById: user.id }).where(eq(campaigns.id, c.id));
  await audit('campaign.launch_confirmed', 'campaign', c.id);
  return { ok: true };
});
