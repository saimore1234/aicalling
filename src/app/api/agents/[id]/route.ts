import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents, campaigns } from '@/db/schema';
import { route } from '@/lib/api';
import { conflict, notFound } from '@/lib/errors';
import { agentPatch } from '@/server/agent-input';
import { agentIsLaunchable, validateAgent } from '@/server/agent-validation';

async function load(id: string) {
  const [a] = await db.select().from(aiAgents).where(and(eq(aiAgents.id, id), isNull(aiAgents.deletedAt))).limit(1);
  if (!a) throw notFound('Agent not found');
  return a;
}

export const GET = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params }) => {
  const a = await load(params.id);
  const problems = validateAgent(a);
  return { agent: a, problems, launchable: agentIsLaunchable(problems) };
});

export const PATCH = route<{ id: string }, typeof agentPatch>({ roles: ['ADMIN'], body: agentPatch }, async ({ params, body, audit }) => {
  await load(params.id);
  const [row] = await db.update(aiAgents).set({ ...body, humanTransferNumber: body.humanTransferNumber === undefined ? undefined : body.humanTransferNumber }).where(eq(aiAgents.id, params.id)).returning();
  await audit('agent.updated', 'agent', params.id, { fields: Object.keys(body) });
  const problems = validateAgent(row!);
  return { agent: row, problems, launchable: agentIsLaunchable(problems) };
});

export const DELETE = route<{ id: string }>({ roles: ['ADMIN'] }, async ({ params, audit }) => {
  await load(params.id);
  const running = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.agentId, params.id), eq(campaigns.status, 'RUNNING'))).limit(1);
  if (running.length) throw conflict('This agent is used by a running campaign. Stop the campaign first.');
  await db.update(aiAgents).set({ deletedAt: new Date(), active: false }).where(eq(aiAgents.id, params.id));
  await audit('agent.deleted', 'agent', params.id);
  return { ok: true };
});
