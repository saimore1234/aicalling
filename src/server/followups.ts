import { and, asc, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  aiAgents, appointments, campaignLeads, campaigns, customers, followUpRules, followUpTasks, users,
} from '@/db/schema';
import { logger, sanitizeError } from '@/lib/logger';
import { enqueue } from './queues';
import { DeferredError, sendTemplateMessage } from './messaging';
import type { Outcome } from './qualification-schema';

type FollowUpTaskRow = typeof followUpTasks.$inferSelect;

/** Creates follow-up tasks for a call outcome from the configured rules. Idempotent per (call, rule). */
export async function planFollowUps(opts: {
  callId: string;
  customerId: string;
  campaignId: string | null;
  outcome: Outcome;
  callbackAt: Date | null;
  nextStep: string | null;
  meetingPreference: string | null;
  isDemo: boolean;
}) {
  const rules = await db.select().from(followUpRules).where(and(eq(followUpRules.outcome, opts.outcome), eq(followUpRules.active, true)));
  // Campaign-specific rules replace the global defaults for the same outcome.
  const campaignRules = rules.filter((r) => r.campaignId && r.campaignId === opts.campaignId);
  const effective = campaignRules.length ? campaignRules : rules.filter((r) => !r.campaignId);
  const now = Date.now();
  const created: string[] = [];

  for (const rule of effective) {
    let scheduledFor = new Date(now + rule.delayMinutes * 60_000);
    if (rule.action === 'SCHEDULE_CALLBACK' && opts.callbackAt) scheduledFor = opts.callbackAt;
    const [row] = await db
      .insert(followUpTasks)
      .values({
        customerId: opts.customerId,
        callId: opts.callId,
        campaignId: opts.campaignId,
        ruleId: rule.id,
        type: rule.action,
        templateId: rule.templateId,
        title: rule.name,
        scheduledFor,
        payload: {
          nextStep: opts.nextStep,
          meetingPreference: opts.meetingPreference,
          callbackAt: opts.callbackAt?.toISOString() ?? null,
          callbackNeedsConfirmation: rule.action === 'SCHEDULE_CALLBACK' && !opts.callbackAt,
        },
        idempotencyKey: `fu-${opts.callId}-${rule.id}`,
        isDemo: opts.isDemo,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      created.push(row.id);
      if (row.type !== 'TASK') {
        await enqueue('followups:process', { taskId: row.id }, { jobId: `followup-${row.id}`, delayMs: Math.max(0, scheduledFor.getTime() - now) });
      }
    }
  }
  return created;
}

async function claim(taskId: string): Promise<FollowUpTaskRow | null> {
  const [row] = await db
    .update(followUpTasks)
    .set({ status: 'PROCESSING', attempts: sql`${followUpTasks.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(followUpTasks.id, taskId), eq(followUpTasks.status, 'PENDING'), lte(followUpTasks.scheduledFor, new Date())))
    .returning();
  return row ?? null;
}

async function settle(taskId: string, patch: Partial<typeof followUpTasks.$inferInsert>) {
  await db.update(followUpTasks).set({ ...patch, updatedAt: new Date() }).where(eq(followUpTasks.id, taskId));
}

async function pickAssignee(customerId: string): Promise<string | null> {
  const [c] = await db.select({ ownerId: customers.ownerId }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (c?.ownerId) return c.ownerId;
  const execs = await db
    .select({ id: users.id, n: count(customers.id) })
    .from(users)
    .leftJoin(customers, and(eq(customers.ownerId, users.id), isNull(customers.deletedAt)))
    .where(and(eq(users.role, 'SALES_EXECUTIVE'), eq(users.active, true), isNull(users.deletedAt)))
    .groupBy(users.id)
    .orderBy(asc(count(customers.id)), asc(users.id))
    .limit(1);
  const pick = execs[0]?.id ?? null;
  if (pick) await db.update(customers).set({ ownerId: pick, updatedAt: new Date() }).where(and(eq(customers.id, customerId), isNull(customers.ownerId)));
  return pick;
}

const RETRY_BACKOFF_MIN = [5, 30, 120];

/** Executes one due follow-up task. Safe to call repeatedly: only one caller can claim a PENDING task. */
export async function processFollowUp(taskId: string): Promise<'done' | 'skipped' | 'deferred' | 'failed' | 'not_due'> {
  const task = await claim(taskId);
  if (!task) return 'not_due';

  try {
    switch (task.type) {
      case 'SEND_EMAIL':
      case 'SEND_SMS':
      case 'SEND_WHATSAPP': {
        if (!task.templateId) {
          await settle(task.id, { status: 'SKIPPED', lastError: 'No template configured for this rule.' });
          return 'skipped';
        }
        let companyName = '';
        if (task.campaignId) {
          const [row] = await db
            .select({ company: aiAgents.companyName, agent: aiAgents.name })
            .from(campaigns)
            .innerJoin(aiAgents, eq(aiAgents.id, campaigns.agentId))
            .where(eq(campaigns.id, task.campaignId))
            .limit(1);
          companyName = row?.company ?? '';
        }
        const res = await sendTemplateMessage({
          customerId: task.customerId,
          templateId: task.templateId,
          callId: task.callId,
          followUpTaskId: task.id,
          idempotencyKey: `fu-msg-${task.id}`,
          variables: { company_name: companyName },
        });
        if (res.sent) {
          await settle(task.id, { status: 'COMPLETED', completedAt: new Date(), resultMessageId: res.message.id, lastError: null });
          return 'done';
        }
        if (res.message.status === 'BLOCKED') {
          await settle(task.id, { status: 'SKIPPED', resultMessageId: res.message.id, lastError: res.message.errorMessage });
          return 'skipped';
        }
        if (res.retryable && task.attempts < task.maxAttempts) {
          return reschedule(task, res.message.errorMessage ?? 'Send failed');
        }
        await settle(task.id, { status: 'FAILED', resultMessageId: res.message.id, lastError: res.message.errorMessage ?? 'Send failed' });
        return 'failed';
      }
      case 'CREATE_APPOINTMENT': {
        const payload = task.payload as { meetingPreference?: string | null; nextStep?: string | null };
        const [cust] = await db.select().from(customers).where(eq(customers.id, task.customerId)).limit(1);
        const ownerId = await pickAssignee(task.customerId);
        const [appt] = await db
          .insert(appointments)
          .values({
            customerId: task.customerId,
            callId: task.callId,
            ownerId,
            status: 'REQUESTED',
            title: `Demo / meeting with ${cust?.name ?? 'customer'}`,
            requestedWindow: payload.meetingPreference ?? null,
            notes: payload.nextStep ?? null,
            isDemo: task.isDemo,
          })
          .returning();
        await settle(task.id, { status: 'COMPLETED', completedAt: new Date(), resultAppointmentId: appt!.id, assignedToId: ownerId });
        return 'done';
      }
      case 'SCHEDULE_CALLBACK': {
        const payload = task.payload as { callbackAt?: string | null; callbackNeedsConfirmation?: boolean };
        if (payload.callbackNeedsConfirmation || !task.campaignId) {
          // No concrete time (or no campaign to re-queue into): a person must confirm it.
          const assignee = await pickAssignee(task.customerId);
          await settle(task.id, {
            type: 'ASSIGN_HUMAN',
            status: 'PENDING',
            assignedToId: assignee,
            scheduledFor: new Date(),
            title: 'Confirm callback time with customer',
          });
          return 'done';
        }
        const when = payload.callbackAt ? new Date(payload.callbackAt) : new Date();
        const [camp] = await db.select({ m: campaigns.maxAttempts }).from(campaigns).where(eq(campaigns.id, task.campaignId)).limit(1);
        const maxAttempts = Math.max(0, (camp?.m ?? 1) - 1); // a requested callback always gets at least one more attempt
        const r = await db
          .update(campaignLeads)
          .set({ status: 'RETRY_WAIT', nextAttemptAt: when, skipReason: null, attempts: sql`least(${campaignLeads.attempts}, ${maxAttempts})`, updatedAt: new Date() })
          .where(and(eq(campaignLeads.campaignId, task.campaignId), eq(campaignLeads.customerId, task.customerId), inArray(campaignLeads.status, ['COMPLETED', 'RETRY_WAIT', 'PENDING'])))
          .returning({ id: campaignLeads.id });
        await settle(task.id, r.length
          ? { status: 'COMPLETED', completedAt: new Date() }
          : { status: 'SKIPPED', lastError: 'Customer is not in the campaign (or is already queued); no callback scheduled.' });
        return r.length ? 'done' : 'skipped';
      }
      case 'ASSIGN_HUMAN': {
        const assignee = await pickAssignee(task.customerId);
        // The task remains visible to humans as an open to-do until someone completes it.
        await settle(task.id, { status: 'COMPLETED', completedAt: new Date(), assignedToId: assignee });
        return 'done';
      }
      default:
        await settle(task.id, { status: 'PENDING' });
        return 'skipped';
    }
  } catch (err) {
    if (err instanceof DeferredError) {
      await db.update(followUpTasks).set({
        status: 'PENDING',
        attempts: sql`greatest(${followUpTasks.attempts} - 1, 0)`, // deferral is not an attempt
        scheduledFor: err.until ?? new Date(Date.now() + 15 * 60_000),
        lastError: `Deferred: ${err.reasonCode}`,
        updatedAt: new Date(),
      }).where(eq(followUpTasks.id, task.id));
      await enqueue('followups:process', { taskId: task.id }, { jobId: `followup-${task.id}-d${Date.now()}`, delayMs: Math.max(1000, (err.until?.getTime() ?? Date.now() + 15 * 60_000) - Date.now()) });
      return 'deferred';
    }
    logger.error({ taskId, err: sanitizeError(err) }, 'follow-up processing error');
    if (task.attempts < task.maxAttempts) return reschedule(task, sanitizeError(err));
    await settle(task.id, { status: 'FAILED', lastError: sanitizeError(err) });
    return 'failed';
  }
}

async function reschedule(task: FollowUpTaskRow, error: string): Promise<'deferred'> {
  const minutes = RETRY_BACKOFF_MIN[Math.min(task.attempts - 1, RETRY_BACKOFF_MIN.length - 1)]!;
  const at = new Date(Date.now() + minutes * 60_000);
  await settle(task.id, { status: 'PENDING', scheduledFor: at, lastError: error });
  await enqueue('followups:process', { taskId: task.id }, { jobId: `followup-${task.id}-r${task.attempts}`, delayMs: minutes * 60_000 });
  return 'deferred';
}

/** Safety net run by the worker: picks up due tasks whose delayed job was lost (Redis flush, crash). */
export async function enqueueDueFollowUps(limit = 100) {
  const due = await db
    .select({ id: followUpTasks.id })
    .from(followUpTasks)
    .where(and(eq(followUpTasks.status, 'PENDING'), lte(followUpTasks.scheduledFor, new Date()), or(sql`${followUpTasks.type} <> 'TASK'`)))
    .orderBy(asc(followUpTasks.scheduledFor))
    .limit(limit);
  for (const t of due) await enqueue('followups:process', { taskId: t.id }, { jobId: `followup-tick-${t.id}-${Math.floor(Date.now() / 60_000)}` });
  return due.length;
}
