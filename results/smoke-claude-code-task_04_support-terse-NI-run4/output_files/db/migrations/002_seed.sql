-- 002_seed.sql — baseline data the app expects to exist on a fresh install.

-- Default SLA policies (task spec: 1h first response, 24h resolution baseline).
-- Higher-priority tickets get tighter targets.
INSERT INTO sla_policies (name, priority, first_response_minutes, resolution_minutes) VALUES
  ('Urgent', 'urgent',  15,  240),
  ('High',   'high',    30,  480),
  ('Normal', 'normal',  60,  1440),
  ('Low',    'low',     240, 2880)
ON CONFLICT (priority, active) DO NOTHING;

-- A default team so tickets always have a routable home.
INSERT INTO teams (name) VALUES ('General Support')
ON CONFLICT (name) DO NOTHING;

-- Bootstrap admin. Password is 'ChangeMe123!' (bcrypt). MUST be rotated post-install.
INSERT INTO agents (email, name, role, password_hash, team_id)
SELECT 'admin@example.com', 'Bootstrap Admin', 'admin',
       '$2a$10$2sTTFNKX8qxG7PGk8HMLceb9LiwXBzOunsjoxJA/0xycuqmDLvfJe',
       (SELECT id FROM teams WHERE name = 'General Support')
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE email = 'admin@example.com');
