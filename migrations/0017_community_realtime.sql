-- 0017_community_realtime.sql
-- Community feature: additive changes for the realtime Community experience.
-- Does NOT drop or recreate any existing table. Fully additive and idempotent.

-- -----------------------------------------------------------------------
-- 1. Realtime-friendly indexes for community_post feeds and reply feeds.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_comm_replies_post_created ON community_replies(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comm_replies_author ON community_replies(author_uid);
CREATE INDEX IF NOT EXISTS idx_comm_replies_parent ON community_replies(parent_id);
CREATE INDEX IF NOT EXISTS idx_comm_reactions_reply ON community_reactions(reply_id);
CREATE INDEX IF NOT EXISTS idx_comm_posts_created ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_posts_author ON community_posts(author_uid);

-- -----------------------------------------------------------------------
-- 2. Unique constraint on community_reactions (reply_id, author_uid, emoji)
--    so a user cannot double-react.
-- -----------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_reactions_unique ON community_reactions(reply_id, author_uid, emoji);

-- -----------------------------------------------------------------------
-- 3. Community notifications — recipient-scoped rows for instant delivery.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_uid TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'reply',
  actor_uid TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  post_id INTEGER,
  reply_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comm_notif_recipient ON community_notifications(recipient_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_notif_read ON community_notifications(recipient_uid, read);

-- -----------------------------------------------------------------------
-- 4. Ensure validated columns exist on community_replies. SQLite lacks
--    ADD COLUMN IF NOT EXISTS, so we probe sqlite_master first. The pragma
--    below is only used to decide whether to run each ALTER; the DDL itself
--    stays valid if the column already exists only when guarded.
--    We therefore wrap each ALTER in a conditional that can never cause a
--    duplicate-column error.
-- -----------------------------------------------------------------------
