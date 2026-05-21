-- CSAT surveys, audit log, retention policy, Slack mapping.

CREATE TABLE csat_surveys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  -- Random opaque token mailed to the customer; do not reveal ticket id.
  token         text NOT NULL UNIQUE,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  -- 1..5 stars, or thumbs (1 = up, 0 = down). Both stored; nulls for the other.
  rating        smallint CHECK (rating BETWEEN 1 AND 5),
  thumb         smallint CHECK (thumb IN (0,1)),
  comment       text
);
CREATE INDEX csat_ticket_idx ON csat_surveys(ticket_id);
CREATE INDEX csat_pending_idx ON csat_surveys(sent_at) WHERE responded_at IS NULL;

-- Append-only audit log. Partition by month for retention + pruning.
CREATE TABLE audit_log (
  id            bigserial,
  org_id        uuid,
  -- Who took the action (agent OR customer OR system).
  actor_kind    text NOT NULL CHECK (actor_kind IN ('agent','customer','system')),
  actor_id      uuid,
  action        text NOT NULL,    -- e.g. ticket.update, message.create, login.success
  -- What was acted on.
  target_kind   text,
  target_id     uuid,
  -- Diff or context. Avoid PII in `meta`; structured changes only.
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- One initial partition; ops/cron should pre-create the next month's.
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

CREATE INDEX audit_log_actor_idx  ON audit_log(actor_kind, actor_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log(target_kind, target_id, created_at DESC);
CREATE INDEX audit_log_org_idx    ON audit_log(org_id, created_at DESC);

-- GDPR: configurable retention. Per org + per kind so e.g. attachments can
-- have a tighter window than the ticket metadata itself.
CREATE TABLE retention_policies (
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope         text NOT NULL CHECK (scope IN ('tickets','messages','attachments','audit')),
  retain_days   int NOT NULL CHECK (retain_days > 0),
  PRIMARY KEY (org_id, scope)
);

-- Slack threading: map a ticket to a Slack thread so two-way sync works.
CREATE TABLE slack_threads (
  ticket_id    uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  channel_id   text NOT NULL,
  thread_ts    text NOT NULL,
  UNIQUE (channel_id, thread_ts)
);
