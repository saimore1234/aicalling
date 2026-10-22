import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { aiAgents, calls, customers, type TranscriptSegment } from '@/db/schema';
import { sha256 } from '@/lib/crypto';
import { applyCallStatus, saveTranscript } from './calls';
import { renderGreeting } from '@/voice/prompt';

type Scenario = { key: string; final: 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'FAILED'; lines: string[]; seconds: number };

/** Scripted scenarios used ONLY in demo mode. They exercise every outcome path without any real call. */
export const SCENARIOS: Scenario[] = [
  { key: 'interested', final: 'COMPLETED', seconds: 74, lines: ['Yes, now is fine.', "That sounds good, I'm interested. Can you send me more details?"] },
  { key: 'meeting', final: 'COMPLETED', seconds: 96, lines: ['Sure, go ahead.', "I'd like a demo with your team. Can we schedule a meeting for next week?"] },
  { key: 'qualified', final: 'COMPLETED', seconds: 121, lines: ['Yes, I have a minute.', "We have a budget set aside this quarter and I'm interested, tell me more."] },
  { key: 'callback', final: 'COMPLETED', seconds: 31, lines: ["I'm in a meeting right now, please call me back tomorrow."] },
  { key: 'not_interested', final: 'COMPLETED', seconds: 28, lines: ['Hello?', "No, thanks. It's not something we need."] },
  { key: 'dnc', final: 'COMPLETED', seconds: 19, lines: ['Please stop calling me. Do not call again and remove my number.'] },
  { key: 'human', final: 'COMPLETED', seconds: 44, lines: ['Hi.', 'I would rather talk to a human, can I speak to a person?'] },
  { key: 'wrong', final: 'COMPLETED', seconds: 17, lines: ["Sorry, you have the wrong number. I don't know who that is."] },
  { key: 'no_answer', final: 'NO_ANSWER', seconds: 0, lines: [] },
  { key: 'busy', final: 'BUSY', seconds: 0, lines: [] },
];

export function pickScenario(customerId: string, attempt: number): Scenario {
  const n = parseInt(sha256(customerId).slice(0, 8), 16);
  // A retry after no-answer/busy should be able to connect, so shift the pick on later attempts.
  return SCENARIOS[(n + attempt * 3) % SCENARIOS.length]!;
}

export async function simulateDemoCall(callId: string) {
  const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  if (!call || !call.isDemo) return; // never simulate a non-demo call
  const [customer] = await db.select().from(customers).where(eq(customers.id, call.customerId)).limit(1);
  const [agent] = await db.select().from(aiAgents).where(eq(aiAgents.id, call.agentId)).limit(1);
  if (!customer || !agent) return;
  const sc = pickScenario(customer.id, call.attemptNumber);
  const t0 = Date.now();
  const at = (s: number) => new Date(t0 + s * 1000);

  await applyCallStatus(callId, 'INITIATED', { at: at(0), payload: { demo: true, scenario: sc.key } });
  await applyCallStatus(callId, 'RINGING', { at: at(1), payload: { demo: true } });
  if (sc.final !== 'COMPLETED') {
    await applyCallStatus(callId, sc.final, { at: at(25), payload: { demo: true } });
    return;
  }
  await applyCallStatus(callId, 'IN_PROGRESS', { at: at(6), payload: { demo: true } });
  const segs: TranscriptSegment[] = [{ role: 'system', text: '[DEMO] Simulated conversation — no real call or audio.', at: at(6).toISOString() }];
  let s = 8;
  segs.push({ role: 'agent', text: renderGreeting(agent, customer), at: at(s).toISOString() });
  for (const line of sc.lines) {
    s += 6;
    segs.push({ role: 'customer', text: line, at: at(s).toISOString() });
    s += 5;
    segs.push({ role: 'agent', text: sc.key === 'dnc' ? 'I understand, I apologise. I will make sure you are not contacted again. Goodbye.' : 'Thank you, I have noted that.', at: at(s).toISOString() });
  }
  await saveTranscript(callId, segs, { language: agent.language, isDemo: true });
  await applyCallStatus(callId, 'COMPLETED', { at: at(6 + sc.seconds), durationSeconds: sc.seconds, endReason: 'demo_completed' });
}
