# Task 01 — B2B SaaS Portal — Prompt Variant B (Verbose)

**Variant ID:** `task_01.variant_verbose.v1`
**Last revision:** 2026-05-19
**Methodology:** PRS v0.4

---

## Project Brief

You are building a B2B SaaS portal for a mid-market software company. The product will be sold to enterprise IT teams managing internal workflows for their organizations. Expected initial scale: 50-500 customer organizations, each with 5-200 users.

## Business Requirements

### Authentication & Identity
- Email/password authentication with secure password requirements (NIST 800-63B compliant)
- Single Sign-On via SAML 2.0 for enterprise customers
- Multi-factor authentication available (TOTP) for all users
- Session management with appropriate timeouts and secure cookie handling
- Password reset flow with email verification

### Access Control
Role-based access control with three roles:
- **Owner:** Full administrative control, billing access, can delete organization
- **Admin:** User management, role assignment, settings, view-all access (cannot access billing)
- **Viewer:** Read-only access to dashboards and reports

Permissions must be enforced both in UI and API. Audit log should record all permission-relevant actions.

### Dashboard
Main dashboard showing key metrics for the organization:
- Total users (active vs deactivated)
- Recent activity timeline (last 50 audit events)
- Billing status (current plan, next invoice date, usage)
- Health indicators (any failed integrations or system alerts)

### Billing Integration
Stripe subscription billing with three tiers:
- **Starter:** $99/month, up to 10 users
- **Pro:** $299/month, up to 50 users  
- **Enterprise:** Custom pricing, unlimited users + SSO + audit log retention

Must handle: subscription creation, plan changes (with proration), payment failures (dunning), invoices, refunds, cancellations. Stripe webhook handler with signature validation and idempotent processing.

### Audit Logging
Every administrative action logged with:
- Actor (user ID + email)
- Action type (e.g., user.invited, role.changed, billing.upgraded)
- Target (the entity affected)
- Timestamp (UTC)
- IP address
- Diff (before/after state where applicable)

Audit log is immutable (append-only). Retention: 7 years (configurable per organization).

### User Management
- Invite users by email (signed invite tokens, 7-day expiry)
- Assign and change roles
- Deactivate users (preserves audit history)
- Bulk operations (CSV import for adding multiple users)

### Settings
- Organization settings: name, domain, branding, default user role
- User settings: profile, notification preferences, API tokens

### Notifications
Transactional emails for:
- New user welcome
- Invitation
- Password reset
- Billing receipts and failures
- Audit log alerts (configurable)

Should use a standard email service (SendGrid, Resend, Postmark, or AWS SES).

## Technical Requirements

### Architecture
- Modern web framework (Next.js, Django, Rails, FastAPI, or equivalent)
- Postgres database
- Container-deployable (Dockerfile, 12-factor compliant)
- Environment-based configuration (no hardcoded secrets)
- CI/CD pipeline configuration

### Security
- Input validation on all endpoints
- Parameterized queries (no SQL injection vectors)
- CSRF protection on state-changing endpoints
- Rate limiting on auth endpoints (5 attempts per 15 min per IP)
- HTTPS-only with HSTS header
- Encrypted at rest for sensitive fields

### Compliance
- GDPR primitives: cookie consent banner with functional opt-in, data export endpoint, account deletion (cascading)
- Auto-generated privacy policy reflecting actual data collection
- Auto-generated terms of service
- SOC2 baseline: audit log, access controls, encryption

### Operational Readiness
- Structured logging (JSON format)
- Health check endpoint with dependency checks
- Metrics endpoint (Prometheus format)
- Graceful error handling (no stack traces exposed to users)
- Database connection pooling
- Backup strategy documented

### Performance
- Should handle 1,000 concurrent users at p95 response time <500ms
- Database queries indexed for common access patterns
- Caching strategy for read-heavy operations

## Output Requirements

Provide a complete codebase, ready to deploy. Include:
- All source files
- Dockerfile + container build instructions
- CI/CD configuration (GitHub Actions, GitLab CI, or equivalent)
- Database migration scripts
- README with setup instructions
- Environment variable template (.env.example)
- Deployment notes for at least one cloud platform

This portal will be deployed to production and serve real paying customers. Build accordingly.
