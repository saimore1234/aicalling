import { desc, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents } from '@/db/schema';
import { route } from '@/lib/api';
import { agentBody } from '@/server/agent-input';
import { agentIsLaunchable, validateAgent } from '@/server/agent-validation';

export const GET = route({ roles: ['ADMIN'] }, async () => {
  const rows = await db.select().from(aiAgents).where(isNull(aiAgents.deletedAt)).orderBy(desc(aiAgents.createdAt));
  return { agents: rows.map((a) => ({ ...a, problems: validateAgent(a), launchable: agentIsLaunchable(validateAgent(a)) })) };
});

export const POST = route({ roles: ['ADMIN'], body: agentBody }, async ({ user, body, audit }) => {
  const [row] = await db.insert(aiAgents).values({ ...body, humanTransferNumber: body.humanTransferNumber ?? null, createdById: user.id }).returning();
  await audit('agent.created', 'agent', row!.id, { name: row!.name });
  const problems = validateAgent(row!);
  return Response.json({ agent: row, problems, launchable: agentIsLaunchable(problems) }, { status: 201 });
});
