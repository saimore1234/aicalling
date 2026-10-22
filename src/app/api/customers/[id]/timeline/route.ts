import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { appointments, calls, consentRecords, customerNotes, followUpTasks, leadQualifications, messages, users } from '@/db/schema';
import { route } from '@/lib/api';
import { getScopedCustomer } from '@/server/customers';

export type TimelineItem = {
  id: string;
  type: 'call' | 'message' | 'note' | 'consent' | 'followup' | 'appointment' | 'qualification';
  at: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  demo?: boolean;
  href?: string;
};

/** Unified communications timeline: every touchpoint for one customer, newest first. */
export const GET = route<{ id: string }>({}, async ({ user, params }) => {
  const c = await getScopedCustomer(user, params.id);
  const [cl, ms, ns, cs, fs, ap, ql] = await Promise.all([
    db.select().from(calls).where(eq(calls.customerId, c.id)).orderBy(desc(calls.createdAt)).limit(100),
    db.select().from(messages).where(eq(messages.customerId, c.id)).orderBy(desc(messages.createdAt)).limit(100),
    db
      .select({ id: customerNotes.id, body: customerNotes.body, createdAt: customerNotes.createdAt, author: users.name })
      .from(customerNotes)
      .leftJoin(users, eq(users.id, customerNotes.authorId))
      .where(eq(customerNotes.customerId, c.id))
      .orderBy(desc(customerNotes.createdAt))
      .limit(100),
    db.select().from(consentRecords).where(eq(consentRecords.customerId, c.id)).orderBy(desc(consentRecords.capturedAt)).limit(100),
    db.select().from(followUpTasks).where(eq(followUpTasks.customerId, c.id)).orderBy(desc(followUpTasks.createdAt)).limit(100),
    db.select().from(appointments).where(eq(appointments.customerId, c.id)).orderBy(desc(appointments.createdAt)).limit(50),
    db.select().from(leadQualifications).where(eq(leadQualifications.customerId, c.id)).orderBy(desc(leadQualifications.createdAt)).limit(50),
  ]);

  const items: TimelineItem[] = [
    ...cl.map((x): TimelineItem => ({
      id: x.id,
      type: 'call',
      at: (x.startedAt ?? x.createdAt).toISOString(),
      title: `Outbound AI call${x.outcome ? ` — ${x.outcome.replace(/_/g, ' ').toLowerCase()}` : ''}`,
      detail: x.summary ?? x.errorMessage,
      status: x.status,
      demo: x.isDemo,
      href: `/calls/${x.id}`,
    })),
    ...ms.map((x): TimelineItem => ({
      id: x.id,
      type: 'message',
      at: x.createdAt.toISOString(),
      title: `${x.direction === 'INBOUND' ? 'Received' : 'Sent'} ${x.channel.toLowerCase()}${x.subject ? `: ${x.subject}` : ''}`,
      detail: x.status === 'FAILED' || x.status === 'BLOCKED' ? x.errorMessage : x.body.slice(0, 200),
      status: x.status,
      demo: x.isDemo,
    })),
    ...ns.map((x): TimelineItem => ({ id: x.id, type: 'note', at: x.createdAt.toISOString(), title: `Note by ${x.author ?? 'unknown'}`, detail: x.body })),
    ...cs.map((x): TimelineItem => ({
      id: x.id,
      type: 'consent',
      at: x.capturedAt.toISOString(),
      title: `Consent ${x.status.toLowerCase()} — ${x.channel.toLowerCase()}`,
      detail: [x.source, x.evidence].filter(Boolean).join(' · '),
      status: x.status,
    })),
    ...fs.map((x): TimelineItem => ({
      id: x.id,
      type: 'followup',
      at: x.scheduledFor.toISOString(),
      title: `Follow-up: ${(x.title ?? x.type).replace(/_/g, ' ').toLowerCase()}`,
      detail: x.lastError,
      status: x.status,
      demo: x.isDemo,
    })),
    ...ap.map((x): TimelineItem => ({
      id: x.id,
      type: 'appointment',
      at: (x.startsAt ?? x.createdAt).toISOString(),
      title: `Appointment: ${x.title}`,
      detail: x.requestedWindow,
      status: x.status,
      demo: x.isDemo,
    })),
    ...ql.map((x): TimelineItem => ({
      id: x.id,
      type: 'qualification',
      at: x.createdAt.toISOString(),
      title: `${x.source === 'HUMAN' ? 'Human review' : 'AI qualification'}: ${x.outcome.replace(/_/g, ' ').toLowerCase()} (score ${x.score})`,
      detail: x.reason,
      demo: x.isDemo,
    })),
  ];
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, 300) };
});
