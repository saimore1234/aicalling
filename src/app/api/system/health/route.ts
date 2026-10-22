import { route } from '@/lib/api';
import { systemHealth } from '@/server/health';

export const GET = route({ roles: ['ADMIN'] }, async () => systemHealth());
