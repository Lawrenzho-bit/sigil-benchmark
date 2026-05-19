# Task 02 — Internal Admin Tool — Prompt Variant A (Terse)

**Variant ID:** `task_02.variant_terse.v1`
**Last revision:** 2026-05-19
**Methodology:** PRS v0.4

---

Build an internal admin tool for an existing SaaS company:

1. SSO-only authentication (SAML 2.0 + OIDC, no local accounts)
2. Fine-grained RBAC: 5 admin roles (Super Admin, Account Admin, Support, Finance, Read-Only)
3. User management: search, view, edit, deactivate, impersonate (with audit trail)
4. Customer/organization browser: filter, search, view org details
5. Audit log: every admin action logged with actor + target + diff
6. Bulk operations: CSV import/export with validation
7. System health dashboard: queue depths, error rates, SLA status
8. Feature flag management: toggle flags per org or globally
9. Communication panel: send broadcast announcements to subsets of users
10. API token management: create scoped tokens, view usage, revoke

Tech stack: any modern framework with strong RBAC + audit primitives. Postgres. Container-deployable.

Internal use only — ~50 concurrent users, low traffic. But every action is sensitive — get authorization right, log everything, no surprises.
