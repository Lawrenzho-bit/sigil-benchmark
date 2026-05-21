# B2B SaaS Portal

An enterprise workflow-management portal: organizations, role-based access,
Stripe subscription billing, an append-only audit log, and the operational
plumbing to run it.

**Stack:** Next.js 14 (App Router) · TypeScript · PostgreSQL · Prisma ·
Stripe · Resend · Docker.

---

## ⚠️ Read this first — implementation status

This repository is a **coherent, runnable foundation**, not a finished product
that has had a security review or load testing. A genuinely production-ready
portal serving paying customers needs work beyond what is here. Treat the
status table below as the source of truth.

The security-critical paths are implemented properly — auth, RBAC, audit
logging, the Stripe webhook, rate limiting — because those are the parts that
are dangerous to get wrong or to stub. Several product features are
scaffolded or partial. **Do not deploy to production serving real customers
until the "Partial / TODO" items are completed and an independent security
review has been done.**

| Area | Status | Notes |
|---|---|---|
| Email/password auth | ✅ Implemented | argon2id, NIST 800-63B policy, breach screening |
| Sessions | ✅ Implemented | Hashed tokens, `__Host-` cookie, idle + absolute timeout |
| MFA (TOTP) | ✅ Implemented | Enroll/enable/verify; encrypted secret at rest |
| RBAC | ✅ Implemented | Owner/Admin/Viewer matrix, enforced in UI + API; unit-tested |
| Audit log | ✅ Implemented | Append-only; DB-level immutability script provided |
| Rate limiting | ✅ Implemented | Postgres-backed; 5/15min on auth per spec |
| Stripe webhook | ✅ Implemented | Signature verified, idempotent |
| Billing checkout/portal | ✅ Implemented | Checkout + Billing Portal; plan limits enforced |
| Password reset | ✅ Implemented | Single-use hashed token, revokes all sessions |
| User invite + role/deactivate | ✅ Implemented | Signed tokens, last-Owner guard |
| Health / metrics endpoints | ✅ Implemented | `/api/health`, `/api/metrics` (Prometheus) |
| GDPR export + deletion | ✅ Implemented | Self-service export + cascading delete |
| Dashboard | 🟡 Partial | API complete; UI shows core metrics, not all widgets |
| SAML 2.0 SSO | 🟡 Scaffold | `SamlConnection` model only — no ACS/metadata flow yet |
| CSV bulk user import | 🟡 TODO | Endpoint not built; design noted below |
| Invite-accept UI flow | 🟡 TODO | API issues invites; accept page/route not built |
| Settings screens | 🟡 TODO | Org/user settings models exist; no UI |
| Caching layer | 🟡 TODO | No Redis; rate limiter is DB-backed (see Scaling) |
| Automated tests | 🟡 Partial | Unit tests for RBAC + password; no integration/e2e suite |

---

## Quick start (local)

Prerequisites: Node 20+, Docker.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    Generate real secrets:
#    SESSION_SECRET        -> openssl rand -base64 48
#    FIELD_ENCRYPTION_KEY  -> openssl rand -base64 32

# 3. Start Postgres (compose includes a db service)
docker compose up -d db

# 4. Apply migrations + generate the Prisma client
npm run db:migrate:dev
npm run db:seed          # optional: demo org with one user per role

# 5. Run it
npm run dev              # http://localhost:3000
```

Seed users (password `demo-password-1234`): `owner@`, `admin@`, `viewer@` —
all `@demo.example.com`.

### Run the whole stack in Docker

```bash
docker compose up --build
```

The app container runs pending migrations on boot (`docker-entrypoint.sh`)
before accepting traffic.

---

## Configuration

All config is environment-based (12-factor) — see `.env.example` for the full
list with descriptions. `src/lib/env.ts` validates it at startup and fails
fast with a clear message if anything is missing or malformed. No secrets are
hardcoded.

Key variables: `DATABASE_URL`, `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
`METRICS_TOKEN`.

---

## Architecture

```
src/
  app/
    api/            Route handlers (auth, users, billing, webhooks, ...)
    dashboard/      Server-rendered dashboard
    page.tsx        Sign-in / landing
    privacy, terms  Generated legal pages
  components/       Client components (login form, cookie consent)
  lib/              Core: db, env, auth, rbac, audit, crypto, stripe, email
  middleware.ts     Request id + CSRF origin check
prisma/
  schema.prisma     Data model
  migrations/       SQL migrations (migrate deploy)
  sql/              Audit-log immutability hardening (run once)
  seed.ts           Dev seed
```

**Request flow for a protected API route:** `middleware` (CSRF/origin check) →
handler wrapped by `handleRoute` (uniform error handling) → `authorize(perm)`
(session + RBAC) → business logic in a transaction → `audit(...)` for
permission-relevant actions.

---

## Security summary

- **Passwords** — argon2id; min 12 chars, no composition rules, screened
  against Have I Been Pwned (k-anonymity) per NIST SP 800-63B.
- **Sessions** — random token, only its SHA-256 hash stored; `__Host-` +
  `HttpOnly` + `Secure` + `SameSite=Lax` cookie; idle and absolute timeouts.
- **CSRF** — SameSite cookie plus an Origin/Host check in middleware for all
  mutating API requests (webhook exempt; it uses signature auth).
- **RBAC** — single permission matrix (`src/lib/rbac.ts`) enforced identically
  in UI and API; privilege-escalation and last-Owner guards.
- **SQL injection** — all DB access via Prisma (parameterized).
- **Input validation** — every endpoint validates its body/query with Zod.
- **Rate limiting** — auth endpoints capped at 5 attempts / 15 min per IP.
- **Encryption at rest** — sensitive columns (TOTP secret, SAML key) encrypted
  with AES-256-GCM (`src/lib/crypto.ts`). Enable disk/volume encryption on the
  database for everything else.
- **Transport** — HSTS + a strict CSP and related headers (`next.config.mjs`).
- **Error handling** — `handleRoute` ensures no stack traces or internals ever
  reach the client; full detail is logged server-side.
- **Audit immutability** — application-level append-only, plus
  `prisma/sql/audit-immutability.sql` to enforce it at the database level.

Known gaps to close before production: SAML SSO, automated integration/e2e
tests, dependency/secret scanning in CI, and a third-party security review.

---

## Operations

- **Logging** — structured JSON via pino (`src/lib/logger.ts`), sensitive keys
  redacted. Ship stdout to your aggregator.
- **Health** — `GET /api/health` checks DB connectivity; used by the Docker
  HEALTHCHECK and load-balancer probes. Returns 503 when degraded.
- **Metrics** — `GET /api/metrics` in Prometheus format, bearer-token
  protected (`METRICS_TOKEN`). For process/runtime metrics add `prom-client`
  default collectors.
- **DB pooling** — set via `connection_limit` in `DATABASE_URL`. With many
  serverless instances, front Postgres with PgBouncer and point `DATABASE_URL`
  at the pooler, `DIRECT_URL` at the database (Prisma uses the latter for
  migrations).
- **Scaling / caching** — the rate limiter is Postgres-backed so it is correct
  across instances; at higher throughput move it (and add read caching) to
  Redis. The interface in `src/lib/rate-limit.ts` is designed for that swap.

### Backup strategy

- Use a managed Postgres (RDS / Cloud SQL / Neon) with automated daily
  snapshots and point-in-time recovery (retain ≥ 30 days; audit-log retention
  is 7 years, so also take periodic logical dumps to object storage).
- `pg_dump` nightly to encrypted object storage (e.g. S3 with SSE) as a
  second, provider-independent copy.
- Test restores quarterly — an untested backup is not a backup.
- Audit-log retention is configurable per organization
  (`Organization.auditRetentionYears`, default 7).

---

## Deployment — AWS (example)

One concrete path; the container runs anywhere.

1. **Database** — provision RDS for PostgreSQL 16, encryption at rest on,
   automated backups + PITR enabled, in private subnets.
2. **Image** — `docker build -t <ecr-repo>:<tag> .` and push to ECR. The CI
   workflow builds the image on `main`; add ECR credentials and an
   authenticated push step.
3. **Run** — ECS Fargate service behind an Application Load Balancer.
   - Container port 3000; ALB terminates TLS (ACM certificate).
   - Target-group health check → `/api/health`.
   - Inject env vars from AWS Secrets Manager — never bake secrets into the
     image.
4. **Migrations** — applied automatically on container start by
   `docker-entrypoint.sh` (`prisma migrate deploy`, idempotent). For
   zero-downtime, run migrations as a one-off task before rolling the service.
5. **Post-deploy, once** — run `prisma/sql/audit-immutability.sql` against the
   database to enforce append-only audit logs.
6. **Stripe** — create a webhook endpoint pointing at
   `https://<your-domain>/api/webhooks/stripe` and set `STRIPE_WEBHOOK_SECRET`.
7. **DNS/TLS** — Route 53 → ALB; HSTS is already sent by the app.

Equivalent setups: Fly.io (`fly launch` + `fly postgres`), Render
(Web Service + Managed Postgres), or Google Cloud Run + Cloud SQL.

---

## CI/CD

`.github/workflows/ci.yml` runs on every push/PR: install → Prisma generate →
migrate → typecheck → lint → unit tests → build, against a throwaway Postgres
service. On `main` it also builds the Docker image. Wire the registry push and
deploy steps to your environment and add credentials as repository secrets.

---

## Notes on unfinished features

- **SAML SSO** — `SamlConnection` holds IdP config. To complete: add
  `/api/auth/saml/[orgId]/metadata` and an ACS endpoint, validate the signed
  assertion (e.g. with `@node-saml/node-saml`), then mint a session.
- **CSV bulk import** — add `POST /api/users/import` accepting a CSV, validate
  each row with the existing invite schema, enforce the plan seat limit for
  the batch, and create invitations in one transaction with one audit entry
  per invite.
- **Invite acceptance** — the invite email links to `/accept-invite?token=`;
  build that page plus a route that validates the hashed token, creates the
  user, and starts a session.

## License

Proprietary — internal scaffold.
