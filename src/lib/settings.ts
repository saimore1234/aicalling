import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { integrationConfigurations } from '@/db/schema';

export type AppSettings = {
  mode: 'demo' | 'live';
  killSwitch: boolean;
  killSwitchReason?: string;
  publicUrl?: string;
  timezone: string;
  retentionDays: number;
  rateLimits: { callsPerMinute: number; messagesPerMinute: number };
  liveEnabledAt?: string;
  liveEnabledBy?: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'demo', // safe default: nothing real is ever dialled or sent until an admin explicitly enables live mode
  killSwitch: false,
  timezone: 'UTC',
  retentionDays: 90,
  rateLimits: { callsPerMinute: 20, messagesPerMinute: 60 },
};

export async function getAppSettings(): Promise<AppSettings> {
  const [row] = await db.select().from(integrationConfigurations).where(eq(integrationConfigurations.key, 'app')).limit(1);
  const cfg = (row?.config ?? {}) as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...cfg,
    rateLimits: { ...DEFAULT_SETTINGS.rateLimits, ...(cfg.rateLimits ?? {}) },
  };
}

export async function updateAppSettings(patch: Partial<AppSettings>, userId?: string | null): Promise<AppSettings> {
  const current = await getAppSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    rateLimits: { ...current.rateLimits, ...(patch.rateLimits ?? {}) },
  };
  await db
    .insert(integrationConfigurations)
    .values({ key: 'app', enabled: true, config: next, status: 'OK', updatedById: userId ?? null })
    .onConflictDoUpdate({
      target: integrationConfigurations.key,
      set: { config: next, status: 'OK', updatedById: userId ?? null, updatedAt: new Date() },
    });
  return next;
}

export async function isDemoMode(): Promise<boolean> {
  return (await getAppSettings()).mode === 'demo';
}

export async function isKillSwitchOn(): Promise<boolean> {
  return (await getAppSettings()).killSwitch;
}
