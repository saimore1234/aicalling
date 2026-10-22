import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { agentIsLaunchable, validateAgent } from '@/server/agent-validation';

export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => {
  const [a] = await db.select().from(aiAgents).where(eq(aiAgents.id, params.id)).limit(1);
  if (!a) throw notFound('Agent not found');
  const problems = validateAgent(a);
  return { problems, launchable: agentIsLaunchable(problems) };
});
