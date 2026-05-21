# Support Tool

A customer-support ticketing backend: email + web + Slack intake, agent inbox,
SLA tracking, knowledge base, macros, CSAT, and reporting.

Node.js + TypeScript + Express, PostgreSQL for storage and full-text search,
container-deployable. Built for ~10k agents and 1M+ tickets/year.

## Quick start

```bash
cp .env.example .env            # adjust secrets before anything real
docker compose up --build       # Postgres + Mailpit + API + SLA worker
```

The API comes up on `http://localhost:3000`; captured outbound mail is visible
in Mailpit at `http://localhost:8025`.

Run it without Docker:

```bash
npm install
npm run migrate                 # apply db/migrations/*.sql
npm run dev                     # API with live reload
npm run sla-monitor             # one breach + retention sweep (or --daemon)
npm test                        # pure-function unit tests
```

A bootstrap admin is seeded: `admin@example.com` / `ChangeMe123!` — **rotate it
immediately**.

## Architecture

```
src/
  config.ts            env loading + fail-fast validation
  db.ts                pg pool, query helpers, withTransaction()
  server.ts            express app: middleware + route wiring
  index.ts             process entry point + graceful shutdown
  middleware/          auth (JWT), rbac (roles), error mapping
  email/               inbound parsing (signature/quote stripping), outbound SMTP
  services/            domain logic — one module per concern
  routes/              HTTP layer — validation (zod) + thin orchestration
  jobs/slaMonitor.ts   SLA breach scan + GDPR retention purge
db/migrations/         forward-only .sql, applied by src/migrate.ts
```

Routes validate and orchestrate; services own the business logic and database
access; multi-step mutations (ticket create, merge, split, macro apply) run
inside a single transaction via `withTransaction`.

## Feature map

| Capability            | Where |
|-----------------------|-------|
| Email → ticket        | `email/parser.ts`, `email/inbound.ts`, `routes/inboundWebhook.ts` |
| Outbound email replies| `email/outbound.ts` (plus-addressed `support+<id>@` threading) |
| Web portal            | `routes/portal.ts` (customer-scoped, UUID-addressed) |
| Agent inbox           | `routes/inbox.ts`, `services/inboxService.ts` (filter/sort/paginate) |
| SLA tracking + alerts | `services/slaService.ts`, `jobs/slaMonitor.ts` |
| Knowledge base search | `services/kbService.ts` (Postgres FTS, weighted `tsvector`) |
| Macros / canned replies | `services/macroService.ts`, `services/macroApply.ts` |
| Internal notes        | `ticket_messages.is_internal_note` — never sent to portal/email |
| Merge + split         | `services/ticketService.ts` |
| CSAT surveys          | `services/csatService.ts`, `routes/csat.ts` |
| Reporting             | `services/reportingService.ts`, `routes/reporting.ts` |
| Slack channel         | `routes/slack.ts` (optional; enabled by `SLACK_*` env) |
| Customer profile      | `routes/customers.ts`, `services/customerService.ts` |

## API surface

| Prefix              | Auth            | Purpose |
|---------------------|-----------------|---------|
| `POST /auth/*`      | none            | Agent + customer login / registration |
| `/agent/tickets`    | agent           | Ticket detail, reply, notes, status, merge, split, tags |
| `/agent/inbox`      | agent           | Filter / sort / paginate the queue |
| `/agent/customers`  | agent           | Profile + full history; anonymize (admin) |
| `/agent/macros`     | agent           | Canned responses |
| `/agent/reports`    | agent (lead+)   | Agent performance, SLA compliance, volume trend |
| `/admin/*`          | admin           | Agents, teams, SLA policies, audit log |
| `/portal/*`         | customer        | Create / view / reply to own tickets |
| `/kb/*`             | mixed           | Public search + agent management |
| `/csat/:token`      | token capability| Submit a satisfaction rating |
| `/webhooks/*`       | shared secret / HMAC | Inbound email, Slack events |

## SLA model

Each ticket gets one `ticket_sla` row when created. First-response and
resolution targets are computed from the priority's `sla_policies` row at apply
time and **frozen** — editing a policy never retroactively breaches old
tickets. Targets honour business hours (Mon–Fri 09:00–17:00; see
`addBusinessMinutes`). The monitor job scans every minute, emails breach alerts,
and stamps `breach_alerted_at` so alerts fire once.

## Email threading

Outbound mail is sent from `support+<ticketId>@domain` with a `[#id]` subject
tag. Inbound parsing (`extractTicketRef`) keys replies off the plus address
first, the subject tag second, so customer replies thread back onto the right
ticket. Quoted history and signatures are stripped before storage. Duplicate
deliveries are dropped via the unique index on `ticket_messages.email_message_id`.

SPF / DKIM / DMARC are enforced at the SMTP relay (`SMTP_*`) and the inbound
mail provider — this service trusts already-authenticated mail.

## Compliance

- **Audit log** — every mutation appends to the immutable `audit_log`
  (`lib/audit.ts`); readable at `GET /admin/audit-log`.
- **Access control** — JWT auth + role hierarchy (`agent < team_lead < admin`)
  enforced by `middleware/rbac.ts`.
- **GDPR** — `POST /agent/customers/:id/anonymize` for right-to-erasure;
  `GDPR_RETENTION_DAYS` drives the automated retention purge in `slaMonitor.ts`.
  Anonymization scrubs PII while keeping ticket/SLA rows for reporting integrity.

## Scaling notes

- Run the API stateless behind a load balancer; set `RUN_SLA_MONITOR=false` on
  API replicas and run one dedicated `worker` replica (see `docker-compose.yml`).
- Put PgBouncer in front of Postgres; keep `PG_POOL_MAX` modest per replica.
- At 1M+ tickets/year, move the heavier reporting aggregations to nightly
  materialized views (noted in `services/reportingService.ts`).
- Attachments store only a `storage_key`; wire `attachments` to S3/GCS rather
  than the database.

## Known limitations

- Attachment upload/download endpoints are not implemented — the schema and
  inbound parsing model attachments, but object-store wiring is left as the
  integration point.
- No bundled frontend; this is a JSON API consumed by an agent SPA / portal UI.
- Business-hours SLA uses a single fixed calendar; per-team timezones and
  holidays plug into `addBusinessMinutes`.
