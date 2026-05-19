# Task 04 — Customer Support Tool — Prompt Variant A (Terse)

**Variant ID:** `task_04.variant_terse.v1`
**Last revision:** 2026-05-19
**Methodology:** PRS v0.4

---

Build a customer support ticketing tool:

1. Email-based ticket creation (inbound email → ticket; outbound email replies)
2. Web portal for customers to create + view tickets
3. Agent inbox: filter, sort, assign, prioritize
4. SLA tracking with breach alerts (e.g. first response in 1 hour, resolution in 24h)
5. Knowledge base with article search
6. Macros / canned responses
7. Internal notes (agents only, hidden from customer)
8. Ticket merging + splitting
9. Customer satisfaction (CSAT) surveys after resolution
10. Reporting: agent performance, SLA compliance, ticket volume trends
11. Multi-channel: email + web + (optional) Slack integration
12. Customer profile with full interaction history

Email infrastructure: SPF, DKIM, DMARC configured. Inbound parsing handles attachments, replies-in-thread, signature stripping.

Tech stack: any modern framework, Postgres for tickets, search infrastructure (Postgres FTS minimum). Container-deployable.

Production scale: 10k agents, 1M+ tickets/year. Compliance: GDPR (data retention configurable), SOC2 baseline (audit log, access controls).
