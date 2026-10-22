import { z } from 'zod';
import { route } from '@/lib/api';
import { checkIntegration, INTEGRATION_KEYS } from '@/server/integrations';

const body = z.object({ key: z.enum(INTEGRATION_KEYS as [string, ...string[]]) });
export const POST = route<Record<string, string>, typeof body>({ roles: ['ADMIN'], body, rateLimit: { name: 'integration-check', limit: 20, windowSec: 60, by: 'user' } }, async ({ body, audit }) => {
  const r = await checkIntegration(body.key as never);
  await audit('integration.checked', 'integration', body.key, { ok: r.ok });
  return r;
});
