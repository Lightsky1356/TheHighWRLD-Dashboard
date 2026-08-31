-- 0015_community_indexes.sql
-- Additive indexes and author reference. Does not drop tables or recreate data.

ALTER TABLE replies ADD COLUMN author_uid TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS reply_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reply_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_replies_author_uid ON replies(author_uid);
CREATE INDEX IF NOT EXISTS idx_replies_parent_id ON replies(parent_id);
CREATE INDEX IF NOT EXISTS idx_replies_created_at ON replies(created_at);
CREATE INDEX IF NOT EXISTS idx_replies_discord_id ON replies(discord_id);
CREATE INDEX IF NOT EXISTS idx_replies_track_created ON replies(track_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reply_votes_reply ON reply_votes(reply_id);
CREATE INDEX IF NOT EXISTS idx_notifications_uid_ts ON notifications(uid, ts DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_reply ON notifications(reply_id);
CREATE INDEX IF NOT EXISTS idx_reply_reactions_target ON reply_reactions(reply_id);
CREATE INDEX IF NOT EXISTS idx_reply_reactions_user ON reply_reactions(user_name);
