-- 001_init.sql — core schema for the support ticketing tool.
-- Designed for ~10k agents and 1M+ tickets/year; hot paths are indexed below.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy KB / customer search
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email columns

-- ---------------------------------------------------------------------------
-- Organisation: teams + agents
-- ---------------------------------------------------------------------------
CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles drive RBAC (see src/middleware/rbac.ts).
CREATE TYPE agent_role AS ENUM ('agent', 'team_lead', 'admin');

CREATE TABLE agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          agent_role NOT NULL DEFAULT 'agent',
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Customers (people who open tickets)
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT NOT NULL UNIQUE,
  name            TEXT,
  phone           TEXT,
  -- Free-form profile attributes (plan, account id, locale, ...)
  attributes      JSONB NOT NULL DEFAULT '{}',
  -- GDPR: set when the customer requests erasure; purge job finishes the job.
  anonymized_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_email_trgm
  ON customers USING gin ((email::text) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------
CREATE TYPE ticket_status   AS ENUM ('new', 'open', 'pending', 'on_hold', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE ticket_channel  AS ENUM ('email', 'web', 'slack', 'api');

CREATE TABLE tickets (
  id                BIGSERIAL PRIMARY KEY,            -- human-facing ticket #
  public_id         UUID NOT NULL DEFAULT gen_random_uuid(),  -- portal-safe id
  subject           TEXT NOT NULL,
  status            ticket_status NOT NULL DEFAULT 'new',
  priority          ticket_priority NOT NULL DEFAULT 'normal',
  channel           ticket_channel NOT NULL DEFAULT 'email',
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  assignee_id       UUID REFERENCES agents(id) ON DELETE SET NULL,
  team_id           UUID REFERENCES teams(id) ON DELETE SET NULL,
  -- Merge: when set, this ticket is closed and folded into merged_into_id.
  merged_into_id    BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  -- Split lineage: the ticket this one was split off from, if any.
  split_from_id     BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_inbox     ON tickets (status, priority, updated_at DESC);
CREATE INDEX idx_tickets_assignee  ON tickets (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_tickets_customer  ON tickets (customer_id);
CREATE INDEX idx_tickets_team      ON tickets (team_id);
CREATE UNIQUE INDEX idx_tickets_public_id ON tickets (public_id);

-- Tags (many-to-many) for inbox filtering + reporting.
CREATE TABLE tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL UNIQUE
);
CREATE TABLE ticket_tags (
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag_id    UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Messages: customer replies, agent replies, and internal notes
-- ---------------------------------------------------------------------------
CREATE TYPE author_type AS ENUM ('customer', 'agent', 'system');

CREATE TABLE ticket_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_type      author_type NOT NULL,
  author_id        UUID,                 -- agents.id or customers.id; NULL for system
  body             TEXT NOT NULL,        -- plain text (signature-stripped)
  body_html        TEXT,
  -- Internal notes are agent-only and MUST never reach the customer.
  is_internal_note BOOLEAN NOT NULL DEFAULT false,
  channel          ticket_channel NOT NULL DEFAULT 'web',
  -- Email threading headers for inbound de-duplication / reply matching.
  email_message_id TEXT,
  email_in_reply_to TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_ticket ON ticket_messages (ticket_id, created_at);
CREATE UNIQUE INDEX idx_messages_email_id
  ON ticket_messages (email_message_id) WHERE email_message_id IS NOT NULL;

CREATE TABLE attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  storage_key   TEXT NOT NULL,           -- object-store key (S3/GCS)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- SLA
-- ---------------------------------------------------------------------------
CREATE TABLE sla_policies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  priority                ticket_priority NOT NULL,
  first_response_minutes  INT NOT NULL,
  resolution_minutes      INT NOT NULL,
  active                  BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (priority, active)
);

-- One row per ticket; targets are frozen at apply time so policy edits
-- don't retroactively breach old tickets.
CREATE TABLE ticket_sla (
  ticket_id            BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  policy_id            UUID NOT NULL REFERENCES sla_policies(id),
  first_response_due   TIMESTAMPTZ NOT NULL,
  resolution_due       TIMESTAMPTZ NOT NULL,
  first_response_met_at TIMESTAMPTZ,
  resolution_met_at    TIMESTAMPTZ,
  first_response_breached BOOLEAN NOT NULL DEFAULT false,
  resolution_breached  BOOLEAN NOT NULL DEFAULT false,
  -- Set once a breach alert has fired so the monitor doesn't re-notify.
  breach_alerted_at    TIMESTAMPTZ
);
CREATE INDEX idx_ticket_sla_due
  ON ticket_sla (first_response_due, resolution_due)
  WHERE first_response_met_at IS NULL OR resolution_met_at IS NULL;

-- ---------------------------------------------------------------------------
-- Knowledge base
-- ---------------------------------------------------------------------------
CREATE TYPE kb_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE kb_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        kb_status NOT NULL DEFAULT 'draft',
  author_id     UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Maintained by trigger below; weighted title > body.
  search_vector tsvector
);
CREATE INDEX idx_kb_search ON kb_articles USING gin (search_vector);

CREATE FUNCTION kb_articles_tsv() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.body, '')),  'B');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kb_articles_tsv
  BEFORE INSERT OR UPDATE ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION kb_articles_tsv();

-- ---------------------------------------------------------------------------
-- Macros / canned responses
-- ---------------------------------------------------------------------------
CREATE TABLE macros (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,            -- supports {{customer.name}} placeholders
  -- Side effects applied alongside the reply, e.g. {"status":"pending"}.
  actions     JSONB NOT NULL DEFAULT '{}',
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- CSAT surveys
-- ---------------------------------------------------------------------------
CREATE TABLE csat_surveys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,   -- single-use link token
  score         SMALLINT CHECK (score BETWEEN 1 AND 5),
  comment       TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ
);
CREATE INDEX idx_csat_ticket ON csat_surveys (ticket_id);

-- ---------------------------------------------------------------------------
-- Audit log (SOC2 baseline) — append-only; no UPDATE/DELETE in app code.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_type   TEXT NOT NULL,           -- 'agent' | 'customer' | 'system'
  actor_id     TEXT,
  action       TEXT NOT NULL,           -- e.g. 'ticket.assign'
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor  ON audit_log (actor_type, actor_id, created_at DESC);

-- updated_at maintenance for tickets
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tickets_touch
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
