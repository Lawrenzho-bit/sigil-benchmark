# Support Tool

Backend for a customer-support ticketing system. API-only (OpenAPI docs at `/docs`).

## Scope

This implementation prioritizes a **coherent, runnable backbone** over surface coverage. The data model covers every feature listed in the spec; the API and behavior are implemented to a real-build bar for the features marked **built** below.

| Feature | Status | Notes |
| --- | --- | --- |
| 1. Email-based ticket creation | **partial** | Inbound webhook endpoint accepts parsed-email JSON (Postmark/SES-shaped). MIME parsing + signature stripping is delegated to the upstream provider. |
| 2. Customer web portal | **built (API)** | `/customer/*` routes; UI not included. |
| 3. Agent inbox (filter/sort/assign/prioritize) | **built** | `/agent/tickets` with status/priority/assignee filters, sort, pagination. |
| 4. SLA tracking + breach alerts | **built** | Per-priority first-response and resolution targets, stored breach state, `/agent/tickets/breached` query, pluggable alerting hook. |
| 5. Knowledge base + search | **partial** | KB articles CRUD + Postgres FTS search. No article authoring UI. |
| 6. Macros / canned responses | **built** | CRUD + apply-to-ticket. |
| 7. Internal notes (agent-only) | **built** | Comments have `visibility` (`public`/`internal`); customer routes never return internal comments. Enforced in serializers and tested. |
| 8. Ticket merge + split | **built (merge)**, stub (split) | Merge collapses two tickets, redirects history. Split exposes endpoint but requires UX decisions deferred. |
| 9. CSAT surveys | **partial** | Survey records + submission endpoint. Email send is a stub. |
| 10. Reporting | **partial** | One example endpoint (agent perf rollup). Real reporting belongs in a warehouse, not the OLTP DB. |
| 11. Multi-channel (Slack) | **deferred** | Schema has `channel` enum; Slack adapter not written. |
| 12. Customer profile + history | **built** | `/agent/customers/{id}` returns profile + ticket history + interaction count. |

### Cross-cutting

- **Auth:** JWT, three roles (customer, agent, admin). Password hashing via bcrypt.
- **Audit log:** Every state-changing action on tickets, users, and access events is recorded. Required for SOC2 baseline.
- **GDPR:** Customer `delete_me` endpoint anonymizes PII in-place (keeps ticket records for compliance) — see `app/routers/customers.py`.
- **Search:** Postgres FTS via generated `tsvector` column on tickets + KB articles.
- **Scale notes:** The data model is sized for 1M+ tickets/year (indexed timestamps, partition-ready ticket table). At 10k agents you'd want connection pooling (PgBouncer), read replicas for reports, and async workers (the included `tasks.py` is a foreground stub; production wants Celery/arq).

### Not built (and why)

- **Frontend.** Out of scope for one session; spec didn't dictate stack. OpenAPI docs serve as the contract.
- **Email infra (SPF/DKIM/DMARC).** This is DNS + sending-provider config, not application code.
- **Slack channel.** Adapter pattern is in place (channel enum); writing the actual Slack OAuth + events handler is a self-contained follow-up.
- **Full reporting suite.** Real BI lives in a separate warehouse. Doing it in the app DB would mislead.

## Running

```bash
docker compose up --build
# in another shell:
docker compose exec api alembic upgrade head
docker compose exec api python -m app.seed   # creates demo agent + customer
# OpenAPI docs:
open http://localhost:8000/docs
```

## Tests

```bash
pip install -e ".[dev]"
pytest
```

Tests use SQLite in-memory; FTS-specific tests are marked and require Postgres (`pytest -m postgres` against a running DB).
