import { eq } from 'drizzle-orm';
import twilio from 'twilio';
import { db } from '@/db/client';
import { calls } from '@/db/schema';
import { publicRoute } from '@/lib/api';
import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getAppSettings } from '@/lib/settings';
import { addCallEvent, isTerminal } from '@/server/calls';
import { createStreamToken } from '@/server/campaigns';
import { verifyTwilio } from '@/server/webhook-verify';

const xml = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
function hangupTwiml(message?: string) {
  const r = new twilio.twiml.VoiceResponse();
  if (message) r.say(message);
  r.hangup();
  return xml(r.toString());
}

/**
 * Twilio calls this when the callee answers. Returns TwiML that connects the call to our voice gateway.
 * Signature verified; the call must exist, be live (not demo) and not be finished; kill switch honoured.
 */
export const POST = publicRoute({ csrf: false }, async ({ req }) => {
  const params = await verifyTwilio(req);
  const callId = new URL(req.url).searchParams.get('callId');
  const [call] = callId ? await db.select().from(calls).where(eq(calls.id, callId)).limit(1) : [];
  if (!call || call.isDemo || (params.CallSid && call.providerCallSid && params.CallSid !== call.providerCallSid)) {
    logger.warn({ callId }, 'voice webhook for unknown/mismatched call');
    return hangupTwiml();
  }
  if (isTerminal(call.status)) return hangupTwiml();
  const settings = await getAppSettings();
  if (settings.killSwitch || settings.mode !== 'live') {
    await addCallEvent(call.id, 'blocked_at_answer', null, { killSwitch: settings.killSwitch, mode: settings.mode });
    return hangupTwiml();
  }
  const url = getEnv().VOICE_GATEWAY_PUBLIC_URL;
  if (!url) {
    await addCallEvent(call.id, 'gateway_not_configured', null);
    return hangupTwiml('We are unable to take your call at this time. Goodbye.');
  }
  const r = new twilio.twiml.VoiceResponse();
  const connect = r.connect();
  const stream = connect.stream({ url });
  stream.parameter({ name: 'token', value: createStreamToken(call.id) });
  stream.parameter({ name: 'callId', value: call.id });
  await addCallEvent(call.id, 'connect_stream', null);
  return xml(r.toString());
});
