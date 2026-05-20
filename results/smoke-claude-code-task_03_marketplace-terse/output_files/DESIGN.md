# Marketplace Platform — Design & Phased Build Plan

Scope ref: task_03.variant_terse.v1 (2026-05-19). Scale targets: 10k sellers, 100k buyers, 1M+ listings. Compliance: PCI DSS SAQ-A, GDPR, EU DSA.

This document is the design artifact, not the implementation. It is sized to be the input to a 6–9 month engineering build, not a one-session deliverable.

---

## 1. Top-level architecture

Single deployable monolith for the first 12 months, with hard internal module boundaries that map to future service extractions. Reasoning: at the target scale (1M listings is small; 10k sellers is small), a well-modularised monolith outperforms microservices on iteration speed, ops cost, and transactional integrity (orders ↔ payments ↔ payouts). Extract only when a module has a distinct scaling or compliance envelope (search, payments, media processing).

```
┌────────────────────────────────────────────────────────────┐
│  Web edge (CDN + WAF)                                      │
│  - Static assets, signed image URLs, rate limiting         │
└────────────────────────────────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│  App tier (stateless, horizontally scaled)                 │
│  Modules (in-process, separate packages):                  │
│   identity │ catalog │ search │ cart │ checkout            │
│   orders   │ reviews │ messaging │ disputes │ payouts      │
│   tax      │ moderation │ admin │ audit                    │
└────────────────────────────────────────────────────────────┘
   │           │            │             │           │
   ▼           ▼            ▼             ▼           ▼
Postgres   OpenSearch   Redis        S3 (media)   Stripe
(primary)  (search)     (cache/rl)                Connect
   │
   ▼
Read replicas (search backfill, analytics, admin queries)
```

Out-of-process workers (same codebase, different entrypoint) handle: payout runs, KYC webhook reconciliation, search indexing, image processing, dispute SLA timers, DSA notice-and-action timers, GDPR export/delete jobs.

## 2. Tech stack (recommended)

- **Language:** TypeScript on Node.js (single language across web/API/workers; mature Stripe + AWS SDKs; large hireable pool). Alternative: Go if you anticipate >10x scale faster, accepting more boilerplate.
- **Framework:** Next.js (App Router) for the buyer-facing storefront and seller dashboard; separate Fastify service for the public API and webhooks. Splitting these prevents storefront traffic spikes from starving webhook handlers.
- **DB:** Postgres 16. Prisma for app code; raw SQL + sqlc-style codegen for hot paths (search results, order list, payout calculation).
- **Search:** OpenSearch. Postgres full-text is tempting but breaks down past ~100k listings with faceting + geo + ranking.
- **Cache / rate limit / queues:** Redis (cache + token bucket) + a real queue (SQS or a Postgres-backed queue like Graphile Worker). Don't put jobs in Redis — losing a payout job is a regulatory problem.
- **Media:** S3 + CloudFront. Image processing via a worker that produces a fixed set of derivatives; never resize on-request.
- **Payments:** Stripe Connect (Custom accounts for sellers — required for marketplace-of-record tax handling). All card data tokenized client-side via Stripe Elements → keeps PCI scope at SAQ-A.
- **Infra:** Containers on ECS Fargate or GKE Autopilot. RDS Postgres with PITR. Terraform.

## 3. Data model — load-bearing entities

Keys called out are the ones that surprise teams later.

- `users` — identity only. Both buyer and seller roles attached via `user_roles`. A user can be both.
- `seller_accounts` — separate from users. Holds KYC state, Stripe Connect account id, payout schedule, tax-jurisdiction, suspension state. **Why separate:** a user's identity is forever; a seller account can be terminated and re-created under restrictions.
- `listings` — `seller_id`, `status` (draft/active/paused/removed/dsa_blocked), `inventory_kind` (single/multi), versioning row for DSA traceability (every public-facing change is an audit row).
- `listing_versions` — append-only. DSA Article 17 requires you to show users the *specific* version that was acted on.
- `orders` — `buyer_id`, `seller_id`, `status`, `payment_intent_id`. Order items snapshot `listing_version_id` + price + tax — **never join live listing fields into financial views**, prices drift.
- `payments`, `refunds`, `payouts` — separate tables. Payouts reference a *set* of order items (you pay out per item, not per order, because items can be partially refunded/disputed).
- `kyc_checks` — vendor-agnostic check log; provider id is a column, not a table per provider. Cheaper to swap Persona ↔ Onfido ↔ Stripe Identity later.
- `disputes` — has its own state machine; references order item; resolution outcome feeds back into payout calculation.
- `messages` — buyer ↔ seller, must be searchable by admin for fraud investigation, must be exportable for GDPR SAR, must be redactable for GDPR erasure. Soft-delete is not enough.
- `dsa_notices`, `dsa_actions`, `transparency_events` — DSA Article 24 transparency reports are aggregated from this.
- `audit_log` — append-only, every admin action and every automated moderation decision. Required for DSA; you'll want it for SOC2 later anyway.

## 4. The hard bits, called out

These are the parts engineers underestimate. Each is a multi-week workstream on its own.

### 4.1 KYC + onboarding
Use Stripe Identity or Persona. Don't build it. The work isn't the integration — it's the **state machine**: started → docs requested → docs submitted → under review → approved/rejected/needs more info, with re-verification triggers (>$X transacted, address change, sanctions list re-scan). Sellers must be able to operate in a "verified but payout-blocked" state.

### 4.2 Stripe Connect + split payments
- Use **destination charges** with `transfer_data[destination]`, not separate transfers — keeps reconciliation sane.
- Platform fee is a *line item*, not a deduction. Store it explicitly.
- Refund flow: who eats the fee depends on seller-vs-platform fault — model this in the dispute resolution outcome, not in payment code.
- Connect requires a webhook reconciliation worker. Webhooks are at-least-once and out-of-order. Idempotency keys on every write.

### 4.3 Tax (the trap)
EU/UK treat marketplaces as the **deemed supplier** for B2C imports and some domestic sales. This isn't a "VAT field on a listing" — it's a per-jurisdiction calculation engine. Use Stripe Tax or TaxJar. Implication: tax must be calculated **at checkout**, stored on the order item, included in payout calculation, and reported per jurisdiction quarterly.

### 4.4 EU Digital Services Act
Often missed. Concrete obligations:
- **Notice-and-action mechanism** (Art. 16): public form for illegal-content reports, must produce a reference ID, must respond with a statement of reasons (Art. 17).
- **Trusted flagger** priority queue (Art. 22).
- **Internal complaint handling** (Art. 20): sellers can appeal moderation decisions.
- **Transparency reports** (Art. 24): aggregated stats on moderation actions, automated decisions, complaints.
- **Traceability of traders** (Art. 30): you must collect and verify seller identity/contact details — overlaps with KYC but is broader (covers self-employed individuals).
- **Statement of reasons** must be sent to the Commission's database.

This is roughly a 2-month workstream in itself once you account for the legal review.

### 4.5 GDPR specifics
- DSAR (export) within 30 days, machine-readable. Build the export pipeline early; retrofitting it across 14 modules is painful.
- Right to erasure conflicts with financial record retention. Resolve: pseudonymise PII on user-erasure, keep order rows with a tombstoned user_id. Document the legal basis (Art. 17(3)(e)).
- Messaging erasure: redact, don't delete, when the other party still needs the thread.
- Data residency: EU users' data in EU regions. This drives infra topology.

### 4.6 Disputes
A state machine with SLA timers, evidence upload, both-party visibility, and an admin override path. Outcomes affect payouts (clawback if seller loses post-payout). Build clawback **before** you launch payouts, not after.

### 4.7 Payouts
Weekly cron + per-seller payout schedule + rolling reserve for new sellers + holdback for open disputes + tax withholding where applicable. Idempotency is non-negotiable — double payouts are an incident.

### 4.8 Search
Faceted (category, price range, location radius, rating, free-text), with seller-side boosts (newer listings get a small bump), with moderation filtering (blocked listings never appear). Plan for query QPS = ~10x your concurrent-user count. Index updates within 60s of edit is the realistic target; sub-second is expensive.

### 4.9 Admin panel
Not "an admin dashboard" — it's its own product. Moderation queue, fraud signals, dispute arbitration, KYC review, payout adjustments, audit log viewer, DSA transparency exports. Plan ~20% of total engineering effort here. Easy to under-invest, expensive in support cost.

## 5. Phased build plan

Each phase is ~6–10 weeks for a team of 4–6 engineers. Sequence matters — later phases assume earlier ones.

### Phase 0 — Foundations (4 wk)
Repo, CI, infra-as-code, Postgres + migrations, auth (email + one OAuth provider), audit log scaffolding, observability (logs/metrics/traces), error tracking. **Exit criterion:** a logged-in user can edit their profile and the action shows up in the audit log.

### Phase 1 — Sell-side core (8 wk)
Seller signup, KYC integration (one provider), listing CRUD with photos, listing versioning, basic admin moderation queue. No buyer flows yet. **Exit:** a seller can complete KYC and publish a listing; an admin can remove it.

### Phase 2 — Buy-side core, no money (6 wk)
Browse, search (OpenSearch), filters, listing detail page, cart, messaging. **Exit:** buyers can find listings and message sellers. No checkout yet.

### Phase 3 — Payments (10 wk)
Stripe Connect setup, checkout, order creation, payment intent flow, webhook reconciliation, tax calculation at checkout, refunds, basic order management for both sides. **Exit:** a buyer can complete a purchase and a seller sees the order. Money is held by Stripe; no payouts yet.

### Phase 4 — Money out (6 wk)
Payouts (weekly cron, platform fee, rolling reserve), dispute workflow with clawback, reviews & ratings after delivery. **Exit:** money flows end-to-end and disputes can reverse it.

### Phase 5 — Compliance hardening (8 wk)
DSA notice-and-action, statement of reasons, internal complaint handling, transparency event aggregation, GDPR DSAR export, erasure with pseudonymisation, data residency. **Exit:** legal sign-off; ready for soft launch in EU.

### Phase 6 — Admin depth + scale (6 wk)
Fraud signal pipeline, advanced moderation tooling, transparency report generation, performance work on hot paths, search relevance tuning. **Exit:** general availability.

Total: ~48 weeks, ~6 engineers, before you have a comfortably operable product. Compress by scope cuts, not by parallelisation — the dependencies are real.

## 6. What to cut for a faster MVP

If the goal is a credible demo in 8 weeks rather than a real product:
- Single country, single currency, single language — defers tax, DSA, residency.
- Manual KYC (admin reviews uploaded docs) — defers vendor integration.
- Manual payouts (admin triggers via Stripe dashboard) — defers payout worker.
- Skip messaging, disputes, reviews — they're not on the critical money path.
- Postgres full-text instead of OpenSearch.
- One photo per listing, no derivatives.

You lose the compliance story entirely, so this version cannot launch in the EU. It is a demo, not a product.

## 7. Open questions for the product owner

These change the design materially and should be answered before Phase 1:

1. Physical goods, digital goods, services, or all three? Each has different tax + dispute + delivery semantics.
2. Geographic scope at launch? EU-only vs. US+EU changes tax engine, compliance scope, infra topology.
3. Marketplace-of-record vs. agent model? Drives whether the platform is the deemed supplier for tax.
4. Single-vendor cart or multi-vendor cart? Multi-vendor adds split shipping, split tax, split disputes per cart.
5. Shipping integration in scope, or seller-managed? In-scope adds another 6-week workstream (rates, labels, tracking).
6. What's the dispute SLA target? Drives ops headcount more than engineering.
7. KYC vendor preference? Affects integration effort and per-check cost.

Answers to 1–4 will change the data model. Answer them before writing migrations.
