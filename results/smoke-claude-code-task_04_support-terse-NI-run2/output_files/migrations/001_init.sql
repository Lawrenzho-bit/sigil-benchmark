-- Identity, organizations, agents, customers, sessions.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations(id) ON DELETE SET NULL,
  email         citext UNIQUE,
  full_name     text,
  phone         text,
  external_id   text,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  portal_password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX customers_org_idx   ON customers(org_id);
CREATE INDEX customers_email_trgm ON customers USING gin (email gin_trgm_ops);

CREATE TYPE agent_role AS ENUM ('admin', 'manager', 'agent', 'viewer');

CREATE TABLE agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations(id) ON DELETE CASCADE,
  email         citext UNIQUE NOT NULL,
  full_name     text NOT NULL,
  role          agent_role NOT NULL DEFAULT 'agent',
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE teams (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name    text NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE team_members (
  team_id   uuid REFERENCES teams(id) ON DELETE CASCADE,
  agent_id  uuid REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, agent_id)
);

-- Opaque, server-revocable session tokens; only hashes stored.
CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,
  subject_id    uuid NOT NULL,
  subject_kind  text NOT NULL CHECK (subject_kind IN ('agent','customer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_subject_idx ON sessions(subject_id, subject_kind);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);
