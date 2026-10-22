# API reference

All endpoints are JSON over HTTPS under `/api`. Authentication is a server-side session in the `vsc_session` cookie (HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=true`). State-changing requests also require a same-origin `Origin`/`Referer`. Errors look like `{ "error": "message", "code": "machine_code", "fieldErrors"?: {field: [msgs]} }`. Lists accept `page` and `pageSize` and return `{ <items>, total, page, pageSize }`.

Roles: **ADMIN** (everything) and **SALES_EXECUTIVE** (only customers they own, and the calls / follow-ups / appointments attached to them). "any" below means any signed-in user (scoped by ownership where relevant).

## Auth & account
| Method | Path | Access | Notes |
|---|---|---|---|
| GET/POST | `/api/setup` | public | Create the FIRST admin; needs `SETUP_TOKEN`; closed once a user exists |
| POST | `/api/auth/login` | public | Rate limited per IP and per account; generic failure message |
| POST | `/api/auth/logout` | any | |
| GET | `/api/auth/me` | any | Current user, mode, kill-switch state |
| POST | `/api/auth/forgot`, `/api/auth/reset` | public | Single-use hashed tokens; response never reveals whether an email exists |
| POST | `/api/auth/password` | any | Revokes all other sessions |
| GET | `/api/auth/sessions`, DELETE `/api/auth/sessions/{id}` | any | Own sessions only |

## Customers, import, pipeline
| Method | Path | Access |
|---|---|---|
| GET/POST | `/api/customers` | any (POST admin) |
| GET/PATCH/DELETE | `/api/customers/{id}` | any / admin |
| POST | `/api/customers/{id}/consent`, `/opt-out`, `/archive`, `/notes`; PATCH `/stage`; GET `/timeline` | any (scoped) |
| POST | `/api/customers/bulk`; GET `/api/customers/export` | any (scoped) |
| GET/POST | `/api/imports` (multipart `file`, .csv/.xlsx only, magic-byte checked) | admin |
| POST | `/api/imports/{id}/validate` (dry run) → `/commit`; GET `/failed-rows`; GET/DELETE `/{id}` | admin |
| GET | `/api/pipeline` (Kanban data); GET/POST/PATCH `/api/pipeline/stages` | any / admin |

## AI agents & campaigns (admin)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/agents` | |
| GET/PATCH/DELETE | `/api/agents/{id}` | |
| GET | `/api/agents/{id}/validate`, `/preview-prompt` | Launch problems; exact model instructions |
| GET/POST | `/api/campaigns` | `is_demo` fixed from the current mode |
| GET/PATCH/DELETE | `/api/campaigns/{id}` | Cannot edit while RUNNING; edits void live confirmation |
| POST | `/api/campaigns/{id}/populate` | Re-evaluate the segment |
| GET | `/api/campaigns/{id}/readiness` | `{ready, problems[], leadCount, mode}` |
| POST | `/api/campaigns/{id}/confirm-launch` | Body `{confirm:"LAUNCH LIVE CALLS"}` (live only) |
| POST | `/api/campaigns/{id}/start`, `/pause`, `/resume`, `/stop` | `start` re-runs readiness (422 `not_ready`) |
| GET | `/api/campaigns/{id}/live` | Counts, active and recent calls (phones masked) |

## Calls, follow-ups, appointments, messages
| Method | Path | Access |
|---|---|---|
| GET | `/api/calls`, `/api/calls/{id}` | any (scoped); detail includes transcript, events, qualification, follow-ups |
| GET/POST | `/api/followups/rules`, PATCH/DELETE `/{id}` | admin |
| GET/POST | `/api/followups/tasks`; PATCH `/{id}` | any (scoped) |
| GET/POST | `/api/appointments`; PATCH `/{id}` | any (scoped) |
| GET | `/api/messages` | any (scoped) |
| GET/POST | `/api/templates`; GET/PATCH/DELETE `/{id}`; POST `/preview` | read any / write admin |
| GET | `/api/dashboard?demo=true\|false\|all&from=&to=&campaignId=&ownerId=` | any; default `demo` follows the current mode; returns metric definitions with the data |

## Governance (admin)
| Method | Path |
|---|---|
| GET/POST, PATCH `/{code}`, POST `/{code}/confirm-dnd-scrub` | `/api/compliance/policies` |
| GET/POST, DELETE `/{id}` (written reason required) | `/api/compliance/suppression` |
| GET | `/api/compliance/consent` (append-only ledger) |
| GET/POST | `/api/compliance/privacy` (`EXPORT` or `ERASE` + `confirm:"ERASE"`) |
| GET/POST/PATCH/DELETE, POST `/{id}/reset-link` | `/api/users` |
| GET | `/api/audit` |
| GET/PATCH | `/api/system/settings` (live mode needs `confirm:"ENABLE LIVE MODE"`) |
| GET/POST/DELETE | `/api/system/kill-switch` (POST needs `reason`) |
| GET | `/api/system/health`, `/api/system/jobs`; POST `/api/system/jobs/{id}/retry` |
| GET, POST `/check` | `/api/integrations` (env presence only; secrets never returned) |
| GET | `/api/health` | public liveness probe |

## Webhooks (public, verified)
| Path | Provider | Verification |
|---|---|---|
| `POST /api/webhooks/twilio/voice` | Twilio | `X-Twilio-Signature` against the `APP_URL`-based public URL; returns TwiML |
| `POST /api/webhooks/twilio/status` | Twilio | same; monotonic call status |
| `POST /api/webhooks/twilio/sms-status`, `/sms-inbound` | Twilio | same; inbound STOP/UNSUBSCRIBE keywords record an opt-out |
| `POST /api/webhooks/resend` | Resend | Svix HMAC, 5-minute tolerance |
| `GET/POST /api/webhooks/whatsapp` | Meta | GET verify handshake with `WHATSAPP_VERIFY_TOKEN`; POST `X-Hub-Signature-256` |
| `POST /api/unsubscribe` | public | HMAC-signed token from the email footer |

If a verification secret is missing the endpoint answers **503** (fail closed) instead of accepting unsigned traffic. Replays are dropped via `webhook_receipts`.
