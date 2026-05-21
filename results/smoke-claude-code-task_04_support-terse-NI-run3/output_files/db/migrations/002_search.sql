-- 002_search.sql — Postgres full-text search for tickets and KB articles.
-- Uses generated tsvector columns + GIN indexes (Postgres FTS, the minimum
-- search infrastructure called for; can be swapped for an external engine).

-- --- Knowledge base search ---------------------------------------------------
ALTER TABLE kb_articles
    ADD COLUMN search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')),  'B')
    ) STORED;

CREATE INDEX kb_articles_search_idx ON kb_articles USING GIN (search_tsv);

-- --- Ticket search -----------------------------------------------------------
-- Tickets are searched by subject + the concatenated body of their messages.
-- The message text is denormalized onto the ticket via trigger so the search
-- vector stays a single generated/maintained column (fast to query at scale).
ALTER TABLE tickets ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
ALTER TABLE tickets
    ADD COLUMN search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(subject, '')),     'A') ||
        setweight(to_tsvector('english', coalesce(search_text, '')), 'B')
    ) STORED;

CREATE INDEX tickets_search_idx ON tickets USING GIN (search_tsv);

-- Keep tickets.search_text in sync with public message bodies.
-- Internal notes are intentionally excluded so customer-facing search and
-- agent search use the same corpus; agents search notes via a separate path.
CREATE OR REPLACE FUNCTION refresh_ticket_search_text() RETURNS trigger AS $$
DECLARE
    tid UUID;
BEGIN
    tid := COALESCE(NEW.ticket_id, OLD.ticket_id);
    UPDATE tickets t
       SET search_text = sub.txt
      FROM (
          SELECT string_agg(body_text, ' ') AS txt
            FROM ticket_messages
           WHERE ticket_id = tid AND is_internal = FALSE
      ) sub
     WHERE t.id = tid;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_messages_search_sync
    AFTER INSERT OR UPDATE OR DELETE ON ticket_messages
    FOR EACH ROW EXECUTE FUNCTION refresh_ticket_search_text();
