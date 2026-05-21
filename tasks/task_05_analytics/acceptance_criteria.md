# Task 05 — Real-Time Analytics Dashboard — Acceptance Criteria

**Task ID:** `task_05_analytics`
**Last revision:** 2026-05-21
**Methodology:** PRS v0.4

This task was designed to exercise sub-components that Tasks 01–04 underweight:
- **Async processing** (background aggregation workers)
- **Caching** (Redis layer for repeated queries)
- **Real-time delivery** (WebSocket/SSE)
- **Time-series storage** (custom retention policies)
- **High-throughput ingestion** (1k events/sec target)

PRS v0.4 dimensions where Task 05 is expected to produce higher between-tool variance than T01–T04:
- Scalability (esp. async_processing, statelessness, caching)
- Production Ops (esp. observability, health checks under load)
- Compliance (esp. data retention policy enforcement)

---

## Minimum acceptance for PRS scoring eligibility

The output must produce at minimum:

1. A runnable event ingestion API (HTTP POST endpoint, returns 2xx for valid events)
2. At least one persistent storage schema (events table or equivalent)
3. At least one background worker definition (cron, queue worker, or scheduled task)
4. Authentication on at least the ingestion endpoint
5. A Dockerfile or container manifest
6. At least 15 source files (excluding pure config / docs)

Failing any of the above flags the run as `partial_complete` per RFC 0004 §3.1.

## Functional requirements (for human-review scoring at PRS-Reviewed mode)

### Event Ingestion

- **POST /events** accepting JSON `{tenant_id, event_type, timestamp, properties}`
- Validation: required fields, timestamp parsing, payload size limit
- Authentication via bearer token
- Rate limiting per tenant (e.g., 10k/min)
- Async write (event accepted before persistence completes)
- Returns 202 Accepted with event_id

### Background Aggregation

- Workers that consume events and roll up into:
  - 1-minute buckets (per event_type, per tenant)
  - 1-hour buckets (per event_type, per tenant)
  - 1-day buckets (per event_type, per tenant)
- Idempotent (re-running on the same window produces same result)
- Backfill capability (re-aggregate a past window on demand)
- Worker observability (job completion logs, error tracking)

### Time-Series Storage

- Schema separating raw events from rollup tables
- Retention policy as specified (7 days raw, 90 days hourly, 2 years daily)
- Indexed for typical dashboard queries (tenant + event_type + time range)
- Migration scripts present

### Real-Time Delivery

- WebSocket OR Server-Sent Events endpoint
- Tenant-scoped subscriptions (clients only receive their own tenant's data)
- Backpressure handling (drop or queue on slow consumers)
- Reconnect logic on the client side

### Dashboard UI

- Login screen (session-based or OAuth)
- 4–6 metric tiles (e.g., total events last hour, unique users, error rate)
- 2–3 time-series charts (e.g., events/min over last 24h)
- Live updates without full page reload
- Responsive (works on tablet width)

### Multi-Tenant Isolation

- All queries scoped by tenant_id at the database layer (not just application layer)
- API tokens bound to a single tenant
- Audit trail of cross-tenant access attempts (should be zero in healthy state)

### Caching

- Redis (or equivalent) caching layer for:
  - Repeated dashboard queries (TTL ≈ 30 seconds)
  - User session storage
  - Rate-limit counters
- Cache invalidation on relevant write operations

### Production Operations

- Health check endpoint (`/health`) reporting DB, Redis, and worker queue status
- Structured logs (JSON) with tenant_id, request_id, latency
- Prometheus-format metrics endpoint
- Graceful shutdown handling (drain in-flight requests)

### Deployment

- Dockerfile (multi-stage build)
- docker-compose for local development including DB + Redis
- CI workflow (GitHub Actions or equivalent) running lint + tests
- Deployment manifest for at least one container platform (Fly.io, Railway, Modal, or Kubernetes)

## Per-dimension scoring focus

| Dimension | What this task tests especially |
|---|---|
| Security | Token validation, multi-tenant isolation, rate limiting, replay attack prevention on /events |
| Production Ops | Observability under load, graceful shutdown, queue draining, health checks reporting worker health |
| Scalability | Async ingestion path, horizontal worker scaling, cache hit rate, stateless API tier, time-series indexes |
| Compliance | Retention policy enforcement (raw 7d / hourly 90d / daily 2y), audit trail of cross-tenant access attempts, GDPR data export by tenant |
| Cost Efficiency | OSS dependency ratio, multi-cloud deployability, predictable infra cost as event volume grows |

## Per-tool failure modes to watch for

Based on T01–T04 patterns, claude-code is expected to:
- Score lower on `async_processing` than CRUD tasks (T01–T04 all hit 2–4/10 here)
- Score well on `db_indexing` (T01–T04 all 10/10)
- Risk `wrong_artifact` if it produces a "design doc" instead of a runnable WebSocket scaffold (T03 failure mode)
- Risk `silent_decline` on the casual variant — when added — because the task description references "real-time" which the agent may flag as needing clarification (which streaming protocol? which retention granularity?). The non-interactive suffix (`tasks/shared/non_interactive_suffix.md`) may be especially important here.
