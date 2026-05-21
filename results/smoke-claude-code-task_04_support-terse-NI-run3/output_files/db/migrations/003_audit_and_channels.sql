-- 003_audit_and_channels.sql — SOC2 audit log, channel config, sessions.

-- ---------------------------------------------------------------------------
-- Append-only audit log. Every state-changing action is recorded here.
-- Rows are never updated or deleted by the application (SOC2 baseline).
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_type  TEXT        NOT NULL CHECK (actor_type IN ('user','customer','system')),
    actor_id    UUID,
    actor_label TEXT,                       -- denormalized email/name for readability
    action      TEXT        NOT NULL,       -- e.g. 'ticket.assign', 'user.login'
    entity_type TEXT        NOT NULL,       -- e.g. 'ticket', 'user', 'kb_article'
    entity_id   TEXT,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx  ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx   ON audit_log (actor_id);
CREATE INDEX audit_log_action_idx  ON audit_log (action);
CREATE INDEX audit_log_created_idx ON audit_log (created_at);

-- Defense in depth: revoke UPDATE/DELETE so even the app role cannot mutate
-- history. Run as superuser; harmless if the role does not exist yet.
DO $$
BEGIN
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC';
EXCEPTION WHEN OTHERS THEN
    -- ignore: permissions vary by deployment
    NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Channel configuration — inbound mailboxes, Slack workspaces, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE channels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       TEXT        NOT NULL CHECK (kind IN ('email','slack','web')),
    name       TEXT        NOT NULL,
    -- email: {"address":"support@acme.com"}; slack: {"channel_id":"C123"}
    config     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    team_id    UUID        REFERENCES teams(id),
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Refresh-token / session revocation list (logout, forced revocation).
-- ---------------------------------------------------------------------------
CREATE TABLE revoked_tokens (
    jti        TEXT PRIMARY KEY,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX revoked_tokens_expiry_idx ON revoked_tokens (expires_at);
