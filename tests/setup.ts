// Global test setup: ensures env is deterministic. Real provider credentials are never read in tests.
for (const k of [
  'OPENAI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'RESEND_API_KEY',
  'WHATSAPP_ACCESS_TOKEN',
  'SMTP_HOST',
]) {
  delete process.env[k];
}
