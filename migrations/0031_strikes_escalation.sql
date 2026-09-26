-- 0031: strikes + escalation rules (Phase 6A: automatic strike escalation).
-- Strikes expire (expires_at) or are revoked; history is kept, never deleted.
-- Escalation rules map an exact active-strike count to an automated action.
-- Actions: 'warn' | 'temp_ban' | 'perm_ban'. Conservative defaults seed below.
CREATE TABLE IF NOT EXISTS strikes (
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
CREATE INDEX IF NOT EXISTS idx_strikes_user ON strikes(user_id);
CREATE INDEX IF NOT EXISTS idx_strikes_created ON strikes(created_at);
CREATE TABLE IF NOT EXISTS escalation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threshold INTEGER NOT NULL,
  action TEXT NOT NULL DEFAULT 'warn',
  duration INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_escalation_threshold ON escalation_rules(threshold);
-- Conservative defaults: warn at 2, temp-ban 7d at 3, temp-ban 30d at 4.
-- No automatic permanent ban is seeded.
INSERT OR IGNORE INTO escalation_rules (id, threshold, action, duration, enabled)
VALUES (1, 2, 'warn', NULL, 1), (2, 3, 'temp_ban', 604800, 1), (3, 4, 'temp_ban', 2592000, 1);
