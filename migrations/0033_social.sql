-- Mutual friends and private one-to-one messages.
-- Additive only; follows is created defensively for older databases where the
-- existing follow API was deployed without its schema migration.

CREATE TABLE IF NOT EXISTS follows (
  follower_uid TEXT NOT NULL,
  followed_uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (follower_uid, followed_uid),
  CHECK (follower_uid <> followed_uid)
);

CREATE INDEX IF NOT EXISTS idx_follows_followed
  ON follows(followed_uid, follower_uid);

CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_uid TEXT NOT NULL,
  recipient_uid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (requester_uid <> recipient_uid)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_pair
  ON friend_requests(
    CASE WHEN requester_uid < recipient_uid THEN requester_uid ELSE recipient_uid END,
    CASE WHEN requester_uid < recipient_uid THEN recipient_uid ELSE requester_uid END
  ) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient
  ON friend_requests(recipient_uid, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester
  ON friend_requests(requester_uid, status, created_at DESC);

CREATE TABLE IF NOT EXISTS social_friends (
  uid_a TEXT NOT NULL,
  uid_b TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (uid_a, uid_b),
  CHECK (uid_a < uid_b)
);
CREATE INDEX IF NOT EXISTS idx_social_friends_b ON social_friends(uid_b, uid_a);

CREATE TABLE IF NOT EXISTS dm_conversations (
  id TEXT PRIMARY KEY,
  uid_a TEXT NOT NULL,
  uid_b TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (uid_a, uid_b),
  CHECK (uid_a < uid_b)
);

CREATE TABLE IF NOT EXISTS dm_conversation_members (
  conversation_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (conversation_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_dm_members_uid ON dm_conversation_members(uid, conversation_id);

CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  sender_uid TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  reply_to_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation
  ON dm_messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_dm_messages_sender
  ON dm_messages(sender_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS dm_message_reactions (
  message_id INTEGER NOT NULL,
  uid TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (message_id, uid, emoji)
);
CREATE INDEX IF NOT EXISTS idx_dm_reactions_message ON dm_message_reactions(message_id);

CREATE TABLE IF NOT EXISTS user_social_settings (
  uid TEXT PRIMARY KEY,
  friend_requests TEXT NOT NULL DEFAULT 'everyone'
    CHECK (friend_requests IN ('everyone', 'followers', 'nobody')),
  direct_messages TEXT NOT NULL DEFAULT 'friends'
    CHECK (direct_messages IN ('everyone', 'friends', 'nobody')),
  online_status TEXT NOT NULL DEFAULT 'friends'
    CHECK (online_status IN ('everyone', 'friends', 'nobody')),
  activity_status TEXT NOT NULL DEFAULT 'friends'
    CHECK (activity_status IN ('everyone', 'friends', 'nobody')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
