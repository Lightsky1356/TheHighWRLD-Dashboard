-- 0029: site-wide ban foundation (Phase 1: backend + enforcement only, no UI).
-- A ban is active when revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now).
-- Expired/revoked rows are kept for moderation history, never deleted by the app.
CREATE TABLE IF NOT EXISTS bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  moderator_id TEXT NOT NULL DEFAULT '',
  moderator_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bans_user ON bans(user_id);
