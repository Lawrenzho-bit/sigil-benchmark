# B2B Portal

A multi-tenant B2B SaaS portal: organizations, role-based access, user
lifecycle, audit logging, and an account/settings surface. Built with
Next.js (App Router) + Prisma + Postgres.

## Honest status

This is a **working vertical slice**, not a finished product. Read this
section before relying on anything.

| Area | Status |
|---|---|
| Email/password auth | **Implemented** — bcrypt hashing, server sessions, enumeration-resistant login |
| RBAC (owner/admin/viewer) | **Implemented** — deny-by-default policy, unit-tested, enforced on every route |
| Dashboard metrics | **Implemented** — live counts from the DB |
| User management (invite/role/deactivate) | **Implemented** — with privilege-escalation and last-owner guards |
| Audit log | **Implemented** — append-only, actor snapshotted, admin actions recorded |
| Org & user settings | **Implemented** |
| SAML SSO | **Deferred — defined boundary.** `src/lib/saml.ts` throws until implemented. Not faked. |
| Stripe billing | **Deferred — defined boundary.** Plan model is real; `src/lib/stripe.ts` throws until wired. |
| Email notifications | **Deferred — dev logs, prod throws.** `src/lib/email.ts`. |

Why deferred and not stubbed-as-done: a fake SSO/billing path that *appears*
to work is a security and correctness liability. Each boundary throws loudly
with the exact steps to complete it, so nothing silently no-ops in
production.

### What is verified

- `npm test` runs the RBAC unit suite (`src/lib/rbac.test.ts`) — the
  security-critical authorization core, including privilege-escalation
  cases. This is the one part proven by automated tests.
- `npm run typecheck` / `npm run lint` gate the rest in CI.
- **Not** verified by an automated end-to-end run: the live Next.js + Postgres
  stack. There are no DB-backed integration tests yet — this is a known gap,
  not an oversight. Highest-value next step before production.

## Run locally

```bash
cp .env.example .env                 # adjust if needed
docker compose up -d db              # Postgres only
npm install
npx prisma migrate dev               # create schema
SEED_OWNER_EMAIL=you@example.com SEED_OWNER_PASSWORD='change-me-長い' npm run db:seed
npm run dev                          # http://localhost:3000
```

Or the whole thing in containers: `docker compose up --build`.

## Security notes

- Sessions are 256-bit random tokens in an httpOnly, SameSite=Lax,
  Secure-in-prod cookie; expired sessions are deleted on read; deactivating
  a user revokes their sessions immediately.
- Edge middleware is a coarse redirect only — real authZ is server-side on
  every route via `requirePermission()`. Presence of a cookie is never
  trusted as proof.
- Login is uniform-error and runs a dummy hash on missing users to resist
  account enumeration and timing analysis.
- Tenant isolation: every membership/user query is scoped by `orgId` from
  the session, so a valid id from another tenant still 404s.

## Production readiness gaps (do not skip before launch)

1. Implement the three deferred boundaries (SAML, Stripe, email).
2. Add DB-backed integration tests for auth + user-management routes.
3. Add rate limiting on `/api/auth/login`.
4. Add observability: structured request logs, error tracking, a
   `/api/health` endpoint, and DB connection metrics. ("Monitored" in the
   brief is **not** delivered here.)
5. Secret management via the platform, not `.env` files.
6. Backups / migration rollback plan for Postgres.
```
