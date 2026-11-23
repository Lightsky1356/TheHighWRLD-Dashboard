-- Public Lobby chat. A small message store; realtime fanout uses the existing
-- CommunityHub Durable Object via hubBroadcast (no new DO or group membership).
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT 'Member',
  avatar TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  reply_to_id INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recent ON chat_messages(id DESC);
