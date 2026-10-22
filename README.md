# VMS Smart Calling

An AI sales calling and automation platform: import customers, let an AI voice agent call them from a controlled campaign queue, qualify each lead with validated structured analysis, and run follow-ups (email / SMS / WhatsApp / appointments / human hand-off) — with consent, calling-hours and do-not-call checks that **fail closed**.

> **Starts in DEMO mode.** Until an administrator explicitly switches to LIVE (typed confirmation), every call, transcript and message is simulated, stored with `is_demo = true`, and shown with a **DEMO** badge. There is no silent fallback from live to demo: in live mode a missing provider makes the action fail with an explanation.

## What's inside

| Area | Pages |
|---|---|
| Account | Login, first-admin setup, forgot/reset password, My account (password, sessions) |
| Sell | Dashboard (DB-backed metrics with definitions), Customers (+detail), Import wizard (CSV/XLSX), Pipeline (Kanban), Call history (+detail with transcript), Appointments, Follow-ups |
| Automate | AI agents, Campaigns (+live monitor), Templates |
| Govern | Compliance & consent, Integrations, Users & roles, Audit log, System health & jobs (kill switch) |

Processes: **web** (Next.js 15 / React 19), **worker** (BullMQ: dialler, follow-ups, analysis, imports, maintenance), **voice gateway** (Twilio Media Streams ⇄ OpenAI Realtime bridge).

## Deviation from the original brief — Drizzle instead of Prisma

The brief named Prisma. Prisma downloads query-engine binaries from `binaries.prisma.sh`, which was blocked in the build environment, so (with the project owner's approval) **Drizzle ORM** is used instead. It is a typed SQL toolkit over `pg`; migrations are plain SQL in `drizzle/`, applied by `npm run db:migrate`. Schema: `src/db/schema.ts`. If you must have Prisma, the schema is a straightforward port; nothing outside `src/db` and the query call-sites depends on the ORM's API surface beyond Drizzle query builders.

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, APP_SECRET (openssl rand -hex 32), SETUP_TOKEN, APP_URL
docker compose up --build
```

Then open <http://localhost:3000/setup>, enter the `SETUP_TOKEN`, and create the first administrator. There are **no default accounts or passwords**.

Optional demo data (fictional people on reserved fictional phone numbers):

```bash
docker compose exec web npm run db:seed:demo
```

## Quick start (local, no Docker)

Requirements: Node ≥ 20.11, PostgreSQL 14+, Redis 6+.

```bash
npm ci
cp .env.example .env            # set DATABASE_URL, REDIS_URL, APP_SECRET, SETUP_TOKEN
npm run db:migrate              # applies drizzle/*.sql
npm run db:seed                 # baseline: pipeline stages, UNREVIEWED country policies, templates, follow-up rules
npm run admin:create -- --email you@company.com --name "Your Name"   # or use /setup
npm run db:seed:demo            # optional DEMO data
npm run dev                     # web      http://localhost:3000
npm run worker                  # worker   (separate terminal)
npm run voice                   # gateway  ws://localhost:8081/media-stream (separate terminal)
```

## First steps in the UI

1. **Integrations → Test connection** for each provider you plan to use (nothing is dialled or sent by the test).
2. **AI agents → New agent.** The editor lists problems that block launch (must disclose it is an AI, real company name, approved product knowledge, escalation rules, sane max duration). **Preview prompt** shows exactly what the model is told.
3. **Import** customers (sample files below) or run `npm run db:seed:demo`.
4. **Campaigns → New campaign**, check **Launch readiness**, then **Start**. Demo campaigns run against scripted scenarios.
5. For live use: review & attest each **Compliance → Country policy**, record DND scrub where required, switch **Integrations → Live mode** (type `ENABLE LIVE MODE`), create a live campaign, confirm launch (type `LAUNCH LIVE CALLS`). The **System health → Kill switch** stops everything instantly.

## Sample files

* `samples/customers-sample.csv` — 7 fictional rows (all validate in the importer).
* `samples/customers-template.xlsx` — fill-in workbook with an Instructions sheet. Regenerate with `npm run template:generate`.
* Both are also served from the import page (`public/templates/`).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev / build / start` | Web app |
| `npm run worker` / `npm run voice` | Background worker / voice gateway |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm test` (`test:unit`, `test:integration`) | Vitest — needs PostgreSQL + Redis (see below) |
| `npm run test:e2e` | Playwright smoke tests (see tests/e2e) |
| `npm run db:migrate / db:seed / db:seed:demo` | Database |
| `npm run admin:create` | Create an administrator from the CLI |

### Running the tests

Integration tests use a separate database `vms_test` (default `postgresql://vms:vms_dev_password@localhost:5432/vms_test`, override with `TEST_DATABASE_URL`) and Redis; migrations are applied automatically by `tests/global-setup.ts`, so a green run also proves the migrations apply cleanly. Tests use fake providers/sockets — **no external service is contacted and no real call or message is ever made**.

## Documentation

* [Architecture](docs/ARCHITECTURE.md)
* [API reference](docs/API.md)
* [Deployment](docs/DEPLOYMENT.md)
* [Provider configuration](docs/PROVIDERS.md)
* [Troubleshooting](docs/TROUBLESHOOTING.md)
* [Security & compliance](docs/SECURITY_COMPLIANCE.md) — including India TRAI/DLT notes

## Important notice

This software is a tool, not legal advice. Telemarketing, recorded calls, AI-voice disclosure and messaging are regulated differently in every country (e.g. TCPA in the US, TRAI TCCCPR/DLT and NDNC in India, PECR/GDPR in the UK/EU). Default country policies are conservative starting points and ship as **unreviewed**, which blocks live contact until your administrator reviews them with qualified counsel.
