-- 0023_online_authed.sql
-- Split presence into signed-in (online) vs signed-out (guests).
-- Existing rows default to 0 (guest) until their next heartbeat re-classifies them.
ALTER TABLE online_visitors ADD COLUMN authed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_online_visitors_seen ON online_visitors(last_seen);
