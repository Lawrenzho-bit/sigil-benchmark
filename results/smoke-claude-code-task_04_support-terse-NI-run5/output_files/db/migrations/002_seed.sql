-- Idempotent baseline data: SLA policies, a bootstrap admin, and a KB category.
-- Safe to run on every migrate; ON CONFLICT guards each insert.

-- Default SLA policies, one per priority (minutes).
INSERT INTO sla_policies (name, priority, first_response_mins, resolution_mins) VALUES
    ('Urgent', 'urgent', 30,  4 * 60),
    ('High',   'high',   60,  8 * 60),
    ('Normal', 'normal', 4 * 60, 24 * 60),
    ('Low',    'low',    8 * 60, 72 * 60)
ON CONFLICT (priority) DO NOTHING;

-- Bootstrap admin. Password is "changeme" (bcrypt). Rotate immediately in production.
INSERT INTO agents (email, name, password_hash, role) VALUES
    ('admin@local', 'Bootstrap Admin',
     '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin')
ON CONFLICT (email) DO NOTHING;

INSERT INTO kb_categories (name, slug) VALUES
    ('Getting Started', 'getting-started')
ON CONFLICT (slug) DO NOTHING;
