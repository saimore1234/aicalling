import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { auditLogs, calls, countryPolicies, customers, followUpTasks, messageTemplates, suppressionRecords, transcripts, aiAgents, leadQualifications } from '@/db/schema';
import { GET as policies } from '@/app/api/compliance/policies/route';
import { PATCH as patchPolicy } from '@/app/api/compliance/policies/[code]/route';
import { POST as dndScrub } from '@/app/api/compliance/policies/[code]/confirm-dnd-scrub/route';
import { POST as addSuppression, GET as listSuppression } from '@/app/api/compliance/suppression/route';
import { DELETE as liftSuppression } from '@/app/api/compliance/suppression/[id]/route';
import { POST as privacy } from '@/app/api/compliance/privacy/route';
import { POST as createTemplate } from '@/app/api/templates/route';
import { PATCH as patchTemplate } from '@/app/api/templates/[id]/route';
import { POST as createRule } from '@/app/api/followups/rules/route';
import { GET as listTasks, POST as createTask } from '@/app/api/followups/tasks/route';
import { PATCH as patchTask } from '@/app/api/followups/tasks/[id]/route';
import { GET as dashboard } from '@/app/api/dashboard/route';
import { GET as audit } from '@/app/api/audit/route';
import { GET as health } from '@/app/api/health/route';
import { GET as integrations } from '@/app/api/integrations/route';
import { GET as sysHealth } from '@/app/api/system/health/route';
import { adminSession, params, req, resetDb, salesSession, shutdown } from '../helpers';

beforeEach(resetDb);
afterAll(shutdown);

describe('compliance policies', () => {
  it('starts unreviewed; editing rules voids a review; only admins may change them', async () => {
    const { cookie } = await adminSession();
    const sales = await salesSession();
    const list = await (await policies(req('/api/compliance/policies', { cookie }))).json();
    expect(list.policies.every((p: { reviewed: boolean }) => p.reviewed === false)).toBe(true);
    expect((await policies(req('/api/compliance/policies', { cookie: sales.cookie }))).status).toBe(403);

    const r1 = await patchPolicy(req('/api/compliance/policies/IN', { method: 'PATCH', body: { reviewed: true }, cookie }), params({ code: 'IN' }));
    expect((await r1.json()).policy.reviewed).toBe(true);
    const r2 = await patchPolicy(req('/api/compliance/policies/IN', { method: 'PATCH', body: { callWindowEnd: '20:00' }, cookie }), params({ code: 'IN' }));
    const p2 = (await r2.json()).policy;
    expect(p2.reviewed).toBe(false);
    expect(p2.reviewedAt).toBeNull();
    const entry = await db.select().from(auditLogs).where(eq(auditLogs.action, 'compliance.policy_updated'));
    expect(entry).toHaveLength(2);
  });
  it('records a do-not-call scrub attestation', async () => {
    const { cookie } = await adminSession();
    const r = await dndScrub(req('/api/compliance/policies/IN/confirm-dnd-scrub', { body: { attest: true }, cookie }), params({ code: 'IN' }));
    expect((await r.json()).policy.dndScrubConfirmedAt).toBeTruthy();
    const bad = await dndScrub(req('/api/compliance/policies/IN/confirm-dnd-scrub', { body: { attest: false }, cookie }), params({ code: 'IN' }));
    expect(bad.status).toBe(400);
  });
});

describe('suppression and privacy', () => {
  it('admin suppression blocks the customer, and lifting needs a written reason', async () => {
    const { cookie } = await adminSession();
    const [c] = await db.insert(customers).values({ name: 'S', phone: '+919833333333', country: 'IN' }).returning();
    const res = await addSuppression(req('/api/compliance/suppression', { body: { phone: '+91 98333 33333', note: 'DNC registry' }, cookie }));
    expect(res.status).toBe(201);
    const [after] = await db.select().from(customers).where(eq(customers.id, c!.id));
    expect(after!.doNotCall).toBe(true);
    const id = (await res.json()).record.id;
    expect((await liftSuppression(req(`/api/compliance/suppression/${id}`, { method: 'DELETE', body: { reason: 'short' }, cookie }), params({ id }))).status).toBe(400);
    expect((await liftSuppression(req(`/api/compliance/suppression/${id}`, { method: 'DELETE', body: { reason: 'Customer re-subscribed in writing on 3 June' }, cookie }), params({ id }))).status).toBe(200);
    const active = await (await listSuppression(req('/api/compliance/suppression?active=true', { cookie }))).json();
    expect(active.records.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });
  it('exports data, and erases personal data while keeping the person suppressed', async () => {
    const { cookie } = await adminSession();
    const [c] = await db.insert(customers).values({ name: 'Priya Nair', phone: '+919844444444', email: 'priya@example.com', country: 'IN', notes: 'secret' }).returning();
    const [agent] = await db.insert(aiAgents).values({ name: 'A', companyName: 'X', greeting: 'AI' }).returning();
    const [call] = await db.insert(calls).values({ customerId: c!.id, agentId: agent!.id, provider: 'demo', idempotencyKey: 'k1', toNumber: c!.phone!, isDemo: true }).returning();
    await db.insert(transcripts).values({ callId: call!.id, segments: [], fullText: 'Customer: my card number is 4242', isDemo: true });
    await db.insert(leadQualifications).values({ customerId: c!.id, callId: call!.id, outcome: 'INTERESTED', score: 50, reason: 'said card number', evidence: ['card number'] });

    const exp = await privacy(req('/api/compliance/privacy', { body: { customerId: c!.id, type: 'EXPORT' }, cookie }));
    const dump = await exp.json();
    expect(dump.customer.email).toBe('priya@example.com');
    expect(dump.transcripts).toHaveLength(1);

    const noConfirm = await privacy(req('/api/compliance/privacy', { body: { customerId: c!.id, type: 'ERASE' }, cookie }));
    expect(noConfirm.status).toBe(400);
    const erased = await privacy(req('/api/compliance/privacy', { body: { customerId: c!.id, type: 'ERASE', confirm: 'ERASE' }, cookie }));
    expect(erased.status).toBe(200);

    const [row] = await db.select().from(customers).where(eq(customers.id, c!.id));
    expect(row!.name).toBe('Erased customer');
    expect(row!.phone).toBeNull();
    expect(row!.email).toMatch(/@erased\.invalid$/);
    expect(row!.deletedAt).not.toBeNull();
    expect(await db.select().from(transcripts)).toHaveLength(0);
    const [q] = await db.select().from(leadQualifications);
    expect(q!.reason).toBe('erased');
    // The number stays on the suppression list so a re-import cannot be called.
    const sup = await db.select().from(suppressionRecords);
    expect(sup.some((s) => s.phone === '+919844444444' && s.reason === 'PRIVACY_REQUEST')).toBe(true);
  });
});

describe('templates and follow-up rules', () => {
  const tpl = { name: 'Promo', channel: 'SMS', bodyText: 'Hi {{first_name}}, offer from {{company_name}}. Reply STOP to opt out.', isMarketing: true };
  it('new templates are unapproved; editing wording voids approval', async () => {
    const { cookie } = await adminSession();
    const created = await (await createTemplate(req('/api/templates', { body: tpl, cookie }))).json();
    expect(created.template.approved).toBe(false);
    expect(created.template.variables.sort()).toEqual(['company_name', 'first_name']);
    const id = created.template.id;
    const ok = await (await patchTemplate(req(`/api/templates/${id}`, { method: 'PATCH', body: { approved: true }, cookie }), params({ id }))).json();
    expect(ok.template.approved).toBe(true);
    const edited = await (await patchTemplate(req(`/api/templates/${id}`, { method: 'PATCH', body: { bodyText: 'New wording {{first_name}}' }, cookie }), params({ id }))).json();
    expect(edited.template.approved).toBe(false);
  });
  it('rejects an email template without a subject and a WhatsApp approval without a provider template', async () => {
    const { cookie } = await adminSession();
    expect((await createTemplate(req('/api/templates', { body: { name: 'E', channel: 'EMAIL', bodyText: 'x' }, cookie }))).status).toBe(400);
    const wa = await (await createTemplate(req('/api/templates', { body: { name: 'W', channel: 'WHATSAPP', bodyText: 'x' }, cookie }))).json();
    const id = wa.template.id;
    expect((await patchTemplate(req(`/api/templates/${id}`, { method: 'PATCH', body: { approved: true }, cookie }), params({ id }))).status).toBe(400);
  });
  it('a rule must use a template of the matching channel', async () => {
    const { cookie } = await adminSession();
    const [sms] = await db.select().from(messageTemplates).where(eq(messageTemplates.channel, 'SMS')).limit(1);
    const bad = await createRule(req('/api/followups/rules', { body: { name: 'r', outcome: 'INTERESTED', action: 'SEND_EMAIL', templateId: sms!.id }, cookie }));
    expect(bad.status).toBe(400);
    const none = await createRule(req('/api/followups/rules', { body: { name: 'r', outcome: 'INTERESTED', action: 'SEND_EMAIL' }, cookie }));
    expect(none.status).toBe(400);
  });
  it('humans can create and complete their own tasks; executives only see their customers', async () => {
    const admin = await adminSession();
    const sales = await salesSession();
    const [mine] = await db.insert(customers).values({ name: 'Mine', phone: '+919855555555', country: 'IN', ownerId: sales.user.id }).returning();
    const [theirs] = await db.insert(customers).values({ name: 'Theirs', phone: '+919866666666', country: 'IN' }).returning();
    expect((await createTask(req('/api/followups/tasks', { body: { customerId: theirs!.id, title: 'x' }, cookie: sales.cookie }))).status).toBe(404);
    const t = await (await createTask(req('/api/followups/tasks', { body: { customerId: mine!.id, title: 'Call back' }, cookie: sales.cookie }))).json();
    const done = await patchTask(req(`/api/followups/tasks/${t.task.id}`, { method: 'PATCH', body: { status: 'COMPLETED' }, cookie: sales.cookie }), params({ id: t.task.id }));
    expect((await done.json()).task.status).toBe('COMPLETED');
    await db.insert(followUpTasks).values({ customerId: theirs!.id, type: 'TASK', title: 'other', idempotencyKey: 'z' });
    const seen = await (await listTasks(req('/api/followups/tasks', { cookie: sales.cookie }))).json();
    expect(seen.tasks.map((x: { title: string }) => x.title)).toEqual(['Call back']);
    const all = await (await listTasks(req('/api/followups/tasks', { cookie: admin.cookie }))).json();
    expect(all.total).toBe(2);
  });
});

describe('dashboard metrics', () => {
  it('counts only database records, separates demo from live, and ships definitions', async () => {
    const { cookie } = await adminSession();
    const [c] = await db.insert(customers).values({ name: 'D', phone: '+919877777777', country: 'IN', isDemo: true }).returning();
    const [agent] = await db.insert(aiAgents).values({ name: 'A', companyName: 'X', greeting: 'AI' }).returning();
    const mk = (k: string, over: Partial<typeof calls.$inferInsert>) => db.insert(calls).values({ customerId: c!.id, agentId: agent!.id, provider: 'demo', idempotencyKey: k, toNumber: c!.phone!, isDemo: true, ...over });
    await mk('a', { status: 'COMPLETED', answeredAt: new Date(), durationSeconds: 60, outcome: 'INTERESTED' });
    await mk('b', { status: 'COMPLETED', answeredAt: new Date(), durationSeconds: 100, outcome: 'QUALIFIED' });
    await mk('c', { status: 'NO_ANSWER', outcome: 'NO_ANSWER' });
    await mk('d', { status: 'FAILED', outcome: 'FAILED' });
    await mk('e', { status: 'CANCELED' });
    await mk('live', { status: 'COMPLETED', answeredAt: new Date(), durationSeconds: 10, isDemo: false, provider: 'twilio' });

    const demo = await (await dashboard(req('/api/dashboard', { cookie }))).json(); // default = current mode (demo)
    expect(demo.mode).toBe('demo');
    expect(demo.totals.callsPlaced).toBe(4); // canceled excluded; live excluded
    expect(demo.totals.callsConnected).toBe(2);
    expect(demo.totals.connectRate).toBeCloseTo(0.5);
    expect(demo.totals.avgDurationSeconds).toBe(80);
    expect(demo.totals.interested).toBe(2);
    expect(demo.totals.qualified).toBe(1);
    expect(demo.totals.failedCalls).toBe(1);
    expect(demo.totals.conversionRate).toBeCloseTo(1);
    expect(demo.includesDemoData).toBe(true);
    expect(demo.definitions.connectRate).toBeTruthy();
    const all = await (await dashboard(req('/api/dashboard?demo=all', { cookie }))).json();
    expect(all.totals.callsPlaced).toBe(5);
    const live = await (await dashboard(req('/api/dashboard?demo=false', { cookie }))).json();
    expect(live.totals.callsPlaced).toBe(1);
    expect(live.includesDemoData).toBe(false);
  });
  it('sales executives only see numbers for their own customers', async () => {
    const sales = await salesSession();
    const [mine] = await db.insert(customers).values({ name: 'M', phone: '+919888888888', country: 'IN', isDemo: true, ownerId: sales.user.id }).returning();
    const [other] = await db.insert(customers).values({ name: 'O', phone: '+919899999999', country: 'IN', isDemo: true }).returning();
    const [agent] = await db.insert(aiAgents).values({ name: 'A', companyName: 'X', greeting: 'AI' }).returning();
    for (const [i, cu] of [mine!, other!, other!].entries()) await db.insert(calls).values({ customerId: cu.id, agentId: agent!.id, provider: 'demo', idempotencyKey: `k${i}`, toNumber: cu.phone!, isDemo: true, status: 'COMPLETED', answeredAt: new Date() });
    const d = await (await dashboard(req('/api/dashboard', { cookie: sales.cookie }))).json();
    expect(d.totals.callsPlaced).toBe(1);
    expect(d.totals.customers).toBe(1);
  });
});

describe('system endpoints', () => {
  it('public health is minimal; detailed health and integrations are admin only and never expose secrets', async () => {
    const h = await (await health()).json();
    expect(h).toEqual({ ok: true });
    const sales = await salesSession();
    expect((await sysHealth(req('/api/system/health', { cookie: sales.cookie }))).status).toBe(403);
    expect((await integrations(req('/api/integrations', { cookie: sales.cookie }))).status).toBe(403);
    const { cookie } = await adminSession();
    process.env.OPENAI_API_KEY = 'sk-super-secret-value';
    const { resetEnvCache } = await import('@/lib/env');
    resetEnvCache();
    const txt = await (await integrations(req('/api/integrations', { cookie }))).text();
    delete process.env.OPENAI_API_KEY;
    resetEnvCache();
    expect(txt).not.toContain('sk-super-secret-value');
    const data = JSON.parse(txt);
    expect(data.integrations.find((i: { key: string }) => i.key === 'openai').configured).toBe(true);
    expect(data.integrations.find((i: { key: string }) => i.key === 'twilio-voice').missing).toContain('TWILIO_ACCOUNT_SID');
    const sh = await (await sysHealth(req('/api/system/health', { cookie }))).json();
    expect(sh.checks.database.ok).toBe(true);
    expect(sh.checks.redis.ok).toBe(true);
    expect(sh.checks.worker.ok).toBe(false); // no worker running in tests → reported honestly
    expect(sh.mode).toBe('demo');
  });
  it('audit log is admin only and filterable', async () => {
    const { cookie } = await adminSession();
    await patchPolicy(req('/api/compliance/policies/US', { method: 'PATCH', body: { reviewed: true }, cookie }), params({ code: 'US' }));
    const sales = await salesSession();
    expect((await audit(req('/api/audit', { cookie: sales.cookie }))).status).toBe(403);
    const r = await (await audit(req('/api/audit?action=compliance.policy', { cookie }))).json();
    expect(r.total).toBe(1);
    expect(r.logs[0].metadata.country).toBe('US');
    void countryPolicies;
  });
});
