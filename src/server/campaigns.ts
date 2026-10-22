import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { notFound } from '@/lib/errors';
import { aiAgents, calls, campaignLeads, campaigns, countryPolicies, customers } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { logger, sanitizeError } from '@/lib/logger';
import { rateLimit } from '@/lib/ratelimit';
import { getAppSettings, updateAppSettings } from '@/lib/settings';
import { startOfDayInZone } from '@/lib/tz';
import { getTelephonyProvider, ProviderNotConfiguredError, ProviderError } from '@/providers';
import { agentIsLaunchable, validateAgent, type AgentProblem } from './agent-validation';
import { ACTIVE, addCallEvent, applyCallStatus } from './calls';
import { getCallEligibility } from './compliance';
import { customerWhere } from './customers';
import { enqueue } from './queues';
import { signToken } from '@/lib/crypto';
import type { AuthUser } from '@/lib/auth';

export type CampaignRow = typeof campaigns.$inferSelect;

export const segmentSchema = z
  .object({
    country: z.string().length(2).toUpperCase().optional(),
    stageId: z.string().uuid().optional(),
    ownerId: z.string().uuid().optional(),
    category: z.string().max(100).optional(),
    leadSource: z.string().max(100).optional(),
    product: z.string().max(200).optional(),
    customerIds: z.array(z.string().uuid()).max(5000).optional(),
  })
  .strict();
export type Segment = z.infer<typeof segmentSchema>;

const SYSTEM_ADMIN: AuthUser = { id: 'system', email: 'system', name: 'system', role: 'ADMIN', mustChangePassword: false };

/** Adds matching customers to the campaign queue. Existing members are untouched. Compliance is NOT decided here — it is re-checked at dial time. */
export async function populateLeads(campaign: CampaignRow): Promise<{ added: number }> {
  const seg = segmentSchema.parse(campaign.segmentFilter ?? {});
  const where = customerWhere(SYSTEM_ADMIN, { country: seg.country, stageId: seg.stageId, ownerId: seg.ownerId, category: seg.category, leadSource: seg.leadSource, product: seg.product });
  const conds = [where, sql`${customers.phone} is not null`, eq(customers.doNotCall, false), eq(customers.isDemo, campaign.isDemo)];
  if (seg.customerIds?.length) conds.push(inArray(customers.id, seg.customerIds));
  const rows = await db.select({ id: customers.id }).from(customers).where(and(...conds)).limit(50_000);
  let added = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => ({ campaignId: campaign.id, customerId: r.id }));
    const res = await db.insert(campaignLeads).values(chunk).onConflictDoNothing().returning({ id: campaignLeads.id });
    added += res.length;
  }
  return { added };
}

export type Readiness = { ready: boolean; problems: { field: string; message: string; severity: 'error' | 'warning' }[]; leadCount: number; mode: 'demo' | 'live' };

/** Everything that must be true before a campaign may dial. Errors block launch. */
export async function launchReadiness(campaign: CampaignRow): Promise<Readiness> {
  const problems: Readiness['problems'] = [];
  const err = (field: string, message: string) => problems.push({ field, message, severity: 'error' });
  const settings = await getAppSettings();
  const mode = settings.mode;

  if (settings.killSwitch) err('killSwitch', 'The emergency kill switch is ON. Release it under System health before starting campaigns.');
  if (campaign.isDemo && mode === 'live') err('mode', 'This is a DEMO campaign but the system is in LIVE mode. Create a new live campaign.');
  if (!campaign.isDemo && mode === 'demo') err('mode', 'This is a live campaign but the system is in DEMO mode. Switch to live mode in Integrations first — demo mode never places real calls.');

  const [agent] = await db.select().from(aiAgents).where(eq(aiAgents.id, campaign.agentId)).limit(1);
  if (!agent) err('agent', 'Select an AI agent.');
  else for (const p of validateAgent(agent) as AgentProblem[]) problems.push({ field: `agent.${p.field}`, message: p.message, severity: p.severity });

  if (!campaign.callWindows?.length) err('callWindows', 'Define at least one calling window.');
  if (campaign.maxConcurrent < 1) err('maxConcurrent', 'Maximum concurrent calls must be at least 1.');
  if (campaign.isTest && !campaign.testPhone) err('testPhone', 'A test campaign needs a test phone number (your own).');

  const [{ n: leadCount } = { n: 0 }] = await db.select({ n: count() }).from(campaignLeads).where(and(eq(campaignLeads.campaignId, campaign.id), inArray(campaignLeads.status, ['PENDING', 'RETRY_WAIT', 'QUEUED'])));
  if (leadCount === 0) err('leads', 'The campaign has no customers to call.');

  if (mode === 'live' && !campaign.isDemo) {
    const tel = getTelephonyProvider('live').status();
    if (!tel.configured) err('telephony', `Telephony is not configured. Missing: ${tel.missing.join(', ')}.`);
    if (!campaign.launchConfirmedAt) err('confirmation', 'A live campaign needs an explicit administrator launch confirmation.');
    const countryRows = await db
      .select({ country: customers.country })
      .from(campaignLeads)
      .innerJoin(customers, eq(customers.id, campaignLeads.customerId))
      .where(eq(campaignLeads.campaignId, campaign.id))
      .groupBy(customers.country);
    const policies = await db.select().from(countryPolicies);
    for (const { country } of countryRows) {
      if (!country) { err('compliance', 'Some customers have no country; they will be skipped until a country is set.'); continue; }
      const pol = policies.find((p) => p.countryCode === country);
      if (!pol) err('compliance', `No compliance policy for ${country}.`);
      else if (!pol.reviewed) err('compliance', `The ${country} compliance policy has not been reviewed by an administrator.`);
      else if (!pol.enabled) err('compliance', `Contact is disabled for ${country}.`);
    }
  }
  return { ready: !problems.some((p) => p.severity === 'error'), problems, leadCount, mode };
}

export async function hangupActiveCalls(where?: { campaignId?: string }): Promise<number> {
  const rows = await db.select().from(calls).where(and(inArray(calls.status, ACTIVE), where?.campaignId ? eq(calls.campaignId, where.campaignId) : undefined));
  let n = 0;
  for (const c of rows) {
    try {
      if (c.providerCallSid && !c.isDemo) await getTelephonyProvider('live').hangup(c.providerCallSid);
      await applyCallStatus(c.id, c.status === 'QUEUED' ? 'CANCELED' : c.status === 'IN_PROGRESS' ? 'COMPLETED' : 'CANCELED', { endReason: 'stopped_by_operator' });
      n++;
    } catch (err) {
      logger.error({ callId: c.id, err: sanitizeError(err) }, 'failed to hang up call during stop');
    }
  }
  return n;
}

/** Emergency stop: blocks all dialling instantly, pauses campaigns and hangs up live calls. */
export async function activateKillSwitch(reason: string, userId?: string | null) {
  await updateAppSettings({ killSwitch: true, killSwitchReason: reason }, userId);
  await db.update(campaigns).set({ status: 'PAUSED', stopReason: `Kill switch: ${reason}`, updatedAt: new Date() }).where(eq(campaigns.status, 'RUNNING'));
  await db.update(campaignLeads).set({ status: 'PENDING', updatedAt: new Date() }).where(eq(campaignLeads.status, 'QUEUED'));
  const hung = await hangupActiveCalls();
  return { hungUp: hung };
}

export async function releaseKillSwitch(userId?: string | null) {
  await updateAppSettings({ killSwitch: false, killSwitchReason: undefined }, userId);
}

/** Pick the next batch of leads for one campaign. Called from the worker tick. */
export async function tickCampaign(campaignId: string): Promise<{ queued: number; reason?: string }> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!c || c.status !== 'RUNNING' || c.deletedAt) return { queued: 0, reason: 'not running' };
  const settings = await getAppSettings();
  if (settings.killSwitch) return { queued: 0, reason: 'kill switch' };
  const mode = settings.mode;
  if ((mode === 'demo') !== c.isDemo) {
    await db.update(campaigns).set({ status: 'PAUSED', stopReason: 'System mode no longer matches this campaign (demo/live).', updatedAt: new Date() }).where(eq(campaigns.id, c.id));
    return { queued: 0, reason: 'mode mismatch' };
  }
  const now = new Date();
  if (c.startAt && c.startAt > now) return { queued: 0, reason: 'not started' };
  if (c.endAt && c.endAt < now) {
    await db.update(campaigns).set({ status: 'COMPLETED', stoppedAt: now, stopReason: 'End date reached', updatedAt: now }).where(eq(campaigns.id, c.id));
    await db.update(campaignLeads).set({ status: 'CANCELED', skipReason: 'Campaign ended', updatedAt: now }).where(and(eq(campaignLeads.campaignId, c.id), inArray(campaignLeads.status, ['PENDING', 'QUEUED', 'RETRY_WAIT'])));
    return { queued: 0, reason: 'ended' };
  }

  // Leads that have used all their attempts are finished, not waiting.
  await db.update(campaignLeads).set({ status: 'COMPLETED', updatedAt: now })
    .where(and(eq(campaignLeads.campaignId, c.id), inArray(campaignLeads.status, ['PENDING', 'RETRY_WAIT']), sql`${campaignLeads.attempts} >= ${c.maxAttempts}`, sql`(${campaignLeads.lastOutcome} is null or ${campaignLeads.lastOutcome}::text in ('NO_ANSWER','BUSY','FAILED'))`));

  const [{ n: active } = { n: 0 }] = await db.select({ n: count() }).from(calls).where(and(eq(calls.campaignId, c.id), inArray(calls.status, ACTIVE)));
  const [{ n: queuedLeads } = { n: 0 }] = await db.select({ n: count() }).from(campaignLeads).where(and(eq(campaignLeads.campaignId, c.id), eq(campaignLeads.status, 'QUEUED')));
  const [{ n: today } = { n: 0 }] = await db.select({ n: count() }).from(calls).where(and(eq(calls.campaignId, c.id), sql`${calls.createdAt} >= ${startOfDayInZone(now, settings.timezone)}`));
  const slots = Math.min(c.maxConcurrent - active - queuedLeads, c.dailyLimit - today - queuedLeads);

  if (slots > 0) {
    const picked = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; attempts: number }>(sql`
        select id, attempts from campaign_leads
        where campaign_id = ${c.id}
          and status in ('PENDING','RETRY_WAIT')
          and (next_attempt_at is null or next_attempt_at <= ${now})
        order by next_attempt_at asc nulls first, created_at asc
        limit ${slots}
        for update skip locked`);
      const ids = rows.rows.map((r) => r.id);
      if (ids.length) await tx.update(campaignLeads).set({ status: 'QUEUED', queuedAt: now, updatedAt: now }).where(inArray(campaignLeads.id, ids));
      return rows.rows;
    });
    for (const r of picked) {
      const attempt = r.attempts + 1;
      const res = await enqueue('calls:place-call', { campaignLeadId: r.id, attempt }, { jobId: `place-${r.id}-${attempt}`, attempts: 3 });
      if (!res.queued) await db.update(campaignLeads).set({ status: 'PENDING', queuedAt: null }).where(eq(campaignLeads.id, r.id));
    }
    if (picked.length) return { queued: picked.length };
  }

  // Completed when nothing is left to do and nothing is in flight.
  const [{ n: open } = { n: 0 }] = await db.select({ n: count() }).from(campaignLeads).where(and(eq(campaignLeads.campaignId, c.id), inArray(campaignLeads.status, ['PENDING', 'QUEUED', 'IN_PROGRESS', 'RETRY_WAIT'])));
  if (open === 0 && active === 0) {
    await db.update(campaigns).set({ status: 'COMPLETED', stoppedAt: now, stopReason: 'All leads processed', updatedAt: now }).where(eq(campaigns.id, c.id));
  }
  return { queued: 0, reason: slots <= 0 ? 'at capacity' : 'nothing due' };
}

export async function tickAllCampaigns() {
  const running = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.status, 'RUNNING'), isNull(campaigns.deletedAt)));
  let queued = 0;
  for (const r of running) queued += (await tickCampaign(r.id)).queued;
  return { campaigns: running.length, queued };
}

function setLead(id: string, patch: Partial<typeof campaignLeads.$inferInsert>) {
  return db.update(campaignLeads).set({ ...patch, updatedAt: new Date() }).where(eq(campaignLeads.id, id));
}

export type PlaceResult = { status: 'placed' | 'skipped' | 'deferred' | 'blocked' | 'failed'; callId?: string; detail?: string };

/**
 * Dial one lead. Every safety condition is re-checked here, immediately before dialling, so a campaign paused,
 * a kill switch flipped, or a consent withdrawn after queueing is always honoured. Fails closed.
 */
export async function placeCallForLead(campaignLeadId: string, attempt: number): Promise<PlaceResult> {
  const [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.id, campaignLeadId)).limit(1);
  if (!lead || lead.status !== 'QUEUED') return { status: 'skipped', detail: 'lead not queued' };
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, lead.campaignId)).limit(1);
  if (!c || c.status !== 'RUNNING') {
    await setLead(lead.id, { status: 'PENDING', queuedAt: null });
    return { status: 'skipped', detail: 'campaign not running' };
  }
  const settings = await getAppSettings();
  if (settings.killSwitch) {
    await setLead(lead.id, { status: 'PENDING', queuedAt: null });
    return { status: 'blocked', detail: 'kill switch' };
  }
  const mode = settings.mode;
  if ((mode === 'demo') !== c.isDemo) {
    await setLead(lead.id, { status: 'PENDING', queuedAt: null });
    return { status: 'blocked', detail: 'mode mismatch' };
  }
  const [agent] = await db.select().from(aiAgents).where(eq(aiAgents.id, c.agentId)).limit(1);
  if (!agent || !agentIsLaunchable(validateAgent(agent))) {
    await db.update(campaigns).set({ status: 'PAUSED', stopReason: 'The AI agent is invalid or inactive.', updatedAt: new Date() }).where(eq(campaigns.id, c.id));
    await setLead(lead.id, { status: 'PENDING', queuedAt: null });
    return { status: 'blocked', detail: 'agent invalid' };
  }

  const elig = await getCallEligibility({ customerId: lead.customerId, callWindows: c.callWindows, fallbackTimezone: c.fallbackTimezone, mode });
  if (!elig.eligible) {
    if (elig.blocked.length === 0 && elig.deferUntil !== undefined) {
      await setLead(lead.id, { status: 'RETRY_WAIT', nextAttemptAt: elig.deferUntil ?? new Date(Date.now() + 3600_000), queuedAt: null, skipReason: null });
      return { status: 'deferred', detail: 'outside permitted hours' };
    }
    const reason = elig.blocked.map((b) => b.message).join(' ');
    await setLead(lead.id, { status: 'SKIPPED', skipReason: reason.slice(0, 500), queuedAt: null });
    return { status: 'blocked', detail: elig.blocked[0]?.code };
  }

  const rl = await rateLimit({ key: 'calls:global', limit: settings.rateLimits.callsPerMinute, windowSec: 60 });
  if (!rl.allowed) {
    await enqueue('calls:place-call', { campaignLeadId, attempt }, { jobId: `place-${lead.id}-${attempt}-rl${Math.floor(Date.now() / 1000)}`, delayMs: rl.retryAfter * 1000 });
    return { status: 'deferred', detail: 'rate limited' };
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, lead.customerId)).limit(1);
  const to = c.isTest && c.testPhone ? c.testPhone : customer!.phone!;
  const key = `call-${lead.id}-${attempt}`;
  const inserted = await db
    .insert(calls)
    .values({
      campaignId: c.id, campaignLeadId: lead.id, customerId: lead.customerId, agentId: agent.id,
      provider: mode === 'demo' ? 'demo' : 'twilio', idempotencyKey: key, status: 'QUEUED', toNumber: to,
      attemptNumber: attempt, isTest: c.isTest, isDemo: mode === 'demo',
    })
    .onConflictDoNothing()
    .returning();
  let call = inserted[0];
  if (!call) {
    // Retried job: the call row already exists. Never create or dial a second one.
    const [existing] = await db.select().from(calls).where(eq(calls.idempotencyKey, key)).limit(1);
    if (existing && (existing.providerCallSid || existing.status !== 'QUEUED')) return { status: 'skipped', callId: existing.id, detail: 'already placed' };
    call = existing!;
  }

  await db.update(campaignLeads).set({ status: 'IN_PROGRESS', attempts: attempt, lastAttemptAt: new Date(), queuedAt: null, nextAttemptAt: null, updatedAt: new Date() }).where(eq(campaignLeads.id, lead.id));
  await addCallEvent(call.id, mode === 'demo' ? 'DEMO_queued' : 'queued', 'QUEUED', { attempt, demo: mode === 'demo' });

  const provider = getTelephonyProvider(mode);
  const env = getEnv();
  try {
    const base = (env.APP_URL ?? '').replace(/\/$/, '');
    const res = await provider.placeCall({
      callId: call.id,
      to,
      voiceUrl: `${base}/api/webhooks/twilio/voice?callId=${call.id}`,
      statusCallbackUrl: `${base}/api/webhooks/twilio/status?callId=${call.id}`,
      ringTimeoutSeconds: 30,
      maxDurationSeconds: agent.maxCallSeconds + 30,
    });
    await db.update(calls).set({ providerCallSid: res.providerCallId, fromNumber: mode === 'live' ? env.TWILIO_VOICE_FROM ?? null : 'DEMO' }).where(eq(calls.id, call.id));
    if (mode === 'demo') await enqueue('calls:demo-simulate', { callId: call.id }, { jobId: `demo-sim-${call.id}` });
    else await applyCallStatus(call.id, 'INITIATED', { payload: { providerStatus: res.initialStatus } });
    return { status: 'placed', callId: call.id };
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      await applyCallStatus(call.id, 'FAILED', { errorCode: 'NOT_CONFIGURED', errorMessage: `Telephony not configured: ${err.missing.join(', ')}` });
      await db.update(campaigns).set({ status: 'PAUSED', stopReason: `Telephony not configured (${err.missing.join(', ')}).`, updatedAt: new Date() }).where(eq(campaigns.id, c.id));
      return { status: 'failed', callId: call.id, detail: 'not configured' };
    }
    if (err instanceof ProviderError && err.retryable) throw err; // BullMQ retries the same idempotent job
    await applyCallStatus(call.id, 'FAILED', { errorCode: err instanceof ProviderError ? err.opts.code ?? 'PROVIDER_ERROR' : 'PLACE_ERROR', errorMessage: sanitizeError(err) });
    return { status: 'failed', callId: call.id, detail: sanitizeError(err) };
  }
}

/** Signed token that authorises the voice gateway to run exactly this call. */
export function createStreamToken(callId: string, ttlSec = 3600) {
  return signToken({ callId, purpose: 'media-stream' }, ttlSec);
}

export async function loadCampaign(id: string): Promise<CampaignRow> {
  const [c] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), isNull(campaigns.deletedAt))).limit(1);
  if (!c) throw notFound('Campaign not found');
  return c;
}
