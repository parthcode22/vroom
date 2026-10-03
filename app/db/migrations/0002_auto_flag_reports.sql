-- VRIP-09. The room object refuses a message, records a flag in its own SQLite,
-- and the console materialises that flag as a report on load. Nobody reported
-- it, so there is no reporter.
--
-- Re-runnable, like 0001: `drizzle-kit push` may already have carried the
-- nullable column, and the ledger records a filename without knowing what state
-- a pushed database is in.

ALTER TABLE reports
  ALTER COLUMN reporter_member_id DROP NOT NULL;

-- The idempotency control. `reports_message_reporter_uniq` cannot do this job:
-- Postgres treats NULLs as distinct, so it would let one flag become two
-- reports every time the console reloaded before acknowledging the drain.
-- message_id carries the flag id, so this index makes a repeat drain a no-op.
DROP INDEX IF EXISTS reports_auto_flag_uniq;

CREATE UNIQUE INDEX reports_auto_flag_uniq
  ON reports (room_id, message_id)
  WHERE reporter_member_id IS NULL;
