# Task 04 — Customer Support Tool — Acceptance Criteria

**Used by:** Scoring engines
**Methodology:** PRS v0.4
**Task Weight Template:** Security 20% / Ops 30% / Scale 15% / Compliance 25% / Cost 10%
**Activates Domain Dimension:** Real-Time & Concurrency

## Feature Completeness Checklist

### Ticket Lifecycle
- [ ] Create ticket via email (inbound parsing)
- [ ] Create ticket via web form
- [ ] Reply by email (threaded conversation)
- [ ] Ticket state machine (new → open → pending → resolved → closed)
- [ ] Reopen if customer responds after resolution

### Email Infrastructure
- [ ] SPF record documented/configured
- [ ] DKIM signing
- [ ] DMARC policy
- [ ] Inbound parsing handles:
  - Replies (extract new message from quoted threads)
  - Attachments
  - Signature stripping
  - Bounce detection
- [ ] Outbound deliverability monitoring

### Agent Inbox
- [ ] Sortable + filterable ticket list
- [ ] Assignment (manual + auto by rule)
- [ ] Priority levels (urgent/high/normal/low)
- [ ] Ticket tags
- [ ] Bulk actions (close, assign, tag)
- [ ] Saved views / filters

### SLA
- [ ] SLA rule configuration (per priority, per channel)
- [ ] First response timer
- [ ] Resolution timer
- [ ] Breach alert (in-app + email)
- [ ] SLA pause for pending customer
- [ ] SLA reporting

### Knowledge Base
- [ ] Article CRUD
- [ ] Public + private articles
- [ ] Categories + tags
- [ ] Full-text search
- [ ] Article suggestions in ticket reply
- [ ] Article view analytics

### Macros / Canned Responses
- [ ] Personal + shared macros
- [ ] Variable substitution (customer name, ticket #)
- [ ] Macro chain (apply tags + assign + reply)

### Internal Notes
- [ ] Notes visible to agents only
- [ ] @mention for collaboration
- [ ] Cannot be visible to customer

### Ticket Operations
- [ ] Merge tickets
- [ ] Split ticket
- [ ] Forward externally
- [ ] Convert reply → new ticket

### CSAT
- [ ] Survey email after resolution
- [ ] 1-5 or thumbs up/down
- [ ] Free-text comment
- [ ] Aggregated scoring

### Reporting
- [ ] Agent performance dashboard
- [ ] SLA compliance dashboard
- [ ] Ticket volume trends
- [ ] CSAT trends
- [ ] Custom report builder
- [ ] CSV export

### Multi-Channel (optional)
- [ ] Slack integration (DM → ticket)
- [ ] Web widget for in-product support

### Customer Profile
- [ ] Customer detail page
- [ ] Interaction history
- [ ] Custom fields
- [ ] Linked records (orders, accounts)

### Compliance
- [ ] Data retention policy configurable
- [ ] Auto-delete after retention period
- [ ] Audit log of agent actions
- [ ] Access controls (role-based)
- [ ] Data export for GDPR DSR

## Test Scenarios

### Test 1: Email Round Trip
1. Send email to support@... → ticket created
2. Reply visible in agent inbox
3. Agent replies → outbound email sent
4. Customer replies → thread updates
5. Attachments preserved

### Test 2: SLA Breach
1. Ticket created with 1h first-response SLA
2. 30 min passes → no alert
3. 55 min passes → warning
4. 65 min passes → breach alert
5. Reporting shows breach

### Test 3: Time Correctness
1. Ticket created in UTC
2. Agent in Bangkok sees Bangkok time
3. Agent in NYC sees NYC time
4. SLA computed in UTC
5. Reports use UTC timestamps

### Test 4: Real-Time Updates
1. Two agents viewing same ticket
2. Agent A replies → Agent B sees update without refresh
3. New ticket arrives → inbox updates
4. Connection drops → reconnects gracefully

### Test 5: Data Retention (GDPR)
1. Customer requests deletion
2. PII anonymized (email → hashed, name → "[deleted]")
3. Ticket content retained for audit but unattributable
4. After retention period → fully purged

## Scoring Notes

Task 04 activates **Real-Time & Concurrency** domain dimension:
- WebSocket / SSE infrastructure scored
- Concurrent edit conflict handling
- Notification delivery reliability

Production Ops weighted heavily (30%): observability, error handling, time correctness, queueing all matter for support workload.

Compliance weighted: GDPR data retention, audit log, access controls.
