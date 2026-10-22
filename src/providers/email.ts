import nodemailer from 'nodemailer';
import { getEnv } from '@/lib/env';
import { ProviderError, ProviderNotConfiguredError, type EmailMessage, type EmailProvider, type ProviderStatus } from './types';

function fromAddress(msg: EmailMessage): string {
  const env = getEnv();
  if (msg.from) return msg.from;
  const addr = env.EMAIL_FROM!;
  return env.EMAIL_FROM_NAME ? `${env.EMAIL_FROM_NAME} <${addr}>` : addr;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly supportsDeliveryStatus = true;

  status(): ProviderStatus {
    const env = getEnv();
    const missing = [!env.RESEND_API_KEY && 'RESEND_API_KEY', !env.EMAIL_FROM && 'EMAIL_FROM'].filter(Boolean) as string[];
    return { configured: missing.length === 0, missing };
  }

  async send(msg: EmailMessage) {
    const st = this.status();
    if (!st.configured) throw new ProviderNotConfiguredError(this.name, st.missing);
    const env = getEnv();
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromAddress(msg),
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          headers: msg.headers,
          attachments: msg.attachments?.map((a) => ({ filename: a.filename, path: a.url })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError(this.name, `Resend request failed: ${(err as Error).message}`, { retryable: true });
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      throw new ProviderError(this.name, `Resend rejected the message (${res.status}): ${json.message ?? json.name ?? 'unknown error'}`, {
        retryable: res.status >= 500 || res.status === 429,
        status: res.status,
        code: json.name,
      });
    }
    return { providerMessageId: json.id ?? null };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  // SMTP only confirms the server accepted the message; it cannot confirm delivery.
  readonly supportsDeliveryStatus = false;

  status(): ProviderStatus {
    const env = getEnv();
    const missing = [!env.SMTP_HOST && 'SMTP_HOST', !env.EMAIL_FROM && 'EMAIL_FROM'].filter(Boolean) as string[];
    return { configured: missing.length === 0, missing, detail: 'SMTP reports acceptance only, never delivery.' };
  }

  async send(msg: EmailMessage) {
    const st = this.status();
    if (!st.configured) throw new ProviderNotConfiguredError(this.name, st.missing);
    const env = getEnv();
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      const info = await transport.sendMail({
        from: fromAddress(msg),
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        headers: msg.headers,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, path: a.url })),
      });
      return { providerMessageId: info.messageId ?? null };
    } catch (err) {
      const e = err as { responseCode?: number; message: string };
      throw new ProviderError(this.name, `SMTP send failed: ${e.message}`, {
        retryable: !e.responseCode || e.responseCode >= 500 || e.responseCode === 421 || e.responseCode === 450,
        status: e.responseCode,
      });
    } finally {
      transport.close();
    }
  }
}

export class NoEmailProvider implements EmailProvider {
  readonly name = 'none';
  readonly supportsDeliveryStatus = false;
  status(): ProviderStatus {
    return { configured: false, missing: ['EMAIL_PROVIDER (resend | smtp)'] };
  }
  async send(): Promise<never> {
    throw new ProviderNotConfiguredError(this.name, ['EMAIL_PROVIDER']);
  }
}
