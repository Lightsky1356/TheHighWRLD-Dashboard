-- Suggestion reply threads. Mirrors song_comments: a self-referencing parent_id
-- makes a reply, and deleted_at leaves a tombstone so a thread keeps its shape.
CREATE TABLE IF NOT EXISTS suggestion_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id INTEGER NOT NULL REFERENCES suggestions_v2(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES suggestion_comments(id) ON DELETE CASCADE,
  author_uid TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  author_avatar TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sugg_comments_suggestion ON suggestion_comments(suggestion_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sugg_comments_parent ON suggestion_comments(parent_id);
