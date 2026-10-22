import { getEnv } from '@/lib/env';
import { NoEmailProvider, ResendEmailProvider, SmtpEmailProvider } from './email';
import { TwilioSmsProvider } from './sms';
import { MetaWhatsAppProvider } from './whatsapp';
import { DemoTelephonyProvider, TwilioTelephonyProvider } from './telephony';
import { DemoAnalysisProvider, OpenAIAnalysisProvider } from './analysis';
import type { AnalysisProvider, EmailProvider, SmsProvider, TelephonyProvider, WhatsAppProvider } from './types';

type Overrides = Partial<{
  email: EmailProvider;
  sms: SmsProvider;
  whatsapp: WhatsAppProvider;
  telephony: TelephonyProvider;
  analysis: AnalysisProvider;
}>;

let overrides: Overrides = {};

/** Test hook: inject mock providers. Pass {} to reset. */
export function setProviderOverrides(o: Overrides) {
  overrides = o;
}

export function getEmailProvider(): EmailProvider {
  if (overrides.email) return overrides.email;
  const p = getEnv().EMAIL_PROVIDER;
  if (p === 'resend') return new ResendEmailProvider();
  if (p === 'smtp') return new SmtpEmailProvider();
  return new NoEmailProvider();
}
export function getSmsProvider(): SmsProvider {
  return overrides.sms ?? new TwilioSmsProvider();
}
export function getWhatsAppProvider(): WhatsAppProvider {
  return overrides.whatsapp ?? new MetaWhatsAppProvider();
}
/** Demo mode NEVER returns a real provider; live mode NEVER returns a demo one (no silent fallback). */
export function getTelephonyProvider(mode: 'demo' | 'live'): TelephonyProvider {
  if (overrides.telephony) return overrides.telephony;
  return mode === 'demo' ? new DemoTelephonyProvider() : new TwilioTelephonyProvider();
}
export function getAnalysisProvider(mode: 'demo' | 'live'): AnalysisProvider {
  if (overrides.analysis) return overrides.analysis;
  return mode === 'demo' ? new DemoAnalysisProvider() : new OpenAIAnalysisProvider();
}

export * from './types';
