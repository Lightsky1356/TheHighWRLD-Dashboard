-- 0026_user_relations.sql
-- Personal user-to-user relations (blocking + muting) and rate-limit log.
-- Blocking/muting is PERSONAL: rows store the viewer's uid as the "blocker".
-- blocked_discord_id mirrors the target's discord link so community content
-- (which carries discord_id, not uid) can be filtered without extra lookups.
CREATE TABLE IF NOT EXISTS user_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  blocked_discord_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- One block per pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_blocks_uniq
  ON user_blocks(blocker_user_id, blocked_user_id);
-- Reverse lookups (who blocked me) + moderation.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON user_blocks(blocked_user_id);
-- Efficient content filtering by discord id (replies carry discord_id only).
CREATE INDEX IF NOT EXISTS idx_user_blocks_discord
  ON user_blocks(blocker_user_id, blocked_discord_id);

CREATE TABLE IF NOT EXISTS user_mutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muter_user_id TEXT NOT NULL,
  muted_user_id TEXT NOT NULL,
  muted_discord_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_mutes_uniq
  ON user_mutes(muter_user_id, muted_user_id);
CREATE INDEX IF NOT EXISTS idx_user_mutes_muted
  ON user_mutes(muted_user_id);
CREATE INDEX IF NOT EXISTS idx_user_mutes_discord
  ON user_mutes(muter_user_id, muted_discord_id);

-- Server-side rate limiting for block/unblock/mute/unmute actions.
CREATE TABLE IF NOT EXISTS user_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_user_action_log
  ON user_action_log(actor_uid, action, created_at);