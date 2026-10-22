# Security & compliance

> This document describes what the software enforces and where legal responsibility remains with you. **It is not legal advice.** Have qualified counsel in each destination country review your campaigns, scripts, consent capture and policies before live use.

## 1. Application security

| Control | Implementation |
|---|---|
| Authentication | Argon2id password hashes; 12+ chars with upper/lower/number; generic login errors; per-IP and per-account rate limits; no default accounts (first admin via `/setup` + `SETUP_TOKEN`, or CLI) |
| Sessions | Opaque random token in an HttpOnly, SameSite=Lax cookie (`Secure` when `COOKIE_SECURE`); only a hash is stored; server-side revocation; password change signs out other devices; forced password change for admin-created users |
| Authorisation | RBAC enforced in every API route (`ADMIN`, `SALES_EXECUTIVE`); sales executives are row-scoped to customers they own; out-of-scope records return 404 |
| CSRF | SameSite=Lax + same-origin check on state-changing requests |
| Input validation | Zod on every body/query; parameterised SQL via Drizzle; uploads limited by size, verified by magic bytes, stored under generated names with 0600 permissions |
| Webhooks | Twilio signature, Svix HMAC (Resend), Meta HMAC; **fail closed (503) if the secret is missing**; replay protection table; monotonic status transitions |
| Voice stream | Media Stream accepted only with an HMAC token bound to one call id, verified on `start` |
| Secrets | Environment only; never returned by APIs; log redaction for keys/tokens; phone numbers masked in logs |
| Headers | HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy |
| Audit | Append-only audit log of security-relevant actions with actor, IP and non-sensitive metadata |
| Abuse limits | Global calls/minute and messages/minute limits; per-campaign concurrency and daily caps; AI call max duration |

## 2. Compliance engine (fail closed)

Before **every** call and message the engine evaluates, in order: kill switch → opt-out/suppression (any channel) → do-not-call flag → country policy exists, is enabled, and has been **reviewed by an administrator** → required consent for the channel → DND-registry scrub attested (where required) → calling window in the *customer's* local time (country hours ∩ campaign window) → DLT template (where required). Anything unknown (no country, no timezone, no policy, unreviewed policy) **blocks** rather than allows. Temporary conditions (outside hours) *defer*; permanent ones *block* with a recorded reason.

Other safeguards:
* Opt-outs are honoured immediately, on all channels, including opt-outs spoken to the AI agent (`mark_do_not_contact`) and STOP/UNSUBSCRIBE replies. Lifting a suppression needs a written reason and is audited; rows are retained, not deleted.
* Consent is an append-only ledger with source, evidence and timestamp. The importer rejects "granted" consent without a source.
* Editing a policy's rules clears its review; editing template wording clears its approval.
* Marketing email requires an unsubscribe link (signed token, one click, no login).
* The agent must **disclose that it is an AI** in its greeting (validated; campaigns cannot launch otherwise), states the company name, may only use approved product knowledge, and escalates to a human on request. It never claims to be human.
* Call transcripts (text) are stored and purged per `retentionDays`. The agent's *transcription* flag controls whether the greeting tells the customer the call may be transcribed (recommended; keep it on). Call audio itself is not stored by this app.
* Privacy requests: export (JSON) and erasure; erasure keeps a minimal suppression entry so the person is not contacted or re-imported.

## 3. India — TRAI / DLT notes (starting point, verify with counsel)

* Promotional calls/SMS fall under TRAI's Telecom Commercial Communications Customer Preference Regulations (TCCCPR). Senders must register on the operators' **DLT platform** (principal entity, headers/sender IDs, content templates, consent templates) and use registered resources.
* Customers' preferences are held in the national preference register (NDNC / DND categories). Scrub lists against it before calling; the policy flag `Require DND scrub` blocks dialling until an admin records a scrub (`Compliance → Record scrub`).
* Promotional calling hours are limited (the seeded policy uses 09:00–21:00 IST). Verify the current window.
* Use of automated/AI-voice calling for promotions, number series for telemarketers, and consent evidence requirements are evolving — confirm with your telecom provider and counsel. Twilio and other carriers may require additional registration before India traffic is delivered.
* SMS: policy `Require DLT template` refuses to send unless the template carries DLT template and entity IDs.
* The seeded India policy is **unreviewed** and therefore blocks live contact until you review and attest it.

## 4. Other regions (high level)
* **US**: TCPA/TSR — prior express written consent for autodialled/prerecorded or AI-voice marketing calls to mobiles, National DNC scrub, state calling-hour and registration rules, call recording consent laws vary by state.
* **UK/EU**: PECR/ GDPR/ ePrivacy — consent or legitimate-interest rules for B2B vs B2C, TPS/CTPS screening, lawful basis and DPIA for AI processing, international transfer rules for OpenAI/Twilio processing.
* Seeded policies for these countries are conservative defaults and also start **unreviewed**.

## 5. Data protection
* Personal data: names, phone, email, notes, call audio is **not stored by this app** (only text transcripts); audio and transcripts are processed by OpenAI and Twilio under your accounts and DPAs.
* Minimise: set a retention period; export/erase on request.
* Backups contain personal data — encrypt and restrict access.
* Breach response, DPA/sub-processor lists and privacy notices are your organisation's responsibility.

## 6. Known limitations / items for your security review
* No MFA/SSO yet (passwords + server-side sessions only).
* The default login/IP rate limit uses Redis; behind a proxy ensure `X-Forwarded-For` is set by a trusted proxy only.
* Call audio recording is intentionally not implemented; if you add it, update the greeting disclosure and retention rules.
* Provider integrations (Twilio, OpenAI, Resend, Meta) have been exercised in this repository only through fakes/contract tests; run a supervised test campaign to your own number before any production use.
