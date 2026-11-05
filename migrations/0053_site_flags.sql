-- 0053_site_flags.sql
-- Site-wide switches the OWNER can flip, kept in one place.
--
-- WHY THIS EXISTS
-- The track-sync pipeline adds songs to tracks.js every 30 minutes on a
-- schedule. The owner asked for a switch to pause that. There was nowhere to
-- put such a choice: no generic settings table exists anywhere in this schema,
-- and a one-off file in the repo would need the browser to be able to commit,
-- which it cannot. A D1 row is the answer - the owner dashboard, which already
-- holds the passcode after an unlock (functions/api/announcements.js pattern),
-- can set it, and the scheduled workflow reads it back over a plain public GET
-- before it does anything.
--
-- Additive: one new table, name-keyed, one string value. Everything that
-- already exists is untouched, so landing it before the code that uses it
-- cannot break anything.
CREATE TABLE IF NOT EXISTS site_flags (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
