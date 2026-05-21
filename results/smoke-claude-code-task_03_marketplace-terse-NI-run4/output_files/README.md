# Marketplace Platform

A B2C two-sided marketplace API: buyers and sellers, KYC-gated seller
onboarding, listings, search, split-payment checkout via Stripe Connect,
orders, reviews, messaging, disputes, weekly payouts, marketplace-facilitator
tax, and an admin/moderation surface.

> **Scope honesty.** This repository is a **coherent, runnable backend
> foundation**, not a finished production system. The data model covers all 12
> required domains and the core flows are implemented end-to-end with real
> integration code. Sections marked **(Gap)** below are deliberately stubbed or
> omitted and would need to be built before a real launch. See
> [§What is and isn't done](#what-is-and-isnt-done).

## Stack

| Concern        | Choice                                              |
|----------------|-----------------------------------------------------|
| Runtime        | Node.js 20, TypeScript (ESM)                        |
| HTTP framework | Fastify 4                                           |
| Database       | PostgreSQL 16 via Prisma ORM                        |
| Payments       | Stripe Connect (destination charges)                |
| Object storage | Any S3-compatible store (MinIO locally)             |
| Auth           | Argon2id passwords, HS256 JWT access + rotating refresh tokens |
| Deployment     | Docker multi-stage build; `docker-compose` for local |

## Architecture

```
src/
  config.ts            Validated env config (fails fast at boot)
  db.ts                Shared PrismaClient
  app.ts               Fastify assembly: plugins, error handler, routes
  server.ts            Process entrypoint + graceful shutdown
  lib/
    tokens.ts          JWT + refresh-token hashing
    stripe.ts          Connect accounts, destination charges, transfers
    s3.ts              Presigned photo uploads
    kyc.ts             Identity-verification provider abstraction
    tax.ts             VAT/GST facilitator calculation
    errors.ts          Typed AppError + HTTP mapping
    pagination.ts      Cursor pagination helpers
  middleware/auth.ts   requireAuth / requireRole / requireAdmin
  routes/              One module per domain (see below)
  workers/payouts.ts   Weekly payout job
prisma/
  schema.prisma        Full data model (all 12 domains)
  seed.ts              Category tree + admin account
```

### Key design decisions

- **Money is integer minor units.** Every amount is an `Int` in a known
  currency. No floats in financial paths — see `src/lib/money.test.ts`.
- **Destination charges.** The buyer is charged on the platform account; Stripe
  routes the seller's share to their connected account and withholds the
  `application_fee_amount`. Card data never touches our servers, which keeps
  PCI scope at **SAQ-A**.
- **One Order per seller.** A cart can span sellers; checkout splits it so each
  Order maps cleanly to one PaymentIntent, one payout line, and one dispute.
- **Cursor pagination everywhere.** Offset pagination does not survive 1M+
  listings; list endpoints page by an opaque id cursor against composite
  indexes.
- **Webhook inbox.** Stripe events are deduped via the `WebhookEvent` table and
  processed at most once. Signature verification runs against the raw body.
- **Inventory safety.** Checkout decrements stock with a conditional
  `updateMany` inside a transaction, so concurrent checkouts cannot oversell.
- **Soft deletes for referenced rows.** Listings and users are never hard
  deleted (orders/payments reference them); they move to `REMOVED` / `DELETED`.

## API surface

| Domain | Routes |
|--------|--------|
| Accounts/OAuth | `POST /api/auth/{signup,login,refresh,logout}`, `GET /api/auth/me`, `POST /api/auth/oauth/:provider/link` |
| Seller onboarding/KYC | `POST /api/sellers`, `GET /api/sellers/me`, `POST /api/sellers/me/bank-account`, `POST /api/sellers/me/kyc/sync` |
| Listings | `POST/GET/PATCH/DELETE /api/listings/:id`, `POST /api/listings/:id/status`, photo presign/attach/delete |
| Search/browse | `GET /api/search`, `GET /api/categories` |
| Cart | `GET /api/cart`, `POST/PATCH/DELETE /api/cart/items` |
| Checkout | `POST /api/checkout` |
| Orders | `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/transition` |
| Reviews | `POST /api/orders/:orderId/review`, `POST /api/reviews/:id/reply`, `GET /api/sellers/:id/reviews` |
| Messaging | `POST/GET /api/conversations`, conversation messages |
| Disputes | `POST /api/orders/:orderId/dispute`, dispute messages, escalate |
| Payouts | `GET /api/payouts`, `GET /api/payouts/balance` |
| Webhooks | `POST /api/webhooks/stripe` |
| Admin/moderation | flags queue, resolve, suspend seller, dispute resolution, audit log |
| GDPR | `GET /api/privacy/export`, `POST /api/privacy/erase` |

## Running locally

```bash
cp .env.example .env          # fill in Stripe keys; defaults work for DB/S3
docker compose up -d db minio minio-init
npm install
npm run prisma:migrate        # creates the schema
npm run seed                  # categories + admin@marketplace.local
npm run dev                   # API on http://localhost:8080
```

Or run the whole stack in containers: `docker compose up --build`.

Run the weekly payout job: `npm run worker:payouts` (wire to cron / a scheduler).

Tests: `npm test` (pure money/tax math; no DB required).

### Full-text search index

After the first migration, add the GIN index that `GET /api/search` relies on:

```sql
CREATE INDEX listing_fts ON "Listing"
USING GIN (to_tsvector('simple', title || ' ' || description));
```

Add this as a manual step inside a Prisma migration (`prisma migrate dev
--create-only`, then paste the SQL).

## Compliance posture

- **PCI DSS SAQ-A** — card data is collected client-side by Stripe Elements/
  Checkout; the server only ever handles tokens and PaymentIntent ids.
- **GDPR** — Art. 15 export and Art. 17 erasure endpoints (`/api/privacy/*`).
  Erasure scrubs PII but retains financial rows for statutory accounting
  periods. Refresh sessions are revocable; passwords are Argon2id.
- **EU DSA** — public notice-and-action flagging (Art. 16), removals require a
  stored statement of reasons (Art. 17), and every privileged admin action is
  written to an append-only audit log for transparency reporting.
- **Marketplace-facilitator tax** — VAT/GST is calculated on the buyer's
  destination country, collected at checkout, and snapshotted per order in
  `TaxRecord` for remittance by the platform.

## What is and isn't done

**Implemented end-to-end:** data model (all 12 domains), auth + sessions,
seller onboarding scaffolding, listing CRUD + photo presigning, search/filter,
cart, multi-seller checkout with tax + fees + inventory locking, Stripe
PaymentIntent creation, order state machine, reviews with rating aggregates,
messaging, dispute workflow, weekly payout worker, Stripe webhook ingestion,
admin moderation/fraud/dispute tooling, GDPR endpoints, Docker packaging.

**(Gap) — needs building before production:**

- **OAuth code exchange.** `/api/auth/oauth/:provider/link` implements the
  account-linking logic but expects an already-verified profile; the
  provider's authorization-code exchange + state/PKCE handling is not wired.
- **Email delivery.** Signup creates accounts but no verification or
  transactional email is sent (`emailVerified` stays false).
- **Abandoned-checkout reconciliation.** Orders stuck in `PENDING_PAYMENT`
  hold reserved inventory; a sweeper job to release it after a timeout is
  described in `webhooks.ts` but not implemented.
- **Tax rate table** in `lib/tax.ts` is a small static illustration. Production
  should use `stripe_tax` or a maintained rate engine, plus reverse-charge /
  OSS handling.
- **Background job runner.** The payout worker is a plain script; production
  needs a real scheduler/queue (e.g. cron + a queue for retries).
- **Search relevance & facets.** FTS is basic; a dedicated search engine
  (OpenSearch/Typesense) would be warranted at the stated 1M-listing scale.
- **Realtime messaging** (websockets/push), image processing/thumbnails,
  rate-limit tuning per-route, observability (metrics/tracing), and an
  automated integration test suite are out of scope for this pass.
- **Frontend.** This is the API only; no buyer/seller/admin web UI is included.

## Testing & verification status

`src/lib/money.test.ts` covers the pure tax/fee math and passes with `npm
test`. The HTTP layer, Prisma queries, and Stripe integration have **not** been
run against live services in this pass — they are written to compile and to
match the documented Prisma/Stripe/Fastify APIs, but should be exercised
against a real database and Stripe test mode before being trusted.
