# Helpdesk

Customer support ticketing platform. FastAPI + Postgres + Redis, designed to be container-deployable and to scale to 10k agents and 1M+ tickets/year.

## Features

- Email-based ticket creation (inbound webhook → ticket; outbound replies via SMTP)
- Customer self-service portal
- Agent inbox with filters, sort, assignment, priority
- SLA tracking with breach alerts (first-response and resolution clocks)
- Knowledge base with full-text search (Postgres FTS)
- Macros / canned responses
- Internal notes (agent-only)
- Ticket merge + split
- CSAT surveys post-resolution
- Reporting: agent performance, SLA compliance, ticket volume
- Multi-channel: email, web, Slack
- Customer profile with interaction history
- GDPR: configurable retention, PII export + erasure
- SOC2 baseline: audit log, RBAC, structured logging

## Stack

- Python 3.11 + FastAPI
- Postgres 16 (tickets, FTS for search)
- Redis + RQ (background jobs, SLA monitor, CSAT dispatcher)
- Jinja2 templates + HTMX for the portal / agent UI
- Alembic for migrations

## Quick start

```bash
cp .env.example .env
docker compose up --build
# wait for "application startup complete"
docker compose exec api alembic upgrade head
docker compose exec api python -m app.scripts.seed
open http://localhost:8000
```

## Layout

```
app/
  main.py              FastAPI app + middleware
  config.py            Settings (pydantic-settings)
  db.py                SQLAlchemy session + base
  models/              ORM models
  schemas/             Pydantic request/response models
  api/                 HTTP routes
  services/            Business logic (email, SLA, search, audit, slack)
  workers/             Background workers (RQ)
  templates/           Jinja2 templates (portal + agent + email)
  static/              CSS/JS
  scripts/             Seeders + admin utilities
alembic/               Database migrations
docker/                Dockerfile + compose
tests/                 Pytest
```

## Email infrastructure

Inbound mail is delivered to `/webhooks/inbound-email` from your provider (SES,
Postmark, Mailgun). The provider verifies SPF/DKIM/DMARC at receive time and
forwards a signed payload; we re-verify the signature and then parse:

- multipart/alternative → strip HTML, keep text
- attachments → object storage (S3-compatible, configurable)
- replies-in-thread → match on `Message-ID` / `References` / `In-Reply-To`
  headers, falling back to the `+<ticket_id>` plus-address on the To:
- signature stripping → heuristic split on `-- ` and trailing quoted blocks

Outbound mail is sent over SMTP with the platform's DKIM-signing domain. Replies
use the plus-address `support+<ticket_id>@example.com` so replies route back to
the same ticket.

## Scaling notes

- Tickets table is partitioned by `created_at` month (see migration 0002)
- `tickets.search_vector` is a generated tsvector with a GIN index
- Background workers are horizontally scalable; SLA monitor uses a leased lock
- Per-tenant rate limits applied at the inbound webhook
- Read replicas can be wired via `DATABASE_URL_READ`

## Compliance

- **GDPR**: every customer record has an explicit `data_subject_export()` and
  `data_subject_erase()` flow (`app/services/gdpr.py`). Retention is enforced
  by `workers.retention_sweeper`.
- **SOC2**: structured audit log on every state-changing action; role-based
  access control at the route layer; secrets only via env vars; least-privileged
  DB role for the application.
