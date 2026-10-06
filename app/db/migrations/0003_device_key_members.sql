-- VRIP-13. Students are identified by the sha256 of a browser-held public key;
-- moderators keep a V Auth account. A row is one or the other, never both and
-- never neither: a row with both would be the handle-to-person mapping VRIP-13
-- removes, and a row with neither is an account nobody can sign in as.
--
-- Re-runnable, like 0001 and 0002: `drizzle-kit push` may already have carried
-- the column and the nullable user_id.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS key_hash text;

ALTER TABLE members
  ALTER COLUMN user_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_key_hash_unique
  ON members (key_hash);

ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_one_identity;

ALTER TABLE members
  ADD CONSTRAINT members_one_identity
  CHECK ((user_id IS NULL) <> (key_hash IS NULL));

ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_key_hash_format;

ALTER TABLE members
  ADD CONSTRAINT members_key_hash_format
  CHECK (key_hash IS NULL OR key_hash ~ '^[0-9a-f]{64}$');
