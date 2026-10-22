import { z } from 'zod';
import { route } from '@/lib/api';
import { getAppSettings } from '@/lib/settings';
import { activateKillSwitch, releaseKillSwitch } from '@/server/campaigns';

export const GET = route({ roles: ['ADMIN'] }, async () => {
  const s = await getAppSettings();
  return { active: s.killSwitch, reason: s.killSwitchReason ?? null };
});

const on = z.object({ reason: z.string().trim().min(3).max(300) });
/** Emergency stop. Blocks ALL dialling and messaging-triggered calls, pauses running campaigns, hangs up live calls. */
export const POST = route<Record<string, string>, typeof on>({ roles: ['ADMIN'], body: on }, async ({ user, body, audit }) => {
  const r = await activateKillSwitch(body.reason, user.id);
  await audit('system.kill_switch_on', 'system', null, { reason: body.reason, ...r });
  return { active: true, ...r };
});

export const DELETE = route({ roles: ['ADMIN'] }, async ({ user, audit }) => {
  await releaseKillSwitch(user.id);
  await audit('system.kill_switch_off', 'system');
  return { active: false };
});
