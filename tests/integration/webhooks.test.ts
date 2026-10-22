import { createHmac } from 'node:crypto';
import twilio from 'twilio';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents, callEvents, calls, customers, messages, suppressionRecords, consentRecords } from '@/db/schema';
import { resetEnvCache } from '@/lib/env';
import { POST as statusHook } from '@/app/api/webhooks/twilio/status/route';
import { POST as voiceHook } from '@/app/api/webhooks/twilio/voice/route';
import { POST as smsStatus } from '@/app/api/webhooks/twilio/sms-status/route';
import { POST as smsInbound } from '@/app/api/webhooks/twilio/sms-inbound/route';
import { POST as resendHook } from '@/app/api/webhooks/resend/route';
import { GET as waVerify, POST as waHook } from '@/app/api/webhooks/whatsapp/route';
import { POST as unsubscribe } from '@/app/api/unsubscribe/route';
import { signToken, verifyToken } from '@/lib/crypto';
import { updateAppSettings } from '@/lib/settings';
import { unsubscribeUrl } from '@/server/messaging';
import { resetDb, shutdown } from '../helpers';

const TOKEN = 'twilio-test-auth-token';
const BASE = 'https://app.example.test';

beforeEach(async () => {
  await resetDb();
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.VOICE_GATEWAY_PUBLIC_URL = 'wss://voice.example.test/media-stream';
  resetEnvCache();
});
afterEach(() => {
  for (const k of ['TWILIO_AUTH_TOKEN', 'VOICE_GATEWAY_PUBLIC_URL', 'RESEND_WEBHOOK_SECRET', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']) delete process.env[k];
  resetEnvCache();
});
afterAll(shutdown);

function twilioReq(path: string, params: Record<string, string>, opts: { sign?: boolean; badSig?: boolean } = {}) {
  const url = `${BASE}${path}`;
  const sig = opts.badSig ? 'AAAA' : twilio.getExpectedTwilioSignature(TOKEN, url, params);
  const body = new URLSearchParams(params);
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.sign === false ? {} : { 'x-twilio-signature': sig }) }, body });
}

async function liveCall(status: 'QUEUED' | 'INITIATED' | 'IN_PROGRESS' = 'INITIATED') {
  const [cust] = await db.insert(customers).values({ name: 'Live Person', phone: '+919811111111', country: 'IN', timezone: 'Asia/Kolkata' }).returning();
  const [agent] = await db.insert(aiAgents).values({ name: 'A', companyName: 'Acme', greeting: "Hi, I'm an AI assistant from Acme" }).returning();
  const [call] = await db.insert(calls).values({ customerId: cust!.id, agentId: agent!.id, provider: 'twilio', providerCallSid: 'CAtest1', idempotencyKey: `k-${Math.random()}`, toNumber: cust!.phone!, status, isDemo: false }).returning();
  return { call: call!, cust: cust! };
}

describe('twilio status webhook', () => {
  it('rejects missing and invalid signatures', async () => {
    const { call } = await liveCall();
    const p = { CallSid: 'CAtest1', CallStatus: 'ringing' };
    const path = `/api/webhooks/twilio/status?callId=${call.id}`;
    expect((await statusHook(twilioReq(path, p, { sign: false }))).status).toBe(403);
    expect((await statusHook(twilioReq(path, p, { badSig: true }))).status).toBe(403);
    const [c] = await db.select().from(calls).where(eq(calls.id, call.id));
    expect(c!.status).toBe('INITIATED');
  });
  it('fails closed when no auth token is configured', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    resetEnvCache();
    const { call } = await liveCall();
    const r = await statusHook(twilioReq(`/api/webhooks/twilio/status?callId=${call.id}`, { CallSid: 'CAtest1', CallStatus: 'ringing' }));
    expect(r.status).toBe(503);
  });
  it('applies valid transitions, ignores replays and never moves a call backwards', async () => {
    const { call } = await liveCall();
    const path = `/api/webhooks/twilio/status?callId=${call.id}`;
    const send = (p: Record<string, string>) => statusHook(twilioReq(path, { CallSid: 'CAtest1', ...p }));
    expect((await send({ CallStatus: 'ringing', SequenceNumber: '1' })).status).toBe(200);
    expect((await send({ CallStatus: 'in-progress', SequenceNumber: '2' })).status).toBe(200);
    const dup = await (await send({ CallStatus: 'in-progress', SequenceNumber: '2' })).json();
    expect(dup.duplicate).toBe(true);
    await send({ CallStatus: 'completed', SequenceNumber: '3', CallDuration: '42' });
    let [c] = await db.select().from(calls).where(eq(calls.id, call.id));
    expect(c!.status).toBe('COMPLETED');
    expect(c!.durationSeconds).toBe(42);
    expect(c!.endedAt).not.toBeNull();
    // Late, out-of-order "ringing" must not reopen the call.
    await send({ CallStatus: 'ringing', SequenceNumber: '0' });
    [c] = await db.select().from(calls).where(eq(calls.id, call.id));
    expect(c!.status).toBe('COMPLETED');
    expect((await db.select().from(callEvents).where(eq(callEvents.callId, call.id))).length).toBeGreaterThanOrEqual(3);
  });
  it('maps no-answer and busy', async () => {
    const { call } = await liveCall();
    await statusHook(twilioReq(`/api/webhooks/twilio/status?callId=${call.id}`, { CallSid: 'CAtest1', CallStatus: 'no-answer' }));
    const [c] = await db.select().from(calls).where(eq(calls.id, call.id));
    expect(c!.status).toBe('NO_ANSWER');
    expect(c!.outcome).toBe('NO_ANSWER');
  });
  it('ignores a callback whose CallSid belongs to a different call', async () => {
    const { call } = await liveCall();
    await statusHook(twilioReq(`/api/webhooks/twilio/status?callId=${call.id}`, { CallSid: 'CAother', CallStatus: 'completed' }));
    const [c] = await db.select().from(calls).where(eq(calls.id, call.id));
    expect(c!.status).toBe('INITIATED');
  });
});

describe('twilio voice webhook', () => {
  const run = async (callId: string, sid = 'CAtest1') => {
    const r = await voiceHook(twilioReq(`/api/webhooks/twilio/voice?callId=${callId}`, { CallSid: sid, CallStatus: 'in-progress' }));
    return { status: r.status, xml: await r.text() };
  };
  it('returns <Connect><Stream> with a signed token for a live call in live mode', async () => {
    await updateAppSettings({ mode: 'live' });
    const { call } = await liveCall();
    const { xml } = await run(call.id);
    expect(xml).toContain('<Stream url="wss://voice.example.test/media-stream"');
    const token = /name="token" value="([^"]+)"/.exec(xml)?.[1];
    expect(token).toBeTruthy();
    const t = verifyToken<{ callId: string; purpose: string }>(token!);
    expect(t?.callId).toBe(call.id);
    expect(t?.purpose).toBe('media-stream');
  });
  it('hangs up instead of connecting when the kill switch is on', async () => {
    await updateAppSettings({ mode: 'live', killSwitch: true });
    const { call } = await liveCall();
    const { xml } = await run(call.id);
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Stream');
  });
  it('hangs up in demo mode, for unknown calls and for finished calls', async () => {
    const { call } = await liveCall();
    expect((await run(call.id)).xml).not.toContain('<Stream'); // demo mode
    await updateAppSettings({ mode: 'live' });
    expect((await run('00000000-0000-0000-0000-000000000000')).xml).not.toContain('<Stream');
    await db.update(calls).set({ status: 'COMPLETED' }).where(eq(calls.id, call.id));
    expect((await run(call.id)).xml).not.toContain('<Stream');
  });
  it('rejects unsigned requests', async () => {
    const r = await voiceHook(twilioReq('/api/webhooks/twilio/voice?callId=x', { CallSid: 'CA1' }, { badSig: true }));
    expect(r.status).toBe(403);
  });
});

describe('messaging webhooks', () => {
  async function liveMessage(provider: string, providerMessageId: string, channel: 'SMS' | 'EMAIL' | 'WHATSAPP' = 'SMS') {
    const [cust] = await db.insert(customers).values({ name: 'M', phone: '+919822222222', email: 'm@example.com', country: 'IN', timezone: 'Asia/Kolkata' }).returning();
    const [m] = await db.insert(messages).values({ customerId: cust!.id, channel, direction: 'OUTBOUND', status: 'SENT', toAddress: 'x', body: 'test', provider, providerMessageId, isMarketing: false, sentAt: new Date() }).returning();
    return { m: m!, cust: cust! };
  }
  it('twilio sms status: forward-only transitions and replay protection', async () => {
    const { m } = await liveMessage('twilio', 'SM1');
    await smsStatus(twilioReq('/api/webhooks/twilio/sms-status', { MessageSid: 'SM1', MessageStatus: 'delivered' }));
    let [row] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(row!.status).toBe('DELIVERED');
    await smsStatus(twilioReq('/api/webhooks/twilio/sms-status', { MessageSid: 'SM1', MessageStatus: 'sent' })); // late
    [row] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(row!.status).toBe('DELIVERED');
    expect((await smsStatus(twilioReq('/api/webhooks/twilio/sms-status', { MessageSid: 'SM1', MessageStatus: 'delivered' })).then((r) => r.json())).duplicate).toBe(true);
    expect((await smsStatus(twilioReq('/api/webhooks/twilio/sms-status', { MessageSid: 'SM1', MessageStatus: 'failed' }, { badSig: true }))).status).toBe(403);
  });
  it('a failure report never overrides a delivered message, but fails a merely-sent one', async () => {
    const a = await liveMessage('twilio', 'SM2');
    await smsStatus(twilioReq('/api/webhooks/twilio/sms-status', { MessageSid: 'SM2', MessageStatus: 'undelivered', ErrorCode: '30003' }));
    const [row] = await db.select().from(messages).where(eq(messages.id, a.m.id));
    expect(row!.status).toBe('FAILED');
    expect(row!.errorCode).toBe('30003');
  });
  it('inbound STOP opts the sender out of SMS immediately', async () => {
    const { cust } = await liveMessage('twilio', 'SM3');
    await db.insert(consentRecords).values({ customerId: cust.id, channel: 'SMS', status: 'GRANTED', source: 't' });
    const r = await smsInbound(twilioReq('/api/webhooks/twilio/sms-inbound', { MessageSid: 'SMin1', From: '+919822222222', Body: 'STOP' }));
    expect(r.status).toBe(200);
    const sup = await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, cust.id));
    expect(sup.some((s) => s.channel === 'SMS')).toBe(true);
    const inbound = await db.select().from(messages).where(eq(messages.direction, 'INBOUND'));
    expect(inbound).toHaveLength(1);
  });

  function svix(secret: string, body: string, id = 'msg_1', ts = String(Math.floor(Date.now() / 1000))) {
    const key = Buffer.from(secret.replace('whsec_', ''), 'base64');
    const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
    return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
  }
  const SECRET = `whsec_${Buffer.from('resend-secret-bytes').toString('base64')}`;
  const resendReq = (body: string, headers: Record<string, string>) => new Request(`${BASE}/api/webhooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  it('resend: verifies Svix signatures, updates status, suppresses hard bounces', async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    resetEnvCache();
    const { m, cust } = await liveMessage('resend', 'em_1', 'EMAIL');
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1', to: ['m@example.com'] } });
    expect((await resendHook(resendReq(body, { 'svix-id': 'x', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,bad' }))).status).toBe(403);
    expect((await resendHook(resendReq(body, svix(SECRET, body, 'msg_a')))).status).toBe(200);
    let [row] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(row!.status).toBe('DELIVERED');
    // stale timestamp (replay) rejected
    expect((await resendHook(resendReq(body, svix(SECRET, body, 'msg_old', String(Math.floor(Date.now() / 1000) - 3600))))).status).toBe(403);
    const bounce = JSON.stringify({ type: 'email.bounced', data: { email_id: 'em_1', to: ['m@example.com'], bounce: { type: 'Permanent', message: 'no such user' } } });
    await resendHook(resendReq(bounce, svix(SECRET, bounce, 'msg_b')));
    expect((await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, cust.id))).some((s) => s.reason === 'BOUNCE')).toBe(true);
    [row] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(row!.status).toBe('DELIVERED'); // delivered is never downgraded
  });
  it('resend: refuses everything when no secret is configured', async () => {
    const r = await resendHook(resendReq('{}', {}));
    expect(r.status).toBe(503);
  });

  it('whatsapp: verification handshake and signed status events', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
    process.env.WHATSAPP_APP_SECRET = 'app-secret';
    resetEnvCache();
    const ok = await waVerify(new Request(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`));
    expect(await ok.text()).toBe('12345');
    expect((await waVerify(new Request(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`))).status).toBe(403);

    const { m } = await liveMessage('meta-cloud', 'wamid.1', 'WHATSAPP');
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] });
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    const mk = (s: string) => new Request(`${BASE}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': s, 'content-type': 'application/json' }, body });
    expect((await waHook(mk('sha256=deadbeef'))).status).toBe(403);
    expect((await waHook(mk(sig))).status).toBe(200);
    const [row] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(row!.status).toBe('READ');
  });
});

describe('unsubscribe', () => {
  it('opts the customer out of the signed channel only, and rejects tampered tokens', async () => {
    const [cust] = await db.insert(customers).values({ name: 'U', email: 'u@example.com', country: 'IN' }).returning();
    const url = unsubscribeUrl(cust!.id, 'EMAIL')!;
    const token = url.split('/unsubscribe/')[1]!;
    const mk = (t: string) => new Request(`${BASE}/api/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, host: 'app.example.test' }, body: JSON.stringify({ token: t }) });
    expect((await unsubscribe(mk(token.slice(0, -3) + 'abc'))).status).toBe(400);
    expect((await unsubscribe(mk(signToken({ cid: cust!.id, ch: 'EMAIL' }, -5)))).status).toBe(400);
    expect((await unsubscribe(mk(token))).status).toBe(200);
    const sup = await db.select().from(suppressionRecords).where(eq(suppressionRecords.customerId, cust!.id));
    expect(sup.map((s) => s.channel)).toEqual(['EMAIL']);
    expect(sup[0]!.reason).toBe('UNSUBSCRIBE');
    const [after] = await db.select().from(customers).where(eq(customers.id, cust!.id));
    expect(after!.doNotCall).toBe(false); // email unsubscribe must not block voice
  });
});
