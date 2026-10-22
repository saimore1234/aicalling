# Provider configuration

Secrets live only in environment variables; the Integrations page shows presence (✓/✕), never values. Use **Test connection** after configuring — it makes a harmless API call and never dials or sends.

## OpenAI
* `OPENAI_API_KEY`. Realtime voice uses the agent's `model` (default `gpt-realtime`) and voice; analysis uses `analysisModel` (default `gpt-4.1-mini`) with a JSON schema response that is re-validated server-side.
* `OPENAI_REALTIME_PROTOCOL`: `ga` (default; audio type `audio/pcmu`) or `beta` (`g711_ulaw`). If the Realtime connection is rejected with a session/format error, try the other value.
* Set a monthly spend cap in the OpenAI dashboard.

## Twilio Voice
* `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_FROM` (a number you own / a verified caller ID).
* `APP_URL` (webhooks) and `VOICE_GATEWAY_PUBLIC_URL` (`wss://…/media-stream`).
* Webhook URLs (`/api/webhooks/twilio/voice` and `/status`) are supplied **per call** by the app; nothing needs configuring on the number for outbound calling.
* Trial accounts can only call verified numbers and play a trial message.
* Regulated destinations (e.g. India) require registered entity/headers/templates and approved routes — see SECURITY_COMPLIANCE.md.

## Twilio SMS
* `TWILIO_SMS_FROM` or `TWILIO_MESSAGING_SERVICE_SID`.
* Status callbacks are set per message. For inbound (STOP handling) set the number's *A message comes in* webhook to `{APP_URL}/api/webhooks/twilio/sms-inbound`.
* India: SMS needs DLT-registered sender header + template. Put the DLT template/entity IDs on the template; policies with `requireDltTemplate` refuse to send without them.

## Email — choose one
* **Resend**: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (verified domain), `RESEND_WEBHOOK_SECRET` (Svix `whsec_…`). Add a webhook to `{APP_URL}/api/webhooks/resend` for delivery/bounce/complaint events (bounces and complaints suppress the address).
* **SMTP**: `EMAIL_PROVIDER=smtp`, `SMTP_HOST/PORT/USER/PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`.
* Marketing templates automatically get an unsubscribe link (`/unsubscribe/{token}`) and are refused without one.

## WhatsApp Business (Meta Cloud API)
* `WHATSAPP_ACCESS_TOKEN` (system-user token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
* In the Meta app: Webhooks → callback URL `{APP_URL}/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
* Business-initiated messages must use a **Meta-approved template**: set its exact name as the template's *Meta-approved template name* and tick approval attestation in Templates. Free-form text is only possible inside the 24-hour customer-service window.

## Demo mode needs none of the above
Demo mode simulates telephony, analysis and messaging internally. Provider status on the Integrations page still reflects what is configured, but nothing is contacted.
