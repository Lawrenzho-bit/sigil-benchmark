# Real-Time Analytics Dashboard

A production-ready, multi-tenant real-time analytics platform: high-throughput event
ingestion, background rollup aggregation, time-series storage with retention,
live-streaming dashboards, caching, auth, monitoring, and CI/CD.

## Architecture

```
                 ┌─────────────┐   XADD    ┌─────────────┐
  HTTP POST  ───▶ │ Ingestion   │ ────────▶ │ Redis Stream│
  (Bearer token)  │ API (FastAPI)│          │ events:ingest│
                 └─────────────┘            └──────┬──────┘
                                                   │ XREADGROUP (batches)
                                            ┌──────▼──────┐
                                            │   Worker    │
                                            │ ingest loop │──▶ bulk INSERT ─┐
                                            │ rollup loop │                 │
                                            └──────┬──────┘                 ▼
                                                   │ time_bucket    ┌───────────────┐
                                                   ▼ upserts        │  TimescaleDB  │
                                            rollup_1m/1h/1d ───────▶│ events (7d)   │
                                                   │                │ rollup_1m(7d) │
                                                   │ PUBLISH         │ rollup_1h(90d)│
                                                   ▼ live:{tenant}   │ rollup_1d(2y) │
  Browser  ◀── SSE /api/stream ◀── Redis Pub/Sub   └────────────────┘
  Dashboard ◀── GET /api/metrics/* (Redis-cached) ◀── query API
```

- **API** (`app.main`) — event ingestion, dashboard queries, SSE streaming, auth.
- **Worker** (`app.worker`) — drains the ingest stream into storage and computes
  1-minute / 1-hour / 1-day rollups, publishing live updates.
- **TimescaleDB** — hypertables for raw events + rollups, with automatic retention.
- **Redis** — ingest queue (stream), query cache, pub/sub for live updates, sessions,
  rate-limit counters.

## Tech stack

Python 3.12 · FastAPI · asyncpg · TimescaleDB (Postgres 16) · Redis 7 ·
Prometheus · Docker Compose · GitHub Actions · Fly.io.

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

Then open <http://localhost:8000>.

- **Dashboard login:** `admin` / `admin123`  (tenant `demo`)
- **Second tenant (isolation demo):** `acme` / `acme123`
- **API token (demo tenant):** `demo-token-12345`
- **API token (acme tenant):** `acme-token-67890`

### Generate load (1k events/sec)

```bash
pip install httpx
python scripts/loadgen.py http://localhost:8000 demo-token-12345 1000
```

Within ~30s the worker computes rollups and the dashboard updates live.

## Ingestion API

```bash
curl -X POST http://localhost:8000/api/events \
  -H "Authorization: Bearer demo-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"event_type":"page_view","value":1,"metadata":{"path":"/home"}}]}'
```

A request may carry 1–1000 events. `ts` defaults to now; `value` defaults to `1`.

## Endpoints

| Method | Path                       | Auth        | Purpose                          |
|--------|----------------------------|-------------|----------------------------------|
| POST   | `/api/events`              | API token   | Ingest a batch of events         |
| POST   | `/api/auth/login`          | —           | Dashboard login (session cookie) |
| POST   | `/api/auth/logout`         | session     | End session                      |
| GET    | `/api/auth/me`             | session     | Current session info             |
| GET    | `/api/metrics/tiles`       | session     | Metric tiles (cached)            |
| GET    | `/api/metrics/series`      | session     | Time-series for charts (cached)  |
| GET    | `/api/metrics/event-types` | session     | Distinct event types             |
| GET    | `/api/stream`              | session     | SSE live updates                 |
| GET    | `/health`                  | —           | Liveness/readiness               |
| GET    | `/metrics`                 | —           | Prometheus metrics               |

## Multi-tenancy & isolation

Every tenant has its own API token and users. The tenant id is **always** derived
server-side — from the API token (ingestion) or the session (dashboard) — and never
read from the request body. All storage queries are filtered by that tenant id, so a
session for tenant A can never see tenant B's data.

## Retention

Enforced by TimescaleDB retention policies (`backend/db/init.sql`):

| Data         | Retention |
|--------------|-----------|
| Raw events   | 7 days    |
| 1-min rollup | 7 days    |
| Hourly rollup| 90 days   |
| Daily rollup | 2 years   |

## Local development (without Docker)

```bash
# Start dependencies
docker compose up -d db redis

cd backend
pip install -r requirements.txt
psql postgresql://analytics:analytics@localhost:5432/analytics -f db/init.sql  # first run only

# Terminal 1 — API
uvicorn app.main:app --reload
# Terminal 2 — worker
python -m app.worker
```

## Tests

```bash
cd backend && pytest -q
```

## Deployment

- **Container platform:** the image (`backend/Dockerfile`) runs both the `api` and
  `worker` process groups — see `fly.toml` for a Fly.io target.
- **CI/CD:** `.github/workflows/ci.yml` runs tests against TimescaleDB + Redis,
  builds and pushes the image to GHCR, then deploys.

## Monitoring

`/metrics` exposes Prometheus counters/gauges/histograms: events ingested & persisted,
rollups computed, request latency, active SSE streams, and ingest queue depth.
`/health` reports database and Redis connectivity.
