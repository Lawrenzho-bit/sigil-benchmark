# Support Desk

A multi-channel customer support ticketing tool: email + web portal + (optional) Slack,
SLA tracking, knowledge base, macros, CSAT, merging/splitting, and reporting.

## Stack

- **Runtime:** Node.js 20 + TypeScript, Express
- **Storage:** PostgreSQL 16 (tickets, full-text search via `tsvector`/GIN)
- **Email:** inbound via webhook (SES/Mailgun/Postmark style) parsed by `mailparser`;
  outbound via SMTP (`nodemailer`). SPF/DKIM/DMARC are DNS-level concerns — see
  `docs` notes in `.env.example`.
- **Deploy:** Docker; `api`, `worker-sla`, `worker-email` are separately scalable.

No ORM — raw parameterised SQL through a thin pool wrapper (`src/db/pool.ts`), so the
schema and query plans stay explicit at 1M+ tickets/year.

## Quick start

```bash
cp .env.example .env
docker compose up --build          # db + mailpit + migrate + api + workers
# API on http://localhost:3000, mail UI on http://localhost:8025
```

Local without Docker:

```bash
npm install
npm run migrate          # applies db/migrations/*.sql
npm run dev              # API with reload
npm run worker:sla       # SLA breach scanner
npm run worker:email     # inbound email processor
```

Seed an initial admin (idempotent):

```bash
npm run migrate          # 002_seed.sql creates admin@local / "changeme" — rotate immediately
```

## Feature map

| # | Feature | Where |
|---|---------|-------|
| 1 | Email tickets (inbound parse, threaded replies) | `src/email/`, `src/workers/email.worker.ts` |
| 2 | Customer web portal | `public/portal.html`, `src/auth` (portal tokens), portal-scoped ticket routes |
| 3 | Agent inbox (filter/sort/assign/prioritize) | `src/modules/tickets` |
| 4 | SLA tracking + breach alerts | `src/modules/sla`, `src/workers/sla.worker.ts` |
| 5 | Knowledge base + article search | `src/modules/kb` (Postgres FTS) |
| 6 | Macros / canned responses | `src/modules/macros` |
| 7 | Internal notes | `ticket_messages.visibility = 'internal'` |
| 8 | Ticket merging + splitting | `src/modules/tickets/service.ts` |
| 9 | CSAT surveys | `src/modules/csat` |
| 10 | Reporting | `src/modules/reporting` |
| 11 | Multi-channel (email/web/slack) | `channel` enum; Slack is a stubbed adapter |
| 12 | Customer profile + history | `src/modules/customers` |

## API overview

All `/api/*` routes require a Bearer JWT. Agent tokens come from
`POST /api/auth/agent/login`; customer (portal) tokens from
`POST /api/auth/portal/login`. RBAC roles: `admin`, `manager`, `agent`, `read_only`.

See `src/app.ts` for the full route table. Highlights:

- `POST /api/tickets` · `GET /api/tickets` (filter/sort/paginate) · `PATCH /api/tickets/:id`
- `POST /api/tickets/:id/messages` (public reply → outbound email)
- `POST /api/tickets/:id/notes` (internal)
- `POST /api/tickets/:id/merge` · `POST /api/tickets/:id/split`
- `POST /api/tickets/:id/apply-macro/:macroId`
- `GET /api/kb/search?q=` · `GET /api/reports/*`
- `POST /webhooks/email/inbound` (HMAC-authenticated, no JWT)
- `POST /public/csat/:token` (unauthenticated survey response)

## Compliance

- **Audit log** — every state-changing action writes to `audit_log` (`src/audit`).
- **Access control** — RBAC middleware; customers can only see their own tickets.
- **GDPR** — `RETENTION_*` env vars drive the retention sweep in the SLA worker;
  `POST /api/customers/:id/erase` anonymises a customer on request.

## Scaling notes & known gaps

- Ticket FTS currently indexes the subject; indexing message bodies needs a
  trigger-maintained `tsvector` (noted in `001_schema.sql`).
- Inbound email assumes a provider webhook; an IMAP poller would replace
  `email.worker.ts`'s staging-table consumer.
- Slack integration is a typed adapter boundary (`src/modules/channels/slack.ts`)
  without a live API client.
- Attachment bytes are referenced by `storage_key`; wire an S3-compatible store.
- Tests cover SLA math, email parsing/threading, and RBAC; not exhaustive.

This is a working foundation, not a finished SaaS — see gaps above.
