import { z } from 'zod';
import { route } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { getAppSettings, updateAppSettings } from '@/lib/settings';
import { isValidTimezone } from '@/lib/tz';

export const GET = route({ roles: ['ADMIN'] }, async () => ({ settings: await getAppSettings() }));

const patch = z.object({
  mode: z.enum(['demo', 'live']).optional(),
  /** Must equal "ENABLE LIVE MODE" when switching to live. */
  confirm: z.string().optional(),
  timezone: z.string().refine((v) => isValidTimezone(v), 'Unknown IANA timezone').optional(),
  retentionDays: z.coerce.number().int().min(0).max(3650).optional(),
  rateLimits: z.object({ callsPerMinute: z.coerce.number().int().min(1).max(600), messagesPerMinute: z.coerce.number().int().min(1).max(6000) }).partial().optional(),
});

export const PATCH = route<Record<string, string>, typeof patch>({ roles: ['ADMIN'], body: patch }, async ({ user, body, audit }) => {
  const current = await getAppSettings();
  const { confirm, ...rest } = body;
  const next: Parameters<typeof updateAppSettings>[0] = { ...rest, rateLimits: rest.rateLimits ? { ...current.rateLimits, ...rest.rateLimits } : undefined };
  if (!rest.rateLimits) delete next.rateLimits;
  if (rest.mode && rest.mode !== current.mode) {
    if (rest.mode === 'live') {
      if (confirm !== 'ENABLE LIVE MODE') throw badRequest('Type "ENABLE LIVE MODE" to confirm switching to live mode.');
      next.liveEnabledAt = new Date().toISOString();
      next.liveEnabledBy = user.email;
    }
  }
  const saved = await updateAppSettings(next, user.id);
  await audit('system.settings_updated', 'system', null, { ...rest, modeChanged: rest.mode && rest.mode !== current.mode });
  return { settings: saved };
});
