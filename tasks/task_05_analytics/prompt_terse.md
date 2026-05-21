# Task 05 — Real-Time Analytics Dashboard — Prompt Variant A (Terse)

**Variant ID:** `task_05.variant_terse.v1`
**Last revision:** 2026-05-21
**Methodology:** PRS v0.4

---

Build a real-time analytics dashboard with the following:

1. Event ingestion API (HTTP POST, 1k events/sec target)
2. Background workers that aggregate events into 1-minute, 1-hour, and 1-day rollups
3. Time-series storage (events + rollups) with retention policy (raw events 7 days, hourly 90 days, daily 2 years)
4. WebSocket or SSE endpoint streaming live aggregate updates to dashboards
5. Dashboard UI showing 4-6 metric tiles + 2-3 time-series charts, refreshing in real time
6. Multi-tenant: events tagged by tenant, isolation enforced server-side
7. Authentication for both API (token) and dashboard (session)
8. Caching layer for repeated dashboard queries (Redis or equivalent)
9. Production-ready: monitored, rate-limited, deployable to a container platform with CI/CD

Tech stack: any modern web framework, Postgres + time-series extension (TimescaleDB) or equivalent (ClickHouse, Druid), Redis for caching/queues, deployable to a container platform. Include CI/CD config. Output complete codebase, ready to deploy.
