-- 0030: ban appeals (Phase 4: user-facing appeals + moderator review).
-- One row per appeal; ban history is never modified except revocation on approval.
-- Status: 'pending' | 'approved' | 'denied'.
CREATE TABLE IF NOT EXISTS ban_appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ban_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  reviewed_by TEXT NOT NULL DEFAULT '',
  moderator_response TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ban_appeals_user ON ban_appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_ban_appeals_ban ON ban_appeals(ban_id);
CREATE INDEX IF NOT EXISTS idx_ban_appeals_status ON ban_appeals(status);
CREATE INDEX IF NOT EXISTS idx_ban_appeals_created ON ban_appeals(created_at);
