import { route } from '@/lib/api';
import { getAppSettings } from '@/lib/settings';

export const GET = route({ allowPasswordChange: true }, async ({ user }) => {
  const s = await getAppSettings();
  return { user, mode: s.mode, killSwitch: s.killSwitch };
});
