import twilio from 'twilio';
import { getEnv } from '@/lib/env';
import { ProviderError, ProviderNotConfiguredError, type ProviderStatus, type SmsMessage, type SmsProvider } from './types';

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  status(): ProviderStatus {
    const env = getEnv();
    const missing = [
      !env.TWILIO_ACCOUNT_SID && 'TWILIO_ACCOUNT_SID',
      !env.TWILIO_AUTH_TOKEN && 'TWILIO_AUTH_TOKEN',
      !env.TWILIO_SMS_FROM && !env.TWILIO_MESSAGING_SERVICE_SID && 'TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID',
    ].filter(Boolean) as string[];
    return { configured: missing.length === 0, missing };
  }

  async send(msg: SmsMessage) {
    const st = this.status();
    if (!st.configured) throw new ProviderNotConfiguredError(this.name, st.missing);
    const env = getEnv();
    const client = twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
    try {
      const params: Record<string, unknown> = { to: msg.to, statusCallback: msg.statusCallbackUrl };
      if (env.TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
      else params.from = env.TWILIO_SMS_FROM;
      if (msg.contentSid) params.contentSid = msg.contentSid;
      else params.body = msg.body;
      const res = await client.messages.create(params as never);
      return { providerMessageId: (res as { sid: string }).sid };
    } catch (err) {
      const e = err as { status?: number; code?: number; message: string };
      throw new ProviderError(this.name, `Twilio SMS failed: ${e.message}`, {
        retryable: !e.status || e.status >= 500 || e.status === 429,
        status: e.status,
        code: e.code ? String(e.code) : undefined,
      });
    }
  }
}
