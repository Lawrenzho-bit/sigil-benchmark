# Support Desk

Customer support ticketing platform. Email + web + optional Slack. Postgres-backed with FTS.

## Features

| # | Feature | Where |
|---|---|---|
| 1 | Email-based tickets | `src/email/`, `src/workers/email-poller.ts` |
| 2 | Customer web portal | `src/routes/portal.ts`, `web/portal.html` |
| 3 | Agent inbox (filter/sort/assign/prioritize) | `src/routes/tickets.ts` |
| 4 | SLA tracking + breach alerts | `src/sla/`, `src/workers/sla-monitor.ts` |
| 5 | Knowledge base with FTS search | `src/routes/kb.ts`, `migrations/003_kb_and_macros.sql` |
| 6 | Macros / canned responses | `src/routes/macros.ts` |
| 7 | Internal notes (agent-only) | `messages.is_internal` |
| 8 | Ticket merging + splitting | `src/routes/tickets.ts` (`/merge`, `/split`) |
| 9 | CSAT surveys | `src/routes/csat.ts`, `src/workers/csat-sender.ts` |
| 10 | Reporting | `src/routes/reports.ts` |
| 11 | Slack integration | `src/slack/webhook.ts` |
| 12 | Customer profile + history | `src/routes/customers.ts` |

## Compliance

- **GDPR:** Configurable retention via `retention_policies` table; subject-access-request endpoint exports full customer history.
- **SOC2 baseline:** Append-only `audit_log` table records all access and mutation. Auth uses bcrypt + opaque session tokens with revocation.

## Scale Targets

- 10k agents, 1M+ tickets/year.
- Partitioning hints in migrations for `messages` and `audit_log`.
- Indexes tuned for the agent inbox queries.

## Run

```sh
cp .env.example .env
docker compose up -d postgres
npm install
npm run migrate
npm run dev
```

API on `http://localhost:3000`. Portal at `/portal`. Agent UI at `/agent`.

## Layout

```
migrations/   SQL migrations
src/
  server.ts   Express bootstrap
  db.ts       PG pool + query helpers
  auth.ts     Session + RBAC middleware
  audit.ts    Append-only audit logger
  routes/     HTTP endpoints
  sla/        Policy evaluator
  workers/    Background jobs
  email/      Inbound parser + outbound sender
  slack/      Slack webhook bridge
web/          Static portal + agent UI
```
