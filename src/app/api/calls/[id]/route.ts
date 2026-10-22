import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents, callEvents, calls, campaigns, customers, followUpTasks, leadQualifications, messages, transcripts } from '@/db/schema';
import { route } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { scopeCondition } from '@/server/customers';

export const GET = route<{ id: string }>({}, async ({ user, params }) => {
  const scope = scopeCondition(user);
  const [row] = await db
    .select({ call: calls, customer: customers, campaignName: campaigns.name, agentName: aiAgents.name })
    .from(calls)
    .innerJoin(customers, eq(customers.id, calls.customerId))
    .leftJoin(campaigns, eq(campaigns.id, calls.campaignId))
    .leftJoin(aiAgents, eq(aiAgents.id, calls.agentId))
    .where(and(eq(calls.id, params.id), scope))
    .limit(1);
  if (!row) throw notFound('Call not found'); // also returned for calls on customers the user does not own
  const [transcript] = await db.select().from(transcripts).where(eq(transcripts.callId, params.id)).limit(1);
  const events = await db.select().from(callEvents).where(eq(callEvents.callId, params.id)).orderBy(asc(callEvents.occurredAt));
  const [qualification] = await db.select().from(leadQualifications).where(eq(leadQualifications.callId, params.id)).orderBy(desc(leadQualifications.createdAt)).limit(1);
  const tasks = await db.select().from(followUpTasks).where(eq(followUpTasks.callId, params.id)).orderBy(asc(followUpTasks.createdAt));
  const msgs = await db.select({ id: messages.id, channel: messages.channel, status: messages.status, subject: messages.subject, isDemo: messages.isDemo, createdAt: messages.createdAt, errorMessage: messages.errorMessage }).from(messages).where(eq(messages.callId, params.id));
  return {
    call: { ...row.call, campaignName: row.campaignName, agentName: row.agentName },
    customer: { id: row.customer.id, name: row.customer.name, company: row.customer.company },
    transcript: transcript ?? null,
    events,
    qualification: qualification ?? null,
    followUps: tasks,
    messages: msgs,
  };
});
