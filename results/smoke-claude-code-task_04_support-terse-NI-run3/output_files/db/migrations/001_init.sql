-- 001_init.sql — core schema for the support ticketing tool.
-- Designed for Postgres 14+. All timestamps are stored as timestamptz (UTC).

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Agents / staff users. Customers are stored separately (see `customers`).
-- ---------------------------------------------------------------------------
-- Email uniqueness is enforced case-insensitively via a lower() index
-- rather than the citext extension (which is not always available).
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'agent'
                  CHECK (role IN ('admin', 'agent', 'read_only')),
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Teams / groups that tickets can be routed to.
-- ---------------------------------------------------------------------------
CREATE TABLE teams (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Customers (end users / requesters). One row per known email identity.
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL,
    name          TEXT,
    -- portal login (optional — customers can also be email-only)
    password_hash TEXT,
    phone         TEXT,
    -- arbitrary CRM-style attributes
    attributes    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- GDPR: set when the customer record has been anonymized.
    anonymized_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_email_lower_idx ON customers (lower(email));

-- ---------------------------------------------------------------------------
-- SLA policies. A policy maps a priority to response/resolution targets.
-- ---------------------------------------------------------------------------
CREATE TABLE sla_policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT        NOT NULL,
    priority            TEXT        NOT NULL
                        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    first_response_mins INTEGER     NOT NULL,
    resolution_mins     INTEGER     NOT NULL,
    is_default          BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- exactly one default policy per priority
CREATE UNIQUE INDEX sla_policies_default_idx
    ON sla_policies (priority) WHERE is_default;

-- ---------------------------------------------------------------------------
-- Tickets. `number` is the human-facing sequential id (e.g. #1042).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE ticket_number_seq START 1000;

CREATE TABLE tickets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number         BIGINT      NOT NULL DEFAULT nextval('ticket_number_seq') UNIQUE,
    subject        TEXT        NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('new','open','pending','on_hold','resolved','closed')),
    priority       TEXT        NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','urgent')),
    channel        TEXT        NOT NULL DEFAULT 'email'
                   CHECK (channel IN ('email','web','slack','api')),
    requester_id   UUID        NOT NULL REFERENCES customers(id),
    assignee_id    UUID        REFERENCES users(id),
    team_id        UUID        REFERENCES teams(id),
    -- merge bookkeeping: when set, this ticket was merged INTO merged_into_id.
    merged_into_id UUID        REFERENCES tickets(id),
    -- split bookkeeping: when set, this ticket was split FROM split_from_id.
    split_from_id  UUID        REFERENCES tickets(id),
    -- email threading anchor (Message-ID of the first inbound message).
    thread_key     TEXT,
    tags           TEXT[]      NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_response_at TIMESTAMPTZ,
    resolved_at    TIMESTAMPTZ,
    closed_at      TIMESTAMPTZ
);
CREATE INDEX tickets_status_idx        ON tickets (status);
CREATE INDEX tickets_assignee_idx      ON tickets (assignee_id);
CREATE INDEX tickets_team_idx          ON tickets (team_id);
CREATE INDEX tickets_requester_idx     ON tickets (requester_id);
CREATE INDEX tickets_priority_idx      ON tickets (priority);
CREATE INDEX tickets_created_at_idx    ON tickets (created_at);
CREATE INDEX tickets_thread_key_idx    ON tickets (thread_key);

-- ---------------------------------------------------------------------------
-- Messages on a ticket. Includes customer messages, agent replies, internal
-- notes (is_internal = TRUE, never shown to customers) and system events.
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id    UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_type  TEXT        NOT NULL
                 CHECK (author_type IN ('customer','agent','system')),
    author_user_id     UUID  REFERENCES users(id),
    author_customer_id UUID  REFERENCES customers(id),
    body_text    TEXT        NOT NULL DEFAULT '',
    body_html    TEXT,
    is_internal  BOOLEAN     NOT NULL DEFAULT FALSE,
    channel      TEXT        NOT NULL DEFAULT 'web',
    -- email headers, for threading + deduplication
    email_message_id TEXT,
    email_in_reply_to TEXT,
    delivered_at TIMESTAMPTZ,         -- set when an outbound email was sent
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);
CREATE UNIQUE INDEX ticket_messages_email_msgid_idx
    ON ticket_messages (email_message_id) WHERE email_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Attachments belong to a message.
-- ---------------------------------------------------------------------------
CREATE TABLE attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   UUID        NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT      NOT NULL DEFAULT 0,
    storage_key  TEXT        NOT NULL,    -- key into object storage / local disk
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_message_idx ON attachments (message_id);

-- ---------------------------------------------------------------------------
-- Per-ticket SLA tracking row. Created when a ticket is created.
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_sla (
    ticket_id              UUID PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
    policy_id              UUID REFERENCES sla_policies(id),
    first_response_due_at  TIMESTAMPTZ NOT NULL,
    resolution_due_at      TIMESTAMPTZ NOT NULL,
    first_response_met     BOOLEAN,        -- NULL = pending, TRUE/FALSE once known
    resolution_met         BOOLEAN,
    first_response_breached_alerted BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_breached_alerted     BOOLEAN NOT NULL DEFAULT FALSE,
    -- pause bookkeeping for 'pending'/'on_hold' states
    paused_at              TIMESTAMPTZ,
    paused_total_seconds   BIGINT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- SLA breach alerts (consumed by the worker + reporting).
-- ---------------------------------------------------------------------------
CREATE TABLE sla_alerts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    kind       TEXT        NOT NULL CHECK (kind IN ('first_response','resolution')),
    breached_at TIMESTAMPTZ NOT NULL,
    acknowledged_by UUID    REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sla_alerts_ticket_idx ON sla_alerts (ticket_id);
CREATE INDEX sla_alerts_open_idx   ON sla_alerts (acknowledged_at) WHERE acknowledged_at IS NULL;

-- ---------------------------------------------------------------------------
-- Macros / canned responses.
-- ---------------------------------------------------------------------------
CREATE TABLE macros (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL,
    body       TEXT        NOT NULL,
    -- structured side effects applied when the macro is run, e.g.
    -- {"set_status":"pending","set_priority":"high","add_tags":["billing"]}
    actions    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID        REFERENCES users(id),
    is_shared  BOOLEAN     NOT NULL DEFAULT TRUE,
    usage_count BIGINT     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Knowledge base articles.
-- ---------------------------------------------------------------------------
CREATE TABLE kb_articles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL UNIQUE,
    title       TEXT        NOT NULL,
    body        TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','archived')),
    author_id   UUID        REFERENCES users(id),
    view_count  BIGINT      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- CSAT surveys, sent after a ticket is resolved.
-- ---------------------------------------------------------------------------
CREATE TABLE csat_surveys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id    UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    token        TEXT        NOT NULL UNIQUE,   -- opaque link token
    score        INTEGER     CHECK (score BETWEEN 1 AND 5),
    comment      TEXT,
    sent_at      TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX csat_surveys_ticket_idx ON csat_surveys (ticket_id);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch     BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER customers_touch BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER tickets_touch   BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER kb_touch        BEFORE UPDATE ON kb_articles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
