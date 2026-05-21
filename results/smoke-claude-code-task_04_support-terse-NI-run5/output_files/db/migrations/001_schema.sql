-- Support Desk core schema.
-- Single tenant per deployment. Designed for 1M+ tickets/year: surrogate bigint PKs,
-- explicit indexes on every foreign key and inbox filter column.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
CREATE TYPE user_role        AS ENUM ('admin', 'manager', 'agent', 'read_only');
CREATE TYPE ticket_status    AS ENUM ('new', 'open', 'pending', 'on_hold', 'resolved', 'closed');
CREATE TYPE ticket_priority  AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE channel_type     AS ENUM ('email', 'web', 'slack', 'api');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_visibility AS ENUM ('public', 'internal');
CREATE TYPE actor_type       AS ENUM ('agent', 'customer', 'system');
CREATE TYPE email_proc_status AS ENUM ('pending', 'processed', 'failed', 'skipped');

-- ---------------------------------------------------------------------------
-- People: agents (staff) and customers (requesters)
-- ---------------------------------------------------------------------------
CREATE TABLE teams (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agents (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          user_role NOT NULL DEFAULT 'agent',
    team_id       BIGINT REFERENCES teams(id) ON DELETE SET NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_team ON agents(team_id);

CREATE TABLE customers (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT,
    phone         TEXT,
    company       TEXT,
    locale        TEXT NOT NULL DEFAULT 'en',
    -- Portal login is optional; email-only customers never set a password.
    password_hash TEXT,
    notes         TEXT,
    is_anonymised BOOLEAN NOT NULL DEFAULT false,  -- GDPR erasure flag
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_company ON customers(company);

-- ---------------------------------------------------------------------------
-- SLA policies. Resolved by ticket priority; targets are stored per ticket so
-- a policy change never retroactively re-times historical tickets.
-- ---------------------------------------------------------------------------
CREATE TABLE sla_policies (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                TEXT NOT NULL,
    priority            ticket_priority NOT NULL UNIQUE,
    first_response_mins INTEGER NOT NULL,
    resolution_mins     INTEGER NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------
CREATE TABLE tickets (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Human-facing reference shown to customers and embedded in email subjects.
    number          BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1001),
    subject         TEXT NOT NULL,
    status          ticket_status NOT NULL DEFAULT 'new',
    priority        ticket_priority NOT NULL DEFAULT 'normal',
    channel         channel_type NOT NULL DEFAULT 'email',
    requester_id    BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    assignee_id     BIGINT REFERENCES agents(id) ON DELETE SET NULL,
    team_id         BIGINT REFERENCES teams(id) ON DELETE SET NULL,
    tags            TEXT[] NOT NULL DEFAULT '{}',
    custom_fields   JSONB NOT NULL DEFAULT '{}',
    -- Merge/split lineage.
    merged_into_id  BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    split_from_id   BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    -- Lifecycle timestamps drive SLA + reporting.
    first_response_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Subject-level FTS. Indexing message bodies needs a trigger-maintained
    -- column; see README "known gaps".
    search_vector   tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(subject, ''))) STORED
);
CREATE UNIQUE INDEX idx_tickets_number ON tickets(number);
CREATE INDEX idx_tickets_status      ON tickets(status);
CREATE INDEX idx_tickets_priority    ON tickets(priority);
CREATE INDEX idx_tickets_assignee    ON tickets(assignee_id);
CREATE INDEX idx_tickets_team        ON tickets(team_id);
CREATE INDEX idx_tickets_requester   ON tickets(requester_id);
CREATE INDEX idx_tickets_created_at  ON tickets(created_at);
CREATE INDEX idx_tickets_updated_at  ON tickets(updated_at);
CREATE INDEX idx_tickets_merged_into ON tickets(merged_into_id);
CREATE INDEX idx_tickets_tags        ON tickets USING gin(tags);
CREATE INDEX idx_tickets_search      ON tickets USING gin(search_vector);
-- Common inbox query: open tickets for an agent, newest activity first.
CREATE INDEX idx_tickets_inbox ON tickets(assignee_id, status, updated_at DESC);

-- Per-ticket SLA timing. One row per ticket; created when the ticket is created.
CREATE TABLE ticket_sla (
    ticket_id               BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
    policy_id               BIGINT REFERENCES sla_policies(id) ON DELETE SET NULL,
    first_response_due_at   TIMESTAMPTZ NOT NULL,
    resolution_due_at       TIMESTAMPTZ NOT NULL,
    first_response_met      BOOLEAN,         -- null = still pending
    resolution_met          BOOLEAN,
    first_response_breached_at TIMESTAMPTZ,  -- set by the SLA worker on breach
    resolution_breached_at  TIMESTAMPTZ,
    -- Time the ticket spent in 'pending'/'on_hold' is excluded from breach
    -- calculation by pushing the due timestamps forward.
    paused_at               TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Worker scan: unmet targets whose due time has passed.
CREATE INDEX idx_ticket_sla_fr_due ON ticket_sla(first_response_due_at)
    WHERE first_response_met IS NULL;
CREATE INDEX idx_ticket_sla_res_due ON ticket_sla(resolution_due_at)
    WHERE resolution_met IS NULL;

-- ---------------------------------------------------------------------------
-- Messages: customer-visible correspondence AND internal notes (visibility flag)
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_messages (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id       BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    direction       message_direction NOT NULL,
    channel         channel_type NOT NULL,
    visibility      message_visibility NOT NULL DEFAULT 'public',
    -- Exactly one author kind is set, matching actor_type.
    author_agent_id    BIGINT REFERENCES agents(id) ON DELETE SET NULL,
    author_customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    body_text       TEXT NOT NULL,
    body_html       TEXT,
    -- Link back to the raw email this message was parsed from / sent as.
    email_message_id BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_ticket ON ticket_messages(ticket_id, created_at);
CREATE INDEX idx_messages_visibility ON ticket_messages(ticket_id, visibility);

CREATE TABLE attachments (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id    BIGINT REFERENCES ticket_messages(id) ON DELETE CASCADE,
    ticket_id     BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    content_type  TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL,
    storage_key   TEXT NOT NULL,           -- key into the object store
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attachments_ticket ON attachments(ticket_id);

-- ---------------------------------------------------------------------------
-- Email pipeline
-- ---------------------------------------------------------------------------
-- Raw inbound email staged by the webhook, consumed by the email worker.
CREATE TABLE email_messages (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    direction        message_direction NOT NULL,
    message_id_header TEXT,               -- RFC 5322 Message-ID
    in_reply_to      TEXT,
    references_ids   TEXT[] NOT NULL DEFAULT '{}',
    from_addr        TEXT NOT NULL,
    to_addrs         TEXT[] NOT NULL DEFAULT '{}',
    subject          TEXT,
    raw_mime         TEXT,                -- raw MIME for inbound; stored for audit/replay
    ticket_id        BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    proc_status      email_proc_status NOT NULL DEFAULT 'pending',
    proc_error       TEXT,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at     TIMESTAMPTZ
);
CREATE INDEX idx_email_proc ON email_messages(proc_status, received_at)
    WHERE proc_status = 'pending';
CREATE UNIQUE INDEX idx_email_msgid ON email_messages(message_id_header)
    WHERE message_id_header IS NOT NULL;
CREATE INDEX idx_email_ticket ON email_messages(ticket_id);

-- ---------------------------------------------------------------------------
-- Macros / canned responses
-- ---------------------------------------------------------------------------
CREATE TABLE macros (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    -- Reply body inserted when applied. Supports {{ticket.number}} etc. placeholders.
    body        TEXT NOT NULL,
    -- Side effects applied to the ticket, e.g. {"status":"pending","priority":"high","tags":["billing"]}.
    actions     JSONB NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  BIGINT REFERENCES agents(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Knowledge base
-- ---------------------------------------------------------------------------
CREATE TABLE kb_categories (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name   TEXT NOT NULL,
    slug   TEXT NOT NULL UNIQUE
);

CREATE TABLE kb_articles (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id   BIGINT REFERENCES kb_categories(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    body          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    author_id     BIGINT REFERENCES agents(id) ON DELETE SET NULL,
    view_count    BIGINT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Title weighted above body ('A' vs 'B') for relevance ranking.
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'B')
    ) STORED
);
CREATE INDEX idx_kb_search ON kb_articles USING gin(search_vector);
CREATE INDEX idx_kb_category ON kb_articles(category_id);

-- ---------------------------------------------------------------------------
-- CSAT surveys
-- ---------------------------------------------------------------------------
CREATE TABLE csat_surveys (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id    BIGINT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    -- Public, unguessable token used in the survey link.
    token        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    score        SMALLINT CHECK (score BETWEEN 1 AND 5),
    comment      TEXT,
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ
);
CREATE INDEX idx_csat_responded ON csat_surveys(responded_at);

-- ---------------------------------------------------------------------------
-- Audit log (SOC2). Append-only; never updated or deleted except by retention.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor       actor_type NOT NULL,
    actor_id    BIGINT,                  -- agent/customer id, null for system
    action      TEXT NOT NULL,           -- e.g. 'ticket.assign', 'ticket.merge'
    entity_type TEXT NOT NULL,
    entity_id   BIGINT,
    metadata    JSONB NOT NULL DEFAULT '{}',
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor  ON audit_log(actor, actor_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
