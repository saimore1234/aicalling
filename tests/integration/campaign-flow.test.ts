import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  appointments, callEvents, calls, campaignLeads, campaigns, consentRecords, countryPolicies, customers, followUpTasks, leadQualifications, messages, suppressionRecords, transcripts,
} from '@/db/schema';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createCampaign } from '@/app/api/campaigns/route';
import { GET as readinessGet } from '@/app/api/campaigns/[id]/readiness/route';
import { POST as startCampaign } from '@/app/api/campaigns/[id]/start/route';
import { POST as pauseCampaign } from '@/app/api/campaigns/[id]/pause/route';
import { POST as stopCampaign } from '@/app/api/campaigns/[id]/stop/route';
import { POST as killOn, DELETE as killOff } from '@/app/api/system/kill-switch/route';
import { GET as listCalls } from '@/app/api/calls/route';
import { GET as getCall } from '@/app/api/calls/[id]/route';
import { PATCH as patchSettings } from '@/app/api/system/settings/route';
import { placeCallForLead, tickCampaign } from '@/server/campaigns';
import { simulateDemoCall, SCENARIOS } from '@/server/demo-sim';
import { analyzeCall } from '@/server/qualification';
import { processFollowUp } from '@/server/followups';
import { setProviderOverrides } from '@/providers';
import { STARTER_AGENT } from '@/server/agent-validation';
import { adminSession, params, req, resetDb, salesSession, shutdown } from '../helpers';

beforeEach(async () => {
  await resetDb();
  // Make "now" always inside the legal window so tests do not depend on the time of day.
  await db.update(countryPolicies).set({ callWindowStart: '00:00', callWindowEnd: '23:59', allowedWeekdays: [1, 2, 3, 4, 5, 6, 7] });
});
afterAll(shutdown);

const goodAgent = {
  ...STARTER_AGENT,
  companyName: 'Acme Solar',
  greeting: "Hello, I'm an AI sales assistant calling on behalf of Acme Solar. This call may be transcribed. Is now a good time?",
  productKnowledge: 'Acme Solar sells rooftop solar panels for homes and small businesses, with free site surveys and a 25-year panel warranty.',
};

let phoneSeq = 0;
async function addCustomer(over: Partial<typeof customers.$inferInsert> = {}, consent: 'GRANTED' | 'WITHDRAWN' | 'NONE' = 'GRANTED') {
  const [c] = await db.insert(customers).values({
    name: over.name ?? `Customer ${++phoneSeq}`,
    phone: over.phone ?? `+9198${String(10000000 + phoneSeq * 7).slice(0, 8)}`,
    email: over.email ?? `c${phoneSeq}@example.com`,
    country: 'IN', timezone: 'Asia/Kolkata', isDemo: true, productInterest: 'Solar', ...over,
  }).returning();
  if (consent !== 'NONE') await db.insert(consentRecords).values([{ customerId: c!.id, channel: 'VOICE', status: consent, source: 'test' }, { customerId: c!.id, channel: 'EMAIL', status: consent, source: 'test' }]);
  return c!;
}

async function setup(opts: { agent?: object } = {}) {
  const { cookie } = await adminSession();
  const ar = await createAgent(req('/api/agents', { body: { ...goodAgent, ...opts.agent }, cookie }));
  const agent = (await ar.json()).agent;
  return { cookie, agent };
}
async function makeCampaign(cookie: string, agentId: string, over: object = {}) {
  const res = await createCampaign(req('/api/campaigns', {
    cookie,
    body: { name: 'Test campaign', agentId, callWindows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' }], maxConcurrent: 5, ...over },
  }));
  expect(res.status).toBe(201);
  return (await res.json()).campaign as typeof campaigns.$inferSelect;
}
const start = (cookie: string, id: string) => startCampaign(req(`/api/campaigns/${id}/start`, { method: 'POST', body: {}, cookie }), params({ id }));

/** Drive the pipeline by hand (what the worker does), without BullMQ. */
async function runPipeline(campaignId: string) {
  const t = await tickCampaign(campaignId);
  const leads = await db.select().from(campaignLeads).where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.status, 'QUEUED')));
  const placed = [];
  for (const l of leads) placed.push(await placeCallForLead(l.id, l.attempts + 1));
  const rows = await db.select().from(calls).where(eq(calls.campaignId, campaignId));
  for (const c of rows) if (c.status === 'QUEUED' || c.status === 'INITIATED') await simulateDemoCall(c.id);
  const done = await db.select().from(calls).where(eq(calls.campaignId, campaignId));
  for (const c of done) if (c.status === 'COMPLETED' && !c.analyzedAt) await analyzeCall(c.id);
  return { tick: t, placed };
}

describe('agent validation', () => {
  it('blocks launch when the greeting does not disclose AI', async () => {
    const { cookie, agent } = await setup({ agent: { greeting: 'Hello, this is Priya from Acme Solar, how are you today?' } });
    await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    const r = await (await readinessGet(req(`/api/campaigns/${c.id}/readiness`, { cookie }), params({ id: c.id }))).json();
    expect(r.ready).toBe(false);
    expect(JSON.stringify(r.problems)).toMatch(/AI assistant/);
    const res = await start(cookie, c.id);
    expect(res.status).toBe(422);
  });
  it('blocks launch for a placeholder company and missing product knowledge', async () => {
    const { cookie, agent } = await setup({ agent: { companyName: 'Your Company', productKnowledge: '' } });
    await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    const r = await (await readinessGet(req(`/api/campaigns/${c.id}/readiness`, { cookie }), params({ id: c.id }))).json();
    expect(r.problems.map((p: { field: string }) => p.field)).toEqual(expect.arrayContaining(['agent.companyName', 'agent.productKnowledge']));
  });
  it('requires admin', async () => {
    const { cookie } = await salesSession();
    const res = await createAgent(req('/api/agents', { body: goodAgent, cookie }));
    expect(res.status).toBe(403);
  });
});

describe('demo campaign end to end', () => {
  it('runs calls → transcripts → qualification → follow-ups, all labelled DEMO', async () => {
    const { cookie, agent } = await setup();
    for (let i = 0; i < 8; i++) await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    expect(c.isDemo).toBe(true);
    expect((await start(cookie, c.id)).status).toBe(200);

    await runPipeline(c.id);
    const all = await db.select().from(calls).where(eq(calls.campaignId, c.id));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((x) => x.isDemo && x.provider === 'demo')).toBe(true);

    const events = await db.select().from(callEvents);
    expect(events.every((e) => !e.type.includes('status') || e.type.startsWith('DEMO_'))).toBe(true);

    const completed = all.filter((x) => x.status === 'COMPLETED');
    for (const x of completed) {
      expect(x.analyzedAt).not.toBeNull();
      expect(x.outcome).not.toBeNull();
      const [t] = await db.select().from(transcripts).where(eq(transcripts.callId, x.id));
      expect(t?.isDemo).toBe(true);
      expect(t?.fullText).toContain('[DEMO]');
    }
    const quals = await db.select().from(leadQualifications);
    expect(quals.every((q) => q.isDemo && q.score >= 0 && q.score <= 100)).toBe(true);
  });

  it('applies follow-up rules: email for interested, appointment for meeting, opt-out for DNC', async () => {
    const { cookie, agent } = await setup();
    // Build one customer per interesting scenario by searching for ids that hash to it.
    const want = ['interested', 'meeting', 'dnc'];
    const made: Record<string, typeof customers.$inferSelect> = {};
    const { pickScenario } = await import('@/server/demo-sim');
    for (let i = 0; i < 400 && Object.keys(made).length < want.length; i++) {
      const c = await addCustomer();
      const sc = pickScenario(c.id, 1).key;
      if (want.includes(sc) && !made[sc]) made[sc] = c;
    }
    expect(Object.keys(made).sort()).toEqual([...want].sort());
    const camp = await makeCampaign(cookie, agent.id, { segmentFilter: { customerIds: Object.values(made).map((c) => c.id) } });
    await start(cookie, camp.id);
    await runPipeline(camp.id);

    // Make every pending follow-up due now and process it.
    await db.update(followUpTasks).set({ scheduledFor: new Date(Date.now() - 1000) });
    const tasks = await db.select().from(followUpTasks);
    for (const t of tasks) await processFollowUp(t.id);

    const byCustomer = async (id: string) => db.select().from(followUpTasks).where(eq(followUpTasks.customerId, id));
    const interested = await byCustomer(made.interested!.id);
    expect(interested.some((t) => t.type === 'SEND_EMAIL' && t.status === 'COMPLETED')).toBe(true);
    const mails = await db.select().from(messages).where(eq(messages.customerId, made.interested!.id));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.isDemo).toBe(true);
    expect(mails[0]!.body).toContain('Acme Solar'); // company_name variable resolved from the agent

    const meeting = await byCustomer(made.meeting!.id);
    expect(meeting.some((t) => t.type === 'CREATE_APPOINTMENT' && t.status === 'COMPLETED')).toBe(true);
    expect((await db.select().from(appointments).where(eq(appointments.customerId, made.meeting!.id))).length).toBe(1);

    const [dnc] = await db.select().from(customers).where(eq(customers.id, made.dnc!.id));
    expect(dnc!.doNotCall).toBe(true);
    expect((await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, made.dnc!.id))).length).toBeGreaterThan(0);
    // Nothing is sent to someone who opted out.
    expect((await db.select().from(messages).where(eq(messages.customerId, made.dnc!.id))).length).toBe(0);
  });

  it('is idempotent: placing the same attempt twice creates one call', async () => {
    const { cookie, agent } = await setup();
    await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    await start(cookie, c.id);
    await tickCampaign(c.id);
    const [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.id));
    const first = await placeCallForLead(lead!.id, 1);
    const second = await placeCallForLead(lead!.id, 1);
    expect(first.status).toBe('placed');
    expect(second.status).toBe('skipped');
    expect(await db.select().from(calls).where(eq(calls.campaignId, c.id))).toHaveLength(1);
  });

  it('respects the concurrency limit', async () => {
    const { cookie, agent } = await setup();
    for (let i = 0; i < 6; i++) await addCustomer();
    const c = await makeCampaign(cookie, agent.id, { maxConcurrent: 2 });
    await start(cookie, c.id);
    const r = await tickCampaign(c.id);
    expect(r.queued).toBe(2);
    expect((await tickCampaign(c.id)).queued).toBe(0); // still 2 queued → no free slots
  });
});

describe('safety controls', () => {
  it('kill switch stops dialling immediately and pauses campaigns', async () => {
    const { cookie, agent } = await setup();
    for (let i = 0; i < 3; i++) await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    await start(cookie, c.id);
    await tickCampaign(c.id);
    const queued = await db.select().from(campaignLeads).where(eq(campaignLeads.status, 'QUEUED'));
    expect(queued.length).toBeGreaterThan(0);

    const res = await killOn(req('/api/system/kill-switch', { body: { reason: 'test stop' }, cookie }));
    expect(res.status).toBe(200);
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(camp!.status).toBe('PAUSED');
    for (const l of queued) expect((await placeCallForLead(l.id, 1)).status).not.toBe('placed');
    expect(await db.select().from(calls)).toHaveLength(0);
    // And a campaign cannot be started while it is on.
    expect((await start(cookie, c.id)).status).toBe(422);
    expect((await killOff(req('/api/system/kill-switch', { method: 'DELETE', cookie }))).status).toBe(200);
    expect((await start(cookie, c.id)).status).toBe(200);
  });

  it('pausing prevents already-queued leads from being dialled', async () => {
    const { cookie, agent } = await setup();
    await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    await start(cookie, c.id);
    await tickCampaign(c.id);
    const [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.id));
    await pauseCampaign(req(`/api/campaigns/${c.id}/pause`, { method: 'POST', body: {}, cookie }), params({ id: c.id }));
    const r = await placeCallForLead(lead!.id, 1);
    expect(r.status).not.toBe('placed');
    expect(await db.select().from(calls)).toHaveLength(0);
  });

  it('stop cancels remaining leads', async () => {
    const { cookie, agent } = await setup();
    for (let i = 0; i < 3; i++) await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    await start(cookie, c.id);
    const res = await stopCampaign(req(`/api/campaigns/${c.id}/stop`, { method: 'POST', body: {}, cookie }), params({ id: c.id }));
    expect(res.status).toBe(200);
    const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.id));
    expect(leads.every((l) => l.status === 'CANCELED')).toBe(true);
  });

  it('skips a customer whose consent was withdrawn after queueing', async () => {
    const { cookie, agent } = await setup();
    const cust = await addCustomer();
    const c = await makeCampaign(cookie, agent.id);
    await start(cookie, c.id);
    await tickCampaign(c.id);
    await db.insert(consentRecords).values({ customerId: cust.id, channel: 'VOICE', status: 'WITHDRAWN', source: 'test' });
    const [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.id));
    const r = await placeCallForLead(lead!.id, 1);
    expect(r.status).toBe('blocked');
    expect(await db.select().from(calls)).toHaveLength(0);
    const [after] = await db.select().from(campaignLeads).where(eq(campaignLeads.id, lead!.id));
    expect(after!.status).toBe('SKIPPED');
  });

  it('never silently falls back from live to demo: a demo campaign will not run in live mode', async () => {
    const { cookie, agent } = await setup();
    await addCustomer();
    const c = await makeCampaign(cookie, agent.id); // created in demo mode → isDemo
    const bad = await patchSettings(req('/api/system/settings', { method: 'PATCH', body: { mode: 'live' }, cookie }));
    expect(bad.status).toBe(400); // needs typed confirmation
    const ok = await patchSettings(req('/api/system/settings', { method: 'PATCH', body: { mode: 'live', confirm: 'ENABLE LIVE MODE' }, cookie }));
    expect(ok.status).toBe(200);
    const r = await (await readinessGet(req(`/api/campaigns/${c.id}/readiness`, { cookie }), params({ id: c.id }))).json();
    expect(r.ready).toBe(false);
    expect((await start(cookie, c.id)).status).toBe(422);
  });

  it('live campaigns require telephony config, reviewed policies and explicit confirmation', async () => {
    const { cookie, agent } = await setup();
    await patchSettings(req('/api/system/settings', { method: 'PATCH', body: { mode: 'live', confirm: 'ENABLE LIVE MODE' }, cookie }));
    await addCustomer({ isDemo: false });
    const c = await makeCampaign(cookie, agent.id);
    expect(c.isDemo).toBe(false);
    const r = await (await readinessGet(req(`/api/campaigns/${c.id}/readiness`, { cookie }), params({ id: c.id }))).json();
    const fields = r.problems.map((p: { field: string }) => p.field);
    expect(fields).toEqual(expect.arrayContaining(['telephony', 'confirmation', 'compliance']));
    expect((await start(cookie, c.id)).status).toBe(422);
    // Even if someone forces the lead through, dialling still fails closed on the unreviewed policy.
    await tickCampaign(c.id);
    expect(await db.select().from(calls)).toHaveLength(0);
  });
});

describe('AI output validation', () => {
  it('rejects schema-invalid AI output, stores no guessed outcome, and raises a human task', async () => {
    const { cookie, agent } = await setup();
    const cust = await addCustomer();
    const c = await makeCampaign(cookie, agent.id, { segmentFilter: { customerIds: [cust.id] } });
    await start(cookie, c.id);
    setProviderOverrides({ analysis: { name: 'bad', status: () => ({ configured: true, missing: [] }), analyzeCall: async () => ({ output: { outcome: 'SUPER_HAPPY', score: 900 }, model: 'x' }) } });
    // force a connected scenario
    await tickCampaign(c.id);
    const [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.id));
    await placeCallForLead(lead!.id, 1);
    const [call] = await db.select().from(calls);
    await db.update(calls).set({ answeredAt: new Date(), status: 'IN_PROGRESS' }).where(eq(calls.id, call!.id));
    await db.insert(transcripts).values({ callId: call!.id, segments: [], fullText: 'Customer: hello', isDemo: true });
    const r = await analyzeCall(call!.id);
    expect(r.ok).toBe(false);
    expect(await db.select().from(leadQualifications)).toHaveLength(0);
    const tasks = await db.select().from(followUpTasks);
    expect(tasks.some((t) => t.type === 'ASSIGN_HUMAN')).toBe(true);
    setProviderOverrides({});
  });

  it('a retried analysis job does not duplicate qualifications or follow-ups', async () => {
    const { cookie, agent } = await setup();
    let interested: typeof customers.$inferSelect | undefined;
    const { pickScenario } = await import('@/server/demo-sim');
    for (let i = 0; i < 300 && !interested; i++) { const c = await addCustomer(); if (pickScenario(c.id, 1).key === 'interested') interested = c; }
    const camp = await makeCampaign(cookie, agent.id, { segmentFilter: { customerIds: [interested!.id] } });
    await start(cookie, camp.id);
    await runPipeline(camp.id);
    const [call] = await db.select().from(calls).where(eq(calls.campaignId, camp.id));
    const again = await analyzeCall(call!.id);
    expect(again.ok).toBe(false);
    expect(await db.select().from(leadQualifications).where(eq(leadQualifications.callId, call!.id))).toHaveLength(1);
    const fu = await db.select().from(followUpTasks).where(eq(followUpTasks.callId, call!.id));
    expect(new Set(fu.map((t) => t.idempotencyKey)).size).toBe(fu.length);
  });
});

describe('retries', () => {
  it('no-answer leads are retried after the interval, up to max attempts', async () => {
    const { cookie, agent } = await setup();
    let noAnswer: typeof customers.$inferSelect | undefined;
    const { pickScenario } = await import('@/server/demo-sim');
    for (let i = 0; i < 300 && !noAnswer; i++) { const c = await addCustomer(); if (pickScenario(c.id, 1).key === 'no_answer') noAnswer = c; }
    const camp = await makeCampaign(cookie, agent.id, { segmentFilter: { customerIds: [noAnswer!.id] }, maxAttempts: 2 });
    await start(cookie, camp.id);
    await runPipeline(camp.id);
    let [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, camp.id));
    expect(lead!.status).toBe('RETRY_WAIT');
    expect(lead!.attempts).toBe(1);
    expect(lead!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 3 * 3600_000);
    // Not due yet → not picked.
    expect((await tickCampaign(camp.id)).queued).toBe(0);
    // Due → second and final attempt.
    await db.update(campaignLeads).set({ nextAttemptAt: new Date(Date.now() - 1000) });
    await tickCampaign(camp.id);
    [lead] = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, camp.id));
    await placeCallForLead(lead!.id, 2);
    expect((await db.select().from(calls).where(eq(calls.campaignId, camp.id))).length).toBe(2);
    expect(SCENARIOS.length).toBeGreaterThan(5);
  });
});

describe('call history access', () => {
  it('sales executives only see calls for their own customers and masked numbers', async () => {
    const { cookie: adminCookie, agent } = await setup();
    const sales = await salesSession();
    const mine = await addCustomer({ ownerId: sales.user.id });
    const theirs = await addCustomer();
    const camp = await makeCampaign(adminCookie, agent.id, { segmentFilter: { customerIds: [mine.id, theirs.id] } });
    await start(adminCookie, camp.id);
    await tickCampaign(camp.id);
    for (const l of await db.select().from(campaignLeads)) await placeCallForLead(l.id, 1);
    const all = await (await listCalls(req('/api/calls', { cookie: adminCookie }))).json();
    expect(all.total).toBe(2);
    const own = await (await listCalls(req('/api/calls', { cookie: sales.cookie }))).json();
    expect(own.total).toBe(1);
    expect(own.calls[0].toNumber).toContain('•');
    const other = (await db.select().from(calls).where(eq(calls.customerId, theirs.id)))[0]!;
    expect((await getCall(req(`/api/calls/${other.id}`, { cookie: sales.cookie }), params({ id: other.id }))).status).toBe(404);
    expect((await getCall(req(`/api/calls/${other.id}`, { cookie: adminCookie }), params({ id: other.id }))).status).toBe(200);
  });
});
