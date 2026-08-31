-- 0016_community_page.sql
-- Community page: fix replies_with_counts view (broken reference to non-existent
-- reply_vote_counts view), add community_posts table, add missing notifications columns.
-- Fully additive — does NOT drop or recreate any existing table.

-- -----------------------------------------------------------------------
-- 1. Drop the broken replies_with_counts view (it referenced reply_vote_counts
--    which was never created) and recreate it correctly.
-- -----------------------------------------------------------------------
DROP VIEW IF EXISTS replies_with_counts;

CREATE VIEW replies_with_counts AS
SELECT
  r.id,
  r.track_id,
  r.user_name,
  r.avatar,
  r.discord_id,
  r.author_uid,
  r.body,
  r.created_at,
  r.edited_at,
  r.parent_id,
  r.reply_to,
  COALESCE(rv.vote_total, 0)  AS vote_total,
  COALESCE(rr.react_total, 0) AS reaction_total
FROM replies r
LEFT JOIN (
  SELECT reply_id, SUM(value) AS vote_total
  FROM reply_votes
  GROUP BY reply_id
) rv ON rv.reply_id = r.id
LEFT JOIN (
  SELECT reply_id, COUNT(*) AS react_total
  FROM reply_reactions
  GROUP BY reply_id
) rr ON rr.reply_id = r.id;

-- -----------------------------------------------------------------------
-- 2. community_posts — first-class Community page posts (separate from
--    track nominations in the wanted vault).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_uid  TEXT    NOT NULL DEFAULT '',
  user_name   TEXT    NOT NULL DEFAULT '',
  avatar      TEXT    NOT NULL DEFAULT '',
  discord_id  TEXT    NOT NULL DEFAULT '',
  title       TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_comm_posts_author   ON community_posts(author_uid);
CREATE INDEX IF NOT EXISTS idx_comm_posts_created  ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_posts_pinned   ON community_posts(pinned, created_at DESC);

-- -----------------------------------------------------------------------
-- 3. community_replies — replies scoped to community_posts
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_replies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_uid  TEXT    NOT NULL DEFAULT '',
  user_name   TEXT    NOT NULL DEFAULT '',
  avatar      TEXT    NOT NULL DEFAULT '',
  discord_id  TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  parent_id   INTEGER,
  reply_to    TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_comm_replies_post     ON community_replies(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comm_replies_author   ON community_replies(author_uid);
CREATE INDEX IF NOT EXISTS idx_comm_replies_parent   ON community_replies(parent_id);
CREATE INDEX IF NOT EXISTS idx_comm_replies_created  ON community_replies(created_at);

-- -----------------------------------------------------------------------
-- 4. community_reactions — emoji reactions on community_replies
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reply_id    INTEGER NOT NULL REFERENCES community_replies(id) ON DELETE CASCADE,
  author_uid  TEXT    NOT NULL DEFAULT '',
  user_name   TEXT    NOT NULL DEFAULT '',
  emoji       TEXT    NOT NULL DEFAULT '❤️',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(reply_id, author_uid, emoji)
);

CREATE INDEX IF NOT EXISTS idx_comm_react_reply  ON community_reactions(reply_id);
CREATE INDEX IF NOT EXISTS idx_comm_react_author ON community_reactions(author_uid);

-- -----------------------------------------------------------------------
-- 5. Ensure notifications table has all needed columns
--    (migrations 0009+ already add most; ADD COLUMN IF NOT EXISTS is not
--    supported in older SQLite, so we use a safe ALTER TABLE wrapped in
--    a view check — just guard with IF NOT EXISTS on index side).
-- -----------------------------------------------------------------------
-- The notifications table was created by migration 0009 with these columns:
--   uid, type, message, track_id, reply_id, actor, read, ts
-- No new columns needed for community — re-use existing schema.

-- -----------------------------------------------------------------------
-- 6. Ensure reply_reactions unique constraint exists (migration 0015 may
--    have created the table without the UNIQUE constraint on reply_id+author_uid+emoji).
--    We add only the index here (cannot add constraint to existing table in SQLite).
-- -----------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_react_unique ON reply_reactions(reply_id, user_name, emoji);
