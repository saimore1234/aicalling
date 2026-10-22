import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { callEvents, calls, campaignLeads, campaigns, transcripts, type TranscriptSegment } from '@/db/schema';
import { logger } from '@/lib/logger';
import { enqueue } from './queues';

export type CallRow = typeof calls.$inferSelect;
type CallStatus = CallRow['status'];

/** Twilio call status → our status. */
export function mapProviderStatus(s: string): CallStatus | null {
  switch (s.toLowerCase()) {
    case 'queued': return 'QUEUED';
    case 'initiated': return 'INITIATED';
    case 'ringing': return 'RINGING';
    case 'in-progress': case 'answered': return 'IN_PROGRESS';
    case 'completed': return 'COMPLETED';
    case 'busy': return 'BUSY';
    case 'no-answer': return 'NO_ANSWER';
    case 'failed': return 'FAILED';
    case 'canceled': return 'CANCELED';
    default: return null;
  }
}

const RANK: Record<CallStatus, number> = {
  QUEUED: 0, INITIATED: 1, RINGING: 2, IN_PROGRESS: 3, COMPLETED: 9, BUSY: 9, NO_ANSWER: 9, FAILED: 9, CANCELED: 9,
};
export const TERMINAL: CallStatus[] = ['COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED'];
export const ACTIVE: CallStatus[] = ['QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS'];
export const isTerminal = (s: CallStatus) => TERMINAL.includes(s);

/** Status never moves backwards and a terminal status is final — late or duplicated webhooks cannot regress a call. */
export function canTransition(from: CallStatus, to: CallStatus): boolean {
  if (isTerminal(from)) return false;
  return RANK[to] >= RANK[from] && from !== to;
}

export async function addCallEvent(callId: string, type: string, status: string | null, payload: Record<string, unknown> = {}, occurredAt = new Date()) {
  await db.insert(callEvents).values({ callId, type, status, payload, occurredAt });
}

export async function applyCallStatus(
  callId: string,
  to: CallStatus,
  extra: { durationSeconds?: number; at?: Date; errorCode?: string; errorMessage?: string; endReason?: string; payload?: Record<string, unknown> } = {},
): Promise<{ changed: boolean; call: CallRow | null }> {
  const at = extra.at ?? new Date();
  const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  if (!call) return { changed: false, call: null };
  await addCallEvent(callId, call.isDemo ? 'DEMO_status' : 'status', to, { ...(extra.payload ?? {}), ...(call.isDemo ? { demo: true } : {}) }, at);
  if (!canTransition(call.status, to)) return { changed: false, call };

  const patch: Partial<typeof calls.$inferInsert> = { status: to };
  if (to === 'INITIATED' && !call.startedAt) patch.startedAt = at;
  if (to === 'IN_PROGRESS' && !call.answeredAt) patch.answeredAt = at;
  if (isTerminal(to)) {
    patch.endedAt = at;
    if (extra.durationSeconds !== undefined) patch.durationSeconds = extra.durationSeconds;
    else if (call.answeredAt) patch.durationSeconds = Math.max(0, Math.round((at.getTime() - call.answeredAt.getTime()) / 1000));
    if (to === 'NO_ANSWER') patch.outcome = 'NO_ANSWER';
    if (to === 'BUSY') patch.outcome = 'BUSY';
    if (to === 'FAILED') patch.outcome = 'FAILED';
    if (extra.errorCode) patch.errorCode = extra.errorCode;
    if (extra.errorMessage) patch.errorMessage = extra.errorMessage;
    if (extra.endReason) patch.endReason = extra.endReason;
  }
  // Compare-and-set on the previous status so two concurrent webhooks cannot both "win".
  const [updated] = await db.update(calls).set(patch).where(and(eq(calls.id, callId), eq(calls.status, call.status))).returning();
  if (!updated) return { changed: false, call };
  if (isTerminal(to)) await onCallEnded(updated);
  return { changed: true, call: updated };
}

/** After an unsuccessful attempt: schedule a retry if the campaign allows it, otherwise finish the lead. */
export async function settleLeadAfterMiss(
  campaign: typeof campaigns.$inferSelect,
  lead: typeof campaignLeads.$inferSelect,
  outcome: 'NO_ANSWER' | 'BUSY' | 'FAILED',
  opts: { hardFail?: boolean; canceled?: boolean; failed?: boolean } = {},
) {
  const retryable = !opts.hardFail && campaign.retryOutcomes.includes(outcome);
  const canRetry = retryable && lead.attempts < campaign.maxAttempts && !opts.canceled;
  await db.update(campaignLeads).set(
    canRetry
      ? { status: 'RETRY_WAIT', lastOutcome: outcome, nextAttemptAt: new Date(Date.now() + campaign.minIntervalMinutes * 60_000), updatedAt: new Date() }
      : { status: opts.canceled ? 'CANCELED' : opts.failed ? 'FAILED' : 'COMPLETED', lastOutcome: outcome, updatedAt: new Date() },
  ).where(eq(campaignLeads.id, lead.id));
}

/** Lead bookkeeping + post-call jobs after a call reaches a terminal state. */
export async function onCallEnded(call: CallRow) {
  if (call.campaignLeadId && call.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, call.campaignId)).limit(1);
    const [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.id, call.campaignLeadId)).limit(1);
    if (campaign && lead) {
      if (call.status === 'COMPLETED' && call.answeredAt) {
        // Analysis decides the final lead state. Mark in-flight until then so it is not re-dialled.
        await db.update(campaignLeads).set({ status: 'IN_PROGRESS', updatedAt: new Date() }).where(eq(campaignLeads.id, lead.id));
      } else {
        const outcome = call.status === 'BUSY' ? 'BUSY' : call.status === 'NO_ANSWER' ? 'NO_ANSWER' : call.status === 'COMPLETED' ? 'NO_ANSWER' : 'FAILED';
        await settleLeadAfterMiss(campaign, lead, outcome, { hardFail: call.status === 'FAILED' && call.errorCode === 'NOT_CONFIGURED', canceled: call.status === 'CANCELED', failed: call.status === 'FAILED' });
      }
    }
  }
  if (call.status === 'COMPLETED' && call.answeredAt) {
    await enqueue('postcall:analyze-call', { callId: call.id }, { jobId: `analyze-${call.id}`, delayMs: call.isDemo ? 0 : 3000 });
  }
  if (!call.isDemo && call.providerCallSid) {
    await enqueue('postcall:fetch-cost', { callId: call.id }, { jobId: `cost-${call.id}`, delayMs: 60_000, attempts: 5 });
  }
  logger.info({ callId: call.id, status: call.status, demo: call.isDemo }, 'call ended');
}

export async function saveTranscript(callId: string, segments: TranscriptSegment[], opts: { language?: string; isDemo: boolean }) {
  const fullText = segments.map((s) => `${s.role === 'agent' ? 'Agent' : s.role === 'customer' ? 'Customer' : 'System'}: ${s.text}`).join('\n');
  await db
    .insert(transcripts)
    .values({ callId, segments, fullText, language: opts.language ?? null, isDemo: opts.isDemo })
    .onConflictDoUpdate({ target: transcripts.callId, set: { segments, fullText, language: opts.language ?? null } });
  await db.update(calls).set({ transcriptSaved: true }).where(eq(calls.id, callId));
}

export async function getCallByProviderSid(sid: string) {
  const [c] = await db.select().from(calls).where(eq(calls.providerCallSid, sid)).limit(1);
  return c ?? null;
}
