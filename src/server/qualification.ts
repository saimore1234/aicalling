import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  aiAgents, calls, campaignLeads, campaigns, customers, leadQualifications, pipelineStages, transcripts, followUpTasks,
} from '@/db/schema';
import { logger, sanitizeError } from '@/lib/logger';
import { getAnalysisProvider } from '@/providers';
import { applyOptOut } from './compliance';
import { QualificationSchema, type Qualification, type Outcome } from './qualification-schema';
import { planFollowUps } from './followups';

export type AnalysisResult =
  | { ok: true; qualification: Qualification; effectiveOutcome: Outcome; notes: string[] }
  | { ok: false; error: string };

/**
 * Business rules applied OVER the model's output. The model proposes; these rules decide.
 * Pure function so it can be unit-tested without a database.
 */
export function enforceBusinessRules(
  raw: Qualification,
  ctx: { transcript: string; now: Date },
): { outcome: Outcome; score: number; callbackAt: Date | null; evidence: string[]; notes: string[] } {
  const notes: string[] = [];
  let outcome: Outcome = raw.outcome;
  let score = raw.score;
  const hasCustomerSpeech = /^customer:/im.test(ctx.transcript);

  // Opt-out always wins, whatever else the model said.
  if (raw.opt_out_requested && outcome !== 'DO_NOT_CONTACT') {
    notes.push(`Outcome overridden ${outcome} → DO_NOT_CONTACT because the customer asked not to be contacted.`);
    outcome = 'DO_NOT_CONTACT';
  }
  if (outcome === 'DO_NOT_CONTACT') score = 0;

  // A human request escalates unless the customer opted out.
  if (raw.human_requested && !['DO_NOT_CONTACT', 'HUMAN_REQUIRED'].includes(outcome)) {
    notes.push(`Outcome overridden ${outcome} → HUMAN_REQUIRED because the customer asked for a person.`);
    outcome = 'HUMAN_REQUIRED';
  }

  // No customer speech means there is nothing to qualify.
  if (!hasCustomerSpeech && !['NO_ANSWER', 'DO_NOT_CONTACT'].includes(outcome)) {
    notes.push(`Outcome overridden ${outcome} → NO_ANSWER: the transcript contains no customer speech.`);
    outcome = 'NO_ANSWER';
    score = 0;
  }

  // Positive outcomes need evidence quoted from the call; otherwise downgrade to a human review rather than guess.
  const positive: Outcome[] = ['INTERESTED', 'QUALIFIED', 'MEETING_REQUESTED'];
  const lower = ctx.transcript.toLowerCase();
  const evidence = raw.evidence.filter((e) => e.trim() && lower.includes(e.trim().toLowerCase().slice(0, 40)));
  if (positive.includes(outcome) && evidence.length === 0) {
    notes.push(`Outcome ${outcome} downgraded to HUMAN_REQUIRED: no supporting quote could be found in the transcript.`);
    outcome = 'HUMAN_REQUIRED';
    score = Math.min(score, 40);
  }

  // Callback time must be a real future instant within a year.
  let callbackAt: Date | null = null;
  if (raw.callback_at) {
    const d = new Date(raw.callback_at);
    const max = new Date(ctx.now.getTime() + 365 * 24 * 3600 * 1000);
    if (d > ctx.now && d < max) callbackAt = d;
    else notes.push('callback_at was in the past or too far ahead and was ignored.');
  }
  if (outcome === 'CALLBACK_REQUESTED' && !callbackAt) notes.push('Callback requested without a usable time; a human will confirm it.');

  return { outcome, score: Math.max(0, Math.min(100, Math.round(score))), callbackAt, evidence, notes };
}

const STAGE_FOR: Partial<Record<Outcome, string>> = {
  INTERESTED: 'contacted',
  QUALIFIED: 'qualified',
  MEETING_REQUESTED: 'meeting_scheduled',
  CALLBACK_REQUESTED: 'contacted',
  NOT_INTERESTED: 'contacted',
  HUMAN_REQUIRED: 'contacted',
};

export async function transcriptText(callId: string): Promise<string> {
  const [t] = await db.select().from(transcripts).where(eq(transcripts.callId, callId)).limit(1);
  return t?.fullText ?? '';
}

/**
 * Analyse a finished call. Idempotent: a call that already has an AI qualification is not analysed twice.
 * Failures (provider error, invalid structured output) never invent an outcome — they raise a human task.
 */
export async function analyzeCall(callId: string): Promise<AnalysisResult & { skipped?: boolean }> {
  const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  if (!call) return { ok: false, error: 'Call not found' };
  const [existing] = await db.select({ id: leadQualifications.id }).from(leadQualifications)
    .where(and(eq(leadQualifications.callId, callId), eq(leadQualifications.source, 'AI'))).limit(1);
  if (existing) return { ok: false, error: 'already analysed', skipped: true };

  const text = await transcriptText(callId);
  const [customer] = await db.select().from(customers).where(eq(customers.id, call.customerId)).limit(1);
  const [agent] = await db.select().from(aiAgents).where(eq(aiAgents.id, call.agentId)).limit(1);
  if (!customer || !agent) return { ok: false, error: 'Missing customer or agent' };

  const mode = call.isDemo ? 'demo' : 'live';
  const now = new Date();
  let rawOutput: unknown;
  let model = '';
  try {
    const res = await getAnalysisProvider(mode).analyzeCall({
      model: agent.analysisModel,
      transcript: text,
      language: agent.language,
      customerName: customer.name,
      company: customer.company,
      nowIso: now.toISOString(),
      customerTimezone: customer.timezone,
      productContext: agent.productKnowledge.slice(0, 4000),
      qualificationQuestions: agent.qualificationQuestions,
    });
    rawOutput = res.output;
    model = res.model;
  } catch (err) {
    logger.warn({ callId, err: sanitizeError(err) }, 'call analysis provider failed');
    throw err; // worker retries; after final failure markAnalysisFailed() is called
  }

  const parsed = QualificationSchema.safeParse(rawOutput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    await markAnalysisFailed(callId, `AI output failed schema validation: ${msg}`, rawOutput);
    return { ok: false, error: msg };
  }

  const q = parsed.data;
  const rules = enforceBusinessRules(q, { transcript: text, now });
  const isDemo = call.isDemo;

  await db.transaction(async (tx) => {
    await tx.insert(leadQualifications).values({
      customerId: customer.id,
      callId,
      outcome: rules.outcome,
      score: rules.score,
      reason: q.reason,
      evidence: rules.evidence,
      interestLevel: q.interest_level,
      nextStep: q.next_step,
      callbackAt: rules.callbackAt,
      meetingPreference: q.meeting_preference,
      source: 'AI',
      aiModel: model,
      rawOutput: { ...q, _rules: rules.notes } as Record<string, unknown>,
      isDemo,
    });
    await tx.update(calls).set({ outcome: rules.outcome, summary: q.summary, analyzedAt: now }).where(eq(calls.id, callId));

    const stageKey = STAGE_FOR[rules.outcome];
    let stageId: string | undefined;
    if (stageKey) {
      const [st] = await tx.select({ id: pipelineStages.id }).from(pipelineStages).where(eq(pipelineStages.key, stageKey)).limit(1);
      stageId = st?.id;
    }
    // Never move a customer backwards out of Won/Lost/Proposal automatically.
    const [cur] = await tx
      .select({ key: pipelineStages.key })
      .from(customers)
      .leftJoin(pipelineStages, eq(pipelineStages.id, customers.stageId))
      .where(eq(customers.id, customer.id)).limit(1);
    const locked = cur?.key && ['proposal', 'won', 'lost'].includes(cur.key);
    await tx.update(customers).set({
      lastOutcome: rules.outcome,
      leadScore: rules.score,
      leadScoreReason: q.reason.slice(0, 500),
      lastContactedAt: call.answeredAt ?? call.endedAt ?? now,
      ...(stageId && !locked ? { stageId } : {}),
      updatedAt: now,
    }).where(eq(customers.id, customer.id));

    if (call.campaignLeadId) {
      if (rules.outcome === 'NO_ANSWER') {
        // Nobody actually spoke: treat as a missed attempt (retry if the campaign allows it).
        const [lead] = await tx.select().from(campaignLeads).where(eq(campaignLeads.id, call.campaignLeadId)).limit(1);
        const [camp] = call.campaignId ? await tx.select().from(campaigns).where(eq(campaigns.id, call.campaignId)).limit(1) : [];
        if (lead && camp) {
          const retry = camp.retryOutcomes.includes('NO_ANSWER') && lead.attempts < camp.maxAttempts;
          await tx.update(campaignLeads).set(retry
            ? { status: 'RETRY_WAIT', lastOutcome: 'NO_ANSWER', nextAttemptAt: new Date(now.getTime() + camp.minIntervalMinutes * 60_000), updatedAt: now }
            : { status: 'COMPLETED', lastOutcome: 'NO_ANSWER', updatedAt: now }).where(eq(campaignLeads.id, lead.id));
        }
      } else {
        await tx.update(campaignLeads).set({ status: 'COMPLETED', lastOutcome: rules.outcome, updatedAt: now }).where(eq(campaignLeads.id, call.campaignLeadId));
      }
    }
    if (rules.outcome === 'DO_NOT_CONTACT') {
      await applyOptOut({ customerId: customer.id, channels: 'ALL', source: isDemo ? 'DEMO call (analysis)' : 'Voice call', note: 'Customer asked not to be contacted during the call.' }, tx);
    }
    if (rules.outcome === 'WRONG_NUMBER') {
      await applyOptOut({ customerId: customer.id, channels: ['VOICE'], reason: 'WRONG_NUMBER', source: 'Voice call', note: 'Wrong number reported on call.' }, tx);
    }
  });

  await planFollowUps({ callId, customerId: customer.id, campaignId: call.campaignId, outcome: rules.outcome, callbackAt: rules.callbackAt, nextStep: q.next_step, meetingPreference: q.meeting_preference, isDemo });
  return { ok: true, qualification: q, effectiveOutcome: rules.outcome, notes: rules.notes };
}

export async function markAnalysisFailed(callId: string, error: string, rawOutput?: unknown) {
  const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  if (!call) return;
  logger.warn({ callId, error }, 'call analysis failed; flagging for human review');
  await db.update(calls).set({ analyzedAt: new Date(), summary: call.summary ?? 'Automatic analysis failed — please review the transcript.' }).where(eq(calls.id, callId));
  await db.insert(followUpTasks).values({
    customerId: call.customerId,
    callId,
    campaignId: call.campaignId,
    type: 'ASSIGN_HUMAN',
    title: 'Review call — automatic analysis failed',
    payload: { error: error.slice(0, 500), raw: rawOutput ? JSON.stringify(rawOutput).slice(0, 2000) : undefined },
    idempotencyKey: `analysis-failed-${callId}`,
    isDemo: call.isDemo,
  }).onConflictDoNothing();
}

export async function latestQualification(customerId: string) {
  const [q] = await db.select().from(leadQualifications).where(eq(leadQualifications.customerId, customerId)).orderBy(desc(leadQualifications.createdAt)).limit(1);
  return q ?? null;
}
