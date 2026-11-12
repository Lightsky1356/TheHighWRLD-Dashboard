-- ============================================================================
-- SONG COMMENTS
--
-- A comment thread per song, the way the song pages on juicewrld.io carry
-- one. The thread hangs off the track title, because that is the one name
-- every part of the site agrees on: the player shows it, the search
-- matches it and the vault stores it.
--
-- A reply points at the comment it answers, so a thread reads as a thread
-- and not as a flat list. The parent is ON DELETE CASCADE, so deleting a
-- comment takes its replies with it.
--
-- The heartbeat of a song is what makes a comment worth reading, so a
-- comment remembers the moment it was written at: "1:12 on Fenty". The
-- seconds and the label are kept separately, so the label can be
-- redrawn if a song is renamed.
-- ============================================================================
CREATE TABLE IF NOT EXISTS song_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_title TEXT NOT NULL DEFAULT '',
  parent_id INTEGER REFERENCES song_comments(id) ON DELETE CASCADE,
  author_uid TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  author_avatar TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  at_seconds INTEGER NOT NULL DEFAULT 0,
  at_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_song_comments_track ON song_comments(track_title, created_at);
CREATE INDEX IF NOT EXISTS idx_song_comments_parent ON song_comments(parent_id);

-- The heart under a comment. One row per person per comment.
CREATE TABLE IF NOT EXISTS song_comment_likes (
  comment_id INTEGER NOT NULL REFERENCES song_comments(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (comment_id, uid)
);
