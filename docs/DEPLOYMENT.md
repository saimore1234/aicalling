# Deployment

## Topology
Run three processes from one image/codebase plus PostgreSQL and Redis:

| Service | Command | Port | Scale |
|---|---|---|---|
| web | `npm run start` | 3000 | horizontally (stateless; sessions are in PostgreSQL) |
| worker | `npm run worker` | – | 1+ replicas (BullMQ coordinates; dialler uses `SKIP LOCKED`) |
| voice | `npm run voice` | 8081 | scale by concurrent calls; each call is one pair of sockets |

Twilio must reach **web** (webhooks) and **voice** (WSS) over the public internet with valid TLS.

## Docker Compose (single host)
```bash
cp .env.example .env     # set POSTGRES_PASSWORD, APP_SECRET, SETUP_TOKEN, APP_URL, VOICE_GATEWAY_PUBLIC_URL, COOKIE_SECURE=true
docker compose up -d --build
```
`migrate` runs once (`db:migrate` + `db:seed`) before web/worker/voice start. Postgres, Redis and uploads use named volumes — back them up.

Put a TLS-terminating reverse proxy in front. Example Caddyfile:
```
app.example.com   { reverse_proxy web:3000 }
voice.example.com { reverse_proxy voice:8081 }   # WebSocket upgrade is automatic
```
Set `APP_URL=https://app.example.com` and `VOICE_GATEWAY_PUBLIC_URL=wss://voice.example.com/media-stream`. **`APP_URL` must be exactly the public URL Twilio calls**, otherwise signature verification (correctly) fails.

## First start checklist
1. Open `/setup` (or `npm run admin:create`), then **remove `SETUP_TOKEN`** and restart.
2. Integrations → test each provider. System health → all green (database, Redis, worker heartbeat, voice gateway).
3. Compliance → review & attest each country policy you will contact; record DND scrub where required.
4. Register webhooks (see PROVIDERS.md).
5. Run a **test campaign** to your own number before any real list.
6. Only then switch to LIVE.

## Operations
* **Migrations**: `npm run db:migrate` is idempotent; run on every release before starting new app versions. Never edit an applied migration — generate a new one with `npm run db:generate`.
* **Backups**: `pg_dump` the database nightly and test restores. Uploaded import files are transient; they can be deleted after import.
* **Redis**: use AOF persistence (`--appendonly yes`) and `maxmemory-policy noeviction` (compose does) so queued jobs are not evicted.
* **Retention**: Settings → `retentionDays` purges old transcripts, sessions, tokens, receipts and job rows (every 6 h). 0 = keep.
* **Logs**: structured JSON (pino) to stdout with phone numbers masked and secrets redacted. Ship them with your platform's collector.
* **Health probes**: `GET /api/health` (web), `GET :8081/healthz` (voice), System health page (everything).
* **Zero-downtime**: new web/worker versions can roll; in-flight calls live in the voice gateway, so drain it (stop new campaigns, wait for active calls to end) before restarting it.

## Production hardening checklist
* `APP_SECRET` 32+ random chars; unique `POSTGRES_PASSWORD`; do not expose Postgres/Redis publicly.
* `COOKIE_SECURE=true`, HTTPS everywhere; HSTS is already sent by the app.
* Keep the kill switch location known to everyone who runs campaigns.
* Restrict who is ADMIN. Review the Audit log regularly.
* Set provider spend limits (OpenAI, Twilio) independently of this app.
