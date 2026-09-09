CREATE TABLE IF NOT EXISTS wanted_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track TEXT NOT NULL,
  authorUid TEXT NOT NULL DEFAULT '',
  authorName TEXT NOT NULL DEFAULT 'Anonymous',
  text TEXT NOT NULL,
  parentId INTEGER,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parentId) REFERENCES wanted_replies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wanted_replies_track ON wanted_replies(track);
CREATE INDEX IF NOT EXISTS idx_wanted_replies_parent ON wanted_replies(parentId);
