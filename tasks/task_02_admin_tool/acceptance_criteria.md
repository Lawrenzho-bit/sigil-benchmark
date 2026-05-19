# Task 02 — Internal Admin Tool — Acceptance Criteria

**Used by:** Scoring engines to evaluate tool outputs
**Methodology:** PRS v0.4
**Task Weight Template:** Security 30% / Ops 25% / Scale 10% / Compliance 25% / Cost 10%

This document specifies what success looks like for Task 02.

## Feature Completeness Checklist

### Authentication
- [ ] SAML 2.0 integration code
- [ ] OIDC integration code (alternative)
- [ ] No local password authentication
- [ ] MFA enforcement (TOTP minimum)
- [ ] Session timeout configurable (default 30 min idle)
- [ ] Force re-auth for sensitive actions (impersonation, role changes)

### RBAC (high weight for this task)
- [ ] Five admin roles defined
- [ ] Fine-grained permissions per role:
  - Super Admin: all permissions
  - Account Admin: user management, no billing
  - Support: read-only + impersonate
  - Finance: billing, invoices, refunds
  - Read-Only: view-only across the system
- [ ] Per-endpoint permission checks
- [ ] Permission changes propagate immediately
- [ ] Cannot escalate own privileges

### User Management
- [ ] Search users by email, name, ID
- [ ] View user profile + activity history
- [ ] Edit user metadata
- [ ] Deactivate user (preserves data)
- [ ] Impersonation with explicit audit entry
- [ ] Impersonation has time limit (e.g. 1 hour)
- [ ] User can see "you are being impersonated" warning

### Organization Browser
- [ ] List + filter + paginate organizations
- [ ] View org details: users, billing, usage, integrations
- [ ] Org status (active, trial, cancelled, suspended)
- [ ] Org-level audit log

### Audit Logging (high weight)
- [ ] All admin actions logged
- [ ] Actor ID + email
- [ ] Action type
- [ ] Target entity ID + type
- [ ] Timestamp (UTC)
- [ ] IP address
- [ ] Before/after diff for modifications
- [ ] Immutable (append-only)
- [ ] Searchable by actor, action, target, time range
- [ ] Exportable for compliance audits

### Bulk Operations
- [ ] CSV import with validation
- [ ] Preview before commit
- [ ] Rollback capability
- [ ] CSV export with role-based redaction
- [ ] Async processing for large jobs

### System Health Dashboard
- [ ] Queue depths visible
- [ ] Error rates by service
- [ ] SLA tracking
- [ ] Recent incidents
- [ ] Auto-refresh

### Feature Flags
- [ ] Toggle per org
- [ ] Toggle globally
- [ ] Percentage rollouts
- [ ] Audit trail of toggle changes
- [ ] Rollback to previous state

### Communication Panel
- [ ] Compose announcement
- [ ] Target subset (by role, plan, signup date, etc.)
- [ ] Preview before send
- [ ] Scheduled send
- [ ] Delivery tracking
- [ ] Cannot exceed N sends/day (anti-mistake guardrail)

### API Token Management
- [ ] Create scoped tokens (limited permissions)
- [ ] View token usage
- [ ] Revoke tokens
- [ ] Token expiration enforced
- [ ] Audit logging of token creation/use

## Test Scenarios

### Test 1: RBAC Enforcement (CRITICAL)
1. As Read-Only: attempt to edit user → 403
2. As Support: attempt to access Finance endpoints → 403
3. As Finance: attempt to deactivate user → 403
4. As Account Admin: attempt billing actions → 403
5. As Super Admin: all endpoints accessible
6. Privilege escalation attempts logged + blocked

### Test 2: Impersonation Audit
1. Admin starts impersonation → audit log entry
2. Actions during impersonation → audit logs include "impersonated by"
3. Impersonation auto-expires after time limit → audit entry
4. Target user receives notification

### Test 3: Audit Log Integrity
1. Attempt to modify audit log row → DB rejects
2. Audit log entries cannot be deleted
3. Audit log searchable + filterable
4. Export produces machine-readable format

### Test 4: SSO Integration
1. SAML metadata endpoint exposed
2. SP-initiated SSO works
3. IdP-initiated SSO works
4. SAML attribute mapping documented
5. SSO failure path doesn't expose internals

### Test 5: Bulk Operations Safety
1. Import 1000 users → preview shown
2. Validation errors prevent commit
3. Successful import logged in audit
4. Rollback after import → restores state

## Notes on Scoring

Task 02 emphasizes **Security and Compliance**:
- RBAC correctness is critical (max points for proper enforcement)
- Audit logging immutability is critical
- SSO-only adds security weight
- Impersonation requires careful audit trail

Task 02 deemphasizes Scalability:
- Internal tool, low traffic
- Load tests at 10k concurrent are irrelevant
- But: bulk operations may stress the system at low concurrency
