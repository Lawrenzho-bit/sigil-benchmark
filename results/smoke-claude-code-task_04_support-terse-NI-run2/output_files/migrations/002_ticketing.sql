-- Tickets, messages, SLA policies + tracking, channels.

CREATE TYPE ticket_status   AS ENUM ('new','open','pending','on_hold','solved','closed');
CREATE TYPE ticket_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE channel_kind    AS ENUM ('email','web','slack','api');

CREATE TABLE channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  kind        channel_kind NOT NULL,
  -- For email: the support address (e.g. support@acme.com).
  -- For slack: the channel id.
  address     text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (org_id, kind, address)
);

CREATE TABLE tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Public, monotonically increasing reference (#12345). Trigger fills it.
  number          bigint NOT NULL,
  subject         text NOT NULL,
  status          ticket_status NOT NULL DEFAULT 'new',
  priority        ticket_priority NOT NULL DEFAULT 'normal',
  channel_id      uuid REFERENCES channels(id),
  requester_id    uuid NOT NULL REFERENCES customers(id),
  assignee_id     uuid REFERENCES agents(id),
  team_id         uuid REFERENCES teams(id),
  tags            text[] NOT NULL DEFAULT '{}',
  -- Merge: when set, this ticket is a duplicate folded into the target.
  merged_into_id  uuid REFERENCES tickets(id),
  -- Split: lineage to the ticket this one was split from.
  split_from_id   uuid REFERENCES tickets(id),
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE INDEX tickets_org_status_idx     ON tickets(org_id, status) WHERE merged_into_id IS NULL;
CREATE INDEX tickets_assignee_idx       ON tickets(assignee_id) WHERE status NOT IN ('solved','closed');
CREATE INDEX tickets_team_idx           ON tickets(team_id)     WHERE status NOT IN ('solved','closed');
CREATE INDEX tickets_requester_idx      ON tickets(requester_id);
CREATE INDEX tickets_priority_idx       ON tickets(org_id, priority, created_at DESC);
CREATE INDEX tickets_tags_gin           ON tickets USING gin (tags);
-- FTS over subject for the agent inbox search.
CREATE INDEX tickets_subject_fts        ON tickets USING gin (to_tsvector('english', subject));

-- Per-org monotonic ticket numbering.
CREATE TABLE ticket_counters (
  org_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  next_no bigint NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION assign_ticket_number() RETURNS trigger AS $$
BEGIN
  INSERT INTO ticket_counters(org_id) VALUES (NEW.org_id) ON CONFLICT DO NOTHING;
  UPDATE ticket_counters
     SET next_no = next_no + 1
   WHERE org_id = NEW.org_id
  RETURNING next_no - 1 INTO NEW.number;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_number_bi
BEFORE INSERT ON tickets
FOR EACH ROW
WHEN (NEW.number IS NULL OR NEW.number = 0)
EXECUTE FUNCTION assign_ticket_number();

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Messages: every reply, internal note, status change in one stream.
-- High volume; index for the per-ticket fetch path and for FTS search.
CREATE TYPE message_kind AS ENUM ('reply','note','system');

CREATE TABLE messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind          message_kind NOT NULL DEFAULT 'reply',
  -- author is either an agent or a customer; never both.
  author_agent_id     uuid REFERENCES agents(id),
  author_customer_id  uuid REFERENCES customers(id),
  -- Internal notes are visible to agents only.
  is_internal   boolean NOT NULL DEFAULT false,
  body_html     text,
  body_text     text NOT NULL,
  -- Email threading.
  message_id    text,   -- RFC 5322 Message-ID for inbound/outbound dedup
  in_reply_to   text,
  email_from    citext,
  email_to      text[],
  email_cc      text[],
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ( (author_agent_id IS NOT NULL)::int + (author_customer_id IS NOT NULL)::int <= 1 ),
  -- A customer cannot post an internal note.
  CHECK ( NOT (is_internal AND author_customer_id IS NOT NULL) )
);

CREATE INDEX messages_ticket_created_idx ON messages(ticket_id, created_at);
CREATE UNIQUE INDEX messages_message_id_idx ON messages(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX messages_body_fts ON messages USING gin (to_tsvector('english', body_text));

-- SLA policies. Conditions are JSONB (e.g. {"priority":"urgent"}).
CREATE TABLE sla_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  conditions      jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_response_minutes int NOT NULL,
  resolution_minutes     int NOT NULL,
  priority        int NOT NULL DEFAULT 0,  -- higher wins
  active          boolean NOT NULL DEFAULT true
);
CREATE INDEX sla_policies_org_idx ON sla_policies(org_id, active, priority DESC);

-- Per-ticket SLA targets, materialized on creation/policy-match.
CREATE TABLE ticket_sla (
  ticket_id           uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  policy_id           uuid REFERENCES sla_policies(id),
  first_response_due  timestamptz,
  resolution_due      timestamptz,
  first_response_breached_at timestamptz,
  resolution_breached_at     timestamptz,
  -- Last time the monitor scanned this row, for incremental sweeps.
  last_evaluated_at   timestamptz
);
CREATE INDEX ticket_sla_due_idx ON ticket_sla(first_response_due) WHERE first_response_breached_at IS NULL;
CREATE INDEX ticket_sla_res_idx ON ticket_sla(resolution_due)     WHERE resolution_breached_at IS NULL;
