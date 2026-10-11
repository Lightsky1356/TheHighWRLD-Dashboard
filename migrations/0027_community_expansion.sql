-- 0027_community_expansion.sql
-- Community systems expansion: playlist visibility/sharing, notification
-- destinations, privacy preferences, achievements, and listen dedupe index.
-- Fully additive; does not drop or recreate any existing table.

-- ---------------------------------------------------------------------------
-- Notifications: destination + payload. href points where the client should
-- navigate (e.g. "community:42", "playlist:7"); post_id disambiguates
-- community-post notifications (wanted-vault notifications leave it NULL).
-- ---------------------------------------------------------------------------
ALTER TABLE notifications ADD COLUMN href TEXT NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN post_id INTEGER;
ALTER TABLE notifications ADD COLUMN data TEXT NOT NULL DEFAULT '';

-- Fast unread badge + feed order.
CREATE INDEX IF NOT EXISTS idx_notifications_uid_read_ts ON notifications(uid, read, id DESC);

-- ---------------------------------------------------------------------------
-- Playlists: visibility + share key.
--   'private'  -> visible to owner only (default)
--   'unlisted' -> visible only with the share URL (share_key)
--   'public'   -> visible on profiles and in search
-- ---------------------------------------------------------------------------
ALTER TABLE playlists ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE playlists ADD COLUMN share_key TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_playlists_visibility ON playlists(visibility, id DESC);

-- ---------------------------------------------------------------------------
-- Privacy preferences (conservative defaults: everything stays private).
--   show_playlists / show_stats / show_activity / show_favorites = what is
--   visible on the PUBLIC profile.
--   activity_enabled      = whether community events get recorded at all.
--   notifications_enabled = whether notifications are generated for the user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_privacy (
  uid TEXT PRIMARY KEY,
  show_playlists INTEGER NOT NULL DEFAULT 0,
  show_stats INTEGER NOT NULL DEFAULT 0,
  show_activity INTEGER NOT NULL DEFAULT 0,
  show_favorites INTEGER NOT NULL DEFAULT 0,
  activity_enabled INTEGER NOT NULL DEFAULT 1,
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Achievements (earned server-side only; the client can never unlock these).
--   first_listen       First listen recorded
--   playlist_creator   First playlist created
--   community_member   First community post
--   vault_explorer     First Wanted Vault submission
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievements (
  uid TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (uid, code)
);
CREATE INDEX IF NOT EXISTS idx_achievements_uid ON achievements(uid);

-- ---------------------------------------------------------------------------
-- Listen dedupe (skip "plays" that are really seeks/pauses/resumes within a
-- short window) + history ordering.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_listens_uid_track_ts ON listens(uid, track_id, ts);