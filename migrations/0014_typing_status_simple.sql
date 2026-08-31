-- 0014_typing_status_simple.sql
-- Simple typing status table for polling-based realtime

-- Table for tracking typing status (ephemeral, per-session)
CREATE TABLE IF NOT EXISTS typing_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  track_id TEXT,
  status TEXT NOT NULL DEFAULT 'typing',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_typing_session ON typing_status(session_id);
CREATE INDEX IF NOT EXISTS idx_typing_user ON typing_status(user_name);
CREATE INDEX IF NOT EXISTS idx_typing_track ON typing_status(track_id);
CREATE INDEX IF NOT EXISTS idx_typing_created ON typing_status(created_at);
