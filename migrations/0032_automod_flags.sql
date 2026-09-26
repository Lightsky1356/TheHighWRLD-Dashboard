-- 0032: automated moderation flags (Phase 6B).
-- One row per detector decision worth human review (medium+ confidence).
-- Status: 'pending' | 'approved' | 'removed' | 'actioned'.
-- Never auto-bans; severe actions stay human via the existing systems.
CREATE TABLE IF NOT EXISTS automod_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL DEFAULT 'post',
  target_id TEXT NOT NULL DEFAULT '',
  uid TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'low',
  recommended_action TEXT NOT NULL DEFAULT 'review',
  detail TEXT NOT NULL DEFAULT '',
  ai_verdict TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  reviewed_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_automod_status ON automod_flags(status, id);
CREATE INDEX IF NOT EXISTS idx_automod_uid ON automod_flags(uid);
CREATE INDEX IF NOT EXISTS idx_automod_created ON automod_flags(created_at);
