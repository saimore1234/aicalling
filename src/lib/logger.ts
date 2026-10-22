import pino from 'pino';

const redactKeys = [
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'authorization',
  'cookie',
  'apiKey',
  'secret',
  'authToken',
  'accessToken',
  'OPENAI_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'RESEND_API_KEY',
  'SMTP_PASSWORD',
  'WHATSAPP_ACCESS_TOKEN',
  'phone',
  'phoneRaw',
  'email',
  'to',
  'from',
  'toNumber',
  'fromNumber',
  'toAddress',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: process.env.SERVICE_NAME ?? 'vms-smart-calling' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [...redactKeys, ...redactKeys.map((k) => `*.${k}`), 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  formatters: { level: (label) => ({ level: label }) },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

/** Mask a phone number for human-readable messages: +91••••••3210 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  if (phone.length <= 6) return '••••';
  return `${phone.slice(0, 3)}${'•'.repeat(Math.max(phone.length - 7, 2))}${phone.slice(-4)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return '••••';
  return `${user.slice(0, 1)}•••@${domain}`;
}

/** Strip anything that looks like a secret from an error message before it reaches a UI or log. */
export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]')
    .replace(/AC[a-f0-9]{32}/gi, '[REDACTED_SID]')
    .replace(/(password|token|secret|apikey|api_key)=([^&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 500);
}
