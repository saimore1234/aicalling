import { z } from 'zod';
import { route } from '@/lib/api';
import { emptyToUndefined } from '@/lib/schemas';
import { getAppSettings } from '@/lib/settings';
import { dashboardMetrics } from '@/server/metrics';

const query = z.object({
  from: emptyToUndefined(z.coerce.date().optional()),
  to: emptyToUndefined(z.coerce.date().optional()),
  campaignId: emptyToUndefined(z.string().uuid().optional()),
  ownerId: emptyToUndefined(z.string().uuid().optional()),
  /** Default: the data that matches the current mode (demo mode → demo data, live mode → real data). */
  demo: emptyToUndefined(z.enum(['true', 'false', 'all']).optional()),
});

export const GET = route({ query }, async ({ user, query }) => {
  const settings = await getAppSettings();
  const to = query.to ?? new Date(Date.now() + 60_000);
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
  const demo = query.demo ?? (settings.mode === 'demo' ? 'true' : 'false');
  return { mode: settings.mode, ...(await dashboardMetrics(user, { from, to, campaignId: query.campaignId, ownerId: query.ownerId, demo })) };
});
