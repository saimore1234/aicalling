import { route } from '@/lib/api';
import { integrationStatuses } from '@/server/integrations';

export const GET = route({ roles: ['ADMIN'] }, async () => integrationStatuses());
