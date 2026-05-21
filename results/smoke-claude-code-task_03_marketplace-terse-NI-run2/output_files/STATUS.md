# Implementation Status — Read This Before Deploying

This is an honest accounting of what is real, what is stubbed, and what is
missing. **Do not deploy this handling real money or real PII.**

## Solid (implemented and internally consistent)

- Data model covering all 12 domains (`prisma/schema.prisma`)
- Email/password auth: argon2id hashing, JWT access tokens
- Accounts: registration, login, profile, buyer/seller role grants
- Listings: CRUD, categories, inventory, photo references
- Search: category / price / location / rating filters with pagination
- Cart: add / update / remove / view
- Orders: creation from cart, status state transitions, seller/buyer views
- Reviews: gated on a delivered order, one review per order
- Messaging: threads + messages between buyer and seller
- Disputes: explicit state machine with event log
- Payouts: platform-fee calculation and weekly batch selection logic
- Tax: marketplace-facilitator VAT/GST calculation per destination
- Admin: listing moderation, dispute review, user suspension
- Audit log writes on sensitive actions

## Integration code present but UNVERIFIED (needs credentials + testing)

- **Stripe Connect** (`modules/payments/stripe.ts`): payment-intent creation
  with `application_fee_amount` and `transfer_data`, plus payout transfers.
  Written against the Stripe API shape but never run. Needs real keys, a
  webhook endpoint hardening pass, and idempotency-key review.
- **KYC** (`modules/sellers/kyc.ts`): a provider-agnostic interface with a
  stub implementation. A real provider (Stripe Identity, Persona, Onfido)
  must be wired in. The stub auto-approves — that is a placeholder, not a
  policy.
- **S3/MinIO** (`lib/s3.ts`): presigned-URL upload flow. Works against local
  MinIO; bucket policy and lifecycle rules are not configured.

## NOT done — required before this is a product

- **Frontend**: none. This pass is backend API only.
- **Webhooks**: Stripe webhook handler is a skeleton; signature verification
  is present but event handling is incomplete (refunds, disputes, payout
  failures, account.updated).
- **Background jobs**: payout batching and KYC polling have logic but no
  scheduler/queue wired (no BullMQ/cron). They are callable functions only.
- **Rate limiting, brute-force protection, CAPTCHA**: not present.
- **Email/SMS delivery**: notification calls are no-ops.
- **OAuth**: schema + route placeholders only; no provider flow implemented.
- **Search at scale**: Postgres `ILIKE`/filter queries are fine for tens of
  thousands of rows, not 1M+ listings with full-text + facets. Plan for
  Postgres full-text + `pg_trgm`, or OpenSearch/Meilisearch.
- **Tests**: none written. Do not trust any of the above without them.

## Compliance gap list

### PCI DSS SAQ-A
- SAQ-A requires that card data never touches your servers. The Stripe code
  is designed for this (client-side tokenization via Stripe.js / Elements),
  but **there is no frontend**, so the tokenization boundary is unproven.
- TLS termination, no card data in logs: not configured/audited here.

### GDPR
- No data-subject access/export endpoint.
- No erasure ("right to be forgotten") workflow — note that financial/tax
  records have legal retention requirements that override erasure.
- No consent tracking, no data-processing records, no retention policy.
- KYC documents are high-risk PII; storage encryption and access controls
  are not implemented.

### EU Digital Services Act (DSA)
- No notice-and-action mechanism for illegal content/listings.
- No statement-of-reasons issued on moderation decisions.
- No trader traceability ("Know Your Business Customer") enforcement on
  sellers beyond the KYC stub.
- No transparency reporting or appeals process.
- The `admin` module is a starting point, not a DSA-compliant system.

## Recommended next steps (in order)

1. Add a test suite; nothing below is trustworthy without it.
2. Wire a real KYC provider and remove the auto-approve stub.
3. Build the checkout frontend so the PCI SAQ-A boundary actually exists.
4. Complete the Stripe webhook handler.
5. Add a job queue for payouts and KYC polling.
6. Add GDPR data-subject endpoints and a DSA notice-and-action flow.
7. Move search to Postgres full-text or a dedicated search engine.
