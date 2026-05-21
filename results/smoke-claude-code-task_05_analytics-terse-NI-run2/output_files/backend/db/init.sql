-- Schema for the real-time analytics dashboard.
-- Run automatically by the TimescaleDB container on first start, and by CI.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- Tenancy & identity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL UNIQUE,
    api_token  TEXT        NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     BIGINT      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    username      TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Raw events (hypertable, 7-day retention)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    tenant_id  BIGINT           NOT NULL,
    ts         TIMESTAMPTZ      NOT NULL,
    event_type TEXT             NOT NULL,
    value      DOUBLE PRECISION NOT NULL DEFAULT 1,
    metadata   JSONB            NOT NULL DEFAULT '{}'::jsonb
);
SELECT create_hypertable('events', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_events_tenant_type_ts
    ON events (tenant_id, event_type, ts DESC);

-- ---------------------------------------------------------------------------
-- Rollups: one hypertable per granularity so retention can differ.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rollup_1m (
    tenant_id  BIGINT           NOT NULL,
    bucket     TIMESTAMPTZ      NOT NULL,
    event_type TEXT             NOT NULL,
    count      BIGINT           NOT NULL,
    sum        DOUBLE PRECISION NOT NULL,
    min        DOUBLE PRECISION NOT NULL,
    max        DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, event_type, bucket)
);
SELECT create_hypertable('rollup_1m', 'bucket', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS rollup_1h (
    tenant_id  BIGINT           NOT NULL,
    bucket     TIMESTAMPTZ      NOT NULL,
    event_type TEXT             NOT NULL,
    count      BIGINT           NOT NULL,
    sum        DOUBLE PRECISION NOT NULL,
    min        DOUBLE PRECISION NOT NULL,
    max        DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, event_type, bucket)
);
SELECT create_hypertable('rollup_1h', 'bucket', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS rollup_1d (
    tenant_id  BIGINT           NOT NULL,
    bucket     TIMESTAMPTZ      NOT NULL,
    event_type TEXT             NOT NULL,
    count      BIGINT           NOT NULL,
    sum        DOUBLE PRECISION NOT NULL,
    min        DOUBLE PRECISION NOT NULL,
    max        DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, event_type, bucket)
);
SELECT create_hypertable('rollup_1d', 'bucket', if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- Retention policies
--   raw events  : 7 days
--   1-min rollup: 7 days
--   hourly      : 90 days
--   daily       : 2 years
-- ---------------------------------------------------------------------------
SELECT add_retention_policy('events',    INTERVAL '7 days',   if_not_exists => TRUE);
SELECT add_retention_policy('rollup_1m', INTERVAL '7 days',   if_not_exists => TRUE);
SELECT add_retention_policy('rollup_1h', INTERVAL '90 days',  if_not_exists => TRUE);
SELECT add_retention_policy('rollup_1d', INTERVAL '730 days', if_not_exists => TRUE);
