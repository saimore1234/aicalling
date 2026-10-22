import { route } from '@/lib/api';
import { loadCampaign, launchReadiness } from '@/server/campaigns';

export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => launchReadiness(await loadCampaign(params.id)));
