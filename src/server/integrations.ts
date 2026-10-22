import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { db } from '@/db/client';
import { integrationConfigurations } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { sanitizeError } from '@/lib/logger';
import { getAppSettings } from '@/lib/settings';
import { getAnalysisProvider, getEmailProvider, getSmsProvider, getTelephonyProvider, getWhatsAppProvider } from '@/providers';

export type IntegrationKey = 'openai' | 'twilio-voice' | 'twilio-sms' | 'email' | 'whatsapp';
export const INTEGRATION_KEYS: IntegrationKey[] = ['openai', 'twilio-voice', 'twilio-sms', 'email', 'whatsapp'];

const LABEL: Record<IntegrationKey, string> = {
  openai: 'OpenAI (real-time voice + call analysis)',
  'twilio-voice': 'Twilio Voice (telephony)',
  'twilio-sms': 'Twilio SMS',
  email: 'Email (Resend or SMTP)',
  whatsapp: 'WhatsApp Business (Meta Cloud API)',
};

/** Names of environment variables only — values are never read into responses. */
export function integrationOverview() {
  const env = getEnv();
  const base = (env.APP_URL ?? '').replace(/\/$/, '');
  const present = (v: unknown) => !!v;
  const sms = getSmsProvider().status();
  const tel = getTelephonyProvider('live').status();
  const email = getEmailProvider();
  const emailSt = email.status();
  const wa = getWhatsAppProvider().status();
  const openaiMissing = [!env.OPENAI_API_KEY && 'OPENAI_API_KEY'].filter(Boolean) as string[];
  return [
    { key: 'openai' as const, label: LABEL.openai, configured: openaiMissing.length === 0, missing: openaiMissing, env: { OPENAI_API_KEY: present(env.OPENAI_API_KEY) }, webhooks: [] as string[] },
    { key: 'twilio-voice' as const, label: LABEL['twilio-voice'], configured: tel.configured, missing: tel.missing, env: { TWILIO_ACCOUNT_SID: present(env.TWILIO_ACCOUNT_SID), TWILIO_AUTH_TOKEN: present(env.TWILIO_AUTH_TOKEN), TWILIO_VOICE_FROM: present(env.TWILIO_VOICE_FROM), VOICE_GATEWAY_PUBLIC_URL: present(env.VOICE_GATEWAY_PUBLIC_URL), APP_URL: present(env.APP_URL) },
      webhooks: [`${base}/api/webhooks/twilio/voice  (set per call automatically)`, `${base}/api/webhooks/twilio/status  (set per call automatically)`] },
    { key: 'twilio-sms' as const, label: LABEL['twilio-sms'], configured: sms.configured, missing: sms.missing, env: { TWILIO_SMS_FROM: present(env.TWILIO_SMS_FROM), TWILIO_MESSAGING_SERVICE_SID: present(env.TWILIO_MESSAGING_SERVICE_SID) },
      webhooks: [`${base}/api/webhooks/twilio/sms-status  (status callback, set per message)`, `${base}/api/webhooks/twilio/sms-inbound  (configure on the number: "A message comes in")`] },
    { key: 'email' as const, label: `${LABEL.email} — active: ${email.name}`, configured: emailSt.configured, missing: emailSt.missing, env: { EMAIL_PROVIDER: env.EMAIL_PROVIDER, EMAIL_FROM: present(env.EMAIL_FROM), RESEND_API_KEY: present(env.RESEND_API_KEY), RESEND_WEBHOOK_SECRET: present(env.RESEND_WEBHOOK_SECRET), SMTP_HOST: present(env.SMTP_HOST) },
      webhooks: env.EMAIL_PROVIDER === 'resend' ? [`${base}/api/webhooks/resend`] : [] },
    { key: 'whatsapp' as const, label: LABEL.whatsapp, configured: wa.configured, missing: wa.missing, env: { WHATSAPP_ACCESS_TOKEN: present(env.WHATSAPP_ACCESS_TOKEN), WHATSAPP_PHONE_NUMBER_ID: present(env.WHATSAPP_PHONE_NUMBER_ID), WHATSAPP_APP_SECRET: present(env.WHATSAPP_APP_SECRET), WHATSAPP_VERIFY_TOKEN: present(env.WHATSAPP_VERIFY_TOKEN) },
      webhooks: [`${base}/api/webhooks/whatsapp  (callback URL + verify token in Meta app dashboard)`] },
  ];
}

async function http(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Lightweight connectivity check. Never places a call or sends a message. */
export async function checkIntegration(key: IntegrationKey): Promise<{ ok: boolean; error?: string }> {
  const env = getEnv();
  const row = integrationOverview().find((i) => i.key === key)!;
  let result: { ok: boolean; error?: string };
  if (!row.configured) {
    result = { ok: false, error: `Not configured. Missing: ${row.missing.join(', ')}` };
  } else {
    try {
      switch (key) {
        case 'openai':
          await http(`${env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/models`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
          break;
        case 'twilio-voice':
        case 'twilio-sms':
          await twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!).api.accounts(env.TWILIO_ACCOUNT_SID!).fetch();
          break;
        case 'email':
          if (env.EMAIL_PROVIDER === 'resend') await http('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
          else await nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined }).verify();
          break;
        case 'whatsapp':
          await http(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}`, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } });
          break;
      }
      result = { ok: true };
    } catch (err) {
      result = { ok: false, error: sanitizeError(err) };
    }
  }
  await db.insert(integrationConfigurations)
    .values({ key, enabled: row.configured, status: result.ok ? 'OK' : row.configured ? 'ERROR' : 'NOT_CONFIGURED', lastCheckedAt: new Date(), lastError: result.error ?? null })
    .onConflictDoUpdate({ target: integrationConfigurations.key, set: { enabled: row.configured, status: result.ok ? 'OK' : row.configured ? 'ERROR' : 'NOT_CONFIGURED', lastCheckedAt: new Date(), lastError: result.error ?? null, updatedAt: new Date() } });
  return result;
}

export async function integrationStatuses() {
  const checks = await db.select().from(integrationConfigurations);
  const settings = await getAppSettings();
  const ready = {
    telephony: getTelephonyProvider('live').status(),
    analysis: getAnalysisProvider('live').status(),
  };
  return {
    mode: settings.mode,
    liveReady: ready.telephony.configured && ready.analysis.configured,
    integrations: integrationOverview().map((i) => {
      const c = checks.find((x) => x.key === i.key);
      return { ...i, lastCheckedAt: c?.lastCheckedAt ?? null, lastStatus: c?.status ?? null, lastError: c?.lastError ?? null };
    }),
  };
}
