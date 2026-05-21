# Marketplace Platform

A B2C two-sided marketplace API — buyers and sellers, listings, Stripe Connect
split payments, orders, reviews, messaging, disputes, weekly payouts, tax
handling, and an admin moderation/fraud panel.

> **Scope note (read this first).** This repository is a coherent, runnable
> **foundation**, not a finished production system. The data model covers all
> 12 required subsystems; the core commerce path (auth → listings → search →
> cart → checkout → orders → reviews → payouts) is implemented end to end.
> Several subsystems are deliberately scaffolded with real interfaces and
> documented TODOs rather than fully built. See **Implementation status**
> below for an honest, line-by-line breakdown. Building all 12 subsystems to
> true production grade (load tested, security audited, with a frontend) is a
> multi-team, multi-month effort.

## Tech stack

| Concern        | Choice |
|----------------|--------|
| Language       | TypeScript |
| Framework      | NestJS 10 (modular, DI, decorators) |
| Database       | PostgreSQL 16 |
| ORM            | Prisma 5 |
| Payments       | Stripe Connect (Express accounts, split payments) |
| Object storage | S3-compatible (MinIO in dev) for listing photos |
| Cache / queues | Redis + BullMQ |
| Auth           | JWT access + rotating refresh tokens; Google OAuth |
| Scheduling     | `@nestjs/schedule` (weekly payout cron) |
| Packaging      | Docker + docker-compose |

Money is stored as **integer minor units** (cents) plus an ISO-4217 currency
code — never floats.

## Quick start

```bash
cp .env.example .env          # fill in Stripe keys to exercise payments
docker compose up -d postgres redis minio
npm install
npm run prisma:migrate        # creates the schema
npm run prisma:seed           # categories + an admin account
npm run start:dev
```

API: `http://localhost:3000/api/v1` · Swagger UI: `http://localhost:3000/api/docs`

Full stack in containers: `docker compose up --build`.

## Architecture

```
src/
  main.ts                 Bootstrap: helmet, validation, versioning, Swagger
  app.module.ts           Root module wiring
  config/                 Env schema (fail-fast validation)
  common/                 PrismaService, guards, decorators, filters, health
  modules/
    auth/                 Register/login, JWT + refresh rotation, Google OAuth
    users/                Profile, GDPR export + erasure
    sellers/              Onboarding, KYC via Stripe Connect
    listings/             CRUD, photo upload (presigned S3), lifecycle
    search/               Search / filter / browse, category tree
    cart/                 Cart + items
    checkout/             Multi-seller order split, Stripe PaymentIntent, webhooks
    orders/               Buyer + seller order management, fulfilment
    reviews/              Ratings with seller/listing aggregate recompute
    messaging/            Buyer↔seller conversations
    disputes/             Dispute lifecycle + admin resolution
    payouts/              Weekly payout cron (after platform fee)
    tax/                  Marketplace-facilitator VAT/GST
    admin/                Moderation queue, fraud review, suspensions, metrics
    stripe/  storage/     Shared infrastructure wrappers
```

### Key design decisions

- **One `Order` per seller per checkout.** A buyer's cart can span multiple
  sellers. Checkout creates one `OrderGroup` and splits items into one `Order`
  per seller, so each seller is fulfilled, disputed, and paid out independently.
- **Funds held until delivery.** The buyer is charged at checkout (platform
  PaymentIntent). Per-seller proceeds, net of the platform fee, are transferred
  to Connect accounts in the **weekly payout run** — only for `DELIVERED`,
  dispute-free orders. This gives the platform a dispute window.
- **Snapshots.** `OrderItem` stores a title/price snapshot; listings can change
  or be removed without corrupting order history.
- **Soft deletes** on listings (`deletedAt`) so order history and audit remain
  intact.

## Compliance posture

- **PCI DSS SAQ-A.** Card data is entered directly into Stripe.js / Stripe
  Checkout and never transits or rests on our infrastructure. We store only
  Stripe object IDs. Auth headers/cookies are redacted from logs.
- **GDPR.** `GET /users/me/export` (portability, Art. 20) and `DELETE /users/me`
  (erasure, Art. 17 — pseudonymises the user while retaining legally-required
  order/tax records). Append-only `AuditLog` for accountability.
- **EU Digital Services Act.** `SellerProfile.dsaTraderVerified` gates trader
  listings (Art. 30 traceability); every moderation decision records a
  machine-readable **statement of reasons** (Art. 17). Pushing those to the EU
  DSA Transparency Database is a documented TODO.

## Implementation status

| # | Subsystem | Status | Notes |
|---|-----------|--------|-------|
| 1 | Accounts (email/OAuth) | ✅ Implemented | Argon2id, JWT + refresh rotation w/ reuse detection, Google OAuth |
| 2 | Seller onboarding + KYC | ✅ Implemented | Stripe Connect Express hosted flow; webhook syncs KYC state |
| 3 | Listing creation | ✅ Implemented | CRUD, presigned-S3 photo upload, draft→active lifecycle |
| 4 | Search / filter / browse | ⚠️ Functional | Indexed SQL filters + sort. **Needs `tsvector`/OpenSearch for 1M+ listings & relevance ranking** |
| 5 | Cart + checkout (Stripe Connect) | ✅ Implemented | Multi-seller split, tax, PaymentIntent, idempotent webhooks |
| 6 | Order management | ✅ Implemented | Buyer + seller views, ship/track/deliver/cancel |
| 7 | Reviews + ratings | ✅ Implemented | Post-delivery, aggregate recompute, seller replies |
| 8 | Messaging | ⚠️ Functional | REST conversations/messages. **No WebSocket — clients poll** |
| 9 | Dispute resolution | ✅ Implemented | Full lifecycle + admin resolution + audit |
| 10 | Payouts (weekly) | ✅ Implemented | Cron, platform-fee withholding, Connect transfers |
| 11 | Tax (VAT/GST facilitator) | ⚠️ Functional | Static rate table fallback. **Wire Stripe Tax for production accuracy** |
| 12 | Admin panel | ⚠️ Backend only | Moderation/fraud/suspension APIs + metrics. **No admin UI** |

### Known gaps — production hardening checklist

These are intentionally **not** done and would be required before launch:

- [ ] **Migrations** — run `prisma migrate dev` to generate the initial
      migration; none are committed.
- [ ] **Refund execution** — dispute resolution and order cancellation set
      statuses but the actual Stripe refund / transfer reversal is a `TODO`
      (should run as a BullMQ job).
- [ ] **Fraud detection** — the `FraudCase` model and admin review exist, but
      no rules/scoring engine creates cases. Needs a detection pipeline.
- [ ] **Notifications** — `Notification` model exists; no email/push delivery
      (no provider wired). Email verification is modelled but not enforced.
- [ ] **BullMQ workers** — Redis/BullMQ are dependencies but no queues/workers
      are registered. Async work (refunds, payout retries, image processing,
      DSA database submission) should move onto queues.
- [ ] **Search at scale** — replace `ILIKE` with Postgres full-text search or
      a dedicated engine; add facet counts.
- [ ] **Frontend** — this is an API only; no buyer/seller/admin web app.
- [ ] **Test coverage** — only a representative unit test (`tax.service.spec.ts`)
      is included. Needs broad unit + e2e coverage.
- [ ] **Observability** — structured logs are in place; add metrics + tracing.
- [ ] **Rate limiting** — a global throttler is set; tighten per-route limits
      on auth and checkout.
- [ ] **CI/CD, secrets management, infra-as-code.**

## Testing

```bash
npm test          # unit tests
```

## License

UNLICENSED — internal scaffold.
