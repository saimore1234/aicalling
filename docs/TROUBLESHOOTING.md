# Troubleshooting

Start at **System health**: database, Redis, worker heartbeat, voice gateway, queue counts, failed jobs (with Retry).

| Symptom | Likely cause / fix |
|---|---|
| Campaign "Start" is disabled | Open *Launch readiness*: kill switch on, mode mismatch (demo campaign in live mode or vice-versa), agent problems, no leads, missing provider config, unreviewed country policy, missing live confirmation. |
| Campaign running but nothing is dialled | Worker down (heartbeat red); outside calling windows / country hours in the *customer's* timezone; daily limit or concurrency reached; customers lack consent / are on DND (they show as *Skipped by compliance* with a reason); kill switch on. |
| Twilio webhooks return 403/503 | 503 = `TWILIO_AUTH_TOKEN` or `APP_URL` missing. 403 = signature mismatch: `APP_URL` must exactly match the public URL (scheme, host, path) — check your proxy preserves host/proto. |
| Call connects then silence / hangs up | Voice gateway unreachable (`VOICE_GATEWAY_PUBLIC_URL` wrong, no TLS/WebSocket upgrade at proxy); stream token rejected (`APP_SECRET` differs between web and voice); OpenAI key/model invalid. Check voice logs for `openai_error`. |
| OpenAI Realtime rejects session | Switch `OPENAI_REALTIME_PROTOCOL` between `ga` and `beta`; confirm the model name in the agent. |
| Caller hears an apology and the call ends | OpenAI connection failed mid-call (by design, fail-safe). See call timeline events. |
| Call "Analysis pending" forever | Worker down or `analysis` queue failing; see failed jobs. An invalid AI answer creates a human review task instead of guessing an outcome. |
| Import fails: "granted but no consent source" | Add a consent source column or set a default consent source in the wizard — unsupported consent claims are rejected. |
| Import says file is not a genuine CSV/XLSX | Files are verified by content, not extension. Re-export from Excel / save as CSV UTF-8. |
| Email not sent | Provider unconfigured, template not *approved*, marketing email without consent or unsubscribe link, address suppressed. The follow-up task shows the exact reason. |
| WhatsApp send rejected | Template not Meta-approved or name mismatch; outside the 24 h window for free text. |
| Locked out | Login is rate limited per IP/account (15 min windows). Admins can generate a reset link (Users → Reset link); or run `npm run admin:create` on the server. |
| `Invalid environment configuration` at start | A variable failed validation; the message names it (e.g. `APP_SECRET` < 32 chars). |
| Tests fail to connect | Start PostgreSQL & Redis, create the `vms_test` database / set `TEST_DATABASE_URL`. |

## Useful commands
```bash
docker compose logs -f worker voice
docker compose exec web npm run db:migrate
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:8081/healthz
```
