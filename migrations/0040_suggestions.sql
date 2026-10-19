-- 0040_suggestions.sql
-- The `suggestions` table, which has always existed in production and in no
-- migration.
--
-- WHY THIS EXISTS LATE
-- Same shape of gap as gallery_items: the table was created directly against the
-- production D1 and never had a migration. Two consequences, and this fixes both.
--
-- `wrangler d1 migrations apply` against a fresh database did not create it, so
-- the local development database never had it and /api/account returned 500 -
-- "no such table: suggestions" - on line 95, before it could read anything else.
-- Production was fine, which is exactly why it went unnoticed: the feature only
-- ever ran against the one database that had the table.
--
-- The shape below is read out of production with pragma_table_info, not written
-- from memory, so a fresh database ends up identical to the live one. Recovered
-- 2026-10-18.
--
-- CREATE TABLE IF NOT EXISTS because production already has this table and this
-- same migration has to be a no-op there. That is what makes it safe to record
-- the migration as applied without running it against production.

CREATE TABLE IF NOT EXISTS suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL,
  text       TEXT NOT NULL,
  status     TEXT DEFAULT 'open',
  -- The parentheses are required. SQLite only accepts a function call as a column
  -- default when it is wrapped, and it stores the default with the outer pair
  -- stripped - which is why reading this back from production with
  -- pragma_table_info shows a bare datetime('now') and copying that verbatim
  -- fails with "near "(": syntax error". Verified by applying it.
  created_at TEXT DEFAULT (datetime('now'))
);

-- Every read is "this user's suggestions, newest first", so uid is the column
-- that matters. Present in production; recreated here for a fresh database.
CREATE INDEX IF NOT EXISTS idx_suggestions_uid ON suggestions(uid);
