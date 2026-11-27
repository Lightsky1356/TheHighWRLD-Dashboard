-- 0066: chat-like comments on gallery artwork.
-- Author identity is server-derived from the session; the client never sends
-- a uid. A deleted comment keeps a tombstone so the thread shape survives.
CREATE TABLE IF NOT EXISTS gallery_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  uid TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  author_avatar TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_gallery_comments_item ON gallery_comments(item_id, id);
CREATE INDEX IF NOT EXISTS idx_gallery_comments_uid ON gallery_comments(uid, created_at DESC);
