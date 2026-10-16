-- Per-category notification preferences.
--
-- WHY THIS TABLE EXISTS
-- user_privacy has exactly one notification column: notifications_enabled. It is
-- a single master switch, so the only choice a user had was "everything" or
-- "nothing" - and because createNotification() gates on it for all thirteen
-- writers, turning it off also silenced replies, mentions, follows, playlist
-- favourites, drop alerts AND every moderation notice, including ban notices.
-- Someone who only wanted less DMs had no way to say that.
--
-- A separate table rather than more columns on user_privacy, because that table
-- is a privacy/visibility record with its own API (GET/POST /api/privacy) and its
-- own write path. Notification categories are a different concern with a different
-- consumer, and folding them in would mean every privacy write has to know about
-- them.
--
-- No row means the server default: everything on. That is the same fail-open rule
-- notificationsEnabled() already uses, and it means an existing account keeps
-- its current behaviour without a backfill.
--
-- NOT a copy of user_privacy.notifications_enabled. That column stays as the
-- master kill switch and is still honoured; these are narrower opt-outs under it.

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  uid              TEXT    PRIMARY KEY,
  replies          INTEGER NOT NULL DEFAULT 1,
  wanted_replies   INTEGER NOT NULL DEFAULT 1,
  mentions         INTEGER NOT NULL DEFAULT 1,
  upvotes          INTEGER NOT NULL DEFAULT 1,
  direct_messages  INTEGER NOT NULL DEFAULT 1,
  friend_requests  INTEGER NOT NULL DEFAULT 1,
  -- in_site and push are separate on purpose. Someone may want a DMs entry in the
  -- bell but nothing on their lock screen, or the reverse.
  in_site          INTEGER NOT NULL DEFAULT 1,
  push             INTEGER NOT NULL DEFAULT 1,
  -- Drives whether a DM notification carries the message body. Off means the
  -- notification says "you received a new message" and nothing more, so a lock
  -- screen does not expose private content to anyone who picks the phone up.
  message_previews INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- read_only lookup path: one recipient, their prefs.
CREATE INDEX IF NOT EXISTS idx_notif_prefs_uid ON user_notification_prefs(uid);

-- Idempotency for events that are inherently repeated.
--
-- Retrying an event must not create a second row, and re-upvoting something you
-- already upvoted should not stack notices. The index is scoped to upvote-family
-- types only, and deliberately does NOT cover direct messages or replies: two
-- genuine messages from the same person an hour apart are two notifications, and
-- a unique index here would silently swallow the second one.
--
-- SQLite treats NULLs as distinct in unique indexes, hence IFNULL(...) = 0 in the
-- queries that use it rather than bare IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comm_notif_vote_once
  ON community_notifications(recipient_uid, type, actor_uid, IFNULL(post_id, 0), IFNULL(reply_id, 0))
  WHERE type IN ('vote', 'upvote', 'reply_vote');