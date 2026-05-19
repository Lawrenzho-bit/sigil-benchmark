# Task 03 — Marketplace Platform — Acceptance Criteria

**Used by:** Scoring engines
**Methodology:** PRS v0.4
**Task Weight Template:** Security 25% / Ops 20% / Scale 20% / Compliance 25% / Cost 10%
**Activates Domain Dimension:** Payment Security & Money-Flow

## Feature Completeness Checklist

### Identity & Onboarding
- [ ] Buyer signup (email/OAuth)
- [ ] Seller signup with KYC step
- [ ] Identity verification (document upload + automated check or stub)
- [ ] Bank account linking (Stripe Connect onboarding)
- [ ] Tax form collection (W-9/W-8, VAT ID)

### Listings
- [ ] Listing CRUD
- [ ] Photo upload (multiple, with size limits)
- [ ] Categories with hierarchy
- [ ] Inventory tracking
- [ ] Listing approval workflow (admin moderation)
- [ ] Listing status (draft/active/sold/archived)

### Discovery
- [ ] Full-text search
- [ ] Category browse
- [ ] Filters (price, location, rating, category)
- [ ] Sort options (relevance, price, recency, popularity)
- [ ] Pagination

### Cart & Checkout
- [ ] Shopping cart (persisted across sessions)
- [ ] Stripe Connect destination charges
- [ ] Platform fee calculation
- [ ] Multi-seller order splitting
- [ ] Shipping address collection
- [ ] Tax calculation per jurisdiction
- [ ] Receipt emails

### Orders
- [ ] Buyer order history
- [ ] Seller fulfillment dashboard
- [ ] Order state machine (placed → paid → shipped → delivered → completed)
- [ ] Cancellation flow
- [ ] Refund flow

### Reviews
- [ ] Buyer can review after delivery
- [ ] 5-star rating + text
- [ ] Seller response
- [ ] Review moderation
- [ ] Computed seller rating

### Messaging
- [ ] Buyer-seller direct messages
- [ ] Conversation thread per order
- [ ] Notifications (email + in-app)
- [ ] PII scrubbing (no off-platform contact attempts)

### Disputes
- [ ] File a dispute
- [ ] Evidence upload
- [ ] Admin mediation interface
- [ ] Refund/chargeback handling
- [ ] Stripe dispute integration

### Payouts
- [ ] Weekly payout schedule
- [ ] Platform fee deduction
- [ ] Payout history per seller
- [ ] Stripe Connect transfer

### Tax & Compliance
- [ ] VAT/GST applied per region
- [ ] Tax invoice generation
- [ ] Seller 1099/equivalent reporting
- [ ] DSA-required transparency reports

### Admin Panel
- [ ] Listing moderation queue
- [ ] User moderation (suspend, ban)
- [ ] Fraud review dashboard
- [ ] Refund approvals
- [ ] Transparency report exports

## Test Scenarios

### Test 1: Stripe Connect Flow
1. Seller onboards via Stripe Connect Express
2. KYC fields filled
3. Bank account linked
4. Listing created
5. Buyer purchases
6. Stripe destination charge created
7. Platform fee deducted
8. Webhook updates order status
9. Weekly payout triggered (mocked time)

### Test 2: Webhook Security
1. Stripe webhook without signature → 401
2. Tampered webhook → 401
3. Replayed webhook → idempotent (no double charge)
4. Unknown event type → 200 (gracefully ignored)

### Test 3: Marketplace-Specific Compliance
1. Listing flagged → moderation queue
2. User reported → moderation queue
3. DSA transparency report exportable
4. Seller annual sales report for tax reporting

### Test 4: Dispute Resolution
1. Buyer files dispute → seller notified
2. Both parties upload evidence
3. Admin reviews + decides
4. If buyer wins → automatic refund via Stripe
5. If seller wins → no refund, dispute closed

## Scoring Notes

Marketplace activates the **Payment Security & Money-Flow** domain dimension. Sub-components scored include:
- PCI DSS SAQ-A compliance
- Webhook signature validation
- Idempotency keys on financial endpoints
- Refund handling correctness
- Dispute handling workflow
- Tax computation accuracy
- Multi-currency support
- Failed payment retry logic
- KYC/AML primitives

Compliance bundle: EU+US default + Marketplace-specific (DSA, marketplace facilitator tax laws).
