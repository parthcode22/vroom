-- The constraint that makes VRIP-04's binding rule structural rather than
-- cultural, plus the updated_at trigger.
--
-- Written to be safely re-runnable: `drizzle-kit push` may already have created
-- the tables on a developer's database, and the ledger records a filename
-- without knowing what state a pushed database is in.

-- A bare "who is this handle" cannot be recorded, so it cannot be performed
-- through the sanctioned path. Every reveal carries the report that justified it.
ALTER TABLE moderation_audit
  DROP CONSTRAINT IF EXISTS reveal_must_be_bound;

ALTER TABLE moderation_audit
  ADD CONSTRAINT reveal_must_be_bound
  CHECK (action <> 'reveal' OR report_id IS NOT NULL);

-- Vocabulary guards. Cheap, and they stop a typo in a moderation action from
-- writing a row nothing will ever query.
ALTER TABLE moderation_audit
  DROP CONSTRAINT IF EXISTS moderation_audit_actor_kind_valid;

ALTER TABLE moderation_audit
  ADD CONSTRAINT moderation_audit_actor_kind_valid
  CHECK (actor_kind IN ('console', 'script'));

ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_status_valid;

ALTER TABLE reports
  ADD CONSTRAINT reports_status_valid
  CHECK (status IN ('open', 'resolved', 'dismissed'));

-- Pseudonyms are [a-z-] only. pseudonym.ts guarantees it on the write path;
-- this is the guarantee that survives a future write path nobody has written yet.
ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_pseudonym_charset;

ALTER TABLE members
  ADD CONSTRAINT members_pseudonym_charset
  CHECK (pseudonym IS NULL OR pseudonym ~ '^[a-z]+-[a-z]+(-[0-9]{4})?$');

-- updated_at at the database level, so no write path can forget it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_set_updated_at ON members;

CREATE TRIGGER members_set_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
