# Architecture

```
            ┌────────────┐   HTTPS    ┌─────────────────────────────┐
 Browser ──▶│  Next.js   │──────────▶ │ PostgreSQL (Drizzle / pg)   │
            │  web app   │◀────────── │ system of record            │
            └─────┬──────┘            └─────────────▲───────────────┘
 Twilio / Resend /│ webhooks (signature verified)   │
 Meta ────────────┘                                 │
                    enqueue                         │
            ┌────────────┐◀── Redis (BullMQ) ──▶┌───┴────────┐
            │   web      │                      │   worker   │ dialler ticks, follow-ups,
            └────────────┘                      │            │ analysis, imports, reaper
                                                └─────┬──────┘
 Twilio ──(Media Streams WSS)──▶ ┌────────────────┐   │ places calls via Twilio REST
 phone call ◀────────────────────│ voice gateway  │◀──┘
                                 │ μ-law 8 kHz ⇄  │──WSS──▶ OpenAI Realtime
                                 └────────────────┘
```

## Processes

| Process | Entry | Responsibility |
|---|---|---|
| web | `next start` | UI, REST API, provider webhooks |
| worker | `src/worker/index.ts` | BullMQ workers and repeatable schedulers (campaign tick 10 s, follow-up tick 60 s, reaper 60 s, retention 6 h); writes Redis heartbeat `vms:worker:heartbeat` |
| voice gateway | `src/voice/server.ts` | WebSocket server (`/media-stream`, `/healthz`) bridging Twilio ⇄ OpenAI Realtime |

## Modes and safety gates

* App settings (`integration_configurations`, key `app`): `mode` demo|live (default **demo**), `killSwitch`, rate limits, timezone, retention.
* A campaign's `is_demo` is fixed at creation from the mode. A mode mismatch blocks dialling and readiness.
* `placeCallForLead` re-checks, immediately before every dial and fail-closed: kill switch → mode → agent validity → compliance eligibility (defer vs block) → rate limit → idempotency key `call-<leadId>-<attempt>`.
* Campaigns never auto-launch. Live campaigns need typed confirmation; editing a campaign voids the confirmation.

## Dialler

`tickCampaign` selects pending leads with `FOR UPDATE SKIP LOCKED`, honours `maxConcurrent`, `dailyLimit`, calling windows (campaign ∩ country policy, in the *customer's* timezone), retry gaps and max attempts, and marks exhausted leads finished. Retryable provider errors are re-thrown for BullMQ back-off.

## Call lifecycle

1. Worker creates a `calls` row (QUEUED) and asks the telephony provider to dial; Twilio fetches TwiML from `/api/webhooks/twilio/voice`, which returns `<Connect><Stream>` with an HMAC token parameter bound to the call id.
2. The gateway verifies the token on the stream's `start` event, opens the OpenAI Realtime socket and relays native μ-law audio both ways. Barge-in clears Twilio's buffer and truncates the model's turn. Tools: `end_call`, `mark_do_not_contact`, `request_human_followup` (optional live transfer). A max-duration timer (with wrap-up warning) plus Twilio `timeLimit` bound every call. If OpenAI fails, the caller hears an apology and the call ends.
3. Status webhooks move the call forward monotonically (compare-and-set); duplicates and out-of-order callbacks are ignored (`webhook_receipts` replay table).
4. On end, transcript is saved and an `analysis` job runs.

## Analysis & follow-ups

`analyzeCall` → provider → **Zod `QualificationSchema`** → deterministic business rules (opt-out overrides; human request → HUMAN_REQUIRED; no customer speech → NO_ANSWER; positive outcomes need transcript-quoted evidence or are downgraded; callback time must be a future time within one year). Invalid output stores no outcome and creates an ASSIGN_HUMAN task. Pipeline stage moves forward only. `planFollowUps` creates tasks from rules (campaign rules override global) idempotently (`fu-<callId>-<ruleId>`); `processFollowUp` claims atomically, re-checks compliance at send time, and retries with 5/30/120-minute back-off.

## Data & metrics

Schema in `src/db/schema.ts` (migrations in `drizzle/`). Dashboard numbers are SQL aggregates (`src/server/metrics.ts`); each metric ships with its definition and the default scope follows the current mode (demo/live/all selectable). Sales executives are scoped to customers they own.

## Frontend

Client-rendered pages using SWR, Tailwind (CSS-variable theme, dark mode via `prefers-color-scheme`), Recharts. `src/middleware.ts` only redirects cookie-less visitors; every API call validates the server-side session and role.

## Testability

Providers are injected (`setProviderOverrides`); `CallBridge` takes `BridgeDeps`, so tests drive it with fake sockets. Tests never contact a real provider.
