import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { calls } from '@/db/schema';
import { publicRoute } from '@/lib/api';
import { applyCallStatus, mapProviderStatus } from '@/server/calls';
import { claimWebhookEvent } from '@/server/webhooks';
import { verifyTwilio } from '@/server/webhook-verify';

/** Twilio call status callbacks. Idempotent (replay-safe) and order-safe (status never moves backwards). */
export const POST = publicRoute({ csrf: false }, async ({ req }) => {
  const p = await verifyTwilio(req);
  const callId = new URL(req.url).searchParams.get('callId');
  const sid = p.CallSid;
  if (!sid || !p.CallStatus) return { ok: true, ignored: 'missing fields' };
  const first = await claimWebhookEvent('twilio-call', `${sid}:${p.CallStatus}:${p.SequenceNumber ?? ''}:${p.Timestamp ?? ''}`);
  if (!first) return { ok: true, duplicate: true };

  const [call] = callId
    ? await db.select().from(calls).where(eq(calls.id, callId)).limit(1)
    : await db.select().from(calls).where(eq(calls.providerCallSid, sid)).limit(1);
  if (!call) return { ok: true, ignored: 'unknown call' };
  if (call.providerCallSid && call.providerCallSid !== sid) return { ok: true, ignored: 'sid mismatch' };

  const status = mapProviderStatus(p.CallStatus);
  if (!status) return { ok: true, ignored: 'unmapped status' };
  const duration = p.CallDuration ? Number(p.CallDuration) : undefined;
  const failed = status === 'FAILED';
  await applyCallStatus(call.id, status, {
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
    errorCode: failed ? p.ErrorCode ?? 'PROVIDER_FAILED' : undefined,
    errorMessage: failed ? 'The carrier or provider reported that the call failed.' : undefined,
    payload: { providerStatus: p.CallStatus, sip: p.SipResponseCode, answeredBy: p.AnsweredBy },
  });
  return { ok: true };
});
