# B2B SaaS Portal

A multi-tenant B2B SaaS portal: email/password + SAML SSO authentication,
role-based access control, a metrics dashboard, Stripe subscription billing,
an append-only audit log, user management, settings, and transactional email.

## Stack

| Concern        | Choice                                            |
| -------------- | ------------------------------------------------- |
| Framework      | Next.js 14 (App Router) + TypeScript              |
| Database       | PostgreSQL via Prisma ORM                         |
| Auth           | Signed-JWT session cookie; SAML 2.0 for SSO       |
| Billing        | Stripe Checkout + Billing Portal + webhooks       |
| Email          | SMTP via nodemailer (MailHog in dev)              |
| Deployment     | Docker (standalone build) + GitHub Actions CI/CD  |

## Feature → code map

| Requirement                | Where                                                        |
| -------------------------- | ------------------------------------------------------------ |
| Email/password auth        | `src/app/api/auth/{login,signup}` , `src/lib/{session,password}.ts` |
| SAML SSO                   | `src/lib/saml.ts`, `src/app/api/auth/saml/*`                 |
| RBAC (owner/admin/viewer)  | `src/lib/rbac.ts`, enforced in every route + page guard      |
| Dashboard / metrics        | `src/app/(app)/dashboard/page.tsx`                           |
| Stripe billing (3 plans)   | `src/lib/{plans,stripe}.ts`, `src/app/api/billing/*`         |
| Audit log                  | `src/lib/audit.ts`, `src/app/(app)/audit`                    |
| User management            | `src/app/api/users/*`, `src/app/(app)/users`                 |
| Settings (org + user)      | `src/app/api/settings/*`, `src/app/(app)/settings`           |
| Email notifications        | `src/lib/email.ts`                                           |
| Production readiness       | `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `/api/health` |

## Quick start (Docker — recommended)

```bash
cp .env.example .env          # adjust values if you like
docker compose up --build     # starts Postgres, MailHog and the app
```

Then, in another shell, create the schema and demo data:

```bash
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run db:seed
```

- App:        http://localhost:3000
- Sent email: http://localhost:8025  (MailHog)

The container entrypoint already runs `prisma migrate deploy` on boot; the
explicit command above is only needed the very first time if you want the
seed data immediately.

## Quick start (local Node)

```bash
npm install
cp .env.example .env          # set DATABASE_URL + SESSION_SECRET
npx prisma migrate deploy     # or `prisma migrate dev` while iterating
npm run db:seed               # optional demo org
npm run dev
```

### Demo accounts (after seeding)

| Email              | Role   | Password       |
| ------------------ | ------ | -------------- |
| owner@acme.test    | Owner  | `Password123!` |
| admin@acme.test    | Admin  | `Password123!` |
| viewer@acme.test   | Viewer | `Password123!` |

## Configuration

All configuration is via environment variables — see `.env.example` for the
full list. Required: `DATABASE_URL`, `SESSION_SECRET` (32+ chars). Stripe and
SAML are optional; the relevant UI is disabled gracefully when their variables
are not set (`billingEnabled` / `ssoConfigured` in `src/lib/env.ts`).

### Stripe

1. Create three recurring prices (Starter, Pro, Enterprise).
2. Set `STRIPE_SECRET_KEY` and the three `STRIPE_PRICE_*` IDs.
3. Add a webhook endpoint pointing at `/api/billing/webhook` and set
   `STRIPE_WEBHOOK_SECRET`. Subscribe to `customer.subscription.*` and
   `checkout.session.completed`.

The webhook — not the browser redirect — is the source of truth for
subscription state.

### SAML SSO

Set `SAML_IDP_SSO_URL` and `SAML_IDP_CERT` (IdP signing certificate). Configure
your IdP with:

- ACS / callback URL: `${APP_URL}/api/auth/saml/callback`
- SP entity ID: `SAML_SP_ENTITY_ID` (defaults to `${APP_URL}/saml/metadata`)

SSO signs in users who were already invited to an SSO-enabled organization;
it does not auto-provision accounts.

## Roles

| Capability                  | Viewer | Admin | Owner |
| --------------------------- | :----: | :---: | :---: |
| View dashboard / users      |   ✓    |   ✓   |   ✓   |
| Edit own profile/settings   |   ✓    |   ✓   |   ✓   |
| Invite / deactivate users   |        |   ✓   |   ✓   |
| Change roles                |        |   ✓*  |   ✓   |
| View billing                |        |   ✓   |   ✓   |
| Manage billing / org plan   |        |       |   ✓   |
| View audit log              |        |   ✓   |   ✓   |
| Manage org settings         |        |   ✓   |   ✓   |

\* Admins cannot grant or modify the Owner role, and the last active Owner can
never be demoted or deactivated.

## Scripts

| Command                  | Purpose                                  |
| ------------------------ | ---------------------------------------- |
| `npm run dev`            | Dev server                               |
| `npm run build`          | Production build (`prisma generate` + Next) |
| `npm start`              | Run the production build                 |
| `npm run lint`           | ESLint                                   |
| `npm run typecheck`      | `tsc --noEmit`                           |
| `npm test`               | Vitest unit tests                        |
| `npm run prisma:migrate` | Apply migrations (`migrate deploy`)      |
| `npm run db:seed`        | Seed the demo organization               |

## CI/CD

`.github/workflows/ci.yml`:

1. **test** — install, generate Prisma client, apply migrations against a
   throwaway Postgres service, then lint + typecheck + unit tests.
2. **build-image** — on `main`, build the Docker image and push it to GHCR.
3. **deploy** — a gated placeholder job; wire in your platform's deploy
   command (Fly.io, Render, ECS, Cloud Run, Kubernetes, …).

## Security notes

- Passwords hashed with bcrypt (cost 12); invite tokens stored only as SHA-256.
- Session JWT is httpOnly, `SameSite=Lax`, and `Secure` in production.
- Role/status are re-read from the DB on every request, so demotion or
  deactivation takes effect immediately.
- Login is rate-limited per IP and per account.
- Stripe webhook signatures are verified before processing.
- Security headers (HSTS, `X-Frame-Options`, `X-Content-Type-Options`) set in
  `next.config.mjs`.
- Tenancy: every query is scoped by `organizationId`.

## Known scope / next steps

This is a complete, working codebase covering all nine required features. For a
specific production environment you will still want to:

- Move the in-memory rate limiter (`src/lib/ratelimit.ts`) to Redis if running
  more than one instance.
- Add a managed error/APM integration (the JSON logger in `src/lib/logger.ts`
  is structured for easy ingestion).
- Add end-to-end tests and expand unit coverage around the API routes.
- Configure real SMTP, Stripe, and SAML credentials per environment.
