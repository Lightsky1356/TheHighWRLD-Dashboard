-- 0034_online_visitors.sql
-- Creates the table that /api/online has always written to.
--
-- Why this is late: online_visitors was never created by any earlier migration.
-- 0018_presence.sql builds presence_state (a different table, for "last seen"),
-- and 0023_online_authed.sql ALTERed online_visitors as if it already existed.
-- On a database built purely from migrations the table was therefore missing,
-- so every POST /api/online heartbeat returned 500 and GET returned
-- {"online":0,"guests":0} - the counts on the site were permanently zero.
--
-- getCounts() swallows its errors and falls back to zeros, which is why this
-- never surfaced as an error anywhere and just looked like "nobody is here".
--
-- IF NOT EXISTS throughout so this is safe to run against a database where the
-- table does exist already, and safe to run twice.
--
-- NOTE for a database that has NOT run 0023: that migration does a bare
-- ALTER TABLE ADD COLUMN, which errors when the table is missing. Run this file
-- before 0023 on such a database, or 0023 will need guarding.

CREATE TABLE IF NOT EXISTS online_visitors (
  visitor_id TEXT PRIMARY KEY,
  last_seen   TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  authed      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_online_visitors_seen ON online_visitors(last_seen);

-- The counter splits on this column every request, so index it.
CREATE INDEX IF NOT EXISTS idx_online_visitors_authed ON online_visitors(authed);

-- ---------------------------------------------------------------------------
-- PRIVACY DECISION - READ BEFORE CHANGING THIS
--
-- This records a DELIBERATE reversal of an earlier decision, so the next person
-- to read this file does not assume it was an oversight.
--
-- 0018_presence.sql states: "Guests are deliberately never persisted (privacy)."
-- That is no longer what happens. A visitor row is now written for signed-OUT
-- visitors too, with authed = 0, so the "guests" counter can show a real number.
--
-- Why it was changed: the presence counter was specified to show two figures -
-- signed-in users (Online) and guests (not signed in). With guests excluded, the
-- guest figure was structurally always 0 and the counter looked broken.
--
-- What is actually stored for a guest:
--   - a random per-browser visitor id (no IP, no user agent stored here)
--   - a last_seen timestamp, overwritten on each heartbeat
--   - authed = 0
-- There is no identifier that links a guest across browsers, no IP address, and
-- no account association. The row is not a profile; it is a count with a TTL.
--
-- Retention: /api/online prunes rows whose last_seen is older than the
-- activity window, so a guest row does not outlive their visit.
--
-- To revert to the original privacy posture, stop writing rows when there is no
-- session and count guests from the realtime hub's in-memory presence instead.
-- The column and index stay useful either way. This is a one-function change in
-- functions/api/online.js - no migration needed to go back.
-- ---------------------------------------------------------------------------