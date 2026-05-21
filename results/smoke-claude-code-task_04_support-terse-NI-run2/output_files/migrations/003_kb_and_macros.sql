-- Knowledge base + macros (canned responses).

CREATE TABLE kb_categories (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name    text NOT NULL,
  slug    text NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE TYPE kb_visibility AS ENUM ('public','internal');

CREATE TABLE kb_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES kb_categories(id) ON DELETE SET NULL,
  slug          text NOT NULL,
  title         text NOT NULL,
  body_md       text NOT NULL,
  visibility    kb_visibility NOT NULL DEFAULT 'public',
  author_id     uuid REFERENCES agents(id),
  views         bigint NOT NULL DEFAULT 0,
  helpful_yes   int NOT NULL DEFAULT 0,
  helpful_no    int NOT NULL DEFAULT 0,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TRIGGER kb_articles_updated_at
BEFORE UPDATE ON kb_articles
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Generated tsvector column for portable FTS (title weighted 'A', body 'B').
ALTER TABLE kb_articles
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')),   'A') ||
    setweight(to_tsvector('english', coalesce(body_md,'')), 'B')
  ) STORED;

CREATE INDEX kb_articles_search_idx ON kb_articles USING gin (search_tsv);
CREATE INDEX kb_articles_org_idx    ON kb_articles(org_id, visibility, published_at DESC);

-- Macros: agent-applicable templates with variable substitution.
CREATE TABLE macros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  -- {{customer.full_name}}, {{ticket.number}} etc.
  body        text NOT NULL,
  -- Optional actions applied on use (status, priority, tags, assignee).
  actions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility  text NOT NULL DEFAULT 'org' CHECK (visibility IN ('org','team','personal')),
  team_id     uuid REFERENCES teams(id),
  owner_id    uuid REFERENCES agents(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX macros_org_idx ON macros(org_id);
