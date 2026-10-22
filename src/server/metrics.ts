import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { AuthUser } from '@/lib/auth';

export type MetricFilters = { from: Date; to: Date; campaignId?: string; ownerId?: string; demo: 'true' | 'false' | 'all' };

/** Plain-language definitions shown next to every number so nobody has to guess what it counts. */
export const METRIC_DEFINITIONS = {
  callsPlaced: 'Calls that were handed to the telephony provider (or simulated in demo mode) in the period. Calls cancelled before dialling are excluded.',
  callsConnected: 'Placed calls that were answered by a person or voicemail (provider reported "in progress"). Not the same as a conversation.',
  connectRate: 'Connected ÷ placed.',
  avgDurationSeconds: 'Average length of connected calls, from answer to hang-up.',
  interested: 'Calls whose analysed outcome is INTERESTED, QUALIFIED or MEETING_REQUESTED.',
  qualified: 'Calls whose analysed outcome is QUALIFIED.',
  meetingsRequested: 'Appointments created from calls in the period (status REQUESTED or later, excluding cancelled).',
  conversionRate: 'Interested ÷ connected. This is interest, not sales: closed-won deals are tracked in the pipeline.',
  optOuts: 'Customers who asked not to be contacted (outcome DO_NOT_CONTACT) in the period.',
  failedCalls: 'Calls that ended FAILED (carrier/provider error or gateway failure).',
  messagesSent: 'Outbound messages accepted by the provider. "Sent" does not mean delivered.',
  messagesDelivered: 'Outbound messages for which the provider reported delivery. Email via SMTP can never report this.',
  messagesFailedOrBlocked: 'Outbound messages that failed at the provider or were blocked by compliance rules before sending.',
  cost: 'Provider-reported call cost summed per currency. Demo calls have no cost and are excluded.',
} as const;

export async function dashboardMetrics(user: AuthUser, f: MetricFilters) {
  const scope = user.role === 'ADMIN' ? sql`true` : sql`cu.owner_id = ${user.id}`;
  const owner = f.ownerId && user.role === 'ADMIN' ? sql`cu.owner_id = ${f.ownerId}` : sql`true`;
  const camp = f.campaignId ? sql`c.campaign_id = ${f.campaignId}` : sql`true`;
  const demoC = f.demo === 'all' ? sql`true` : sql`c.is_demo = ${f.demo === 'true'}`;

  const callWhere = sql`c.created_at >= ${f.from} and c.created_at < ${f.to} and ${scope} and ${owner} and ${camp} and ${demoC}`;

  const totals = await db.execute<Record<string, string | number | null>>(sql`
    select
      count(*) filter (where c.status not in ('QUEUED','CANCELED'))::int as placed,
      count(*) filter (where c.answered_at is not null)::int as connected,
      coalesce(avg(c.duration_seconds) filter (where c.answered_at is not null and c.duration_seconds is not null), 0)::float as avg_duration,
      count(*) filter (where c.outcome in ('INTERESTED','QUALIFIED','MEETING_REQUESTED'))::int as interested,
      count(*) filter (where c.outcome = 'QUALIFIED')::int as qualified,
      count(*) filter (where c.outcome = 'DO_NOT_CONTACT')::int as opt_outs,
      count(*) filter (where c.status = 'FAILED')::int as failed,
      count(*) filter (where c.is_demo)::int as demo_calls,
      count(*) filter (where not c.is_demo)::int as live_calls
    from calls c join customers cu on cu.id = c.customer_id
    where ${callWhere}`);

  const outcomes = await db.execute<{ outcome: string | null; n: number }>(sql`
    select coalesce(c.outcome::text, case when c.status in ('COMPLETED') then 'PENDING_ANALYSIS' else c.status::text end) as outcome, count(*)::int as n
    from calls c join customers cu on cu.id = c.customer_id
    where ${callWhere} and c.status not in ('QUEUED','CANCELED')
    group by 1 order by 2 desc`);

  const daily = await db.execute<{ day: string; placed: number; connected: number; interested: number }>(sql`
    select to_char(date_trunc('day', c.created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
      count(*) filter (where c.status not in ('QUEUED','CANCELED'))::int as placed,
      count(*) filter (where c.answered_at is not null)::int as connected,
      count(*) filter (where c.outcome in ('INTERESTED','QUALIFIED','MEETING_REQUESTED'))::int as interested
    from calls c join customers cu on cu.id = c.customer_id
    where ${callWhere} group by 1 order by 1`);

  const cost = user.role === 'ADMIN'
    ? await db.execute<{ currency: string; total: number }>(sql`
        select c.cost_currency as currency, sum(c.cost_amount)::float as total
        from calls c join customers cu on cu.id = c.customer_id
        where ${callWhere} and c.is_demo = false and c.cost_amount is not null group by 1`)
    : { rows: [] as { currency: string; total: number }[] };

  const msgDemo = f.demo === 'all' ? sql`true` : sql`m.is_demo = ${f.demo === 'true'}`;
  const msgs = await db.execute<{ sent: number; delivered: number; failed_or_blocked: number }>(sql`
    select
      count(*) filter (where m.status in ('SENT','DELIVERED','READ'))::int as sent,
      count(*) filter (where m.status in ('DELIVERED','READ'))::int as delivered,
      count(*) filter (where m.status in ('FAILED','BLOCKED'))::int as failed_or_blocked
    from messages m join customers cu on cu.id = m.customer_id
    where m.direction = 'OUTBOUND' and m.created_at >= ${f.from} and m.created_at < ${f.to} and ${scope} and ${owner} and ${msgDemo}`);

  const appts = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from appointments a join customers cu on cu.id = a.customer_id
    where a.created_at >= ${f.from} and a.created_at < ${f.to} and a.status <> 'CANCELED' and ${scope} and ${owner}
      and ${f.demo === 'all' ? sql`true` : sql`a.is_demo = ${f.demo === 'true'}`}`);

  const pipeline = await db.execute<{ key: string; name: string; position: number; n: number }>(sql`
    select s.key, s.name, s.position, count(cu.id)::int as n
    from pipeline_stages s left join customers cu on cu.stage_id = s.id and cu.deleted_at is null and cu.archived_at is null and ${scope} and ${owner}
      and ${f.demo === 'all' ? sql`true` : sql`cu.is_demo = ${f.demo === 'true'}`}
    where s.active group by s.id order by s.position`);

  const customerTotal = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from customers cu where cu.deleted_at is null and cu.archived_at is null and ${scope} and ${owner}
      and ${f.demo === 'all' ? sql`true` : sql`cu.is_demo = ${f.demo === 'true'}`}`);

  const t = totals.rows[0]!;
  const placed = Number(t.placed), connected = Number(t.connected), interested = Number(t.interested);
  const m = msgs.rows[0]!;
  return {
    filters: { from: f.from.toISOString(), to: f.to.toISOString(), campaignId: f.campaignId ?? null, ownerId: f.ownerId ?? null, demo: f.demo },
    includesDemoData: f.demo !== 'false' && Number(t.demo_calls) > 0,
    includesLiveData: f.demo !== 'true' && Number(t.live_calls) > 0,
    totals: {
      customers: customerTotal.rows[0]!.n,
      callsPlaced: placed,
      callsConnected: connected,
      connectRate: placed ? connected / placed : null,
      avgDurationSeconds: Math.round(Number(t.avg_duration)),
      interested,
      qualified: Number(t.qualified),
      meetingsRequested: appts.rows[0]!.n,
      conversionRate: connected ? interested / connected : null,
      optOuts: Number(t.opt_outs),
      failedCalls: Number(t.failed),
      messagesSent: m.sent,
      messagesDelivered: m.delivered,
      messagesFailedOrBlocked: m.failed_or_blocked,
    },
    cost: cost.rows,
    outcomes: outcomes.rows,
    daily: daily.rows,
    pipeline: pipeline.rows,
    definitions: METRIC_DEFINITIONS,
  };
}
