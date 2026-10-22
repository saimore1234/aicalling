import { z } from 'zod';

const bool = (def = false) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('postgresql://vms:vms_dev_password@localhost:5432/vms_smart_calling'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  APP_URL: optionalStr, // public https URL of the web app (provider callbacks)
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters').optional(),
  SETUP_TOKEN: optionalStr,
  COOKIE_SECURE: bool(false),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(20),

  // AI
  OPENAI_API_KEY: optionalStr,
  OPENAI_BASE_URL: optionalStr,
  OPENAI_REALTIME_URL: z.string().default('wss://api.openai.com/v1/realtime'),
  /** 'ga' (default) or 'beta' wire protocol for the OpenAI Realtime API. */
  OPENAI_REALTIME_PROTOCOL: z.enum(['ga', 'beta']).default('ga'),
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-4o-mini-transcribe'),

  // Voice gateway
  VOICE_GATEWAY_PORT: z.coerce.number().int().default(8081),
  VOICE_GATEWAY_PUBLIC_URL: optionalStr, // wss://voice.example.com/media-stream

  // Twilio
  TWILIO_ACCOUNT_SID: optionalStr,
  TWILIO_AUTH_TOKEN: optionalStr,
  TWILIO_VOICE_FROM: optionalStr,
  TWILIO_SMS_FROM: optionalStr,
  TWILIO_MESSAGING_SERVICE_SID: optionalStr,

  // Email
  EMAIL_PROVIDER: z.enum(['resend', 'smtp', 'none']).default('none'),
  EMAIL_FROM: optionalStr,
  EMAIL_FROM_NAME: optionalStr,
  RESEND_API_KEY: optionalStr,
  RESEND_WEBHOOK_SECRET: optionalStr,
  SMTP_HOST: optionalStr,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optionalStr,
  SMTP_PASSWORD: optionalStr,
  SMTP_SECURE: bool(false),

  // WhatsApp Business Platform (Meta Cloud API)
  WHATSAPP_ACCESS_TOKEN: optionalStr,
  WHATSAPP_PHONE_NUMBER_ID: optionalStr,
  WHATSAPP_APP_SECRET: optionalStr,
  WHATSAPP_VERIFY_TOKEN: optionalStr,
  WHATSAPP_API_VERSION: z.string().default('v23.0'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests: drop the cached env so changed process.env values are re-read. */
export function resetEnvCache() {
  cached = null;
}

/** HMAC secret. Fails closed in production if unset; uses a clearly-insecure value only in dev/test. */
export function getAppSecret(): string {
  const env = getEnv();
  if (env.APP_SECRET) return env.APP_SECRET;
  if (env.NODE_ENV === 'production') {
    throw new Error('APP_SECRET is required in production (min 32 chars).');
  }
  return 'dev-only-insecure-secret-change-me-0123456789';
}
