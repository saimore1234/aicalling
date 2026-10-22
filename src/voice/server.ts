import { createServer } from 'node:http';
import { eq } from 'drizzle-orm';
import twilio from 'twilio';
import WebSocket, { WebSocketServer } from 'ws';
import { db, closeDb } from '@/db/client';
import { aiAgents, calls, customers, followUpTasks } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { logger, sanitizeError } from '@/lib/logger';
import { getAppSettings } from '@/lib/settings';
import { getTelephonyProvider } from '@/providers';
import { addCallEvent, applyCallStatus, saveTranscript } from '@/server/calls';
import { applyOptOut } from '@/server/compliance';
import { CallBridge, type BridgeDeps } from './bridge';

export function realDeps(): BridgeDeps {
  const env = getEnv();
  const telephony = () => getTelephonyProvider('live');
  return {
    protocol: env.OPENAI_REALTIME_PROTOCOL,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL,
    connectOpenAI(model) {
      if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
      const headers: Record<string, string> = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
      if (env.OPENAI_REALTIME_PROTOCOL === 'beta') headers['OpenAI-Beta'] = 'realtime=v1';
      return new WebSocket(`${env.OPENAI_REALTIME_URL}?model=${encodeURIComponent(model)}`, { headers }) as never;
    },
    async load(callId) {
      const [row] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
      if (!row) return null;
      const [agent] = await db.select().from(aiAgents).where(eq(aiAgents.id, row.agentId)).limit(1);
      const [customer] = await db.select().from(customers).where(eq(customers.id, row.customerId)).limit(1);
      if (!agent || !customer) return null;
      return {
        call: { id: row.id, status: row.status, isDemo: row.isDemo, providerCallSid: row.providerCallSid, customerId: row.customerId, toNumber: row.toNumber },
        agent,
        customer: { id: customer.id, name: customer.name, company: customer.company, productInterest: customer.productInterest },
      };
    },
    async isHaltRequested() {
      const s = await getAppSettings();
      return s.killSwitch || s.mode !== 'live';
    },
    addEvent: (callId, type, payload) => addCallEvent(callId, type, null, payload ?? {}),
    saveTranscript: async (callId, segments, language) => saveTranscript(callId, segments, { language, isDemo: false }),
    async markAnswered(callId) { await applyCallStatus(callId, 'IN_PROGRESS', { payload: { source: 'voice-gateway' } }); },
    async optOut(customerId, callId) { await applyOptOut({ customerId, channels: 'ALL', source: 'Voice call (live request)', note: `Customer asked to stop during call ${callId}` }); },
    async requestHuman(callId, customerId, reason) {
      const [c] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
      await db.insert(followUpTasks).values({
        customerId, callId, campaignId: c?.campaignId ?? null, type: 'ASSIGN_HUMAN', title: 'Customer needs a human follow-up',
        payload: { reason }, idempotencyKey: `human-live-${callId}`, isDemo: false,
      }).onConflictDoNothing();
    },
    hangup: (sid) => telephony().hangup(sid),
    async transfer(sid, e164) {
      const r = new twilio.twiml.VoiceResponse();
      r.say('Please hold while I connect you.');
      r.dial(e164);
      await telephony().redirect!(sid, r.toString());
    },
    async fallbackSay(sid, text) {
      const r = new twilio.twiml.VoiceResponse();
      r.say(text);
      r.hangup();
      await telephony().redirect!(sid, r.toString());
    },
  };
}

export function createVoiceServer(deps: BridgeDeps = realDeps(), port = getEnv().VOICE_GATEWAY_PORT) {
  const active = new Map<string, CallBridge>();
  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, activeCalls: active.size }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, path: '/media-stream', maxPayload: 1_000_000 });
  wss.on('connection', (socket) => {
    const bridge = new CallBridge(socket as never, deps);
    // Register once the stream is authenticated; reject a second stream for the same call.
    const poll = setInterval(() => {
      const id = bridge.activeCallId;
      if (!id) return;
      clearInterval(poll);
      if (active.has(id)) { void bridge.finish('duplicate_stream'); return; }
      active.set(id, bridge);
      void bridge.done.then(() => active.delete(id));
    }, 50);
    void bridge.done.then(() => clearInterval(poll));
  });
  return {
    http,
    wss,
    active,
    listen: () => new Promise<void>((resolve) => http.listen(port, () => { logger.info({ port }, 'voice gateway listening'); resolve(); })),
    async close() {
      for (const b of active.values()) await b.hangup('gateway_shutdown').catch(() => undefined);
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      await closeDb();
    },
  };
}

if (process.argv[1] && /voice[\\/]server\.(ts|js)$/.test(process.argv[1])) {
  const srv = createVoiceServer();
  srv.listen().catch((err) => { logger.fatal({ err: sanitizeError(err) }, 'voice gateway failed'); process.exit(1); });
  const stop = async () => { await srv.close().catch(() => undefined); process.exit(0); };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}
