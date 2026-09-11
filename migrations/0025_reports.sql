-- 0025_reports.sql
-- Production content-report system for Wanted Vault posts and Suggestions.
-- reporter identity is ALWAYS resolved server-side from the Discord link;
-- the frontend never supplies it.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reporter_discord_id TEXT NOT NULL,
  reporter_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  snapshot_title TEXT NOT NULL DEFAULT '',
  snapshot_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  reviewed_by TEXT NOT NULL DEFAULT ''
);
-- One identical report per reporter (same item + same reason).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique
  ON reports(reporter_discord_id, target_type, target_id, reason);
-- Staff list filtering (status view, newest first).
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, id DESC);
-- Rate limiting + reporter history.
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_discord_id, created_at DESC);
-- Target lookups.
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
