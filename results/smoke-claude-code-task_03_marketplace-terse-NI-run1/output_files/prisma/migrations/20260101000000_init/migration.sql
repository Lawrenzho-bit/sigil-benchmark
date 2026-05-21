-- Prisma will produce the bulk of this on `prisma migrate dev`. This file
-- documents the search-vector trigger we depend on. After `migrate dev`
-- generates the full migration, append these statements to it (or run as
-- a follow-up migration).

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "search" tsvector;

CREATE INDEX IF NOT EXISTS "Listing_search_gin" ON "Listing" USING GIN ("search");

CREATE OR REPLACE FUNCTION listing_search_update() RETURNS trigger AS $$
BEGIN
  NEW."search" :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_search_trg ON "Listing";
CREATE TRIGGER listing_search_trg
  BEFORE INSERT OR UPDATE OF title, description
  ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION listing_search_update();
