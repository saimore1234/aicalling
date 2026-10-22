import twilio from 'twilio';
import { getEnv } from '@/lib/env';
import {
  ProviderError,
  ProviderNotConfiguredError,
  type PlaceCallRequest,
  type ProviderCallInfo,
  type ProviderStatus,
  type TelephonyProvider,
} from './types';

function twilioError(err: unknown, what: string): ProviderError {
  const e = err as { status?: number; code?: number; message: string };
  return new ProviderError('twilio', `Twilio ${what} failed: ${e.message}`, {
    retryable: !e.status || e.status >= 500 || e.status === 429,
    status: e.status,
    code: e.code ? String(e.code) : undefined,
  });
}

export class TwilioTelephonyProvider implements TelephonyProvider {
  readonly name = 'twilio';

  status(): ProviderStatus {
    const env = getEnv();
    const missing = [
      !env.TWILIO_ACCOUNT_SID && 'TWILIO_ACCOUNT_SID',
      !env.TWILIO_AUTH_TOKEN && 'TWILIO_AUTH_TOKEN',
      !env.TWILIO_VOICE_FROM && 'TWILIO_VOICE_FROM',
      !env.APP_URL && 'APP_URL (public https URL for webhooks)',
      !env.VOICE_GATEWAY_PUBLIC_URL && 'VOICE_GATEWAY_PUBLIC_URL (public wss URL of the voice gateway)',
      !env.OPENAI_API_KEY && 'OPENAI_API_KEY (real-time voice)',
    ].filter(Boolean) as string[];
    return { configured: missing.length === 0, missing };
  }

  private client() {
    const env = getEnv();
    return twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
  }

  async placeCall(req: PlaceCallRequest) {
    const st = this.status();
    if (!st.configured) throw new ProviderNotConfiguredError(this.name, st.missing);
    const env = getEnv();
    try {
      const call = await this.client().calls.create({
        to: req.to,
        from: req.from ?? env.TWILIO_VOICE_FROM!,
        url: req.voiceUrl,
        method: 'POST',
        statusCallback: req.statusCallbackUrl,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        timeout: req.ringTimeoutSeconds,
        timeLimit: req.maxDurationSeconds, // hard cap enforced by Twilio even if our gateway fails
      });
      return { providerCallId: call.sid, initialStatus: String(call.status) };
    } catch (err) {
      throw twilioError(err, 'call creation');
    }
  }

  async hangup(providerCallId: string) {
    try {
      await this.client().calls(providerCallId).update({ status: 'completed' });
    } catch (err) {
      // A call that already ended returns 404/20404 or 21220; treat as success.
      const e = err as { status?: number; code?: number };
      if (e.status === 404 || e.code === 21220) return;
      throw twilioError(err, 'hangup');
    }
  }

  async fetchCall(providerCallId: string): Promise<ProviderCallInfo | null> {
    try {
      const c = await this.client().calls(providerCallId).fetch();
      const price = c.price !== null && c.price !== undefined ? Math.abs(Number(c.price)) : undefined;
      return {
        status: String(c.status),
        durationSeconds: c.duration ? Number(c.duration) : undefined,
        price: Number.isFinite(price) ? price : undefined,
        priceUnit: c.priceUnit ?? undefined,
        startTime: c.startTime ?? undefined,
        endTime: c.endTime ?? undefined,
      };
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 404) return null;
      throw twilioError(err, 'call lookup');
    }
  }

  async redirect(providerCallId: string, instructionsXml: string) {
    try {
      await this.client().calls(providerCallId).update({ twiml: instructionsXml });
    } catch (err) {
      throw twilioError(err, 'call redirect');
    }
  }
}

/** Demo telephony: never touches a network. Calls are simulated by the worker and always labelled DEMO. */
export class DemoTelephonyProvider implements TelephonyProvider {
  readonly name = 'demo';
  status(): ProviderStatus {
    return { configured: true, missing: [], detail: 'Simulated — no real calls are placed.' };
  }
  async placeCall(req: PlaceCallRequest) {
    return { providerCallId: `demo-${req.callId}`, initialStatus: 'queued' };
  }
  async hangup() {
    /* nothing to hang up */
  }
  async fetchCall(): Promise<ProviderCallInfo | null> {
    return null;
  }
}
