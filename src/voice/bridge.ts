import { verifyToken } from '@/lib/crypto';
import { logger, maskPhone } from '@/lib/logger';
import type { TranscriptSegment } from '@/db/schema';
import { buildInstructions, renderGreeting } from './prompt';

/** The minimal socket surface we rely on — satisfied by `ws` and by test fakes. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: Buffer | string) => void): unknown;
  on(event: 'close', cb: (code: number, reason?: Buffer) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'open', cb: () => void): unknown;
}
export const WS_OPEN = 1;

export type BridgeCall = {
  id: string;
  status: string;
  isDemo: boolean;
  providerCallSid: string | null;
  customerId: string;
  toNumber: string;
};
export type BridgeAgent = Parameters<typeof buildInstructions>[0];
export type BridgeCustomer = { id: string; name: string; company: string | null; productInterest: string | null };

/** Everything the bridge needs from the outside world. Injected so the protocol logic is unit-testable. */
export interface BridgeDeps {
  protocol: 'ga' | 'beta';
  realtimeModel?: string;
  transcribeModel: string;
  connectOpenAI(model: string): SocketLike;
  load(callId: string): Promise<{ call: BridgeCall; agent: BridgeAgent; customer: BridgeCustomer } | null>;
  isHaltRequested(): Promise<boolean>; // kill switch or non-live mode
  addEvent(callId: string, type: string, payload?: Record<string, unknown>): Promise<void>;
  saveTranscript(callId: string, segments: TranscriptSegment[], language: string): Promise<void>;
  markAnswered(callId: string): Promise<void>;
  optOut(customerId: string, callId: string): Promise<void>;
  requestHuman(callId: string, customerId: string, reason: string): Promise<void>;
  hangup(providerCallSid: string): Promise<void>;
  transfer(providerCallSid: string, e164: string): Promise<void>;
  fallbackSay(providerCallSid: string, text: string): Promise<void>;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}

type ToolName = 'end_call' | 'mark_do_not_contact' | 'request_human_followup';

const TOOLS = [
  { type: 'function', name: 'end_call', description: 'Hang up politely after saying goodbye. Use when the conversation is finished.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  { type: 'function', name: 'mark_do_not_contact', description: 'Record that the customer does not want to be contacted again. Use immediately when they ask you to stop calling.', parameters: { type: 'object', properties: {}, required: [] } },
  { type: 'function', name: 'request_human_followup', description: 'Ask a human colleague to take over or follow up (customer asked for a person, or you lack the information).', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
];

const BYTES_PER_MS = 8; // 8 kHz G.711 → 8 bytes per ms

/**
 * One phone call: bridges Twilio Media Streams (G.711 μ-law, base64) and the OpenAI Realtime API.
 * Both sides use μ-law natively so audio is forwarded without transcoding.
 */
export class CallBridge {
  private streamSid: string | null = null;
  private callId: string | null = null;
  private ctx: Awaited<ReturnType<BridgeDeps['load']>> = null;
  private ai: SocketLike | null = null;
  private aiReady = false;
  private started = false;
  private closed = false;
  private pendingAudio: string[] = [];
  private segments: TranscriptSegment[] = [];
  private lastAssistantItem: string | null = null;
  private assistantMsSent = 0;
  private endAfterResponse = false;
  private humanRequested = false;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;
  private endFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private t: NonNullable<BridgeDeps['timers']>;
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor(private twilio: SocketLike, private deps: BridgeDeps) {
    this.t = deps.timers ?? { setTimeout, clearTimeout };
    this.done = new Promise((r) => (this.resolveDone = r));
    twilio.on('message', (d) => void this.onTwilio(d).catch((e) => this.fail('twilio_handler_error', e)));
    twilio.on('close', () => void this.finish('twilio_closed'));
    twilio.on('error', (e) => logger.warn({ callId: this.callId, err: e.message }, 'twilio socket error'));
  }

  get activeCallId() { return this.callId; }

  /* ----------------------------- Twilio side ----------------------------- */
  private async onTwilio(raw: Buffer | string) {
    let msg: { event: string; streamSid?: string; start?: { streamSid: string; callSid?: string; customParameters?: Record<string, string> }; media?: { payload: string; track?: string }; mark?: { name: string } };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.event) {
      case 'start': return this.onStart(msg.start!);
      case 'media': {
        if (!this.started || !msg.media || (msg.media.track && msg.media.track !== 'inbound')) return;
        if (this.aiReady) this.aiSend({ type: 'input_audio_buffer.append', audio: msg.media.payload });
        else if (this.pendingAudio.length < 250) this.pendingAudio.push(msg.media.payload); // ~5s buffer while the model connects
        return;
      }
      case 'mark': {
        if (msg.mark?.name === 'end-call') await this.hangup('agent_ended');
        return;
      }
      case 'stop': return void (await this.finish('twilio_stop'));
      default: return;
    }
  }

  private async onStart(start: { streamSid: string; callSid?: string; customParameters?: Record<string, string> }) {
    if (this.started) return;
    const token = verifyToken<{ callId: string; purpose: string }>(start.customParameters?.token);
    if (!token || token.purpose !== 'media-stream' || token.callId !== start.customParameters?.callId) {
      logger.warn('voice gateway: rejected stream with invalid token');
      this.twilio.close(1008, 'unauthorized');
      this.resolveDone();
      return;
    }
    const loaded = await this.deps.load(token.callId);
    if (!loaded || loaded.call.isDemo || ['COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED'].includes(loaded.call.status)) {
      logger.warn({ callId: token.callId }, 'voice gateway: call not eligible for streaming');
      this.twilio.close(1008, 'call not eligible');
      this.resolveDone();
      return;
    }
    if (loaded.call.providerCallSid && start.callSid && loaded.call.providerCallSid !== start.callSid) {
      this.twilio.close(1008, 'call mismatch');
      this.resolveDone();
      return;
    }
    if (await this.deps.isHaltRequested()) {
      await this.deps.addEvent(token.callId, 'halted_before_stream');
      await this.safeHangup(loaded.call.providerCallSid);
      this.twilio.close(1000, 'halted');
      this.resolveDone();
      return;
    }
    this.ctx = loaded;
    this.callId = token.callId;
    this.streamSid = start.streamSid;
    this.started = true;
    await this.deps.markAnswered(token.callId);
    await this.deps.addEvent(token.callId, 'stream_started', { to: maskPhone(loaded.call.toNumber) });
    this.connectAI();

    const ms = loaded.agent.maxCallSeconds * 1000;
    this.maxTimer = this.t.setTimeout(() => void this.hangup('max_duration'), ms);
    if (ms > 40_000) this.warnTimer = this.t.setTimeout(() => this.wrapUp(), ms - 25_000);
  }

  /* ----------------------------- OpenAI side ----------------------------- */
  private connectAI() {
    const { agent } = this.ctx!;
    const model = agent.model || this.deps.realtimeModel || 'gpt-realtime';
    try {
      this.ai = this.deps.connectOpenAI(model);
    } catch (e) {
      void this.fail('openai_connect_failed', e);
      return;
    }
    const connectTimeout = this.t.setTimeout(() => { if (!this.aiReady) void this.fail('openai_connect_timeout', new Error('timeout')); }, 10_000);
    this.ai.on('open', () => { this.t.clearTimeout(connectTimeout); this.configureSession(); });
    this.ai.on('message', (d) => this.onAI(d));
    this.ai.on('error', (e) => void this.fail('openai_socket_error', e));
    this.ai.on('close', () => { if (!this.closed && !this.endAfterResponse) void this.fail('openai_closed', new Error('closed unexpectedly')); });
  }

  private configureSession() {
    const { agent, customer } = this.ctx!;
    const instructions = buildInstructions(agent, customer, { transferAvailable: !!agent.humanTransferNumber });
    const vad = { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600, create_response: true, interrupt_response: true };
    if (this.deps.protocol === 'ga') {
      this.aiSend({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions,
          output_modalities: ['audio'],
          audio: {
            input: { format: { type: 'audio/pcmu' }, turn_detection: vad, transcription: { model: this.deps.transcribeModel, language: agent.language.split('-')[0] } },
            output: { format: { type: 'audio/pcmu' }, voice: agent.voiceId },
          },
          tools: TOOLS,
          tool_choice: 'auto',
        },
      });
    } else {
      this.aiSend({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'], instructions, voice: agent.voiceId, input_audio_format: 'g711_ulaw', output_audio_format: 'g711_ulaw',
          turn_detection: vad, input_audio_transcription: { model: 'whisper-1' }, tools: TOOLS, tool_choice: 'auto', temperature: 0.7,
        },
      });
    }
  }

  private onAI(raw: Buffer | string) {
    let e: Record<string, any>;
    try { e = JSON.parse(raw.toString()); } catch { return; }
    switch (e.type) {
      case 'session.updated': {
        if (this.aiReady) return;
        this.aiReady = true;
        for (const p of this.pendingAudio) this.aiSend({ type: 'input_audio_buffer.append', audio: p });
        this.pendingAudio = [];
        // The agent speaks first, with the approved AI-disclosing greeting.
        const { agent, customer } = this.ctx!;
        this.aiSend({ type: 'response.create', response: { instructions: `Say this opening line now, naturally and in full, then stop and wait: "${renderGreeting(agent, customer)}"` } });
        return;
      }
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        if (!e.delta || !this.streamSid) return;
        if (e.item_id && e.item_id !== this.lastAssistantItem) { this.lastAssistantItem = e.item_id; this.assistantMsSent = 0; }
        this.assistantMsSent += Buffer.from(e.delta, 'base64').length / BYTES_PER_MS;
        this.twilioSend({ event: 'media', streamSid: this.streamSid, media: { payload: e.delta } });
        return;
      }
      case 'input_audio_buffer.speech_started': {
        // Barge-in: stop what the caller hears and tell the model how much of the answer was actually spoken.
        if (this.streamSid) this.twilioSend({ event: 'clear', streamSid: this.streamSid });
        if (this.lastAssistantItem && this.assistantMsSent > 0) {
          this.aiSend({ type: 'conversation.item.truncate', item_id: this.lastAssistantItem, content_index: 0, audio_end_ms: Math.floor(this.assistantMsSent) });
        }
        this.assistantMsSent = 0;
        this.lastAssistantItem = null;
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(e.transcript ?? '').trim();
        if (text) this.addSegment('customer', text);
        return;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const text = String(e.transcript ?? '').trim();
        if (text) this.addSegment('agent', text);
        return;
      }
      case 'response.function_call_arguments.done':
        void this.onTool(e.name as ToolName, e.call_id as string, e.arguments as string).catch((err) => logger.error({ callId: this.callId, err: (err as Error).message }, 'tool error'));
        return;
      case 'response.done': {
        if (this.endAfterResponse && this.streamSid) {
          // Let the goodbye finish playing: Twilio echoes this mark once all queued audio has played.
          this.twilioSend({ event: 'mark', streamSid: this.streamSid, mark: { name: 'end-call' } });
          if (!this.endFallbackTimer) this.endFallbackTimer = this.t.setTimeout(() => void this.hangup('agent_ended'), 8_000);
        }
        return;
      }
      case 'error':
        logger.warn({ callId: this.callId, code: e.error?.code, msg: e.error?.message }, 'openai realtime error event');
        void this.deps.addEvent(this.callId!, 'openai_error', { code: e.error?.code ?? null });
        return;
      default:
        return;
    }
  }

  private async onTool(name: ToolName, callItemId: string, rawArgs: string) {
    const callId = this.callId!;
    let args: { reason?: string } = {};
    try { args = JSON.parse(rawArgs || '{}'); } catch { /* ignore */ }
    let output = 'ok';
    switch (name) {
      case 'mark_do_not_contact':
        await this.deps.optOut(this.ctx!.customer.id, callId);
        await this.deps.addEvent(callId, 'tool_mark_do_not_contact');
        output = 'The customer has been added to the do-not-contact list. Apologise briefly, say goodbye, then call end_call.';
        break;
      case 'request_human_followup': {
        this.humanRequested = true;
        await this.deps.requestHuman(callId, this.ctx!.customer.id, String(args.reason ?? 'Customer asked for a person').slice(0, 300));
        await this.deps.addEvent(callId, 'tool_request_human_followup', { reason: args.reason ?? null });
        const num = this.ctx!.agent.humanTransferNumber;
        if (num && this.ctx!.call.providerCallSid) {
          output = 'Tell the customer you are connecting them to a colleague now.';
          this.aiSend({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callItemId, output } });
          this.aiSend({ type: 'response.create' });
          this.t.setTimeout(() => void this.doTransfer(num), 4_000);
          return;
        }
        output = 'Tell the customer a colleague will contact them shortly, then say goodbye and call end_call.';
        break;
      }
      case 'end_call':
        await this.deps.addEvent(callId, 'tool_end_call', { reason: args.reason ?? null });
        this.endAfterResponse = true;
        output = 'Say a brief goodbye if you have not already.';
        break;
      default:
        output = 'Unknown tool';
    }
    this.aiSend({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callItemId, output } });
    this.aiSend({ type: 'response.create' });
  }

  private async doTransfer(num: string) {
    const sid = this.ctx?.call.providerCallSid;
    if (!sid || this.closed) return;
    try {
      await this.deps.addEvent(this.callId!, 'transfer_started');
      await this.deps.transfer(sid, num);
    } catch (e) {
      await this.deps.addEvent(this.callId!, 'transfer_failed', { error: (e as Error).message.slice(0, 200) });
    }
  }

  private wrapUp() {
    if (!this.aiReady || this.closed) return;
    this.aiSend({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[system] The call time limit is almost reached. Politely wrap up in one sentence and say goodbye.' }] } });
    this.aiSend({ type: 'response.create' });
    this.endAfterResponse = true;
  }

  private addSegment(role: 'agent' | 'customer', text: string) {
    this.segments.push({ role, text, at: new Date().toISOString() });
    // Persist as we go so a gateway crash does not lose the conversation.
    void this.deps.saveTranscript(this.callId!, this.segments, this.ctx!.agent.language).catch((e) => logger.warn({ err: (e as Error).message }, 'transcript save failed'));
  }

  /* ----------------------------- lifecycle ----------------------------- */
  private async safeHangup(sid: string | null | undefined) {
    if (!sid) return;
    try { await this.deps.hangup(sid); } catch (e) { logger.warn({ err: (e as Error).message }, 'hangup failed'); }
  }

  async hangup(reason: string) {
    if (this.closed) return;
    await this.deps.addEvent(this.callId!, 'hangup', { reason }).catch(() => undefined);
    await this.safeHangup(this.ctx?.call.providerCallSid);
    await this.finish(reason);
  }

  /** AI unavailable → apologise on the line and end, rather than leaving silence or pretending to be someone else. */
  private async fail(code: string, err: unknown) {
    if (this.closed) return;
    logger.error({ callId: this.callId, code, err: (err as Error)?.message }, 'voice bridge failure');
    if (this.callId) await this.deps.addEvent(this.callId, code, { error: String((err as Error)?.message ?? err).slice(0, 200) }).catch(() => undefined);
    const sid = this.ctx?.call.providerCallSid;
    if (sid && !this.aiReady) {
      try { await this.deps.fallbackSay(sid, 'We are sorry, we are unable to take your call right now. A member of our team will be in touch. Goodbye.'); } catch { await this.safeHangup(sid); }
    } else {
      await this.safeHangup(sid);
    }
    await this.finish(code);
  }

  async finish(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const tm of [this.maxTimer, this.warnTimer, this.endFallbackTimer]) if (tm) this.t.clearTimeout(tm);
    try { if (this.ai && this.ai.readyState === WS_OPEN) this.ai.close(1000); } catch { /* ignore */ }
    try { if (this.twilio.readyState === WS_OPEN) this.twilio.close(1000); } catch { /* ignore */ }
    if (this.callId && this.ctx) {
      if (this.segments.length) await this.deps.saveTranscript(this.callId, this.segments, this.ctx.agent.language).catch(() => undefined);
      await this.deps.addEvent(this.callId, 'stream_ended', { reason, humanRequested: this.humanRequested }).catch(() => undefined);
    }
    this.resolveDone();
  }

  private aiSend(obj: unknown) {
    if (this.ai && this.ai.readyState === WS_OPEN) this.ai.send(JSON.stringify(obj));
  }
  private twilioSend(obj: unknown) {
    if (this.twilio.readyState === WS_OPEN) this.twilio.send(JSON.stringify(obj));
  }
}
