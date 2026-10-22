import OpenAI from 'openai';
import { getEnv } from '@/lib/env';
import { QUALIFICATION_JSON_SCHEMA } from '@/server/qualification-schema';
import {
  ProviderError,
  ProviderNotConfiguredError,
  type AnalysisInput,
  type AnalysisProvider,
  type ProviderStatus,
} from './types';

const SYSTEM_PROMPT = `You classify the outcome of an outbound AI sales call from its transcript.
Rules:
- Base every field ONLY on what the customer actually said. Never infer interest that was not expressed.
- "outcome" must be exactly one allowed value. Use DO_NOT_CONTACT if the customer asked not to be called or contacted again, in any language.
- "evidence" must contain short verbatim customer quotes that justify the outcome (max 5).
- "callback_at": only if the customer gave a specific time; resolve relative times ("tomorrow at 5") using the provided current time and customer timezone and return ISO 8601 with offset. Otherwise null.
- "score" is 0-100 likelihood the lead becomes a customer, justified in "reason".
- Do not invent prices, features or commitments in the summary.`;

export class OpenAIAnalysisProvider implements AnalysisProvider {
  readonly name = 'openai';

  status(): ProviderStatus {
    const missing = getEnv().OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'];
    return { configured: missing.length === 0, missing };
  }

  async analyzeCall(input: AnalysisInput) {
    const st = this.status();
    if (!st.configured) throw new ProviderNotConfiguredError(this.name, st.missing);
    const env = getEnv();
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL, timeout: 45_000, maxRetries: 2 });
    try {
      const res = await client.chat.completions.create({
        model: input.model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `Current time: ${input.nowIso}`,
              `Customer timezone: ${input.customerTimezone ?? 'unknown'}`,
              `Customer: ${input.customerName}${input.company ? ` (${input.company})` : ''}`,
              `Call language: ${input.language}`,
              input.productContext ? `Product context:\n${input.productContext}` : '',
              input.qualificationQuestions.length ? `Qualification questions the agent should have covered:\n- ${input.qualificationQuestions.join('\n- ')}` : '',
              `Transcript:\n${input.transcript}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'call_qualification', strict: true, schema: QUALIFICATION_JSON_SCHEMA as never } },
      });
      const choice = res.choices[0]?.message;
      if (choice?.refusal) throw new ProviderError(this.name, `Model refused to analyse the call: ${choice.refusal}`);
      if (!choice?.content) throw new ProviderError(this.name, 'Model returned no content', { retryable: true });
      let parsed: unknown;
      try {
        parsed = JSON.parse(choice.content);
      } catch {
        throw new ProviderError(this.name, 'Model returned invalid JSON', { retryable: true });
      }
      return { output: parsed, model: res.model ?? input.model };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const e = err as { status?: number; message: string };
      throw new ProviderError(this.name, `OpenAI analysis failed: ${e.message}`, {
        retryable: !e.status || e.status >= 500 || e.status === 429,
        status: e.status,
      });
    }
  }
}

/** Rule-based classifier used ONLY in demo mode so the full pipeline can run with no paid accounts. */
export class DemoAnalysisProvider implements AnalysisProvider {
  readonly name = 'demo';
  status(): ProviderStatus {
    return { configured: true, missing: [], detail: 'Rule-based demo classifier — not AI.' };
  }
  async analyzeCall(input: AnalysisInput) {
    const customerLines = input.transcript
      .split('\n')
      .filter((l) => /^customer:/i.test(l))
      .map((l) => l.replace(/^customer:\s*/i, '').trim());
    const text = customerLines.join(' ').toLowerCase();
    const has = (...w: string[]) => w.some((x) => text.includes(x));
    const quote = (...w: string[]) => customerLines.filter((l) => w.some((x) => l.toLowerCase().includes(x))).slice(0, 3);

    let outcome = 'NOT_INTERESTED';
    let score = 15;
    let evidence = customerLines.slice(0, 2);
    let nextStep: string | null = null;
    let callbackAt: string | null = null;
    if (has('do not call', "don't call", 'stop calling', 'remove my number')) {
      outcome = 'DO_NOT_CONTACT';
      score = 0;
      evidence = quote('do not call', "don't call", 'stop calling', 'remove my number');
    } else if (has('wrong number', 'not the right person')) {
      outcome = 'WRONG_NUMBER';
      score = 0;
      evidence = quote('wrong number', 'not the right person');
    } else if (has('speak to a person', 'talk to a human', 'real person', 'your manager')) {
      outcome = 'HUMAN_REQUIRED';
      score = 40;
      evidence = quote('speak to a person', 'talk to a human', 'real person', 'your manager');
      nextStep = 'Human sales executive to contact the customer';
    } else if (has('demo', 'meeting', 'schedule a')) {
      outcome = 'MEETING_REQUESTED';
      score = 80;
      evidence = quote('demo', 'meeting', 'schedule a');
      nextStep = 'Schedule a demonstration with the sales team';
    } else if (has('call me back', 'call back', 'later this', 'tomorrow')) {
      outcome = 'CALLBACK_REQUESTED';
      score = 45;
      evidence = quote('call me back', 'call back', 'later this', 'tomorrow');
      nextStep = 'Call back at the requested time';
      callbackAt = new Date(new Date(input.nowIso).getTime() + 24 * 3600 * 1000).toISOString();
    } else if (has('budget') && has('interested', 'tell me more', 'sounds good')) {
      outcome = 'QUALIFIED';
      score = 70;
      evidence = quote('budget', 'interested', 'tell me more');
      nextStep = 'Assign to a sales executive';
    } else if (has('interested', 'tell me more', 'sounds good', 'send me')) {
      outcome = 'INTERESTED';
      score = 60;
      evidence = quote('interested', 'tell me more', 'sounds good', 'send me');
      nextStep = 'Send product information';
    }
    return {
      model: 'demo-rules',
      output: {
        outcome,
        score,
        interest_level: score >= 60 ? 'high' : score >= 35 ? 'medium' : score > 0 ? 'low' : 'none',
        reason: `[DEMO] Rule-based classification from customer statements.`,
        evidence,
        next_step: nextStep,
        callback_at: callbackAt,
        meeting_preference: outcome === 'MEETING_REQUESTED' ? 'Customer asked for a demonstration' : null,
        opt_out_requested: outcome === 'DO_NOT_CONTACT',
        human_requested: outcome === 'HUMAN_REQUIRED',
        summary: `[DEMO] ${customerLines.length} customer turn(s). Outcome: ${outcome}.`,
      },
    };
  }
}
