import { route } from '@/lib/api';
import { loadCampaign, populateLeads } from '@/server/campaigns';

export const POST = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  const c = await loadCampaign(params.id);
  const r = await populateLeads(c);
  await audit('campaign.leads_added', 'campaign', c.id, r);
  return r;
});
