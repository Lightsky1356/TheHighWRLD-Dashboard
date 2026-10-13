-- 0023_online_authed.sql
-- Split presence into signed-in (online) vs signed-out (guests).
-- Existing rows default to 0 (guest) until their next heartbeat re-classifies them.
-- online_visitors was never created by any earlier migration - 0034 creates it,
-- but 0034 runs after this file, so the ALTER below used to fail with
-- "no such table: online_visitors" on any database built purely from
-- migrations. Create the table first so this file is self-sufficient.
--
-- authed is deliberately NOT in this definition: the ALTER immediately below
-- is what adds it, and including it here would make that ALTER fail with a
-- duplicate column. 0034's own CREATE TABLE IF NOT EXISTS then matches and
-- does nothing.
CREATE TABLE IF NOT EXISTS online_visitors (
  visitor_id TEXT PRIMARY KEY,
  last_seen   TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT ''
);
ALTER TABLE online_visitors ADD COLUMN authed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_online_visitors_seen ON online_visitors(last_seen);
