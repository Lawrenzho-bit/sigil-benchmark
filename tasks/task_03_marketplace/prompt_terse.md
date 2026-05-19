# Task 03 — Marketplace Platform — Prompt Variant A (Terse)

**Variant ID:** `task_03.variant_terse.v1`
**Last revision:** 2026-05-19
**Methodology:** PRS v0.4

---

Build a B2C two-sided marketplace:

1. User accounts (email/OAuth) for buyers and sellers
2. Seller onboarding with KYC (identity verification + bank account)
3. Listing creation (title, description, photos, price, category, inventory)
4. Search + filter + browse (by category, price, location, rating)
5. Shopping cart + checkout with Stripe Connect (split payments)
6. Order management for buyers and sellers
7. Reviews + ratings (buyer reviews seller after delivery)
8. Messaging between buyer + seller
9. Dispute resolution workflow
10. Payouts to sellers (weekly, after platform fee)
11. Tax handling (VAT/GST for marketplace facilitator)
12. Admin panel for moderation + fraud review

Tech stack: any modern web framework, Postgres, container-deployable. Photo storage via S3-compatible.

Production-ready. Expected scale: 10k sellers, 100k buyers, 1M+ listings. Compliance: PCI DSS SAQ-A, GDPR, EU Digital Services Act (DSA).
